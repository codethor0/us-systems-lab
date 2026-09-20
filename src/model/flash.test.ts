/**
 * Tests for flash.ts, written before it exists.
 *
 * The interface flashes a node once when its visible state changes, then leaves it in a settled
 * "changed" state. This module decides only WHEN. A node flashes when its direction or its bucket
 * changes, or when it first becomes visible. It does not flash on a smaller change inside the same
 * bucket, which is what stops a slider drag from strobing. It never flashes when it settles back to
 * negligible, and loading a scenario from a link does not flash anything.
 *
 * Each node has a key that only ever increases, one step per flash. The interface restarts the CSS
 * animation when the key changes, so a key that repeated would silently suppress a real flash.
 */
import { describe, expect, it } from "vitest";
import { initialFlashState, nextFlashState, visualOf } from "./flash";
import type { FlashState } from "./flash";

function fx(...pairs: [string, number][]): { nodeId: string; delta: number }[] {
  return pairs.map(([nodeId, delta]) => ({ nodeId, delta }));
}

function deepFreeze(value: unknown): void {
  if (typeof value !== "object" || value === null) return;
  Object.freeze(value);
  if (value instanceof Map) {
    for (const [k, v] of value) {
      deepFreeze(k);
      deepFreeze(v);
    }
  }
  for (const child of Object.values(value)) deepFreeze(child);
}

const EMPTY: FlashState = initialFlashState([]);

describe("visualOf", () => {
  it.each([
    [0.75, { direction: "up", bucket: "large" }],
    [-0.5, { direction: "down", bucket: "large" }],
    [0.3, { direction: "up", bucket: "moderate" }],
    [-0.05, { direction: "down", bucket: "small" }],
  ] as const)("a delta of %s is %j", (delta, visual) => {
    expect(visualOf(delta)).toEqual(visual);
  });

  it.each([0, -0, 0.049, -0.049])("a negligible delta of %s has no visual", (delta) => {
    expect(visualOf(delta)).toBeUndefined();
  });
});

describe("initialFlashState", () => {
  it("holds the visible state of every non-negligible node and flashes nothing", () => {
    const state = initialFlashState(fx(["a", 0.5], ["b", -0.2], ["c", 0.01]));
    expect([...state.visuals.keys()]).toEqual(["a", "b"]);
    expect(state.visuals.get("a")).toEqual({ direction: "up", bucket: "large" });
    expect(state.visuals.get("b")).toEqual({ direction: "down", bucket: "moderate" });
    expect(state.keys.size).toBe(0);
  });

  it("means a link that loads with levers set does not flash, and a later change does", () => {
    const loaded = initialFlashState(fx(["a", 0.5]));
    expect(nextFlashState(loaded, fx(["a", 0.5])).flashed).toEqual([]);
    expect(nextFlashState(loaded, fx(["a", 0.1])).flashed).toEqual(["a"]);
  });
});

describe("when a node flashes", () => {
  it("flashes every node that becomes visible, sorted by id, and gives each its first key", () => {
    const step = nextFlashState(EMPTY, fx(["c", 0.75], ["a", -0.5], ["b", 0.3]));
    expect(step.flashed).toEqual(["a", "b", "c"]);
    expect([...step.state.keys]).toEqual([
      ["a", 1],
      ["b", 1],
      ["c", 1],
    ]);
  });

  it("does not flash when the same state arrives again", () => {
    const first = nextFlashState(EMPTY, fx(["a", 0.75]));
    const again = nextFlashState(first.state, fx(["a", 0.75]));
    expect(again.flashed).toEqual([]);
    expect(again.state.keys.get("a")).toBe(1);
  });

  it("does not flash on a change inside the same bucket, however many ticks: 0.75, 0.6, 0.45 are all large", () => {
    let state = nextFlashState(EMPTY, fx(["a", 0.75])).state;
    for (const delta of [0.6, 0.55, 0.45, 0.4]) {
      const step = nextFlashState(state, fx(["a", delta]));
      expect(step.flashed).toEqual([]);
      state = step.state;
    }
    expect(state.keys.get("a")).toBe(1);
  });

  it("flashes when the bucket changes: large to moderate, then moderate to small", () => {
    const one = nextFlashState(EMPTY, fx(["a", 0.75]));
    const two = nextFlashState(one.state, fx(["a", 0.3]));
    const three = nextFlashState(two.state, fx(["a", 0.1]));
    expect(two.flashed).toEqual(["a"]);
    expect(three.flashed).toEqual(["a"]);
    expect(three.state.keys.get("a")).toBe(3);
  });

  it("flashes at the exact boundary: 0.15 is moderate, and the double just below it is small", () => {
    const small = nextFlashState(EMPTY, fx(["a", 0.14999999999999997])).state;
    expect(nextFlashState(small, fx(["a", 0.15])).flashed).toEqual(["a"]);
  });

  it("flashes when the direction flips even though the bucket is the same", () => {
    const up = nextFlashState(EMPTY, fx(["a", 0.5])).state;
    const step = nextFlashState(up, fx(["a", -0.5]));
    expect(step.flashed).toEqual(["a"]);
    expect(step.state.keys.get("a")).toBe(2);
  });

  it("flashes only the nodes that changed, and leaves the others alone", () => {
    const start = nextFlashState(EMPTY, fx(["a", 0.5], ["b", 0.5])).state;
    const step = nextFlashState(start, fx(["a", 0.5], ["b", 0.1]));
    expect(step.flashed).toEqual(["b"]);
    expect(step.state.keys.get("a")).toBe(1);
    expect(step.state.keys.get("b")).toBe(2);
  });
});

