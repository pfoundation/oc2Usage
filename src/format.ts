export type WindowInfo = {
  status?: string;
  percent?: number;
  resetsAt?: string;
};

export type ScopedWindow = WindowInfo & {
  label: string;
};

export type ProviderInfo = {
  status: string;
  percent?: number;
  label?: string;
  resetsAt?: string;
  error?: string;
  rolling?: WindowInfo;
  weekly?: WindowInfo;
  monthly?: WindowInfo;
  fable?: WindowInfo;
  scoped?: ScopedWindow[];
  product?: string;
  periodStart?: string;
  periodEnd?: string;
};

export type Snapshot = {
  fetchedAt: string;
  grok: ProviderInfo;
  go: ProviderInfo;
  anthropic: ProviderInfo;
  meta: ProviderInfo;
};

export type WindowRow = {
  id: "rolling" | "weekly" | "monthly" | "scoped" | "percent";
  label: string;
  percent: number;
  resetsAt?: string;
};

export type WindowLabels = {
  rolling: string;
  weekly: string;
  monthly: string;
};

export const GROK_WINDOW_LABELS: WindowLabels = {
  rolling: "5h",
  weekly: "7d",
  monthly: "30d",
};

export const GO_WINDOW_LABELS: WindowLabels = {
  rolling: "5h",
  weekly: "week",
  monthly: "month",
};

export const CLAUDE_WINDOW_LABELS: WindowLabels = {
  rolling: "5h",
  weekly: "week",
  monthly: "extra",
};

export const META_WINDOW_LABELS: WindowLabels = {
  rolling: "5h",
  weekly: "week",
  monthly: "month",
};

export const MIN_FETCH_INTERVAL_MS = 180_000;
export const HOURLY_BLOCK_MIN_PERCENT = 75;
export const WEEKLY_BLOCK_MIN_PERCENT = 50;
export const LOW_USAGE_DIM_PERCENT = 30;
export const BLOCK_CHARS = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"] as const;

export type FooterPie = {
  label: string;
  glyph: string;
  percent: number;
  durationMs: number;
};

export type FooterView = {
  name: string;
  percents: string;
  pies: FooterPie[];
  failed: boolean;
  maxPercent?: number;
};

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

const FOOTER_KIND = {
  grok: { name: "grok", labels: GROK_WINDOW_LABELS },
  go: { name: "go", labels: GO_WINDOW_LABELS },
  anthropic: { name: "claude", labels: CLAUDE_WINDOW_LABELS },
  meta: { name: "meta", labels: META_WINDOW_LABELS },
} as const;

export function canFetch(
  lastAt: number | undefined,
  now = Date.now(),
  minMs = MIN_FETCH_INTERVAL_MS,
): boolean {
  if (lastAt === undefined) return true;
  return now - lastAt >= minMs;
}

function scopedPercents(provider: ProviderInfo): number[] {
  const fromScoped = (provider.scoped ?? [])
    .map((item) => item.percent)
    .filter((n): n is number => typeof n === "number");
  if (fromScoped.length > 0) return fromScoped;
  if (typeof provider.fable?.percent === "number")
    return [provider.fable.percent];
  return [];
}

export function isFableModel(modelID?: string): boolean {
  return typeof modelID === "string" && /fable/i.test(modelID);
}

function fableWindow(provider: ProviderInfo): WindowInfo | undefined {
  const fromScoped = (provider.scoped ?? []).find(
    (item) =>
      item.label.toLowerCase() === "fable" && typeof item.percent === "number",
  );
  if (fromScoped) return fromScoped;
  if (typeof provider.fable?.percent === "number") return provider.fable;
  return undefined;
}

function preferFableWeekly(
  provider: ProviderInfo,
  modelID?: string,
): WindowInfo | undefined {
  const fable = fableWindow(provider);
  if (!fable) return undefined;
  if (!modelID) return fable;
  return isFableModel(modelID) ? fable : undefined;
}

function hasUsage(provider: ProviderInfo): boolean {
  return (
    typeof provider.percent === "number" ||
    typeof provider.rolling?.percent === "number" ||
    typeof provider.weekly?.percent === "number" ||
    typeof provider.monthly?.percent === "number" ||
    scopedPercents(provider).length > 0
  );
}

export function isFailed(provider: ProviderInfo): boolean {
  return provider.status === "error" || provider.status === "rate-limited";
}

export function mergeProvider(
  prev: ProviderInfo | undefined,
  next: ProviderInfo,
): ProviderInfo {
  if (isFailed(next) && prev && hasUsage(prev)) return prev;
  return next;
}

