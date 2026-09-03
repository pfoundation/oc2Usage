import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

export type UsageTrigger = "rpc" | "rpc-refresh" | "turn-end";
export type UsageLogKind = "query" | "http";
export type UsageCached = "cache" | "inflight" | "fetch";
export type UsageProvider = "grok" | "go" | "anthropic" | "meta";

export type UsageLogRecord = {
  ts: string;
  kind: UsageLogKind;
  trigger: UsageTrigger;
  refresh?: boolean;
  cached?: UsageCached;
  provider?: UsageProvider;
  httpStatus?: number;
  status?: string;
  error?: string;
  ms?: number;
  body?: string;
};

const LOG_KEYS = [
  "ts",
  "kind",
  "trigger",
  "refresh",
  "cached",
  "provider",
  "httpStatus",
  "status",
  "error",
  "ms",
  "body",
] as const;

export function usageLogPath(
  env: Record<string, string | undefined> = process.env,
): string {
  const xdg = env.XDG_DATA_HOME?.replace(/\/$/, "");
  if (xdg) return `${xdg}/opencode/log/oc-usage.jsonl`;
  const home = (env.HOME ?? "").replace(/\/$/, "");
  return `${home}/.local/share/opencode/log/oc-usage.jsonl`;
}

export function truncateBody(body: unknown, max = 200): string | undefined {
  if (body === undefined || body === null) return undefined;
  let text: string;
  if (typeof body === "string") text = body;
  else {
    try {
      text = JSON.stringify(body);
    } catch {
      return undefined;
    }
  }
  if (text.length === 0) return undefined;
  return text.length <= max ? text : text.slice(0, max);
}

export function formatLogLine(record: UsageLogRecord): string {
  const out: Record<string, string | number | boolean> = {};
  const src = record as Record<string, unknown>;
  for (const key of LOG_KEYS) {
    const value = src[key];
    if (value === undefined) continue;
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      out[key] = value;
    }
  }
  return `${JSON.stringify(out)}\n`;
}

export async function appendUsageLog(record: UsageLogRecord): Promise<void> {
  const line = formatLogLine(record);
  console.error("[oc.usage]", line.trimEnd());
  try {
    const path = usageLogPath();
    await mkdir(dirname(path), { recursive: true });
    await appendFile(path, line);
  } catch {
    // Logging must never fail a snapshot.
  }
}
