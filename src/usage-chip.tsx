/** @jsxImportSource @opentui/solid */
import { usePlugin } from "@opencode-ai/plugin/tui";
import { For, Show, createSignal, onCleanup, onMount } from "solid-js";
import {
  asSnapshot,
  emptySnapshot,
  footerView,
  isStale,
  percentTone,
} from "./format.ts";

const TICK_MS = 30_000;

type Selection = { sessionID: string; providerID: string; modelID: string };

function readStore<T>(value: T | (() => T)): T {
  return typeof value === "function" ? (value as () => T)() : value;
}

function pickColor(value: { default?: string } | string | undefined) {
  return typeof value === "string" ? value : value?.default;
}

export function UsageChip(props: { sessionID?: string }) {
  const context = usePlugin();
  const [snapshot] = context.storage.memory("snapshot", {
    initial: emptySnapshot(),
  });
  const [selection] = context.storage.memory("selection", {
    initial: { sessionID: "", providerID: "", modelID: "" } satisfies Selection,
  });
  const [now, setNow] = createSignal(Date.now());

  onMount(() => {
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    onCleanup(() => clearInterval(timer));
  });

  const snap = () => asSnapshot(readStore(snapshot));

  const providerID = () => {
    const sessionID = props.sessionID;
    if (!sessionID) return undefined;
    const sel = readStore(selection);
    const fromStore = sel.sessionID === sessionID ? sel : undefined;
    const session = context.data.session.get(sessionID);
    return fromStore?.providerID || session?.model?.providerID || undefined;
  };

  const chip = () => footerView(snap(), providerID(), now());
  const muted = () => isStale(snap(), now());

  const colors = () => {
    const theme = context.theme;
    const defaultFg = theme.text?.default;
    const mutedFg = theme.text?.muted ?? defaultFg;
    return {
      defaultFg,
      muted: mutedFg,
      warn: pickColor(theme.warning) ?? defaultFg,
      crit: pickColor(theme.error) ?? pickColor(theme.danger) ?? defaultFg,
    };
  };

  const nameFg = () => (muted() ? colors().muted : colors().defaultFg);

  const pieFg = (percent: number) => {
    if (muted()) return colors().muted;
    const tone = percentTone(percent);
    const c = colors();
    if (tone === "crit") return c.crit;
    if (tone === "warn") return c.warn;
    return c.defaultFg;
  };

  return (
    <Show when={chip()}>
      {(item) => (
        <box flexDirection="row" gap={1}>
          <text fg={nameFg()} wrapMode="none">
            {item().name}
          </text>
          <For each={item().pies}>
            {(pie) => (
              <text fg={pieFg(pie.percent)} wrapMode="none">
                {pie.glyph}
              </text>
            )}
          </For>
          <text fg={nameFg()} wrapMode="none">
            {item().percents === "!" ? "!" : item().percents}
          </text>
          <Show when={item().failed && item().percents !== "!"}>
            <text fg={muted() ? colors().muted : colors().crit} wrapMode="none">
              (!)
            </text>
          </Show>
        </box>
      )}
    </Show>
  );
}
