/**
 * Tests for buckets.ts, written before it exists.
 *
 * A bucket is what the interface shows in place of a number, so that it never implies more precision
 * than the model has. The thresholds are editorial and openly tunable: below 0.05 is negligible,
 * 0.05 up to 0.15 is small, 0.15 up to 0.4 is moderate, and 0.4 and above is large, by magnitude.
 * Every boundary is tested at the exact double and at the double just below it.
 */
import { describe, expect, it } from "vitest";
import { BUCKET_THRESHOLDS, bucketOf, directionOf } from "./buckets";

/** The largest double strictly below a positive finite x. */
function nextDown(x: number): number {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, x);
  view.setBigUint64(0, view.getBigUint64(0) - 1n);
  return view.getFloat64(0);
}

describe("the thresholds", () => {
  it("are 0.05, 0.15 and 0.4, and nothing else", () => {
    expect(BUCKET_THRESHOLDS).toEqual({ small: 0.05, moderate: 0.15, large: 0.4 });
  });

  it("nextDown really is the adjacent double, so the boundary tests are exact", () => {
    expect(nextDown(1)).toBe(0.9999999999999999);
    expect(nextDown(0.5)).toBe(0.49999999999999994);
    expect(nextDown(0.05)).toBeLessThan(0.05);
  });
});

describe("bucketOf", () => {
  it.each([
    [0, "negligible"],
    [nextDown(0.05), "negligible"],
    [0.05, "small"],
    [0.1, "small"],
    [nextDown(0.15), "small"],
    [0.15, "moderate"],
    [0.3, "moderate"],
    [nextDown(0.4), "moderate"],
    [0.4, "large"],
    [0.75, "large"],
    [1, "large"],
  ] as const)("a delta of %s is %s", (delta, bucket) => {
    expect(bucketOf(delta)).toBe(bucket);
  });

  it("is symmetric: a negative delta has the same bucket as its magnitude", () => {
    for (const delta of [0, nextDown(0.05), 0.05, nextDown(0.15), 0.15, nextDown(0.4), 0.4, 1]) {
      expect(bucketOf(-delta)).toBe(bucketOf(delta));
    }
  });

  it("treats negative zero as negligible", () => {
    expect(bucketOf(-0)).toBe("negligible");
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, 1.0000000000000002, -1.5])(
    "rejects %s, which a clamped delta can never be",
    (delta) => {
      expect(() => bucketOf(delta)).toThrow(RangeError);
    },
  );
});

describe("directionOf", () => {
  it.each([
    [0.05, "up"],
    [-0.05, "down"],
    [1, "up"],
    [-1, "down"],
    [0.15, "up"],
    [-0.4, "down"],
  ] as const)("a delta of %s is %s", (delta, direction) => {
    expect(directionOf(delta)).toBe(direction);
  });

  it.each([0, -0, 0.03, -0.03, nextDown(0.05), -nextDown(0.05)])(
    "a negligible delta of %s has no direction, so a tiny change is never drawn as an arrow",
    (delta) => {
      expect(directionOf(delta)).toBe("none");
    },
  );

  it("rejects what bucketOf rejects", () => {
    expect(() => directionOf(Number.NaN)).toThrow(RangeError);
    expect(() => directionOf(2)).toThrow(RangeError);
  });
});
