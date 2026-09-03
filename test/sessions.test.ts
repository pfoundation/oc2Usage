import { describe, expect, test } from "bun:test";
import {
  sessionDisplayTitle,
  sortSessionsByUpdated,
  toSessionOptions,
} from "../src/sessions.ts";

describe("sessions", () => {
  test("sorts by updated desc", () => {
    const sorted = sortSessionsByUpdated([
      { id: "a", time: { updated: 1 } },
      { id: "b", time: { updated: 3 } },
      { id: "c", time: { updated: 2 } },
    ]);
    expect(sorted.map((s) => s.id)).toEqual(["b", "c", "a"]);
  });

  test("falls back to id prefix when title is missing", () => {
    expect(sessionDisplayTitle({ id: "abcdef123456" })).toBe(
      "session abcdef12",
    );
    expect(
      sessionDisplayTitle({ id: "abcdef123456", title: "  Fix bug  " }),
    ).toBe("Fix bug");
  });

  test("maps to select options in recency order", () => {
    const options = toSessionOptions([
      { id: "old", title: "Old", time: { updated: 1 } },
      { id: "new", title: "New", time: { updated: 2 } },
    ]);
    expect(options.map((o) => o.value)).toEqual(["new", "old"]);
    expect(options[0].title).toBe("New");
  });
});
