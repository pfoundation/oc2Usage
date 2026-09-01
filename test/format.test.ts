import { describe, expect, test } from "bun:test";
import {
  canFetch,
  CLAUDE_WINDOW_LABELS,
  emptySnapshot,
  footerPies,
  formatCompact,
  formatDetail,
  formatFetchedAt,
  formatFooter,
  formatWindowPercents,
  GO_WINDOW_LABELS,
  GROK_WINDOW_LABELS,
  mergeProvider,
  MIN_FETCH_INTERVAL_MS,
  percentTone,
  pickGoWindow,
  providerWindows,
  remainingPie,
  resetRemaining,
  usageBar,
  usageKindFromProviderID,
} from "../src/format.ts";
import {
  parseAnthropic,
  parseGo,
  parseGrok,
  tokenFromCredential,
} from "../src/providers.ts";

const NOW = Date.parse("2026-09-01T12:00:00.000Z");
const HOUR = 3_600_000;

const go = parseGo(200, {
  usage: {
    rolling: { status: "ok", percent: 0, resetsAt: "2026-09-01T22:57:33.284Z" },
    weekly: { status: "ok", percent: 0, resetsAt: "2026-09-07T00:00:00.284Z" },
    monthly: { status: "ok", percent: 2, resetsAt: "2026-09-20T15:34:57.284Z" },
  },
});

const grok = parseGrok(200, {
  config: {
    currentPeriod: {
      type: "USAGE_PERIOD_TYPE_WEEKLY",
      start: "2026-08-31T22:48:41.564522+00:00",
      end: "2026-09-07T22:48:41.564522+00:00",
    },
    creditUsagePercent: 3,
    productUsage: [{ product: "GrokBuild", usagePercent: 3 }],
  },
});

const anthropic = parseAnthropic(200, {
  five_hour: { utilization: 8, resets_at: "2026-09-01T16:59:59Z" },
  seven_day: { utilization: 28, resets_at: "2026-09-07T12:59:59Z" },
});

const snap = {
  fetchedAt: new Date().toISOString(),
  grok,
  go,
  anthropic,
};

describe("parseGo / pickGoWindow", () => {
  test("parses usage windows", () => {
    expect(go.status).toBe("ok");
    expect(pickGoWindow(go)?.id).toBe("30d");
    expect(pickGoWindow(go)?.percent).toBe(2);
  });

  test("403 is missing", () => {
    expect(parseGo(403, {}).status).toBe("missing");
  });
});

describe("parseGrok", () => {
  test("parses weekly credits", () => {
    expect(grok.status).toBe("ok");
    expect(grok.percent).toBe(3);
  });
});

describe("parseAnthropic", () => {
  test("parses 5h and week", () => {
    expect(anthropic.status).toBe("ok");
    expect(formatWindowPercents(anthropic)).toBe("8/28%");
  });

  test("parses scoped Fable weekly", () => {
    const withFable = parseAnthropic(200, {
      five_hour: { utilization: 8, resets_at: "2026-09-01T16:59:59Z" },
      seven_day: { utilization: 28, resets_at: "2026-09-07T12:59:59Z" },
      limits: [
        { kind: "session", percent: 8, is_active: false },
        { kind: "weekly_all", percent: 28, is_active: false },
        {
          kind: "weekly_scoped",
          percent: 54,
          is_active: true,
          resets_at: "2026-09-07T12:59:59Z",
          scope: { model: { id: null, display_name: "Fable" }, surface: null },
        },
      ],
    });
    expect(withFable.status).toBe("ok");
    expect(withFable.weekly?.percent).toBe(28);
    expect(withFable.fable?.percent).toBe(54);
    expect(withFable.scoped?.[0]?.label).toBe("Fable");
    expect(withFable.scoped?.[0]?.percent).toBe(54);
    expect(
      providerWindows(withFable, CLAUDE_WINDOW_LABELS)
        .map((r) => r.label)
        .join(","),
    ).toBe("5h,week,Fable");
    expect(formatWindowPercents(withFable)).toBe("8/28/54%");
    const fableSnap = { ...snap, anthropic: withFable };
    expect(formatFooter(fableSnap, "anthropic", NOW)).toBe("claude ◔ 8/28/54%");
    const fableDetail = formatDetail(fableSnap);
    expect(fableDetail).toContain("Fable");
    expect(fableDetail).toContain("54%");
    expect(fableDetail).toContain("Claude week");
    const staleFable = mergeProvider(withFable, {
      status: "error",
      error: "unauthorized",
    });
    expect(staleFable.fable?.percent).toBe(54);
    expect(staleFable.scoped?.[0]?.percent).toBe(54);
  });

  test("parses named seven_day_fable", () => {
    const namedFable = parseAnthropic(200, {
      five_hour: { utilization: 8, resets_at: "2026-09-01T16:59:59Z" },
      seven_day: { utilization: 28, resets_at: "2026-09-07T12:59:59Z" },
      seven_day_fable: { utilization: 11, resets_at: "2026-09-07T12:59:59Z" },
    });
    expect(namedFable.scoped?.[0]?.label).toBe("Fable");
    expect(namedFable.scoped?.[0]?.percent).toBe(11);
  });

  test("omits scoped without fable", () => {
    const noFable = parseAnthropic(200, {
      five_hour: { utilization: 8, resets_at: "2026-09-01T16:59:59Z" },
      seven_day: { utilization: 28, resets_at: "2026-09-07T12:59:59Z" },
      limits: [
        { kind: "session", percent: 8 },
        { kind: "weekly_all", percent: 28 },
      ],
    });
    expect(noFable.scoped).toBeUndefined();
  });
});

