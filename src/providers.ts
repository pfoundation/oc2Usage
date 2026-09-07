import type { ProviderInfo, WindowInfo } from "./format.ts";

export const USER_AGENT = "usageTrackerWidget/0.3.1";
export const GO_USAGE_URL = "https://opencode.ai/zen/go/v1/usage";
export const GROK_BILLING_URL =
  "https://cli-chat-proxy.grok.com/v1/billing?format=credits";
export const ANTHROPIC_USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
export const META_RESPONSES_URL = "https://api.meta.ai/v1/responses";
export const META_PROBE_MODEL = "muse-spark-1.3";
export const OPENAI_USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";
export const OPENAI_SESSION_WINDOW_SECONDS = 18_000;
export const OPENAI_WEEKLY_WINDOW_SECONDS = 604_800;
export const ANTHROPIC_OAUTH_HEADERS = {
  "anthropic-beta": "oauth-2025-04-20",
  "anthropic-version": "2023-06-01",
};

type Json = Record<string, unknown>;

function asRecord(value: unknown): Json | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Json)
    : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

/** Number or numeric string (the wham/usage endpoint is loose with types). */
function asFloat(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function asInt(value: unknown): number | undefined {
  const n = asFloat(value);
  return n === undefined ? undefined : Math.trunc(n);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function windowOf(value: unknown): WindowInfo | undefined {
  const rec = asRecord(value);
  if (!rec) return undefined;
  const percent = asNumber(rec.percent);
  const status = asString(rec.status);
  const resetsAt = asString(rec.resetsAt);
  if (percent === undefined && !status && !resetsAt) return undefined;
  return { status, percent, resetsAt };
}

export async function fetchJson(
  url: string,
  token: string,
  signal?: AbortSignal,
  extraHeaders?: Record<string, string>,
): Promise<{ status: number; body: unknown }> {
  const timeout = AbortSignal.timeout(15_000);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "User-Agent": USER_AGENT,
      ...extraHeaders,
    },
    signal: combined,
  });
  const text = await response.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    // keep raw text
  }
  return { status: response.status, body };
}

export function parseGo(status: number, body: unknown): ProviderInfo {
  if (status === 401) return { status: "error", error: "unauthorized" };
  if (status === 403) return { status: "missing", error: "no Go subscription" };
  if (status === 429) return { status: "rate-limited", error: "rate limited" };
  if (status < 200 || status >= 300) {
    return { status: "error", error: `HTTP ${status}` };
  }
  const root = asRecord(body);
  const usage = asRecord(root?.usage) ?? root;
  if (!usage) return { status: "error", error: "unrecognized payload" };
  const rolling = windowOf(usage.rolling);
  const weekly = windowOf(usage.weekly);
  const monthly = windowOf(usage.monthly);
  const picked = monthly ?? weekly ?? rolling;
  return {
    status: "ok",
    rolling,
    weekly,
    monthly,
    percent: picked?.percent,
    resetsAt: picked?.resetsAt,
    label: monthly ? "30d" : weekly ? "7d" : "5h",
  };
}

