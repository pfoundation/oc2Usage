/** @jsxImportSource @opentui/solid */
import { usePlugin } from "@opencode-ai/plugin/tui";
import { TextAttributes } from "@opentui/core";
import { For, Show, createSignal, onCleanup, onMount } from "solid-js";
import {
  asSnapshot,
  emptySnapshot,
  footerView,
  isStale,
  LOW_USAGE_DIM_PERCENT,
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

  const selectionForSession = () => {
    const sessionID = props.sessionID;
    if (!sessionID) return undefined;
    const sel = readStore(selection);
    const fromStore = sel.sessionID === sessionID ? sel : undefined;
    const session = context.data.session.get(sessionID);
    return {
      providerID:
        fromStore?.providerID || session?.model?.providerID || undefined,
      modelID: fromStore?.modelID || session?.model?.id || undefined,
    };
  };

  const chip = () => {
    const sel = selectionForSession();
    return footerView(snap(), sel?.providerID, now(), sel?.modelID);
  };
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

  const nameFg = () => colors().muted;

  // fg-only dimming is invisible when the theme's muted color matches the
  // default, so pair it with the SGR faint attribute (same `attributes`
  // prop convention other TUI plugins use).
  const dimAttrs = (dimmed: boolean) =>
    dimmed ? TextAttributes.DIM : TextAttributes.NONE;

  const valueDimmed = (maxPercent: number | undefined) =>
    muted() || (maxPercent !== undefined && maxPercent < LOW_USAGE_DIM_PERCENT);

  const valueFg = (maxPercent: number | undefined) =>
    valueDimmed(maxPercent) ? colors().muted : colors().defaultFg;

  const pieFg = (percent: number, maxPercent: number | undefined) => {
    if (valueDimmed(maxPercent)) return colors().muted;
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
          <text fg={nameFg()} attributes={dimAttrs(true)} wrapMode="none">
            {item().name}
          </text>
          <box flexDirection="row">
            <For each={item().pies}>
              {(pie, i) => (
                <box flexDirection="row">
                  <Show when={i() > 0}>
                    <text
                      fg={nameFg()}
                      attributes={dimAttrs(true)}
                      wrapMode="none"
                    >
                      /
                    </text>
                  </Show>
                  <text
                    fg={pieFg(pie.percent, item().maxPercent)}
                    attributes={dimAttrs(valueDimmed(item().maxPercent))}
                    wrapMode="none"
                  >
                    {pie.glyph}
                  </text>
                </box>
              )}
            </For>
          </box>
          <text
            fg={valueFg(item().maxPercent)}
            attributes={dimAttrs(valueDimmed(item().maxPercent))}
            wrapMode="none"
          >
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
