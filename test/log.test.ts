import { describe, expect, test } from "bun:test";
import {
  formatLogLine,
  truncateBody,
  usageLogPath,
  type UsageLogRecord,
} from "../src/log.ts";

const TS = "2026-09-02T12:00:00.000Z";

describe("formatLogLine", () => {
  test("one JSON object + newline with kind and ts", () => {
    const line = formatLogLine({
      ts: TS,
      kind: "query",
      trigger: "rpc",
      refresh: false,
      cached: "fetch",
    });
    expect(line.endsWith("\n")).toBe(true);
    expect(line.split("\n")).toEqual([
      '{"ts":"2026-09-02T12:00:00.000Z","kind":"query","trigger":"rpc","refresh":false,"cached":"fetch"}',
      "",
    ]);
    const obj = JSON.parse(line) as UsageLogRecord;
    expect(obj.kind).toBe("query");
    expect(obj.ts).toBe(TS);
  });

  test("http line includes provider + status; omits undefined keys", () => {
    const obj = JSON.parse(
      formatLogLine({
        ts: TS,
        kind: "http",
        provider: "anthropic",
        trigger: "rpc",
        status: "missing",
      }),
    ) as Record<string, unknown>;
    expect(obj.provider).toBe("anthropic");
    expect(obj.status).toBe("missing");
    expect("httpStatus" in obj).toBe(false);
    expect("error" in obj).toBe(false);
    expect("body" in obj).toBe(false);
    expect("ms" in obj).toBe(false);
  });

  test("does not serialize unknown keys like token", () => {
    const line = formatLogLine({
      ts: TS,
      kind: "http",
      provider: "anthropic",
      trigger: "rpc",
      status: "ok",
      token: "sk-secret",
    } as UsageLogRecord & { token: string });
    expect(line).not.toContain("sk-secret");
    expect(line).not.toContain("token");
  });
});

describe("usageLogPath", () => {
  test("respects XDG_DATA_HOME", () => {
    expect(usageLogPath({ XDG_DATA_HOME: "/tmp/xdg" })).toBe(
      "/tmp/xdg/opencode/log/oc-usage.jsonl",
    );
  });

  test("falls back to HOME", () => {
    expect(usageLogPath({ HOME: "/home/me" })).toBe(
      "/home/me/.local/share/opencode/log/oc-usage.jsonl",
    );
  });

  test("strips trailing slashes", () => {
    expect(usageLogPath({ XDG_DATA_HOME: "/tmp/xdg/" })).toBe(
      "/tmp/xdg/opencode/log/oc-usage.jsonl",
    );
  });
});

describe("truncateBody", () => {
  test("string and json, max 200", () => {
    expect(truncateBody("hi")).toBe("hi");
    expect(truncateBody({ a: 1 })).toBe('{"a":1}');
    expect(truncateBody("x".repeat(201))?.length).toBe(200);
    expect(truncateBody(undefined)).toBeUndefined();
    expect(truncateBody("")).toBeUndefined();
  });
});
