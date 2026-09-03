import { beforeEach, describe, expect, test } from "bun:test";
import { emptySnapshot } from "../src/format.ts";
import { gatedGet, resetUsageGate } from "../src/gate.ts";

const snap = emptySnapshot();

beforeEach(() => {
  resetUsageGate();
});

describe("gatedGet", () => {
  test("two concurrent calls share one load", async () => {
    let n = 0;
    const load = async () => {
      n += 1;
      await Bun.sleep(10);
      return snap;
    };
    const a = gatedGet(false, load);
    const b = gatedGet(false, load);
    expect(a.cached).toBe("fetch");
    expect(b.cached).toBe("inflight");
    const [sa, sb] = await Promise.all([a.promise, b.promise]);
    expect(n).toBe(1);
    expect(sa).toBe(sb);
  });

  test("completed fetch is cache within 3 min", async () => {
    let n = 0;
    const load = async () => {
      n += 1;
      return snap;
    };
    expect((await gatedGet(false, load).promise).fetchedAt).toBe(
      snap.fetchedAt,
    );
    const again = gatedGet(false, load);
    expect(again.cached).toBe("cache");
    await again.promise;
    expect(n).toBe(1);
  });

  test("refresh while inflight joins", async () => {
    let n = 0;
    const load = async () => {
      n += 1;
      await Bun.sleep(10);
      return snap;
    };
    const a = gatedGet(false, load);
    const b = gatedGet(true, load);
    expect(b.cached).toBe("inflight");
    await Promise.all([a.promise, b.promise]);
    expect(n).toBe(1);
  });
});
