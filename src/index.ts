import { Plugin } from "@opencode-ai/plugin";
import {
  canFetch,
  mergeProvider,
  type ProviderInfo,
  type Snapshot,
} from "./format.ts";
import { gatedGet, usageGate } from "./gate.ts";
import {
  appendUsageLog,
  truncateBody,
  type UsageProvider,
  type UsageTrigger,
} from "./log.ts";
import {
  ANTHROPIC_OAUTH_HEADERS,
  ANTHROPIC_USAGE_URL,
  GO_USAGE_URL,
  GROK_BILLING_URL,
  OPENAI_USAGE_URL,
  fetchJson,
  fetchMetaSubscription,
  isApiKeyCredential,
  openAIRequestHeaders,
  parseAnthropic,
  parseGo,
  parseGrok,
  parseMeta,
  parseOpenAI,
  tokenFromCredential,
} from "./providers.ts";
import { Usage } from "./rpc.ts";

type Connection = Plugin.Context["integration"]["connection"];

function logProvider(integrationID: string): UsageProvider {
  if (integrationID === "xai") return "grok";
  if (integrationID === "opencode-go") return "go";
  if (integrationID === "meta") return "meta";
  if (integrationID === "openai") return "openai";
  return "anthropic";
}

async function bearer(
  connection: Connection,
  integrationID: string,
): Promise<string | undefined> {
  const active = await connection.active(integrationID);
  if (!active) return undefined;
  return tokenFromCredential(await connection.resolve(active));
}

/** Anthropic API keys have no subscription quota: report pay-as-you-go. */
export const ANTHROPIC_PAYG: ProviderInfo = { status: "ok", product: "Claude" };

/** OpenAI API keys have no ChatGPT subscription quota: report pay-as-you-go. */
export const OPENAI_PAYG: ProviderInfo = { status: "ok", product: "ChatGPT" };

type ExtraHeaders =
  | Record<string, string>
  | ((credential: unknown) => Record<string, string> | undefined);

async function loadProvider(
  connection: Connection,
  integrationID: string,
  url: string,
  parse: (status: number, body: unknown) => ProviderInfo,
  trigger: UsageTrigger,
  signal?: AbortSignal,
  extraHeaders?: ExtraHeaders,
  payg?: ProviderInfo,
): Promise<ProviderInfo> {
  const started = Date.now();
  const logHttp = (info: {
    status: string;
    error?: string;
    httpStatus?: number;
    body?: unknown;
  }) => {
    const failed = info.status === "error" || info.status === "rate-limited";
    void appendUsageLog({
      ts: new Date().toISOString(),
      kind: "http",
      provider: logProvider(integrationID),
      trigger,
      httpStatus: info.httpStatus,
      status: info.status,
      error: info.error,
      ms: Date.now() - started,
      body: failed ? truncateBody(info.body) : undefined,
    });
  };

  try {
    const active = await connection.active(integrationID);
    const credential = active ? await connection.resolve(active) : undefined;
    if (payg && isApiKeyCredential(credential)) {
      // No request is made: API keys carry no subscription quota.
      logHttp({ status: "payg" });
      return payg;
    }
    const token = tokenFromCredential(credential);
    if (!token) {
      logHttp({ status: "missing" });
      return { status: "missing" };
    }
    const headers =
      typeof extraHeaders === "function"
        ? extraHeaders(credential)
        : extraHeaders;
    const { status, body } = await fetchJson(url, token, signal, headers);
    const parsed = parse(status, body);
    logHttp({
      status: parsed.status,
      error: parsed.error,
      httpStatus: status,
      body,
    });
    return parsed;
  } catch (error) {
    const message = error instanceof Error ? error.message : "fetch failed";
    const parsed = /abort/i.test(message)
      ? { status: "error", error: "timeout" }
      : { status: "error", error: message };
    logHttp(parsed);
    return parsed;
  }
}