describe("formatWindowPercents / formatCompact / formatFooter", () => {
  test("joins windows", () => {
    expect(formatWindowPercents(go)).toBe("0/0/2%");
    expect(formatWindowPercents(grok)).toBe("3%");
    expect(formatCompact(snap)).toBe("grok 3% · go 0/0/2% · claude 8/28%");
  });

  test("footer matches current provider", () => {
    expect(formatFooter(snap, "xai", NOW)).toBe("grok ○ 3%");
    expect(formatFooter(snap, "opencode-go", NOW)).toBe("go ◔ 0/0/2%");
    expect(formatFooter(snap, "anthropic", NOW)).toBe("claude ◔ 8/28%");
    expect(formatFooter(snap, "openai")).toBe("");
  });
});

describe("providerWindows", () => {
  test("labels", () => {
    expect(
      providerWindows(go, GO_WINDOW_LABELS)
        .map((r) => r.label)
        .join(","),
    ).toBe("5h,week,month");
    expect(
      providerWindows(grok, GROK_WINDOW_LABELS)
        .map((r) => r.label)
        .join(","),
    ).toBe("7d");
    expect(
      providerWindows(anthropic, CLAUDE_WINDOW_LABELS)
        .map((r) => r.label)
        .join(","),
    ).toBe("5h,week");
  });
});

describe("usageBar / percentTone / formatFetchedAt", () => {
  test("usageBar", () => {
    expect(usageBar(0)).toBe("░░░░░░░░░░");
    expect(usageBar(100)).toBe("██████████");
    expect(usageBar(42)).toBe("████░░░░░░");
  });

  test("percentTone", () => {
    expect(percentTone(0)).toBe("ok");
    expect(percentTone(70)).toBe("warn");
    expect(percentTone(90)).toBe("crit");
  });

  test("formatFetchedAt local time", () => {
    const local = new Date(2026, 8, 1, 16, 4, 12);
    expect(formatFetchedAt(local.toISOString())).toBe("2026-09-01 16:04:12");
  });
});

describe("tokenFromCredential", () => {
  test("key and oauth", () => {
    expect(tokenFromCredential({ type: "key", key: "sk-test" })).toBe(
      "sk-test",
    );
    expect(tokenFromCredential({ type: "oauth", access: "tok" })).toBe("tok");
  });
});

describe("mergeProvider + stale (!)", () => {
  test("keeps last good snapshot when refresh fails", () => {
    const staleClaude = mergeProvider(anthropic, {
      status: "error",
      error: "unauthorized",
    });
    expect(staleClaude.status).toBe("ok");
    expect(staleClaude.rolling?.percent).toBe(8);
    expect(staleClaude.weekly?.percent).toBe(28);
    expect(formatWindowPercents(staleClaude)).toBe("8/28%");
    expect(
      formatFooter({ ...snap, anthropic: staleClaude }, "anthropic", NOW),
    ).toBe("claude ◔ 8/28%");
    expect(formatDetail({ ...snap, anthropic: staleClaude })).toContain(
      "Claude 5h",
    );
  });

  test("error without percents is !", () => {
    expect(formatWindowPercents({ status: "error" })).toBe("!");
    expect(
      mergeProvider(
        { status: "pending" },
        { status: "error", error: "unauthorized" },
      ).percent,
    ).toBeUndefined();
  });
});

describe("canFetch", () => {
  test("3 minute floor", () => {
    expect(canFetch(undefined, 1_000)).toBe(true);
    expect(canFetch(0, MIN_FETCH_INTERVAL_MS - 1)).toBe(false);
    expect(canFetch(0, MIN_FETCH_INTERVAL_MS)).toBe(true);
  });
});