export function parseGrok(status: number, body: unknown): ProviderInfo {
  if (status === 401 || status === 403)
    return { status: "error", error: "unauthorized" };
  if (status === 429) return { status: "rate-limited", error: "rate limited" };
  if (status < 200 || status >= 300) {
    return { status: "error", error: `HTTP ${status}` };
  }
  const root = asRecord(body);
  const config = asRecord(root?.config) ?? root;
  if (!config) return { status: "error", error: "unrecognized payload" };

  const percent =
    asNumber(config.creditUsagePercent) ??
    asNumber(config.usagePercent) ??
    asNumber(config.percent);

  const period = asRecord(config.currentPeriod);
  const periodStart =
    asString(period?.start) ?? asString(config.billingPeriodStart);
  const periodEnd = asString(period?.end) ?? asString(config.billingPeriodEnd);

  let product: string | undefined;
  const products = config.productUsage;
  if (Array.isArray(products) && products.length > 0) {
    const first = asRecord(products[0]);
    product = asString(first?.product);
    if (percent === undefined) {
      const fromProduct = asNumber(first?.usagePercent);
      if (fromProduct !== undefined) {
        return {
          status: "ok",
          percent: fromProduct,
          label: "7d",
          product,
          periodStart,
          periodEnd,
          resetsAt: periodEnd,
          weekly: { percent: fromProduct, resetsAt: periodEnd, status: "ok" },
        };
      }
    }
  }

  if (percent === undefined)
    return { status: "error", error: "no percent in payload" };

  return {
    status: "ok",
    percent,
    label: "7d",
    product,
    periodStart,
    periodEnd,
    resetsAt: periodEnd,
    weekly: { percent, resetsAt: periodEnd, status: "ok" },
  };
}

function oauthWindow(value: unknown): WindowInfo | undefined {
  const rec = asRecord(value);
  if (!rec) return undefined;
  const percent =
    asNumber(rec.utilization) ??
    asNumber(rec.percent) ??
    asNumber(rec.used_percent);
  const resetsAt = asString(rec.resets_at) ?? asString(rec.resetsAt);
  if (percent === undefined && !resetsAt) return undefined;
  const window: WindowInfo = { status: "ok" };
  if (percent !== undefined) window.percent = percent;
  if (resetsAt) window.resetsAt = resetsAt;
  return window;
}

function scopedWindows(root: Json): NonNullable<ProviderInfo["scoped"]> {
  const out: NonNullable<ProviderInfo["scoped"]> = [];
  const seen = new Set<string>();
  const add = (label: string, window?: WindowInfo) => {
    if (!window || typeof window.percent !== "number") return;
    const key = label.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ label, ...window });
  };

  if (Array.isArray(root.limits)) {
    for (const item of root.limits) {
      const rec = asRecord(item);
      if (!rec || asString(rec.kind) !== "weekly_scoped") continue;
      const model = asRecord(asRecord(rec.scope)?.model);
      const display =
        asString(model?.display_name) ?? asString(model?.displayName);
      if (!display) continue;
      add(display, oauthWindow(rec));
    }
  }

  add("Fable", oauthWindow(root.seven_day_fable));
  add("Sonnet", oauthWindow(root.seven_day_sonnet));
  add("Opus", oauthWindow(root.seven_day_opus));
  return out;
}

export function parseAnthropic(status: number, body: unknown): ProviderInfo {
  if (status === 401 || status === 403)
    return { status: "error", error: "unauthorized" };
  if (status === 429) return { status: "rate-limited", error: "rate limited" };
  if (status < 200 || status >= 300)
    return { status: "error", error: `HTTP ${status}` };
  const root = asRecord(body);
  if (!root) return { status: "error", error: "unrecognized payload" };
  const rolling = oauthWindow(root.five_hour);
  const weekly = oauthWindow(root.seven_day);
  const scoped = scopedWindows(root);
  const fableEntry = scoped.find(
    (item) => item.label.toLowerCase() === "fable",
  );
  const fable = fableEntry
    ? {
        status: fableEntry.status,
        percent: fableEntry.percent,
        resetsAt: fableEntry.resetsAt,
      }
    : undefined;
  const extra = asRecord(root.extra_usage);
  let monthly = oauthWindow(root.extra_usage);
  if (extra && monthly && monthly.percent === undefined) {
    const used = asNumber(extra.used_credits);
    const limit = asNumber(extra.monthly_limit);
    if (used !== undefined && limit && limit > 0) {
      monthly = { ...monthly, percent: (used / limit) * 100, status: "ok" };
    }
  }
  const picked = rolling ?? weekly ?? fable ?? monthly;
  if (!picked || typeof picked.percent !== "number")
    return { status: "error", error: "no utilization in payload" };
  return {
    status: "ok",
    rolling,
    weekly,
    monthly,
    fable,
    scoped: scoped.length ? scoped : undefined,
    percent: picked.percent,
    resetsAt: picked.resetsAt,
    label: rolling ? "5h" : weekly ? "7d" : fableEntry ? "Fable" : "extra",
    product: "Claude",
  };
}

