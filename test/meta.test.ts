import { describe, expect, test } from "bun:test";
import {
  asSnapshot,
  emptySnapshot,
  formatDetail,
  formatFooter,
  META_WINDOW_LABELS,
  providerWindows,
  usageKindFromProviderID,
} from "../src/format.ts";
import { extractMetaSubscription, parseMeta } from "../src/providers.ts";

const NOW = Date.parse("2026-09-01T12:00:00.000Z");

const SSE_STREAM = [
  "event: response.created",
  'data: {"type":"response.created","response":{"id":"resp_1"}}',
  "",
  "event: response.in_progress",
  'data: {"type":"response.in_progress"}',
  "",
  "event: response.incomplete",
  'data: {"type":"response.incomplete","response":{"usage":{"total_tokens":24}}}',
  "",
  "event: response.subscription_usage",
  'data: {"subscription":{"tier":"27681631238169137","weekly":{"resets_at":1788739200,"used_percent":0},"window":{"resets_at":1788448916,"used_percent":2,"window_duration_mins":300}},"type":"response.subscription_usage"}',
  "",
].join("\n");

describe("extractMetaSubscription", () => {
  test("finds the subscription event in an SSE stream", () => {
    const sub = extractMetaSubscription(SSE_STREAM) as Record<string, unknown>;
    expect(sub.tier).toBe("27681631238169137");
    expect((sub.window as Record<string, unknown>).used_percent).toBe(2);
  });

  test("returns undefined without a subscription event", () => {
    expect(extractMetaSubscription("event: foo\ndata: {}\n\n")).toBeUndefined();
    expect(extractMetaSubscription("")).toBeUndefined();
  });

  test("skips [DONE] and malformed data lines", () => {
    const stream = [
      "event: message",
      "data: [DONE]",
      "data: not json {",
      'data: {"type":"response.subscription_usage","subscription":{"weekly":{"used_percent":7}}}',
      "",
    ].join("\n");
    const sub = extractMetaSubscription(stream) as Record<string, unknown>;
    expect((sub.weekly as Record<string, unknown>).used_percent).toBe(7);
  });
});

describe("parseMeta", () => {
  test("parses 5h window and week with epoch resets", () => {
    const meta = parseMeta(200, extractMetaSubscription(SSE_STREAM));
    expect(meta.status).toBe("ok");
    expect(meta.percent).toBe(2);
    expect(meta.label).toBe("5h");
    expect(meta.rolling?.percent).toBe(2);
    expect(meta.rolling?.resetsAt).toBe(
      new Date(1788448916 * 1000).toISOString(),
    );
    expect(meta.weekly?.percent).toBe(0);
    expect(meta.weekly?.resetsAt).toBe(
      new Date(1788739200 * 1000).toISOString(),
    );
    expect(
      providerWindows(meta, META_WINDOW_LABELS)
        .map((r) => r.label)
        .join(","),
    ).toBe("5h,week");
  });

  test("weekly-only payload picks week", () => {
    const meta = parseMeta(200, { weekly: { used_percent: 13 } });
    expect(meta.status).toBe("ok");
    expect(meta.percent).toBe(13);
    expect(meta.label).toBe("week");
  });

  test("missing subscription is ok without percent (pay-as-you-go)", () => {
    for (const body of [undefined, null, {}, { tier: "1" }]) {
      const meta = parseMeta(200, body);
      expect(meta.status).toBe("ok");
      expect(meta.percent).toBeUndefined();
    }
  });

  test("auth and rate-limit statuses", () => {
    expect(parseMeta(401, {}).status).toBe("error");
    expect(parseMeta(403, {}).status).toBe("error");
    expect(parseMeta(429, {}).status).toBe("rate-limited");
    expect(parseMeta(500, {}).error).toBe("HTTP 500");
  });
});

describe("meta footer / snapshot", () => {
  const snap = {
    ...emptySnapshot(),
    meta: parseMeta(200, extractMetaSubscription(SSE_STREAM)),
  };

  test("kind mapping", () => {
    expect(usageKindFromProviderID("meta")).toBe("meta");
    expect(usageKindFromProviderID("Meta")).toBe("meta");
    expect(usageKindFromProviderID("meta/muse-spark-1.3")).toBe("meta");
  });

  test("footer shows percents on subscription", () => {
    expect(formatFooter(snap, "meta", NOW)).toBe("meta 2/0%");
  });

  test("footer shows payg without subscription data", () => {
    const payg = { ...emptySnapshot(), meta: { status: "ok" } };
    expect(formatFooter(payg, "meta", NOW)).toBe("meta payg");
  });

  test("footer hides pending meta", () => {
    expect(formatFooter(emptySnapshot(), "meta", NOW)).toBe("");
  });

  test("asSnapshot defaults missing meta (backward compat)", () => {
    const old = {
      fetchedAt: "",
      grok: { status: "pending" },
      go: { status: "pending" },
      anthropic: { status: "pending" },
    };
    expect(asSnapshot(old).meta.status).toBe("pending");
    expect(emptySnapshot().meta.status).toBe("pending");
  });

  test("detail includes Meta rows or payg line", () => {
    expect(formatDetail(snap)).toContain("Meta 5h");
    expect(formatDetail(snap)).toContain("2%");
    const payg = { ...emptySnapshot(), meta: { status: "ok" } };
    expect(formatDetail(payg)).toContain("pay-as-you-go");
  });
});