async function loadMetaProvider(
  connection: Connection,
  trigger: UsageTrigger,
  signal?: AbortSignal,
): Promise<ProviderInfo> {
  const started = Date.now();
  const logHttp = (info: {
    status: string;
    error?: string;
    httpStatus?: number;
  }) => {
    void appendUsageLog({
      ts: new Date().toISOString(),
      kind: "http",
      provider: "meta",
      trigger,
      httpStatus: info.httpStatus,
      status: info.status,
      error: info.error,
      ms: Date.now() - started,
    });
  };

  try {
    const token = await bearer(connection, "meta");
    if (!token) {
      logHttp({ status: "missing" });
      return { status: "missing" };
    }
    // The probe is a minimal streaming Responses call (~25 tokens). Only the
    // `response.subscription_usage` SSE event is read; the completion text is
    // discarded. The body is never logged.
    const { status, subscription } = await fetchMetaSubscription(token, signal);
    const parsed = parseMeta(status, subscription);
    logHttp({ status: parsed.status, error: parsed.error, httpStatus: status });
    return parsed;
  } catch (error) {
    const message = error instanceof Error ? error.message : "fetch failed";
    const parsed = /abort/i.test(message)
      ? { status: "error", error: "timeout" }
      : { status: "error", error: message };
    logHttp(parsed);
    return parsed;
  }
}

function isTurnEnd(event: { type: string; data?: unknown }): boolean {
  if (event.type === "session.execution.succeeded") return true;
  if (event.type === "session.execution.failed") return true;
  if (event.type !== "session.execution.interrupted") return false;
  const data = event.data;
  if (!data || typeof data !== "object") return true;
  return (data as { reason?: string }).reason !== "shutdown";
}

async function setup(ctx: Plugin.Context) {
  const connection = ctx.integration.connection;

  const load = async (
    trigger: UsageTrigger,
    signal?: AbortSignal,
  ): Promise<Snapshot> => {
    const [grok, go, anthropic, meta, openai] = await Promise.all([
      loadProvider(
        connection,
        "xai",
        GROK_BILLING_URL,
        parseGrok,
        trigger,
        signal,
      ),
      loadProvider(
        connection,
        "opencode-go",
        GO_USAGE_URL,
        parseGo,
        trigger,
        signal,
      ),
      loadProvider(
        connection,
        "anthropic",
        ANTHROPIC_USAGE_URL,
        parseAnthropic,
        trigger,
        signal,
        ANTHROPIC_OAUTH_HEADERS,
        ANTHROPIC_PAYG,
      ),
      loadMetaProvider(connection, trigger, signal),
      loadProvider(
        connection,
        "openai",
        OPENAI_USAGE_URL,
        parseOpenAI,
        trigger,
        signal,
        openAIRequestHeaders,
        OPENAI_PAYG,
      ),
    ]);
    const prev = usageGate().snapshot;
    return JSON.parse(
      JSON.stringify({
        fetchedAt: new Date().toISOString(),
        grok: mergeProvider(prev?.grok, grok),
        go: mergeProvider(prev?.go, go),
        anthropic: mergeProvider(prev?.anthropic, anthropic),
        meta: mergeProvider(prev?.meta, meta),
        openai: mergeProvider(prev?.openai, openai),
      }),
    ) as Snapshot;
  };

  const getSnapshot = async (
    refresh: boolean,
    signal?: AbortSignal,
    trigger: UsageTrigger = "rpc",
  ): Promise<Snapshot> => {
    const { cached, promise } = gatedGet(refresh, () => load(trigger, signal));
    void appendUsageLog({
      ts: new Date().toISOString(),
      kind: "query",
      trigger,
      refresh,
      cached,
    });
    return promise;
  };

  const registration = await ctx.rpc.register(Usage, {
    get: async (input, rpcCtx) => {
      const refresh = Boolean(
        (input as { refresh?: boolean } | undefined)?.refresh,
      );
      return getSnapshot(
        refresh,
        rpcCtx.signal,
        refresh ? "rpc-refresh" : "rpc",
      );
    },
  });

  const tick = async (refresh = false, trigger: UsageTrigger = "turn-end") => {
    try {
      const snapshot = await getSnapshot(refresh, undefined, trigger);
      await registration.events.emit("updated", snapshot);
    } catch (error) {
      console.error("[oc.usage] refresh failed", error);
    }
  };

  const controller = new AbortController();
  const subscribe = ctx.event?.subscribe;
  if (typeof subscribe === "function") {
    void (async () => {
      try {
        for await (const event of subscribe({
          signal: controller.signal,
        })) {
          if (!isTurnEnd(event)) continue;
          const gate = usageGate();
          if (gate.inflight) continue;
          if (gate.at && !canFetch(gate.at)) continue;
          void tick(false);
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        console.error("[oc.usage] event subscribe failed", error);
      }
    })();
  } else {
    console.error("[oc.usage] ctx.event.subscribe is not available");
  }

  return () => {
    controller.abort();
    void registration.dispose();
  };
}

export default Plugin.define({
  id: "oc.usage",
  setup,
});
