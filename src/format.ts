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

export const MIN_FETCH_INTERVAL_MS = 180_000;
export const FOOTER_MIN_PERCENT = 0;
export const PIE_CHARS = ["○", "◔", "◑", "◕", "●"] as const;

export type FooterPie = {
  label: string;
  glyph: string;
  percent: number;
};

export type FooterView = {
  name: string;
  percents: string;
  pies: FooterPie[];
  failed: boolean;
};

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

const FOOTER_KIND = {
  grok: { name: "grok", labels: GROK_WINDOW_LABELS },
  go: { name: "go", labels: GO_WINDOW_LABELS },
  anthropic: { name: "claude", labels: CLAUDE_WINDOW_LABELS },
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

export function emptySnapshot(): Snapshot {
  return {
    fetchedAt: "",
    grok: { status: "pending" },
    go: { status: "pending" },
    anthropic: { status: "pending" },
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
  add("weekly", labels.weekly, provider.weekly);

  const scoped = provider.scoped ?? [];
  for (const item of scoped) {
    add("scoped", item.label, item);
  }
  if (scoped.length === 0 && typeof provider.fable?.percent === "number") {
    add("scoped", "Fable", provider.fable);
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

export function remainingPie(remaining: number): string {
  const n = Number.isFinite(remaining) ? remaining : 0;
  const elapsed = 1 - Math.min(1, Math.max(0, n));
  const i = Math.round(elapsed * (PIE_CHARS.length - 1));
  return PIE_CHARS[i];
}

export function footerPies(
  provider: ProviderInfo,
  labels: WindowLabels,
  now = Date.now(),
): FooterPie[] {
  if (provider.status === "missing" || provider.status === "pending") return [];
  const pies: FooterPie[] = [];
  for (const row of providerWindows(provider, labels)) {
    if (row.percent < FOOTER_MIN_PERCENT) continue;
    if (!row.resetsAt || Number.isNaN(Date.parse(row.resetsAt))) continue;
    const durationMs = windowDurationMs(row, provider);
    if (!durationMs) continue;
    pies.push({
      label: row.label,
      glyph: remainingPie(resetRemaining(row.resetsAt, durationMs, now)),
      percent: row.percent,
    });
  }
  return pickFooterPie(pies);
}

function pickFooterPie(pies: FooterPie[]): FooterPie[] {
  if (pies.length <= 1) return pies;
  const exhausted = pies.filter((p) => p.percent >= 100);
  if (exhausted.length)
    return [exhausted.sort((a, b) => b.percent - a.percent)[0]];
  const used = pies.filter((p) => p.percent > 0);
  if (used.length) return [used.sort((a, b) => b.percent - a.percent)[0]];
  return [pies[0]];
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
): string | undefined {
  if (provider.status === "missing" || provider.status === "pending")
    return undefined;
  const percents = [
    provider.rolling?.percent,
    provider.weekly?.percent,
    ...scopedPercents(provider),
    provider.monthly?.percent,
  ].filter((n): n is number => typeof n === "number");
  if (percents.length === 0 && typeof provider.percent === "number") {
    percents.push(provider.percent);
  }
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

  return parts.join(" · ");
}

export function usageKindFromProviderID(
  providerID: string | undefined,
): "grok" | "go" | "anthropic" | undefined {
  if (!providerID) return undefined;
  const id = providerID.toLowerCase();
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

function percentsText(provider: ProviderInfo): string | undefined {
  const text = formatWindowPercents(provider);
  if (!text) return undefined;
  if (text === "!") return "!";
  return text.replace(/ \(!\)$/, "");
}

export function footerView(
  snapshot: Snapshot,
  providerID: string | undefined,
  now = Date.now(),
): FooterView | undefined {
  const kind = usageKindFromProviderID(providerID);
  if (!kind) return undefined;
  const mapped = FOOTER_KIND[kind];
  const provider = snapshot[kind];
  const percents = percentsText(provider);
  if (!percents) return undefined;
  return {
    name: mapped.name,
    percents,
    pies: footerPies(provider, mapped.labels, now),
    failed: isFailed(provider) && percents === "!",
  };
}

export function formatFooter(
  snapshot: Snapshot,
  providerID: string | undefined,
  now = Date.now(),
): string {
  const view = footerView(snapshot, providerID, now);
  if (!view) return "";
  const pies = view.pies.map((pie) => pie.glyph).join(" ");
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
  };
}

export function formatDetail(snapshot: Snapshot, now = Date.now()): string {
  const lines: string[] = [];

  const block = (
    name: string,
    provider: ProviderInfo,
    labels: WindowLabels,
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
    for (const row of providerWindows(provider, labels)) {
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
  block("Claude", snapshot.anthropic, CLAUDE_WINDOW_LABELS);

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
