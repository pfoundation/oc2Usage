import { Plugin } from "@opencode-ai/plugin";
import {
  canFetch,
  mergeProvider,
  type ProviderInfo,
  type Snapshot,
} from "./format.ts";
import {
  ANTHROPIC_OAUTH_HEADERS,
  ANTHROPIC_USAGE_URL,
  GO_USAGE_URL,
  GROK_BILLING_URL,
  fetchJson,
  parseAnthropic,
  parseGo,
  parseGrok,
  tokenFromCredential,
} from "./providers.ts";
import { Usage } from "./rpc.ts";

type Connection = Plugin.Context["integration"]["connection"];

async function bearer(
  connection: Connection,
  integrationID: string,
): Promise<string | undefined> {
  const active = await connection.active(integrationID);
  if (!active) return undefined;
  return tokenFromCredential(await connection.resolve(active));
}

async function loadProvider(
  connection: Connection,
  integrationID: string,
  url: string,
  parse: (status: number, body: unknown) => ProviderInfo,
  signal?: AbortSignal,
  extraHeaders?: Record<string, string>,
): Promise<ProviderInfo> {
  try {
    const token = await bearer(connection, integrationID);
    if (!token) return { status: "missing" };
    const { status, body } = await fetchJson(url, token, signal, extraHeaders);
    return parse(status, body);
  } catch (error) {
    const message = error instanceof Error ? error.message : "fetch failed";
    if (/abort/i.test(message)) return { status: "error", error: "timeout" };
    return { status: "error", error: message };
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
  let cache:
    | {
        at: number;
        snapshot: Snapshot;
      }
    | undefined;
  let inflight: Promise<Snapshot> | undefined;

  const load = async (signal?: AbortSignal): Promise<Snapshot> => {
    const [grok, go, anthropic] = await Promise.all([
      loadProvider(connection, "xai", GROK_BILLING_URL, parseGrok, signal),
      loadProvider(connection, "opencode-go", GO_USAGE_URL, parseGo, signal),
      loadProvider(
        connection,
        "anthropic",
        ANTHROPIC_USAGE_URL,
        parseAnthropic,
        signal,
        ANTHROPIC_OAUTH_HEADERS,
      ),
    ]);
    const prev = cache?.snapshot;
    return JSON.parse(
      JSON.stringify({
        fetchedAt: new Date().toISOString(),
        grok: mergeProvider(prev?.grok, grok),
        go: mergeProvider(prev?.go, go),
        anthropic: mergeProvider(prev?.anthropic, anthropic),
      }),
    ) as Snapshot;
  };

  const getSnapshot = async (
    refresh: boolean,
    signal?: AbortSignal,
  ): Promise<Snapshot> => {
    if (!refresh) {
      if (inflight) return inflight;
      if (cache && !canFetch(cache.at)) return cache.snapshot;
    }

    inflight = (async () => {
      const snapshot = await load(signal);
      cache = { at: Date.now(), snapshot };
      return snapshot;
    })().finally(() => {
      inflight = undefined;
    });

    return inflight;
  };

  const registration = await ctx.rpc.register(Usage, {
    get: async (input, rpcCtx) => {
      const refresh = Boolean(
        (input as { refresh?: boolean } | undefined)?.refresh,
      );
      return getSnapshot(refresh, rpcCtx.signal);
    },
  });

  const tick = async (refresh = false) => {
    try {
      const snapshot = await getSnapshot(refresh);
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
          if (cache && !canFetch(cache.at)) continue;
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