export function tokenFromCredential(credential: unknown): string | undefined {
  if (typeof credential === "string" && credential.length > 0)
    return credential;
  const rec = asRecord(credential);
  if (!rec) return undefined;
  const nested = asRecord(rec.value) ?? rec;
  const key = asString(nested.key);
  if (key) return key;
  const access = asString(nested.access);
  if (access) return access;
  const token = asString(nested.token);
  if (token) return token;
  return undefined;
}

/**
 * True when the resolved credential is a plain API key (`type: "key"`), which
 * covers both `/connect` API keys and `*_API_KEY` env credentials. A pasted
 * OAuth access token (`sk-ant-oat…`, or a ChatGPT JWT) is treated as OAuth so
 * it still reaches the subscription usage endpoint.
 */
export function isApiKeyCredential(credential: unknown): boolean {
  const rec = asRecord(credential);
  if (!rec) return false;
  const nested = asRecord(rec.value) ?? rec;
  if (nested.type !== "key") return false;
  const key = asString(nested.key);
  if (key && /^sk-ant-oat/i.test(key)) return false;
  if (key && isJwtLike(key)) return false;
  return true;
}

function isJwtLike(key: string): boolean {
  const parts = key.split(".");
  return (
    parts.length === 3 &&
    parts[0].startsWith("eyJ") &&
    parts[1].length > 0 &&
    parts[2].length > 0
  );
}

export function metaProbeBody(model = META_PROBE_MODEL): string {
  return JSON.stringify({
    model,
    input: "ok",
    max_output_tokens: 16,
    reasoning: { effort: "minimal" },
    store: false,
    stream: true,
  });
}

/**
 * Scan a Responses SSE stream for the `response.subscription_usage` event
 * (the same event Muse Code reads for `/usage`) and return its
 * `subscription` payload: `{ tier, window: { used_percent, resets_at,
 * window_duration_mins }, weekly: { used_percent, resets_at } }`.
 * `resets_at` values are unix epoch seconds. Returns undefined when the
 * stream carries no subscription event (e.g. pay-as-you-go keys).
 */
export function extractMetaSubscription(streamText: string): unknown {
  for (const line of streamText.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) continue;
    const data = trimmed.slice("data:".length).trim();
    if (!data || data === "[DONE]") continue;
    let event: unknown;
    try {
      event = JSON.parse(data);
    } catch {
      continue;
    }
    const rec = asRecord(event);
    if (!rec || rec.type !== "response.subscription_usage") continue;
    if (rec.subscription !== undefined) return rec.subscription;
  }
  return undefined;
}

export async function fetchMetaSubscription(
  token: string,
  signal?: AbortSignal,
): Promise<{ status: number; subscription: unknown }> {
  const timeout = AbortSignal.timeout(15_000);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const response = await fetch(META_RESPONSES_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "text/event-stream",
      "Content-Type": "application/json",
      "User-Agent": USER_AGENT,
    },
    body: metaProbeBody(),
    signal: combined,
  });
  const text = await response.text();
  return {
    status: response.status,
    subscription: extractMetaSubscription(text),
  };
}

function metaResetsAt(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return new Date(value * 1000).toISOString();
  }
  return asString(value);
}

function metaWindow(value: unknown): WindowInfo | undefined {
  const rec = asRecord(value);
  if (!rec) return undefined;
  const percent =
    asNumber(rec.used_percent) ??
    asNumber(rec.utilization) ??
    asNumber(rec.percent);
  const resetsAt = metaResetsAt(rec.resets_at ?? rec.resetsAt);
  if (percent === undefined && !resetsAt) return undefined;
  const window: WindowInfo = { status: "ok" };
  if (percent !== undefined) window.percent = percent;
  if (resetsAt) window.resetsAt = resetsAt;
  return window;
}

