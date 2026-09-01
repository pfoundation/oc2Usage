import type { ProviderInfo, WindowInfo } from "./format.ts";

export const USER_AGENT = "opencode-providers-usage/0.1.0";
export const GO_USAGE_URL = "https://opencode.ai/zen/go/v1/usage";
export const GROK_BILLING_URL =
  "https://cli-chat-proxy.grok.com/v1/billing?format=credits";
export const ANTHROPIC_USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
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