describe("remainingPie / resetRemaining / footerPies", () => {
  test("remainingPie glyphs", () => {
    expect(remainingPie(1)).toBe("○");
    expect(remainingPie(0.875)).toBe("◔");
    expect(remainingPie(0.874)).toBe("◔");
    expect(remainingPie(0.625)).toBe("◑");
    expect(remainingPie(0.624)).toBe("◑");
    expect(remainingPie(0.375)).toBe("◕");
    expect(remainingPie(0.374)).toBe("◕");
    expect(remainingPie(0.125)).toBe("●");
    expect(remainingPie(0.124)).toBe("●");
    expect(remainingPie(0)).toBe("●");
  });

  test("resetRemaining", () => {
    expect(resetRemaining("2026-09-01T11:00:00.000Z", 5 * HOUR, NOW)).toBe(0);
    expect(resetRemaining("2026-09-01T17:00:00.000Z", 5 * HOUR, NOW)).toBe(1);
    expect(resetRemaining("2026-09-01T14:00:00.000Z", 5 * HOUR, NOW)).toBe(0.4);
    expect(resetRemaining(undefined, 5 * HOUR, NOW)).toBe(0);
  });

  test("footer pies and failed suffix", () => {
    const hot = {
      status: "ok",
      rolling: { percent: 62, resetsAt: "2026-09-01T14:00:00.000Z" },
      weekly: { percent: 28, resetsAt: "2026-09-07T12:00:00.000Z" },
      monthly: { percent: 81, resetsAt: "2026-09-04T12:00:00.000Z" },
    };
    expect(
      footerPies(hot, CLAUDE_WINDOW_LABELS, NOW)
        .map((p) => `${p.label}${p.glyph}`)
        .join(" "),
    ).toBe("extra●");
    expect(formatFooter({ ...snap, anthropic: hot }, "anthropic", NOW)).toBe(
      "claude ● 62/28/81%",
    );
    expect(
      formatFooter(
        {
          ...snap,
          anthropic: { ...hot, status: "error", error: "unauthorized" },
        },
        "anthropic",
        NOW,
      ),
    ).toBe("claude ● 62/28/81%");
    expect(
      footerPies(
        { status: "ok", rolling: { percent: 80 } },
        CLAUDE_WINDOW_LABELS,
        NOW,
      ).length,
    ).toBe(0);
    const edge = {
      status: "ok",
      rolling: { percent: 49, resetsAt: "2026-09-01T17:00:00.000Z" },
      weekly: { percent: 50, resetsAt: "2026-09-08T12:00:00.000Z" },
    };
    expect(
      footerPies(edge, CLAUDE_WINDOW_LABELS, NOW)
        .map((p) => `${p.label}${p.glyph}`)
        .join(" "),
    ).toBe("week○");
    const grokHot = parseGrok(200, {
      config: {
        currentPeriod: {
          type: "USAGE_PERIOD_TYPE_WEEKLY",
          start: "2026-08-31T12:00:00.000Z",
          end: "2026-09-07T12:00:00.000Z",
        },
        creditUsagePercent: 60,
      },
    });
    expect(formatFooter({ ...snap, grok: grokHot }, "xai", NOW)).toBe(
      "grok ◔ 60%",
    );
    const withFable = parseAnthropic(200, {
      five_hour: { utilization: 8, resets_at: "2026-09-01T16:59:59Z" },
      seven_day: { utilization: 28, resets_at: "2026-09-07T12:59:59Z" },
      limits: [
        {
          kind: "weekly_scoped",
          percent: 54,
          is_active: true,
          resets_at: "2026-09-07T12:59:59Z",
          scope: { model: { id: null, display_name: "Fable" }, surface: null },
        },
      ],
    });
    const staleHotFable = mergeProvider(withFable, {
      status: "error",
      error: "unauthorized",
    });
    expect(
      formatFooter({ ...snap, anthropic: staleHotFable }, "anthropic", NOW),
    ).toBe("claude ◔ 8/28/54%");
  });
});

describe("usageKindFromProviderID / emptySnapshot / formatDetail", () => {
  test("kind mapping", () => {
    expect(usageKindFromProviderID("xai")).toBe("grok");
    expect(usageKindFromProviderID("opencode-go")).toBe("go");
    expect(usageKindFromProviderID("anthropic")).toBe("anthropic");
  });

  test("empty snapshot", () => {
    expect(emptySnapshot().grok.status).toBe("pending");
  });

  test("detail includes providers", () => {
    expect(formatDetail(snap)).toContain("Grok");
    expect(formatDetail(snap)).toContain("Go month");
  });
});
