import { describe, expect, test } from "bun:test";
import {
  canFetch,
  ANTHROPIC_WINDOW_LABELS,
  CLAUDE_WINDOW_LABELS,
  emptySnapshot,
  footerPies,
  formatCompact,
  formatDetail,
  formatFetchedAt,
  formatFooter,
  formatRemainingGlyph,
  formatWindowPercents,
  footerView,
  isFableModel,
  GO_WINDOW_LABELS,
  GROK_WINDOW_LABELS,
  maxWindowPercent,
  mergeProvider,
  MIN_FETCH_INTERVAL_MS,
  percentTone,
  pickGoWindow,
  providerDetailWindows,
  providerWindows,
  remainingBlock,
  resetRemaining,
  usageBar,
  usageKindFromProviderID,
} from "../src/format.ts";
import {
  isApiKeyCredential,
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
  meta: { status: "pending" },
  openai: { status: "pending" },
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
      providerWindows(withFable, ANTHROPIC_WINDOW_LABELS)
        .map((r) => r.label)
        .join(","),
    ).toBe("5h,Fable");
    expect(formatWindowPercents(withFable)).toBe("8/54%");
    expect(formatWindowPercents(withFable, "claude-fable-5")).toBe("8/54%");
    expect(formatWindowPercents(withFable, "claude-sonnet-4-6")).toBe("8/28%");
    expect(
      providerWindows(withFable, ANTHROPIC_WINDOW_LABELS, "claude-sonnet-4-6")
        .map((r) => r.label)
        .join(","),
    ).toBe("5h,week");
    const fableSnap = { ...snap, anthropic: withFable };
    expect(
      footerPies(withFable, ANTHROPIC_WINDOW_LABELS, NOW)
        .map((p) => `${p.label}${p.glyph}`)
        .join("/"),
    ).toBe("Fable6d▁");
    expect(formatFooter(fableSnap, "anthropic", NOW)).toBe("claude 6d▁ 8/54%");
    expect(formatFooter(fableSnap, "anthropic", NOW, "claude-fable-5-1")).toBe(
      "claude 6d▁ 8/54%",
    );
    expect(formatFooter(fableSnap, "anthropic", NOW, "claude-opus-4-6")).toBe(
      "claude 8/28%",
    );
    const fableDetail = formatDetail(fableSnap);
    expect(fableDetail).toContain("Fable");
    expect(fableDetail).toContain("54%");
    expect(fableDetail).toContain("Anthropic Claude week");
    expect(fableDetail).toContain("28%");
    // Detail ignores the session model: all reported windows are shown.
    expect(formatDetail(fableSnap, NOW, "claude-sonnet-4-6")).toContain(
      "Anthropic Claude week",
    );
    expect(formatDetail(fableSnap, NOW, "claude-sonnet-4-6")).toContain(
      "Fable",
    );
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
    expect(formatWindowPercents(namedFable)).toBe("8/11%");
    expect(
      providerWindows(namedFable, ANTHROPIC_WINDOW_LABELS)
        .map((r) => r.label)
        .join(","),
    ).toBe("5h,Fable");
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
    expect(formatFooter(snap, "xai", NOW)).toBe("grok 3%");
    expect(formatFooter(snap, "opencode-go", NOW)).toBe("go 0/0/2%");
    expect(formatFooter(snap, "anthropic", NOW)).toBe("claude 8/28%");
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
      providerWindows(anthropic, ANTHROPIC_WINDOW_LABELS)
        .map((r) => r.label)
        .join(","),
    ).toBe("5h,week");
  });

  test("deprecated alias matches", () => {
    expect(CLAUDE_WINDOW_LABELS).toEqual(ANTHROPIC_WINDOW_LABELS);
  });
});

