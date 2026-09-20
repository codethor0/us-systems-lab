/**
 * Tests for strongestOf, written before it exists. strongestOf is the generic form of the tie-break
 * that strongestContribution already applies, so that a caller with richer contributions, such as
 * ones that also name the lever they came from, gets back the very same object it passed in.
 */
import { describe, expect, it } from "vitest";
import { strongestContribution, strongestOf } from "./propagation";
import type { NodeEffect, PathContribution } from "./propagation";

interface Sourced extends PathContribution {
  readonly source: string;
}

function item(source: string, edgeIds: string[], value: number): Sourced {
  return { source, edgeIds, value };
}

function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [[...items]];
  return items.flatMap((first, i) =>
    permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [first, ...rest]),
  );
}

describe("strongestOf", () => {
  it("returns undefined for an empty list", () => {
    expect(strongestOf<PathContribution>([])).toBeUndefined();
  });

  it("returns the very same object it was given, extra fields included", () => {
    const only = item("s", ["a__b"], 0.25);
    expect(strongestOf([only])).toBe(only);
  });

  it("picks the largest magnitude, whatever the sign", () => {
    const small = item("s", ["a__b"], 0.25);
    const bigNegative = item("t", ["c__d"], -0.5);
    expect(strongestOf([small, bigNegative])).toBe(bigNegative);
    expect(strongestOf([bigNegative, small])).toBe(bigNegative);
  });

  it("on equal magnitude prefers fewer edges, before any ordering of names", () => {
    const direct = item("z", ["z__x"], 0.25);
    const twoHops = item("a", ["a__b", "b__x"], -0.25);
    for (const order of permutations([direct, twoHops])) expect(strongestOf(order)).toBe(direct);
  });

  it("on equal magnitude and length prefers the lower edge id sequence", () => {
    const low = item("s", ["a__b", "b__x"], 0.25);
    const high = item("s", ["a__c", "c__x"], 0.25);
    for (const order of permutations([low, high])) expect(strongestOf(order)).toBe(low);
  });

  it("does not depend on the order of the list, over every permutation of four items", () => {
    const items = [
      item("s", ["a__b"], 0.5),
      item("t", ["b__b"], -0.5),
      item("u", ["a__b", "b__c"], 0.5),
      item("v", ["c__c"], 0.25),
    ];
    const winners = new Set(permutations(items).map((order) => strongestOf(order)));
    expect(winners.size).toBe(1);
    expect([...winners][0]).toBe(items[0]);
  });

  it("agrees with strongestContribution on a node effect", () => {
    const contributions: PathContribution[] = [
      { edgeIds: ["a__b", "b__c"], value: 0.25 },
      { edgeIds: ["a__c"], value: 0.25 },
    ];
    const effect: NodeEffect = { nodeId: "c", raw: 0.5, delta: 0.5, contributions };
    expect(strongestContribution(effect)).toBe(strongestOf(contributions));
  });
});