export function parseMeta(status: number, body: unknown): ProviderInfo {
  if (status === 401 || status === 403)
    return { status: "error", error: "unauthorized" };
  if (status === 429) return { status: "rate-limited", error: "rate limited" };
  if (status < 200 || status >= 300) {
    return { status: "error", error: `HTTP ${status}` };
  }
  const root = asRecord(body);
  const subscription = asRecord(root?.subscription) ?? root;
  if (!subscription) return { status: "ok" };
  const rolling = metaWindow(subscription.window);
  const weekly = metaWindow(subscription.weekly);
  const picked = rolling ?? weekly;
  if (!picked || typeof picked.percent !== "number") return { status: "ok" };
  return {
    status: "ok",
    rolling,
    weekly,
    percent: picked.percent,
    resetsAt: picked.resetsAt,
    label: rolling ? "5h" : "week",
    product: "Meta",
  };
}

const OPENAI_ACCOUNT_KEYS = [
  "accountId",
  "accountID",
  "chatgpt_account_id",
  "chatgptAccountId",
  "chatgptAccountID",
] as const;

function pickAccountId(scope: Json | undefined): string | undefined {
  if (!scope) return undefined;
  for (const key of OPENAI_ACCOUNT_KEYS) {
    const id = asString(scope[key]);
    if (id) return id;
  }
  return undefined;
}

function decodeJwtPayload(token: string): Json | undefined {
  const parts = token.split(".");
  if (parts.length !== 3 || !parts[1]) return undefined;
  try {
    const json = Buffer.from(parts[1], "base64url").toString("utf8");
    return asRecord(JSON.parse(json));
  } catch {
    return undefined;
  }
}

function accountIdFromJwt(token: string): string | undefined {
  const payload = decodeJwtPayload(token);
  if (!payload) return undefined;
  const auth = asRecord(payload["https://api.openai.com/auth"]);
  return (
    pickAccountId(auth) ??
    asString(payload.chatgpt_account_id) ??
    asString(payload.account_id) ??
    undefined
  );
}

/**
 * ChatGPT account id for the `ChatGPT-Account-Id` header. OpenCode stores it
 * on the credential (`accountId` in v1 auth.json, `metadata.accountID` in
 * v2); as a fallback it is decoded from the access-token JWT claims, the way
 * OpenCode's own OpenAI integration extracts it. Returns undefined for API
 * keys, which carry no account id (and skip the endpoint anyway).
 */
export function accountIdFromCredential(
  credential: unknown,
): string | undefined {
  if (typeof credential === "string") return accountIdFromJwt(credential);
  const rec = asRecord(credential);
  if (!rec) return undefined;
  const nested = asRecord(rec.value) ?? rec;
  const scopes = [nested, asRecord(nested.metadata)];
  if (nested !== rec) scopes.push(rec, asRecord(rec.metadata));
  for (const scope of scopes) {
    const id = pickAccountId(scope);
    if (id) return id;
  }
  const access = asString(nested.access);
  if (access) return accountIdFromJwt(access);
  return undefined;
}

/** Extra headers for the wham/usage request (account id when known). */
export function openAIRequestHeaders(
  credential: unknown,
): Record<string, string> | undefined {
  const accountId = accountIdFromCredential(credential);
  if (!accountId) return undefined;
  return { "ChatGPT-Account-Id": accountId };
}

function openAIResetsAt(rec: Json, now: number): string | undefined {
  const resetAt = asInt(rec.reset_at);
  if (resetAt !== undefined && resetAt > 0) {
    return new Date(resetAt * 1000).toISOString();
  }
  const after = asInt(rec.reset_after_seconds ?? rec.resetAfterSeconds);
  if (after !== undefined && after >= 0) {
    return new Date(now + after * 1000).toISOString();
  }
  return asString(rec.resetsAt);
}