export const PAYG_MESSAGE = "pay-as-you-go (see usage dashboard)";

/** Provider is connected and healthy but has no quota windows to report. */
export function isPayg(
  kind: keyof typeof FOOTER_KIND,
  provider: ProviderInfo,
): boolean {
  if (kind !== "meta" && kind !== "anthropic") return false;
  return provider.status === "ok" && !hasUsage(provider);
}

export function emptySnapshot(): Snapshot {
  return {
    fetchedAt: "",
    grok: { status: "pending" },
    go: { status: "pending" },
    anthropic: { status: "pending" },
    meta: { status: "pending" },
  };
}

export function formatReset(iso?: string, now = Date.now()): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const ms = t - now;
  if (ms <= 0) return "soon";
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${Math.max(minutes, 1)}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

export function formatFetchedAt(iso?: string): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const d = new Date(t);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function usageBar(percent: number, width = 10): string {
  const n = Number.isFinite(percent) ? percent : 0;
  const filled = Math.round((Math.min(100, Math.max(0, n)) / 100) * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
}

export function percentTone(percent: number): "ok" | "warn" | "crit" {
  if (percent >= 90) return "crit";
  if (percent >= 70) return "warn";
  return "ok";
}

export function providerWindows(
  provider: ProviderInfo,
  labels: WindowLabels,
  modelID?: string,
): WindowRow[] {
  const rows: WindowRow[] = [];
  const add = (id: WindowRow["id"], label: string, window?: WindowInfo) => {
    if (typeof window?.percent !== "number") return;
    rows.push({
      id,
      label,
      percent: window.percent,
      resetsAt: window.resetsAt,
    });
  };

  add("rolling", labels.rolling, provider.rolling);

  const fable = preferFableWeekly(provider, modelID);
  if (fable) {
    add("weekly", "Fable", fable);
  } else {
    add("weekly", labels.weekly, provider.weekly);
    for (const item of provider.scoped ?? []) {
      if (item.label.toLowerCase() === "fable") continue;
      add("scoped", item.label, item);
    }
  }

  add("monthly", labels.monthly, provider.monthly);

  if (rows.length === 0 && typeof provider.percent === "number") {
    rows.push({
      id: "percent",
      label: provider.label ?? "",
      percent: provider.percent,
      resetsAt: provider.resetsAt ?? provider.periodEnd,
    });
  }
  return rows;
}

function periodDurationMs(provider: ProviderInfo): number | undefined {
  if (!provider.periodStart || !provider.periodEnd) return undefined;
  const start = Date.parse(provider.periodStart);
  const end = Date.parse(provider.periodEnd);
  const duration = end - start;
  if (!Number.isFinite(duration) || duration <= 0) return undefined;
  return duration;
}

function windowDurationMs(
  row: WindowRow,
  provider: ProviderInfo,
): number | undefined {
  const period = periodDurationMs(provider);
  if (period && (row.id === "weekly" || row.id === "percent")) return period;
  switch (row.id) {
    case "rolling":
      return 5 * HOUR_MS;
    case "weekly":
    case "scoped":
      return 7 * DAY_MS;
    case "monthly":
      return 30 * DAY_MS;
    case "percent":
      return period;
  }
}

export function resetRemaining(
  resetsAt: string | undefined,
  durationMs: number,
  now = Date.now(),
): number {
  if (!resetsAt || !(durationMs > 0)) return 0;
  const t = Date.parse(resetsAt);
  if (Number.isNaN(t)) return 0;
  const remaining = (t - now) / durationMs;
  if (remaining <= 0) return 0;
  if (remaining >= 1) return 1;
  return remaining;
}

export function remainingBlock(remaining: number): string {
  const n = Number.isFinite(remaining) ? remaining : 0;
  const i = Math.round(Math.min(1, Math.max(0, n)) * (BLOCK_CHARS.length - 1));
  return BLOCK_CHARS[i];
}

export function formatRemainingGlyph(
  resetsAt: string | undefined,
  durationMs: number,
  now = Date.now(),
): string {
  if (!resetsAt || !(durationMs > 0)) return BLOCK_CHARS[0];
  const t = Date.parse(resetsAt);
  if (Number.isNaN(t)) return BLOCK_CHARS[0];
  const remainingMs = t - now;
  if (remainingMs <= 0) return BLOCK_CHARS[0];
  if (durationMs <= DAY_MS) {
    return remainingBlock(resetRemaining(resetsAt, durationMs, now));
  }
  const days = Math.floor(remainingMs / DAY_MS);
  const dayFraction = (remainingMs % DAY_MS) / DAY_MS;
  const glyph = remainingBlock(dayFraction);
  return days >= 1 ? `${days}d${glyph}` : glyph;
}

function blockMinPercent(id: WindowRow["id"]): number | undefined {
  if (id === "rolling") return HOURLY_BLOCK_MIN_PERCENT;
  if (id === "weekly") return WEEKLY_BLOCK_MIN_PERCENT;
  return undefined;
}

export function footerPies(
  provider: ProviderInfo,
  labels: WindowLabels,
  now = Date.now(),
  modelID?: string,
): FooterPie[] {
  if (provider.status === "missing" || provider.status === "pending") return [];
  const pies: FooterPie[] = [];
  for (const row of providerWindows(provider, labels, modelID)) {
    const minPercent = blockMinPercent(row.id);
    if (minPercent === undefined || row.percent < minPercent) continue;
    if (!row.resetsAt || Number.isNaN(Date.parse(row.resetsAt))) continue;
    const durationMs = windowDurationMs(row, provider);
    if (!durationMs) continue;
    pies.push({
      label: row.label,
      glyph: formatRemainingGlyph(row.resetsAt, durationMs, now),
      percent: row.percent,
      durationMs,
    });
  }
  return pies;
}

export function pickGoWindow(
  go: ProviderInfo,
): { id: string; percent: number; resetsAt?: string } | undefined {
  const windows = [
    { id: "5h", ...go.rolling },
    { id: "7d", ...go.weekly },
    { id: "30d", ...go.monthly },
  ].filter((w) => typeof w.percent === "number") as Array<{
    id: string;
    percent: number;
    resetsAt?: string;
    status?: string;
  }>;
  if (windows.length === 0) {
    if (typeof go.percent === "number") {
      return {
        id: go.label ?? "go",
        percent: go.percent,
        resetsAt: go.resetsAt,
      };
    }
    return undefined;
  }
  const exhausted = windows.filter((w) => w.percent >= 100);
  if (exhausted.length)
    return exhausted.sort((a, b) => b.percent - a.percent)[0];
  const used = windows.filter((w) => w.percent > 0);
  if (used.length) return used.sort((a, b) => b.percent - a.percent)[0];
  return windows.find((w) => w.id === "5h") ?? windows[0];
}

export function formatWindowPercents(
  provider: ProviderInfo,
  modelID?: string,
): string | undefined {
  if (provider.status === "missing" || provider.status === "pending")
    return undefined;
  const percents = providerWindows(provider, CLAUDE_WINDOW_LABELS, modelID).map(
    (row) => row.percent,
  );
  if (percents.length === 0) return isFailed(provider) ? "!" : undefined;
  const text =
    percents.length === 1
      ? `${Math.round(percents[0])}%`
      : `${percents.map((n) => Math.round(n)).join("/")}%`;
  return isFailed(provider) ? `${text} (!)` : text;
}

function chip(name: string, provider: ProviderInfo): string | undefined {
  const percents = formatWindowPercents(provider);
  if (!percents) return undefined;
  return percents === "!" ? `${name} !` : `${name} ${percents}`;
}

export function formatCompact(snapshot: Snapshot): string {
  const parts: string[] = [];
  const grok = chip("grok", snapshot.grok);
  if (grok) parts.push(grok);

  const go = chip("go", snapshot.go);
  if (go) parts.push(go);
  const claude = chip("claude", snapshot.anthropic);
  if (claude) parts.push(claude);
  const meta = chip("meta", snapshot.meta ?? { status: "pending" });
  if (meta) parts.push(meta);

  return parts.join(" · ");
}

export function usageKindFromProviderID(
  providerID: string | undefined,
): "grok" | "go" | "anthropic" | "meta" | undefined {
  if (!providerID) return undefined;
  const id = providerID.toLowerCase();
  if (id === "meta" || id.startsWith("meta/") || id.includes("muse"))
    return "meta";
  if (id === "xai" || id.startsWith("xai/") || id.includes("grok"))
    return "grok";
  if (
    id === "opencode-go" ||
    id.includes("opencode-go") ||
    /(^|[-/])go$/.test(id)
  )
    return "go";
  if (
    id === "anthropic" ||
    id.startsWith("anthropic/") ||
    id.includes("claude")
  )
    return "anthropic";
  return undefined;
}

function percentsText(
  provider: ProviderInfo,
  modelID?: string,
): string | undefined {
  const text = formatWindowPercents(provider, modelID);
  if (!text) return undefined;
  if (text === "!") return "!";
  return text.replace(/ \(!\)$/, "");
}

export function maxWindowPercent(
  provider: ProviderInfo,
  labels: WindowLabels,
  modelID?: string,
): number | undefined {
  const rows = providerWindows(provider, labels, modelID);
  if (rows.length === 0) return undefined;
  return Math.max(...rows.map((row) => row.percent));
}

export function footerView(
  snapshot: Snapshot,
  providerID: string | undefined,
  now = Date.now(),
  modelID?: string,
): FooterView | undefined {
  const kind = usageKindFromProviderID(providerID);
  if (!kind) return undefined;
  const mapped = FOOTER_KIND[kind];
  const provider = snapshot[kind] ?? { status: "pending" };
  const percents = percentsText(provider, modelID);
  if (!percents) {
    // Pay-as-you-go keys (Anthropic API key, Meta without subscription) carry
    // no quota, so there is no percent to show. Still acknowledge the provider.
    if (isPayg(kind, provider)) {
      return { name: mapped.name, percents: "payg", pies: [], failed: false };
    }
    return undefined;
  }
  return {
    name: mapped.name,
    percents,
    pies: footerPies(provider, mapped.labels, now, modelID),
    failed: isFailed(provider) && percents === "!",
    maxPercent: maxWindowPercent(provider, mapped.labels, modelID),
  };
}

export function formatFooter(
  snapshot: Snapshot,
  providerID: string | undefined,
  now = Date.now(),
  modelID?: string,
): string {
  const view = footerView(snapshot, providerID, now, modelID);
  if (!view) return "";
  const pies = view.pies.map((pie) => pie.glyph).join("/");
  const usage = view.percents === "!" ? "!" : view.percents;
  const core = pies ? `${view.name} ${pies} ${usage}` : `${view.name} ${usage}`;
  return view.failed && view.percents !== "!" ? `${core} (!)` : core;
}

function withLegacyScoped(provider: ProviderInfo): ProviderInfo {
  if (provider.scoped?.length) return provider;
  if (typeof provider.fable?.percent !== "number") return provider;
  return {
    ...provider,
    scoped: [{ label: "Fable", ...provider.fable }],
  };
}

export function asSnapshot(value: unknown): Snapshot {
  if (!value || typeof value !== "object") return emptySnapshot();
  const rec = value as Partial<Snapshot>;
  if (!rec.grok || !rec.go) return emptySnapshot();
  return {
    fetchedAt: typeof rec.fetchedAt === "string" ? rec.fetchedAt : "",
    grok: rec.grok,
    go: rec.go,
    anthropic: withLegacyScoped(rec.anthropic ?? { status: "pending" }),
    meta: rec.meta ?? { status: "pending" },
  };
}

export function formatDetail(
  snapshot: Snapshot,
  now = Date.now(),
  modelID?: string,
): string {
  const lines: string[] = [];

  const block = (
    name: string,
    provider: ProviderInfo,
    labels: WindowLabels,
    windowModelID?: string,
  ) => {
    if (provider.status === "missing") {
      lines.push(`${name}  not connected`);
      return;
    }
    if (provider.status === "pending") return;
    const prefix =
      provider.product && provider.product !== name
        ? `${name} ${provider.product}`
        : name;
    for (const row of providerWindows(provider, labels, windowModelID)) {
      const reset = formatReset(row.resetsAt, now);
      const label = row.label ? ` ${row.label}` : "";
      lines.push(
        `${prefix}${label}  ${Math.round(row.percent)}% used` +
          (reset ? `  resets ${reset}` : ""),
      );
    }
    if (isFailed(provider)) {
      lines.push(`${name}  ${provider.error ?? provider.status}`);
    }
  };

  block("Grok", snapshot.grok, GROK_WINDOW_LABELS);
  block("OpenCode Go", snapshot.go, GO_WINDOW_LABELS);
  const anthropic = snapshot.anthropic ?? { status: "pending" };
  block("Claude", anthropic, CLAUDE_WINDOW_LABELS, modelID);
  if (isPayg("anthropic", anthropic)) lines.push(`Claude  ${PAYG_MESSAGE}`);
  const meta = snapshot.meta ?? { status: "pending" };
  block("Meta", meta, META_WINDOW_LABELS);
  if (isPayg("meta", meta)) lines.push(`Meta  ${PAYG_MESSAGE}`);

  if (lines.length === 0) return "No usage data yet";
  return lines.join("\n");
}

export function isStale(
  snapshot: Snapshot,
  now = Date.now(),
  maxAgeMs = 10 * 60_000,
): boolean {
  if (!snapshot.fetchedAt) return true;
  const t = Date.parse(snapshot.fetchedAt);
  if (Number.isNaN(t)) return true;
  return now - t > maxAgeMs;
}