describe("settling and returning", () => {
  it("does not flash when a node settles to negligible, and forgets its visual", () => {
    const shown = nextFlashState(EMPTY, fx(["a", 0.5])).state;
    const settled = nextFlashState(shown, fx(["a", 0.01]));
    expect(settled.flashed).toEqual([]);
    expect(settled.state.visuals.has("a")).toBe(false);
  });

  it("does not flash when a node leaves the effects altogether, for example after a reset", () => {
    const shown = nextFlashState(EMPTY, fx(["a", 0.5], ["b", -0.3])).state;
    const cleared = nextFlashState(shown, []);
    expect(cleared.flashed).toEqual([]);
    expect(cleared.state.visuals.size).toBe(0);
  });

  it("flashes again with a NEW key when a node returns, so the animation restarts", () => {
    const first = nextFlashState(EMPTY, fx(["a", 0.5]));
    const settled = nextFlashState(first.state, fx(["a", 0]));
    const back = nextFlashState(settled.state, fx(["a", 0.5]));
    expect(first.state.keys.get("a")).toBe(1);
    expect(settled.state.keys.get("a")).toBe(1);
    expect(back.flashed).toEqual(["a"]);
    expect(back.state.keys.get("a")).toBe(2);
  });

  it("never lets a key decrease or repeat, over a long random walk of one node", () => {
    let state = EMPTY;
    let last = 0;
    const deltas = [0.5, 0.5, 0.1, 0, -0.5, -0.5, 0.9, 0.02, 0.9, 0.2, -0.2, 0, 0, 0.6];
    for (const delta of deltas) {
      const step = nextFlashState(state, fx(["a", delta]));
      const key = step.state.keys.get("a") ?? 0;
      expect(key).toBeGreaterThanOrEqual(last);
      expect(key === last).toBe(step.flashed.length === 0);
      last = key;
      state = step.state;
    }
  });
});

describe("purity", () => {
  it("does not mutate the previous state or the effects", () => {
    const base = nextFlashState(EMPTY, fx(["a", 0.5])).state;
    const effects = fx(["a", 0.1], ["b", 0.5]);
    deepFreeze(base);
    deepFreeze(effects);
    expect(() => nextFlashState(base, effects)).not.toThrow();
    expect(base.keys.get("a")).toBe(1);
    expect(base.visuals.get("a")).toEqual({ direction: "up", bucket: "large" });
  });

  it("returns a new state object and does not alias the previous maps", () => {
    const base = nextFlashState(EMPTY, fx(["a", 0.5])).state;
    const next = nextFlashState(base, fx(["a", 0.5])).state;
    expect(next).not.toBe(base);
    expect(next.keys).not.toBe(base.keys);
    expect(next.visuals).not.toBe(base.visuals);
  });

  it("gives the same result whatever order the effects arrive in", () => {
    const a = nextFlashState(EMPTY, fx(["b", 0.5], ["a", -0.5], ["c", 0.2]));
    const b = nextFlashState(EMPTY, fx(["c", 0.2], ["a", -0.5], ["b", 0.5]));
    expect(b.flashed).toEqual(a.flashed);
    expect([...b.state.keys]).toEqual([...a.state.keys]);
    expect([...b.state.visuals]).toEqual([...a.state.visuals]);
  });
});
