/** @jsxImportSource @opentui/solid */
import { TextAttributes } from "@opentui/core";
import { usePlugin } from "@opencode/plugin/tui";
import { For, Show, createSignal, onCleanup } from "solid-js";
import {
  asSnapshot,
  canFetch,
  ANTHROPIC_WINDOW_LABELS,
  emptySnapshot,
  formatFetchedAt,
  formatReset,
  GO_WINDOW_LABELS,
  GROK_WINDOW_LABELS,
  isFailed,
  isPayg,
  mergeProvider,
  META_WINDOW_LABELS,
  OPENAI_WINDOW_LABELS,
  PAYG_MESSAGE,
  percentTone,
  providerDetailWindows,
  usageBar,
  type ProviderInfo,
  type Snapshot,
  type WindowLabels,
} from "./format.ts";
import { Usage } from "./rpc.ts";

type Card = {
  key: keyof Pick<Snapshot, "grok" | "go" | "anthropic" | "meta" | "openai">;
  name: string;
  labels: WindowLabels;
};

const CARDS: Card[] = [
  { key: "grok", name: "Grok", labels: GROK_WINDOW_LABELS },
  { key: "go", name: "OpenCode Go", labels: GO_WINDOW_LABELS },
  { key: "anthropic", name: "Anthropic", labels: ANTHROPIC_WINDOW_LABELS },
  { key: "meta", name: "Meta", labels: META_WINDOW_LABELS },
  { key: "openai", name: "OpenAI", labels: OPENAI_WINDOW_LABELS },
];

function readStore<T>(value: T | (() => T)): T {
  return typeof value === "function" ? (value as () => T)() : value;
}

function themeColors(theme: {
  text?: { default?: string; muted?: string };
  warning?: { default?: string } | string;
  error?: { default?: string } | string;
  danger?: { default?: string } | string;
  border?: { default?: string } | string;
}) {
  const pick = (
    value: { default?: string } | string | undefined,
  ): string | undefined => (typeof value === "string" ? value : value?.default);
  const defaultFg = theme.text?.default;
  const muted = theme.text?.muted ?? defaultFg;
  return {
    defaultFg,
    muted,
    warn: pick(theme.warning) ?? defaultFg,
    crit: pick(theme.error) ?? pick(theme.danger) ?? defaultFg,
    border: pick(theme.border) ?? muted,
  };
}

function cardTitle(name: string, provider: ProviderInfo): string {
  const parts = [name];
  if (provider.product && provider.product !== name)
    parts.push(provider.product);
  if (isFailed(provider)) parts.push(provider.error ?? provider.status);
  return parts.join(" · ");
}

function statusMessage(provider: ProviderInfo): string {
  if (provider.status === "missing") return "not connected";
  if (provider.status === "pending") return "loading";
  if (isFailed(provider)) return provider.error ?? provider.status;
  return "No usage data yet";
}

export function UsageDialog() {
  const context = usePlugin();
  const [snapshot, setSnapshot] = context.storage.memory("snapshot", {
    initial: emptySnapshot(),
  });
  const [now, setNow] = createSignal(Date.now());
  const [busy, setBusy] = createSignal(false);
  const colors = () => themeColors(context.theme);
  const snap = () => asSnapshot(readStore(snapshot));

  const timer = setInterval(() => setNow(Date.now()), 1000);
  onCleanup(() => clearInterval(timer));

  const write = (next: Snapshot) => {
    setSnapshot((draft: Snapshot) => {
      draft.fetchedAt = next.fetchedAt || draft.fetchedAt;
      draft.grok = mergeProvider(draft.grok, next.grok);
      draft.go = mergeProvider(draft.go, next.go);
      draft.anthropic = mergeProvider(draft.anthropic, next.anthropic);
      draft.meta = mergeProvider(draft.meta, next.meta);
      draft.openai = mergeProvider(draft.openai, next.openai);
    });
  };

  const refresh = async () => {
    if (busy()) return;
    setBusy(true);
    try {
      write(asSnapshot(await context.client.rpc(Usage).get({ refresh: true })));
    } catch {
      // keep last snapshot
    } finally {
      setBusy(false);
      setNow(Date.now());
    }
  };

  const canRefreshNow = () => {
    if (busy()) return false;
    const t = Date.parse(snap().fetchedAt);
    if (!Number.isFinite(t)) return true;
    return canFetch(t, now());
  };

  context.keymap.layer(() => ({
    mode: "global" as const,
    priority: 50,
    commands: canRefreshNow()
      ? [
          {
            id: "oc.usage.refresh",
            title: "Refresh usage",
            bind: "r",
            run: () => void refresh(),
          },
        ]
      : [],
  }));

  const toneFg = (percent: number) => {
    const tone = percentTone(percent);
    const c = colors();
    if (tone === "crit") return c.crit;
    if (tone === "warn") return c.warn;
    return c.defaultFg;
  };

  return (
    <box
      paddingLeft={2}
      paddingRight={2}
      paddingTop={1}
      paddingBottom={1}
      gap={1}
    >
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={colors().defaultFg}>
          Usage limits
        </text>
        <text fg={colors().muted} onMouseUp={() => context.ui.dialog.clear()}>
          esc
        </text>
      </box>
      <For each={CARDS}>
        {(card) => {
          const provider = () => snap()[card.key];
          const rows = () => providerDetailWindows(provider(), card.labels);
          return (
            <box
              border
              borderStyle="rounded"
              borderColor={colors().border}
              title={cardTitle(card.name, provider())}
              titleColor={colors().defaultFg}
              padding={1}
              gap={0}
            >
              <Show
                when={rows().length > 0}
                fallback={
                  <text fg={colors().muted}>
                    {isPayg(card.key, provider())
                      ? PAYG_MESSAGE
                      : statusMessage(provider())}
                  </text>
                }
              >
                <box flexDirection="row">
                  <text width={8} fg={colors().muted} wrapMode="none">
                    Window
                  </text>
                  <text width={18} fg={colors().muted} wrapMode="none">
                    Used
                  </text>
                  <text width={8} fg={colors().muted} wrapMode="none">
                    Resets
                  </text>
                </box>
                <For each={rows()}>
                  {(row) => (
                    <box flexDirection="row">
                      <text width={8} fg={colors().defaultFg} wrapMode="none">
                        {row.label}
                      </text>
                      <text width={18} fg={toneFg(row.percent)} wrapMode="none">
                        {`${usageBar(row.percent)} ${String(Math.round(row.percent)).padStart(3)}%`}
                      </text>
                      <text width={8} fg={colors().muted} wrapMode="none">
                        {formatReset(row.resetsAt) || "—"}
                      </text>
                    </box>
                  )}
                </For>
              </Show>
            </box>
          );
        }}
      </For>
      <box flexDirection="row" justifyContent="space-between">
        <Show when={snap().fetchedAt}>
          <text fg={colors().muted}>
            Fetched {formatFetchedAt(snap().fetchedAt)}
          </text>
        </Show>
        <Show when={busy()}>
          <text fg={colors().muted}>refreshing...</text>
        </Show>
        <Show when={!busy() && canRefreshNow()}>
          <text fg={colors().defaultFg} onMouseUp={() => void refresh()}>
            r <span style={{ fg: colors().muted }}>refresh</span>
          </text>
        </Show>
      </box>
    </box>
  );
}
