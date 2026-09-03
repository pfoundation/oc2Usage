import { canFetch, type Snapshot } from "./format.ts";
import type { UsageCached } from "./log.ts";

const KEY = Symbol.for("pfoundation.oc.usage.gate");

export type UsageGate = {
  at?: number;
  snapshot?: Snapshot;
  inflight?: Promise<Snapshot>;
};

export function usageGate(): UsageGate {
  const g = globalThis as typeof globalThis & { [KEY]?: UsageGate };
  g[KEY] ??= {};
  return g[KEY];
}

/** Tests only. */
export function resetUsageGate(): void {
  const g = globalThis as typeof globalThis & { [KEY]?: UsageGate };
  delete g[KEY];
}

export function gatedGet(
  refresh: boolean,
  load: () => Promise<Snapshot>,
  now = Date.now(),
): { cached: UsageCached; promise: Promise<Snapshot> } {
  const gate = usageGate();
  if (gate.inflight) {
    return { cached: "inflight", promise: gate.inflight };
  }
  if (
    !refresh &&
    gate.snapshot &&
    gate.at !== undefined &&
    !canFetch(gate.at, now)
  ) {
    return { cached: "cache", promise: Promise.resolve(gate.snapshot) };
  }

  const promise = (async () => {
    const snapshot = await load();
    gate.at = Date.now();
    gate.snapshot = snapshot;
    return snapshot;
  })();
  gate.inflight = promise;
  void promise.finally(() => {
    if (gate.inflight === promise) gate.inflight = undefined;
  });
  return { cached: "fetch", promise };
}