describe("providerDetailWindows", () => {
  test("shows week alongside all scoped windows", () => {
    const full = parseAnthropic(200, {
      five_hour: { utilization: 8, resets_at: "2026-09-01T16:59:59Z" },
      seven_day: { utilization: 28, resets_at: "2026-09-07T12:59:59Z" },
      seven_day_fable: { utilization: 54, resets_at: "2026-09-07T12:59:59Z" },
      seven_day_sonnet: { utilization: 12, resets_at: "2026-09-07T12:59:59Z" },
      seven_day_opus: { utilization: 33, resets_at: "2026-09-07T12:59:59Z" },
      extra_usage: { utilization: 5, resets_at: "2026-09-30T12:59:59Z" },
    });
    expect(
      providerDetailWindows(full, ANTHROPIC_WINDOW_LABELS)
        .map((r) => r.label)
        .join(","),
    ).toBe("5h,week,Fable,Sonnet,Opus,extra");
    expect(
      providerDetailWindows(full, ANTHROPIC_WINDOW_LABELS)
        .map((r) => Math.round(r.percent))
        .join("/"),
    ).toBe("8/28/54/12/33/5");
  });

  test("legacy fable without scoped reports once", () => {
    const legacy = {
      status: "ok",
      rolling: { percent: 8, resetsAt: "2026-09-01T16:59:59Z" },
      weekly: { percent: 28, resetsAt: "2026-09-07T12:59:59Z" },
      fable: { percent: 54, resetsAt: "2026-09-07T12:59:59Z" },
    };
    expect(
      providerDetailWindows(legacy, ANTHROPIC_WINDOW_LABELS)
        .map((r) => r.label)
        .join(","),
    ).toBe("5h,week,Fable");
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

describe("isApiKeyCredential", () => {
  test("key credential is pay-as-you-go", () => {
    expect(isApiKeyCredential({ type: "key", key: "sk-ant-api03-x" })).toBe(
      true,
    );
    expect(
      isApiKeyCredential({ value: { type: "key", key: "sk-ant-api03-x" } }),
    ).toBe(true);
  });

  test("oauth and pasted oauth tokens are not", () => {
    expect(isApiKeyCredential({ type: "oauth", access: "tok" })).toBe(false);
    expect(isApiKeyCredential({ type: "key", key: "sk-ant-oat01-x" })).toBe(
      false,
    );
    expect(isApiKeyCredential(undefined)).toBe(false);
    expect(isApiKeyCredential("sk-ant-api03-x")).toBe(false);
  });
});

describe("anthropic pay-as-you-go", () => {
  const payg = {
    ...emptySnapshot(),
    anthropic: { status: "ok", product: "Claude" },
  };

  test("footer shows payg without windows", () => {
    expect(formatFooter(payg, "anthropic", NOW)).toBe("claude payg");
    const view = footerView(payg, "anthropic", NOW);
    expect(view?.percents).toBe("payg");
    expect(view?.pies).toEqual([]);
    expect(view?.failed).toBe(false);
  });

  test("missing and pending stay hidden", () => {
    expect(formatFooter(emptySnapshot(), "anthropic", NOW)).toBe("");
    const missing = { ...emptySnapshot(), anthropic: { status: "missing" } };
    expect(formatFooter(missing, "anthropic", NOW)).toBe("");
  });

  test("detail includes payg line", () => {
    expect(formatDetail(payg, NOW)).toBe(
      "Anthropic  pay-as-you-go (see usage dashboard)",
    );
  });

  test("subscription snapshot is not payg", () => {
    expect(formatFooter(snap, "anthropic", NOW)).not.toContain("payg");
    expect(formatDetail(snap, NOW)).not.toContain("pay-as-you-go");
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
    ).toBe("claude 8/28%");
    expect(formatDetail({ ...snap, anthropic: staleClaude })).toContain(
      "Anthropic Claude 5h",
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

describe("remainingBlock / resetRemaining / footerPies", () => {
  test("remainingBlock glyphs", () => {
    expect(remainingBlock(1)).toBe("█");
    expect(remainingBlock(0.875)).toBe("▇");
    expect(remainingBlock(0.5)).toBe("▅");
    expect(remainingBlock(0.125)).toBe("▂");
    expect(remainingBlock(0)).toBe("▁");
  });

  test("resetRemaining", () => {
    expect(resetRemaining("2026-09-01T11:00:00.000Z", 5 * HOUR, NOW)).toBe(0);
    expect(resetRemaining("2026-09-01T17:00:00.000Z", 5 * HOUR, NOW)).toBe(1);
    expect(resetRemaining("2026-09-01T14:00:00.000Z", 5 * HOUR, NOW)).toBe(0.4);
    expect(resetRemaining(undefined, 5 * HOUR, NOW)).toBe(0);
  });

  test("formatRemainingGlyph per-hour with day prefix", () => {
    const DAY = 24 * HOUR;
    // Rolling (short) windows keep the old fraction-of-window behavior.
    expect(
      formatRemainingGlyph("2026-09-01T14:00:00.000Z", 5 * HOUR, NOW),
    ).toBe("▄");
    // Multi-day windows: whole days + hourly glyph, prefix omitted under 1d.
    expect(formatRemainingGlyph("2026-09-07T12:00:00.000Z", 7 * DAY, NOW)).toBe(
      "6d▁",
    );
    expect(formatRemainingGlyph("2026-09-08T12:00:00.000Z", 7 * DAY, NOW)).toBe(
      "7d▁",
    );
    expect(formatRemainingGlyph("2026-09-07T18:00:00.000Z", 7 * DAY, NOW)).toBe(
      "6d▃",
    );
    expect(formatRemainingGlyph("2026-09-02T00:00:00.000Z", 7 * DAY, NOW)).toBe(
      "▅",
    );
    expect(formatRemainingGlyph("2026-09-02T11:00:00.000Z", 7 * DAY, NOW)).toBe(
      "█",
    );
    expect(formatRemainingGlyph("2026-09-01T11:00:00.000Z", 7 * DAY, NOW)).toBe(
      "▁",
    );
    expect(formatRemainingGlyph(undefined, 7 * DAY, NOW)).toBe("▁");
  });

  test("footer pies and failed suffix", () => {
    const below = {
      status: "ok",
      rolling: { percent: 74, resetsAt: "2026-09-01T14:00:00.000Z" },
      weekly: { percent: 49, resetsAt: "2026-09-07T12:00:00.000Z" },
      monthly: { percent: 81, resetsAt: "2026-09-04T12:00:00.000Z" },
    };
    expect(footerPies(below, ANTHROPIC_WINDOW_LABELS, NOW)).toEqual([]);
    expect(formatFooter({ ...snap, anthropic: below }, "anthropic", NOW)).toBe(
      "claude 74/49/81%",
    );

    const hourlyOnly = {
      status: "ok",
      rolling: { percent: 75, resetsAt: "2026-09-01T14:00:00.000Z" },
      weekly: { percent: 49, resetsAt: "2026-09-07T12:00:00.000Z" },
    };
    expect(
      footerPies(hourlyOnly, ANTHROPIC_WINDOW_LABELS, NOW)
        .map((p) => `${p.label}${p.glyph}`)
        .join("/"),
    ).toBe("5h▄");
    expect(
      formatFooter({ ...snap, anthropic: hourlyOnly }, "anthropic", NOW),
    ).toBe("claude ▄ 75/49%");

    const weeklyOnly = {
      status: "ok",
      rolling: { percent: 74, resetsAt: "2026-09-01T17:00:00.000Z" },
      weekly: { percent: 50, resetsAt: "2026-09-08T12:00:00.000Z" },
    };
    expect(
      footerPies(weeklyOnly, ANTHROPIC_WINDOW_LABELS, NOW)
        .map((p) => `${p.label}${p.glyph}`)
        .join("/"),
    ).toBe("week7d▁");

    const both = {
      status: "ok",
      rolling: { percent: 80, resetsAt: "2026-09-01T14:00:00.000Z" },
      weekly: { percent: 60, resetsAt: "2026-09-07T12:00:00.000Z" },
      monthly: { percent: 81, resetsAt: "2026-09-04T12:00:00.000Z" },
    };
    expect(
      footerPies(both, ANTHROPIC_WINDOW_LABELS, NOW)
        .map((p) => `${p.label}${p.glyph}`)
        .join("/"),
    ).toBe("5h▄/week6d▁");
    expect(formatFooter({ ...snap, anthropic: both }, "anthropic", NOW)).toBe(
      "claude ▄/6d▁ 80/60/81%",
    );
    expect(
      formatFooter(
        {
          ...snap,
          anthropic: { ...both, status: "error", error: "unauthorized" },
        },
        "anthropic",
        NOW,
      ),
    ).toBe("claude ▄/6d▁ 80/60/81%");

    expect(
      footerPies(
        { status: "ok", rolling: { percent: 80 } },
        ANTHROPIC_WINDOW_LABELS,
        NOW,
      ).length,
    ).toBe(0);

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
      "grok 6d▁ 60%",
    );
    const grokCool = parseGrok(200, {
      config: {
        currentPeriod: {
          type: "USAGE_PERIOD_TYPE_WEEKLY",
          start: "2026-08-31T12:00:00.000Z",
          end: "2026-09-07T12:00:00.000Z",
        },
        creditUsagePercent: 49,
      },
    });
    expect(formatFooter({ ...snap, grok: grokCool }, "xai", NOW)).toBe(
      "grok 49%",
    );
  });

  test("maxWindowPercent drives low-usage dimming", () => {
    const both = {
      status: "ok",
      rolling: { percent: 80, resetsAt: "2026-09-01T14:00:00.000Z" },
      weekly: { percent: 60, resetsAt: "2026-09-07T12:00:00.000Z" },
      monthly: { percent: 81, resetsAt: "2026-09-04T12:00:00.000Z" },
    };
    expect(maxWindowPercent(both, ANTHROPIC_WINDOW_LABELS)).toBe(81);
    expect(
      footerView({ ...snap, anthropic: both }, "anthropic", NOW)?.maxPercent,
    ).toBe(81);

    const low = {
      status: "ok",
      rolling: { percent: 8, resetsAt: "2026-09-01T14:00:00.000Z" },
      weekly: { percent: 28, resetsAt: "2026-09-07T12:00:00.000Z" },
    };
    expect(maxWindowPercent(low, ANTHROPIC_WINDOW_LABELS)).toBe(28);
    expect(
      footerView({ ...snap, anthropic: low }, "anthropic", NOW)?.maxPercent,
    ).toBe(28);

    expect(
      maxWindowPercent({ status: "error" }, ANTHROPIC_WINDOW_LABELS),
    ).toBeUndefined();
    expect(
      footerView({ ...snap, anthropic: { status: "error" } }, "anthropic", NOW)
        ?.maxPercent,
    ).toBeUndefined();
  });
});

describe("usageKindFromProviderID / emptySnapshot / formatDetail", () => {
  test("kind mapping", () => {
    expect(usageKindFromProviderID("xai")).toBe("grok");
    expect(usageKindFromProviderID("opencode-go")).toBe("go");
    expect(usageKindFromProviderID("anthropic")).toBe("anthropic");
    expect(isFableModel("claude-fable-5")).toBe(true);
    expect(isFableModel("claude-fable-5-1")).toBe(true);
    expect(isFableModel("claude-sonnet-4-6")).toBe(false);
  });

  test("empty snapshot", () => {
    expect(emptySnapshot().grok.status).toBe("pending");
  });

  test("detail includes providers", () => {
    expect(formatDetail(snap)).toContain("Grok");
    expect(formatDetail(snap)).toContain("Go month");
  });
});