function openAIWindow(
  value: unknown,
  now: number,
): { window?: WindowInfo; seconds?: number } {
  const rec = asRecord(value);
  if (!rec) return {};
  const percent = asFloat(rec.used_percent ?? rec.utilization ?? rec.percent);
  const seconds = asInt(rec.limit_window_seconds ?? rec.limitWindowSeconds);
  const resetsAt = openAIResetsAt(rec, now);
  if (percent === undefined && !resetsAt) return {};
  const window: WindowInfo = { status: "ok" };
  if (percent !== undefined) window.percent = percent;
  if (resetsAt) window.resetsAt = resetsAt;
  return { window, seconds };
}

type OpenAIKind = "rolling" | "weekly";

/**
 * Classify by nominal window length, not wire position: OpenAI has moved the
 * 7d window into `primary_window` with `secondary_window` omitted, so
 * position alone mislabels weekly-only plans.
 */
function classifyOpenAIWindow(
  seconds: number | undefined,
): OpenAIKind | undefined {
  if (seconds === undefined || !(seconds > 0)) return undefined;
  if (seconds === OPENAI_SESSION_WINDOW_SECONDS) return "rolling";
  if (seconds === OPENAI_WEEKLY_WINDOW_SECONDS) return "weekly";
  return seconds <= 86_400 ? "rolling" : "weekly";
}

/**
 * Parse `GET https://chatgpt.com/backend-api/wham/usage`
 * (`rate_limit.primary_window` / `secondary_window` with `used_percent`,
 * `limit_window_seconds`, `reset_at` unix seconds). Unlike Meta, an OAuth
 * response without windows is an error, never pay-as-you-go: API keys are
 * detected up front and never reach this endpoint.
 */
export function parseOpenAI(
  status: number,
  body: unknown,
  now = Date.now(),
): ProviderInfo {
  if (status === 401 || status === 403)
    return { status: "error", error: "unauthorized" };
  if (status === 429) return { status: "rate-limited", error: "rate limited" };
  if (status < 200 || status >= 300) {
    return { status: "error", error: `HTTP ${status}` };
  }
  const root = asRecord(body);
  const rateLimit = asRecord(root?.rate_limit);
  if (!root || !rateLimit)
    return { status: "error", error: "unrecognized payload" };
  const primary = openAIWindow(rateLimit.primary_window, now);
  const secondary = openAIWindow(rateLimit.secondary_window, now);
  // Unknown durations fall back to wire position.
  const primaryKind = primary.window
    ? (classifyOpenAIWindow(primary.seconds) ?? "rolling")
    : undefined;
  const secondaryKind = secondary.window
    ? (classifyOpenAIWindow(secondary.seconds) ?? "weekly")
    : undefined;
  let rolling: WindowInfo | undefined;
  let weekly: WindowInfo | undefined;
  if (primaryKind && secondaryKind && primaryKind === secondaryKind) {
    // Schema drift: both windows claim the same duration.
    rolling = primary.window;
    weekly = secondary.window;
  } else {
    if (primaryKind === "rolling") rolling = primary.window;
    else if (primaryKind === "weekly") weekly = primary.window;
    if (secondaryKind === "rolling") rolling ??= secondary.window;
    else if (secondaryKind === "weekly") weekly ??= secondary.window;
  }
  const picked = rolling ?? weekly;
  if (!picked || typeof picked.percent !== "number")
    return { status: "error", error: "no utilization in payload" };
  return {
    status: "ok",
    rolling,
    weekly,
    percent: picked.percent,
    resetsAt: picked.resetsAt,
    label: rolling ? "5h" : "week",
    product: "ChatGPT",
  };
}
