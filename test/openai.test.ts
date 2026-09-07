import { describe, expect, test } from "bun:test";
import {
  asSnapshot,
  emptySnapshot,
  formatCompact,
  formatDetail,
  formatFooter,
  mergeProvider,
  OPENAI_WINDOW_LABELS,
  providerWindows,
  usageKindFromProviderID,
} from "../src/format.ts";
import {
  accountIdFromCredential,
  isApiKeyCredential,
  openAIRequestHeaders,
  parseOpenAI,
} from "../src/providers.ts";

const NOW = Date.parse("2026-09-01T12:00:00.000Z");
const NOW_S = Math.floor(NOW / 1000);

const PRO_BODY = {
  plan_type: "pro",
  rate_limit: {
    allowed: true,
    primary_window: {
      used_percent: 12,
      limit_window_seconds: 18000,
      reset_after_seconds: 7200,
      reset_at: NOW_S + 7200,
    },
    secondary_window: {
      used_percent: 38,
      limit_window_seconds: 604800,
      reset_after_seconds: 500000,
      reset_at: NOW_S + 500000,
    },
  },
};

const jwt = (payload: unknown): string =>
  `eyJhbGciOiJFZERTQSJ9.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.c2ln`;

describe("parseOpenAI", () => {
  test("parses 5h primary + weekly secondary with epoch resets", () => {
    const openai = parseOpenAI(200, PRO_BODY, NOW);
    expect(openai.status).toBe("ok");
    expect(openai.product).toBe("ChatGPT");
    expect(openai.percent).toBe(12);
    expect(openai.label).toBe("5h");
    expect(openai.rolling?.percent).toBe(12);
    expect(openai.rolling?.resetsAt).toBe(
      new Date((NOW_S + 7200) * 1000).toISOString(),
    );
    expect(openai.weekly?.percent).toBe(38);
    expect(openai.weekly?.resetsAt).toBe(
      new Date((NOW_S + 500000) * 1000).toISOString(),
    );
    expect(openai.resetsAt).toBe(openai.rolling?.resetsAt);
    expect(
      providerWindows(openai, OPENAI_WINDOW_LABELS)
        .map((r) => r.label)
        .join(","),
    ).toBe("5h,week");
  });

  test("weekly-only primary is classified by duration, not position", () => {
    const openai = parseOpenAI(
      200,
      {
        plan_type: "plus",
        rate_limit: {
          primary_window: {
            used_percent: 66,
            limit_window_seconds: 604800,
            reset_at: NOW_S + 100000,
          },
          secondary_window: null,
        },
      },
      NOW,
    );
    expect(openai.status).toBe("ok");
    expect(openai.rolling).toBeUndefined();
    expect(openai.weekly?.percent).toBe(66);
    expect(openai.percent).toBe(66);
    expect(openai.label).toBe("week");
  });

  test("reordered wire windows are classified by duration", () => {
    const openai = parseOpenAI(
      200,
      {
        rate_limit: {
          primary_window: {
            used_percent: 41,
            limit_window_seconds: 604800,
            reset_at: NOW_S + 100000,
          },
          secondary_window: {
            used_percent: 7,
            limit_window_seconds: 18000,
            reset_at: NOW_S + 7000,
          },
        },
      },
      NOW,
    );
    expect(openai.rolling?.percent).toBe(7);
    expect(openai.weekly?.percent).toBe(41);
  });

  test("unknown durations fall back to wire position", () => {
    const openai = parseOpenAI(
      200,
      {
        rate_limit: {
          primary_window: { used_percent: 10, limit_window_seconds: 3600 },
          secondary_window: { used_percent: 20, limit_window_seconds: 3600 },
        },
      },
      NOW,
    );
    expect(openai.rolling?.percent).toBe(10);
    expect(openai.weekly?.percent).toBe(20);
  });

  test("duplicate semantic durations fall back to wire position", () => {
    const openai = parseOpenAI(
      200,
      {
        rate_limit: {
          primary_window: { used_percent: 10, limit_window_seconds: 604800 },
          secondary_window: { used_percent: 20, limit_window_seconds: 604800 },
        },
      },
      NOW,
    );
    expect(openai.rolling?.percent).toBe(10);
    expect(openai.weekly?.percent).toBe(20);
  });

  test("reset_after_seconds is used when reset_at is absent", () => {
    const openai = parseOpenAI(
      200,
      {
        rate_limit: {
          primary_window: {
            used_percent: 10,
            limit_window_seconds: 18000,
            reset_after_seconds: 100,
          },
        },
      },
      NOW,
    );
    expect(openai.rolling?.resetsAt).toBe(
      new Date(NOW + 100 * 1000).toISOString(),
    );
  });

  test("accepts numeric strings", () => {
    const openai = parseOpenAI(
      200,
      {
        rate_limit: {
          primary_window: {
            used_percent: "27.5",
            limit_window_seconds: "18000",
            reset_at: String(NOW_S + 3600),
          },
        },
      },
      NOW,
    );
    expect(openai.rolling?.percent).toBe(27.5);
    expect(openai.rolling?.resetsAt).toBe(
      new Date((NOW_S + 3600) * 1000).toISOString(),
    );
  });

  test("percent without reset is still usable", () => {
    const openai = parseOpenAI(
      200,
      { rate_limit: { primary_window: { used_percent: 5 } } },
      NOW,
    );
    expect(openai.status).toBe("ok");
    expect(openai.rolling?.percent).toBe(5);
    expect(openai.rolling?.resetsAt).toBeUndefined();
  });

  test("missing windows are errors, never pay-as-you-go", () => {
    expect(parseOpenAI(200, {}, NOW)).toEqual({
      status: "error",
      error: "unrecognized payload",
    });
    expect(parseOpenAI(200, "html", NOW).status).toBe("error");
    expect(parseOpenAI(200, null, NOW).status).toBe("error");
    expect(parseOpenAI(200, { rate_limit: {} }, NOW)).toEqual({
      status: "error",
      error: "no utilization in payload",
    });
    expect(
      parseOpenAI(200, { rate_limit: { primary_window: null } }, NOW),
    ).toEqual({ status: "error", error: "no utilization in payload" });
  });

  test("auth and rate-limit statuses", () => {
    expect(parseOpenAI(401, {}).status).toBe("error");
    expect(parseOpenAI(403, {}).status).toBe("error");
    expect(parseOpenAI(429, {}).status).toBe("rate-limited");
    expect(parseOpenAI(500, {}).error).toBe("HTTP 500");
  });
});

describe("accountIdFromCredential / openAIRequestHeaders", () => {
  const oauth = { type: "oauth", access: "tok", refresh: "r", expires: 1 };

  test("flat and metadata account ids", () => {
    expect(accountIdFromCredential({ ...oauth, accountId: "acct-v1" })).toBe(
      "acct-v1",
    );
    expect(accountIdFromCredential({ ...oauth, accountID: "acct-upper" })).toBe(
      "acct-upper",
    );
    expect(
      accountIdFromCredential({
        ...oauth,
        metadata: { accountID: "acct-v2" },
      }),
    ).toBe("acct-v2");
    expect(
      accountIdFromCredential({
        ...oauth,
        metadata: { chatgpt_account_id: "acct-snake" },
      }),
    ).toBe("acct-snake");
    expect(
      accountIdFromCredential({
        value: { ...oauth, accountId: "acct-nested" },
      }),
    ).toBe("acct-nested");
  });

  test("falls back to access-token JWT claims", () => {
    const access = jwt({
      "https://api.openai.com/auth": { chatgpt_account_id: "acct-jwt" },
    });
    expect(accountIdFromCredential({ ...oauth, access })).toBe("acct-jwt");
    expect(
      accountIdFromCredential(jwt({ chatgpt_account_id: "acct-top" })),
    ).toBe("acct-top");
  });

  test("explicit id wins over JWT; missing stays undefined", () => {
    const access = jwt({
      "https://api.openai.com/auth": { chatgpt_account_id: "acct-jwt" },
    });
    expect(
      accountIdFromCredential({ ...oauth, access, accountId: "acct-v1" }),
    ).toBe("acct-v1");
    expect(accountIdFromCredential({ ...oauth })).toBeUndefined();
    expect(accountIdFromCredential({ type: "key", key: "sk-proj-x" })).toBe(
      undefined,
    );
    expect(accountIdFromCredential(undefined)).toBeUndefined();
    expect(accountIdFromCredential("not-a-jwt")).toBeUndefined();
  });

  test("request headers carry the account id when known", () => {
    expect(openAIRequestHeaders({ ...oauth, accountId: "acct-v1" })).toEqual({
      "ChatGPT-Account-Id": "acct-v1",
    });
    expect(openAIRequestHeaders({ ...oauth })).toBeUndefined();
  });
});

describe("openai api keys", () => {
  test("key credentials are pay-as-you-go, pasted JWTs are not", () => {
    expect(isApiKeyCredential({ type: "key", key: "sk-proj-x" })).toBe(true);
    expect(
      isApiKeyCredential({
        value: { type: "key", key: "sk-proj-x" },
      }),
    ).toBe(true);
    expect(isApiKeyCredential({ type: "key", key: jwt({ sub: "u" }) })).toBe(
      false,
    );
    expect(isApiKeyCredential({ type: "oauth", access: "tok" })).toBe(false);
  });
});

describe("openai footer / snapshot", () => {
  const snap = {
    ...emptySnapshot(),
    openai: parseOpenAI(200, PRO_BODY, NOW),
  };

  test("kind mapping is narrow", () => {
    expect(usageKindFromProviderID("openai")).toBe("openai");
    expect(usageKindFromProviderID("OpenAI")).toBe("openai");
    expect(usageKindFromProviderID("openai/gpt-5.2")).toBe("openai");
    expect(usageKindFromProviderID("azure")).toBeUndefined();
    expect(usageKindFromProviderID("azure/gpt-5")).toBeUndefined();
    expect(usageKindFromProviderID("openrouter")).toBeUndefined();
    expect(usageKindFromProviderID("openai-compatible")).toBeUndefined();
    expect(usageKindFromProviderID("my-openai-proxy")).toBeUndefined();
  });

  test("footer shows percents on subscription", () => {
    expect(formatFooter(snap, "openai", NOW)).toBe("openai 12/38%");
  });

  test("footer shows payg without subscription data", () => {
    const payg = { ...emptySnapshot(), openai: { status: "ok" } };
    expect(formatFooter(payg, "openai", NOW)).toBe("openai payg");
  });

  test("footer hides pending and missing openai", () => {
    expect(formatFooter(emptySnapshot(), "openai", NOW)).toBe("");
    const missing = { ...emptySnapshot(), openai: { status: "missing" } };
    expect(formatFooter(missing, "openai", NOW)).toBe("");
  });

  test("asSnapshot defaults missing openai (backward compat)", () => {
    const old = {
      fetchedAt: "",
      grok: { status: "pending" },
      go: { status: "pending" },
      anthropic: { status: "pending" },
      meta: { status: "pending" },
    };
    expect(asSnapshot(old).openai.status).toBe("pending");
    expect(emptySnapshot().openai.status).toBe("pending");
  });

  test("detail and compact include OpenAI rows or payg line", () => {
    expect(formatDetail(snap)).toContain("OpenAI ChatGPT 5h");
    expect(formatDetail(snap)).toContain("12%");
    expect(formatCompact(snap)).toBe("openai 12/38%");
    const payg = { ...emptySnapshot(), openai: { status: "ok" } };
    expect(formatDetail(payg)).toContain("pay-as-you-go");
  });

  test("failed refresh keeps last good openai values", () => {
    const stale = mergeProvider(snap.openai, {
      status: "error",
      error: "unauthorized",
    });
    expect(stale.status).toBe("ok");
    expect(stale.rolling?.percent).toBe(12);
    expect(stale.weekly?.percent).toBe(38);
  });
});
