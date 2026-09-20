/**
 * Tests for propagation.ts, written before the implementation.
 *
 * The specified formula, for a path of k edges e1..ek from the source to node v:
 *
 *   contribution = lever * (direction_1 * strength_1) * ... * (direction_k * strength_k)
 *                  * decay^(k - 1)
 *   raw[v]       = sum of the contributions of every simple path of 1..maxHops edges
 *   delta[v]     = clamp(raw[v], -1, 1)
 *
 * A simple path never revisits a node, and the source counts as visited. Edges are
 * traversed in ascending id order, so sums accumulate in a fixed order.
 *
 * Every expected number below is worked out by hand in the comment above its test.
 * None was produced by running the implementation.
 */
import { describe, expect, it } from "vitest";
import graphJson from "../data/graph.json";
import {
  DEFAULT_PARAMS,
  MAX_HOPS_LIMIT,
  propagate,
  propagateRaw,
  strongestContribution,
} from "./propagation";
import type {
  NodeEffect,
  PropagationEdge,
  PropagationGraph,
  PropagationParams,
} from "./propagation";
import { parseGraph } from "./validate";

const HALF: PropagationParams = { maxHops: 3, decay: 0.5 };

function edge(from: string, to: string, direction: number, strength: number): PropagationEdge {
  return { id: `${from}__${to}`, from, to, direction, strength };
}

function graphOf(edges: PropagationEdge[], extraNodes: string[] = []): PropagationGraph {
  const ids = new Set(extraNodes);
  for (const e of edges) {
    ids.add(e.from);
    ids.add(e.to);
  }
  return { nodes: [...ids].sort().map((id) => ({ id })), edges };
}

function effectOf(effects: readonly NodeEffect[], id: string): NodeEffect {
  const found = effects.find((e) => e.nodeId === id);
  if (found === undefined) throw new Error(`no effect for node ${id}`);
  return found;
}

function ids(effects: readonly NodeEffect[]): string[] {
  return effects.map((e) => e.nodeId);
}

function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(items: readonly T[], rand: () => number): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const a = copy[i];
    const b = copy[j];
    if (a === undefined || b === undefined) throw new Error("index out of range");
    copy[i] = b;
    copy[j] = a;
  }
  return copy;
}

function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [[...items]];
  return items.flatMap((item, i) =>
    permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [item, ...rest]),
  );
}

function deepFreeze(value: unknown): void {
  if (typeof value !== "object" || value === null) return;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
}

/** Adding zero turns -0 into +0 and leaves every other number unchanged. */
function noNegativeZero(value: number): number {
  return value + 0;
}

describe("hand-computed cases, decay 0.5 and 3 hops", () => {
  it("a single hop applies no decay: b = 0.5 * (1 * 0.5) = 0.25", () => {
    const g = graphOf([edge("a", "b", 1, 0.5)]);
    const raw = propagateRaw(g, "a", 0.5, HALF);
    expect([...raw.keys()]).toEqual(["b"]);
    expect(raw.get("b")).toBe(0.25);
    expect(propagate(g, "a", 0.5, HALF)).toEqual([
      { nodeId: "b", raw: 0.25, delta: 0.25, contributions: [{ edgeIds: ["a__b"], value: 0.25 }] },
    ]);
  });

  it("a two-hop chain: b = 1 * (-1 * 0.5) = -0.5 and c = 1 * (-0.5) * (1 * 0.75) * 0.5^1 = -0.1875", () => {
    const g = graphOf([edge("a", "b", -1, 0.5), edge("b", "c", 1, 0.75)]);
    const effects = propagate(g, "a", 1, HALF);
    expect(effects).toEqual([
      { nodeId: "b", raw: -0.5, delta: -0.5, contributions: [{ edgeIds: ["a__b"], value: -0.5 }] },
      {
        nodeId: "c",
        raw: -0.1875,
        delta: -0.1875,
        contributions: [{ edgeIds: ["a__b", "b__c"], value: -0.1875 }],
      },
    ]);
  });

  it("a cycle back to the source: b = 1 * 0.5 = 0.5, and the source is never listed as affected", () => {
    const g = graphOf([edge("a", "b", 1, 0.5), edge("b", "a", 1, 1)]);
    const raw = propagateRaw(g, "a", 1, HALF);
    expect([...raw.keys()]).toEqual(["b"]);
    expect(raw.get("b")).toBe(0.5);
    expect(ids(propagate(g, "a", 1, HALF))).toEqual(["b"]);
  });

  it("a cycle away from the source: b = 1 and c = 1 * 1 * 1 * 0.5 = 0.5, and a->b->c->b is never walked", () => {
    const g = graphOf([edge("a", "b", 1, 1), edge("b", "c", 1, 1), edge("c", "b", 1, 1)]);
    const effects = propagate(g, "a", 1, HALF);
    expect(effectOf(effects, "b").raw).toBe(1);
    expect(effectOf(effects, "b").contributions).toEqual([{ edgeIds: ["a__b"], value: 1 }]);
    expect(effectOf(effects, "c").raw).toBe(0.5);
    expect(effectOf(effects, "c").contributions).toEqual([
      { edgeIds: ["a__b", "b__c"], value: 0.5 },
    ]);
  });

  /*
   * a->c direct: 1 * (1 * 1)                       = 1
   * a->b->c:     1 * (1 * 1) * (1 * 1) * 0.5^1    = 0.5
   * raw c = 1.5, which exceeds 1, so delta c must be clamped to 1.
   * With lever -1 every sign flips: raw c = -1.5, delta c = -1.
   */
  it("the clamp engages: raw c = 1.5 but delta c = 1", () => {
    const g = graphOf([edge("a", "c", 1, 1), edge("a", "b", 1, 1), edge("b", "c", 1, 1)]);
    const up = propagate(g, "a", 1, HALF);
    expect(propagateRaw(g, "a", 1, HALF).get("c")).toBe(1.5);
    expect(effectOf(up, "c").raw).toBe(1.5);
    expect(effectOf(up, "c").delta).toBe(1);
    expect(effectOf(up, "b").delta).toBe(1);

    const down = propagate(g, "a", -1, HALF);
    expect(effectOf(down, "c").raw).toBe(-1.5);
    expect(effectOf(down, "c").delta).toBe(-1);
  });

  it("values inside [-1, 1] are not altered by the clamp", () => {
    const g = graphOf([edge("a", "b", 1, 0.75)]);
    const effect = effectOf(propagate(g, "a", -0.5, HALF), "b");
    expect(effect.raw).toBe(-0.375);
    expect(effect.delta).toBe(-0.375);
  });

  /*
   * Chain a->b->c->d->e, every edge +1 and strength 1, lever 1, decay 0.5.
   * A path of k edges contributes 0.5^(k-1):  b 1, c 0.5, d 0.25, e 0.125.
   * With maxHops 3, e (4 edges away) is unreachable.
   */
  it("stops at the hop limit", () => {
    const g = graphOf([
      edge("a", "b", 1, 1),
      edge("b", "c", 1, 1),
      edge("c", "d", 1, 1),
      edge("d", "e", 1, 1),
    ]);
    const three = propagateRaw(g, "a", 1, { maxHops: 3, decay: 0.5 });
    expect([...three.entries()].sort()).toEqual([
      ["b", 1],
      ["c", 0.5],
      ["d", 0.25],
    ]);
    const four = propagateRaw(g, "a", 1, { maxHops: 4, decay: 0.5 });
    expect(four.get("e")).toBe(0.125);
    const one = propagateRaw(g, "a", 1, { maxHops: 1, decay: 0.5 });
    expect([...one.keys()]).toEqual(["b"]);
  });

  /*
   * Diamond: a->b (+1, 1), a->c (+1, 1), b->d (+1, 0.5), c->d (-1, 0.5). Lever 1, decay 0.5.
   * via b: 1 * (1 * 1) * (1 * 0.5)  * 0.5 =  0.25
   * via c: 1 * (1 * 1) * (-1 * 0.5) * 0.5 = -0.25
   * raw d = 0. d is reached, so it is listed, with two contributions and a delta of exactly 0.
   */
  it("opposing paths cancel: d is reached with raw 0 and both contributions listed", () => {
    const g = graphOf([
      edge("a", "b", 1, 1),
      edge("a", "c", 1, 1),
      edge("b", "d", 1, 0.5),
      edge("c", "d", -1, 0.5),
    ]);
    const d = effectOf(propagate(g, "a", 1, HALF), "d");
    expect(d.raw).toBe(0);
    expect(d.delta).toBe(0);
    expect(d.contributions).toEqual([
      { edgeIds: ["a__b", "b__d"], value: 0.25 },
      { edgeIds: ["a__c", "c__d"], value: -0.25 },
    ]);
  });

  /*
   * a->b (+1, 0.5), a->c (+1, 0.5), b->d (+1, 1), c->d (+1, 0.5). Lever 1, decay 0.5.
   * via b: 1 * (0.5 * 1)   * 0.5 = 0.25
   * via c: 1 * (0.5 * 0.5) * 0.5 = 0.125
   * raw d = 0.375, the sum of the two routes.
   */
  it("routes to the same node add: d = 0.25 + 0.125 = 0.375", () => {
    const g = graphOf([
      edge("a", "b", 1, 0.5),
      edge("a", "c", 1, 0.5),
      edge("b", "d", 1, 1),
      edge("c", "d", 1, 0.5),
    ]);
    const d = effectOf(propagate(g, "a", 1, HALF), "d");
    expect(d.raw).toBe(0.375);
    expect(d.delta).toBe(0.375);
    expect(d.contributions.map((c) => c.value)).toEqual([0.25, 0.125]);
  });

  it("a lever of 0 leaves every node at exactly +0, never -0", () => {
    const g = graphOf([edge("a", "b", -1, 0.5), edge("b", "c", 1, 0.75)]);
    const effects = propagate(g, "a", 0, HALF);
    expect(ids(effects)).toEqual(["b", "c"]);
    for (const effect of effects) {
      expect(Object.is(effect.raw, 0)).toBe(true);
      expect(Object.is(effect.delta, 0)).toBe(true);
    }
  });

  it("a lever of 0 also leaves every listed contribution at +0, never -0", () => {
    const g = graphOf([edge("a", "b", -1, 0.5), edge("b", "c", 1, 0.75)]);
    for (const effect of propagate(g, "a", 0, HALF)) {
      for (const contribution of effect.contributions) {
        expect(Object.is(contribution.value, 0)).toBe(true);
      }
    }
  });

  /*
   * Node ids a1 and a_1 are both valid. In code-unit order "a1" sorts before "a_1" ("1" is
   * 49, "_" is 95). Locale-aware comparison orders them the other way.
   */
  it("orders effects by node id in code-unit order: a1 before a_1", () => {
    const g = graphOf([edge("s", "a_1", 1, 1), edge("s", "a1", 1, 1)]);
    expect(ids(propagate(g, "s", 1, HALF))).toEqual(["a1", "a_1"]);
  });

  /*
   * Edges a->b, b->d, a->c. Depth-first discovery order is b, d, c, but the map must list
   * its keys sorted by node id: b, c, d.
   */
  it("lists propagateRaw keys sorted by node id, not in discovery order", () => {
    const g = graphOf([edge("a", "b", 1, 1), edge("b", "d", 1, 1), edge("a", "c", 1, 1)]);
    expect([...propagateRaw(g, "a", 1, HALF).keys()]).toEqual(["b", "c", "d"]);
  });

  it("returns effects sorted by node id, whatever order the edges arrive in", () => {
    const g = graphOf([edge("a", "c", 1, 0.5), edge("a", "b", 1, 0.5)]);
    expect(ids(propagate(g, "a", 1, HALF))).toEqual(["b", "c"]);
  });

  it("a node no path reaches is absent", () => {
    const g = graphOf([edge("a", "b", 1, 0.5)], ["island"]);
    expect(ids(propagate(g, "a", 1, HALF))).toEqual(["b"]);
  });
});

describe("linearity before the clamp", () => {
  /*
   * Halving the lever halves every raw value exactly, because scaling by a power of
   * two is exact in binary floating point. Graph: the "routes add" graph above.
   */
  it.each([0.5, 0.25, -0.5, -1])("raw(lever = %s) equals lever * raw(lever = 1)", (k) => {
    const g = graphOf([
      edge("a", "b", 1, 0.5),
      edge("a", "c", 1, 0.5),
      edge("b", "d", 1, 1),
      edge("c", "d", 1, 0.5),
    ]);
    const unit = propagateRaw(g, "a", 1, HALF);
    const scaled = propagateRaw(g, "a", k, HALF);
    for (const [id, value] of unit) {
      expect(scaled.get(id)).toBe(noNegativeZero(k * value));
    }
    expect(scaled.size).toBe(unit.size);
  });
});

describe("the strongest contribution, which supplies the 'why' label", () => {
  it("picks the largest magnitude: the direct edge (1) beats the two-hop route (0.5)", () => {
    const g = graphOf([edge("a", "c", 1, 1), edge("a", "b", 1, 1), edge("b", "c", 1, 1)]);
    const c = effectOf(propagate(g, "a", 1, HALF), "c");
    expect(strongestContribution(c)).toEqual({ edgeIds: ["a__c"], value: 1 });
  });

  /*
   * a->c direct (+1, 0.25): 0.25.  a->b->c (+1, 0.5) then (+1, 1): 0.5 * 1 * 0.5 = 0.25.
   * Equal magnitude. The shorter path wins even though "a__b,b__c" sorts before "a__c".
   */
  it("on equal magnitude the path with fewer edges wins, before any name ordering", () => {
    const g = graphOf([edge("a", "c", 1, 0.25), edge("a", "b", 1, 0.5), edge("b", "c", 1, 1)]);
    const c = effectOf(propagate(g, "a", 1, HALF), "c");
    expect(c.contributions.map((x) => x.value)).toEqual([0.25, 0.25]);
    expect(strongestContribution(c)).toEqual({ edgeIds: ["a__c"], value: 0.25 });
  });

  it("on equal magnitude and length the lower edge id sequence wins, whatever the sign", () => {
    const g = graphOf([
      edge("a", "b", 1, 1),
      edge("a", "c", 1, 1),
      edge("b", "d", 1, 0.5),
      edge("c", "d", -1, 0.5),
    ]);
    const d = effectOf(propagate(g, "a", 1, HALF), "d");
    expect(strongestContribution(d)).toEqual({ edgeIds: ["a__b", "b__d"], value: 0.25 });
  });

  /*
   * s->a1->t and s->a_1->t each contribute 1 * (1 * 1) * (1 * 0.5) * 0.5 = 0.25, a tie in
   * magnitude and length. The lower edge id sequence wins, compared by code unit, and
   * "s__a1" is lower than "s__a_1" because "1" is 49 and "_" is 95.
   */
  it("breaks a tie on edge ids by code unit, so the a1 path beats the a_1 path", () => {
    const g = graphOf([
      edge("s", "a_1", 1, 1),
      edge("a_1", "t", 1, 0.5),
      edge("s", "a1", 1, 1),
      edge("a1", "t", 1, 0.5),
    ]);
    const t = effectOf(propagate(g, "s", 1, HALF), "t");
    expect(t.contributions.map((c) => c.value)).toEqual([0.25, 0.25]);
    expect(strongestContribution(t)).toEqual({ edgeIds: ["s__a1", "a1__t"], value: 0.25 });
  });

  /*
   * Node ids b and b1 give edge ids a__b and a__b1, and one is a prefix of the other.
   * a->b->t and a->b1->t each contribute 0.25. The shorter id sorts first, so the b path
   * wins, in whichever order the two contributions are listed.
   */
  it("breaks a tie where one edge id is a prefix of another: a__b before a__b1", () => {
    const g = graphOf([
      edge("a", "b", 1, 1),
      edge("b", "t", 1, 0.5),
      edge("a", "b1", 1, 1),
      edge("b1", "t", 1, 0.5),
    ]);
    const t = effectOf(propagate(g, "a", 1, HALF), "t");
    expect(t.contributions.map((x) => x.value)).toEqual([0.25, 0.25]);
    for (const contributions of permutations(t.contributions)) {
      expect(strongestContribution({ ...t, contributions })).toEqual({
        edgeIds: ["a__b", "b__t"],
        value: 0.25,
      });
    }
  });

  /*
   * The module accepts any string as an id, so the tie-break must not assume snake_case.
   * "!" (33) sorts below "," (44), so with ids b and b! the edge id a__b is a prefix of
   * a__b! and must win. A separator above "!" would compare a__b, then a__b! wrongly.
   */
  it("breaks a tie correctly for ids containing characters below a comma", () => {
    const g = graphOf([
      edge("a", "b", 1, 1),
      edge("b", "t", 1, 0.5),
      edge("a", "b!", 1, 1),
      edge("b!", "t", 1, 0.5),
    ]);
    const t = effectOf(propagate(g, "a", 1, HALF), "t");
    for (const contributions of permutations(t.contributions)) {
      expect(strongestContribution({ ...t, contributions })).toEqual({
        edgeIds: ["a__b", "b__t"],
        value: 0.25,
      });
    }
  });

  /*
   * Edge ids sort a__c before a__z, so the direct path is listed first (value 1) and the
   * route through z second (1 * 1 * 1 * 0.5 = 0.5). A weaker later contribution must not win.
   */
  it("keeps an earlier contribution when a later one is weaker", () => {
    const g = graphOf([edge("a", "c", 1, 1), edge("a", "z", 1, 1), edge("z", "c", 1, 1)]);
    const c = effectOf(propagate(g, "a", 1, HALF), "c");
    expect(c.contributions.map((x) => x.value)).toEqual([1, 0.5]);
    expect(strongestContribution(c)).toEqual({ edgeIds: ["a__c"], value: 1 });
  });

  /*
   * Three routes a->b1->t, a->b2->t, a->b3->t each contribute 1 * (1 * 1) * (1 * 0.5) * 0.5
   * = 0.25, a three-way tie. Whatever order the contributions are listed in, the lowest edge
   * id sequence, a__b1 then b1__t, must win.
   */
  it("does not depend on the order in which the contributions are listed", () => {
    const g = graphOf(
      ["b1", "b2", "b3"].flatMap((mid) => [edge("a", mid, 1, 1), edge(mid, "t", 1, 0.5)]),
    );
    const t = effectOf(propagate(g, "a", 1, HALF), "t");
    expect(t.contributions.map((x) => x.value)).toEqual([0.25, 0.25, 0.25]);
    const orders = permutations(t.contributions);
    expect(orders).toHaveLength(6);
    for (const contributions of orders) {
      expect(strongestContribution({ ...t, contributions })).toEqual({
        edgeIds: ["a__b1", "b1__t"],
        value: 0.25,
      });
    }
  });

  it("returns undefined when there is nothing to choose from", () => {
    expect(
      strongestContribution({ nodeId: "x", raw: 0, delta: 0, contributions: [] }),
    ).toBeUndefined();
  });
});

describe("traversal order is fixed, so the output is reproducible", () => {
  it("lists contributions in ascending edge-id order: a__b then a__c", () => {
    const g = graphOf([
      edge("c", "d", -1, 0.5),
      edge("a", "c", 1, 1),
      edge("b", "d", 1, 0.5),
      edge("a", "b", 1, 1),
    ]);
    const d = effectOf(propagate(g, "a", 1, HALF), "d");
    expect(d.contributions.map((c) => c.edgeIds)).toEqual([
      ["a__b", "b__d"],
      ["a__c", "c__d"],
    ]);
  });

  /*
   * Node ids a1 and a_1 are both valid. Compared by UTF-16 code unit, "s__a1" sorts before
   * "s__a_1", because "1" is code unit 49 and "_" is 95. Locale-aware comparison orders them
   * the other way, so this pins the comparison to code units.
   */
  it("orders edge ids by code unit and not by locale", () => {
    const g = graphOf([
      edge("s", "a_1", 1, 1),
      edge("s", "a1", 1, 1),
      edge("a_1", "t", 1, 1),
      edge("a1", "t", 1, 1),
    ]);
    const t = effectOf(propagate(g, "s", 1, HALF), "t");
    expect(t.contributions.map((c) => c.edgeIds)).toEqual([
      ["s__a1", "a1__t"],
      ["s__a_1", "a_1__t"],
    ]);
  });

  /*
   * Twelve parallel two-hop routes a -> mNN -> t. The contributions are unequal doubles, so
   * adding them in a different order gives a different sum. The guard below proves the fixture
   * has that property, so that a determinism test cannot pass by accident.
   */
  const routes: [number, number, number, number][] = [
    [1, 0.5, -1, 0.75],
    [1, 0.75, -1, 0.5],
    [1, 0.25, 1, 0.25],
    [-1, 1, 1, 0.25],
    [1, 0.5, 1, 0.25],
    [1, 0.25, -1, 0.25],
    [-1, 1, -1, 0.75],
    [1, 0.25, -1, 0.5],
    [-1, 0.75, -1, 0.25],
    [1, 1, -1, 1],
    [-1, 1, 1, 0.25],
    [1, 0.25, 1, 1],
  ];
  const sensitiveEdges: PropagationEdge[] = routes.flatMap(([d1, s, d2, u], i) => {
    const mid = `m${String(i + 1).padStart(2, "0")}`;
    return [edge("a", mid, d1, s), edge(mid, "t", d2, u)];
  });
  const sensitiveGraph = graphOf(sensitiveEdges);
  const sensitiveParams: PropagationParams = { maxHops: 3, decay: 0.7 };

  it("uses a fixture whose sum really depends on the order of addition", () => {
    const t = effectOf(propagate(sensitiveGraph, "a", 0.9, sensitiveParams), "t");
    expect(t.contributions).toHaveLength(12);
    const forward = t.contributions.reduce((sum, c) => sum + c.value, 0);
    const backward = [...t.contributions].reverse().reduce((sum, c) => sum + c.value, 0);
    expect(forward).not.toBe(backward);
  });

  it("returns bit-identical results however the edges and nodes are ordered", () => {
    const baseline = propagate(sensitiveGraph, "a", 0.9, sensitiveParams);
    const rand = mulberry32(2026);
    for (let i = 0; i < 100; i++) {
      const rearranged: PropagationGraph = {
        nodes: shuffled(sensitiveGraph.nodes, rand),
        edges: shuffled(sensitiveGraph.edges, rand),
      };
      expect(propagate(rearranged, "a", 0.9, sensitiveParams)).toEqual(baseline);
    }
  });

  it("returns identical results on repeated calls", () => {
    const first = propagate(sensitiveGraph, "a", 0.9, sensitiveParams);
    const second = propagate(sensitiveGraph, "a", 0.9, sensitiveParams);
    expect(second).toEqual(first);
  });

  it("does not mutate its input, including the order of the edge array", () => {
    const edges = shuffled(sensitiveEdges, mulberry32(7));
    const g: PropagationGraph = { nodes: sensitiveGraph.nodes, edges };
    const before = edges.map((e) => e.id);
    deepFreeze(g);
    expect(() => propagate(g, "a", 0.9, sensitiveParams)).not.toThrow();
    expect(edges.map((e) => e.id)).toEqual(before);
  });
});

describe("termination", () => {
  function completeDigraph(n: number): PropagationGraph {
    const nodeIds = Array.from({ length: n }, (_, i) => `n${String(i)}`);
    const edges = nodeIds.flatMap((from) =>
      nodeIds.filter((to) => to !== from).map((to) => edge(from, to, 1, 0.25)),
    );
    return graphOf(edges);
  }

  function totalContributions(effects: readonly NodeEffect[]): number {
    return effects.reduce((sum, e) => sum + e.contributions.length, 0);
  }

  /*
   * Complete digraph on 8 nodes. A simple path from n0 of k edges chooses k distinct nodes,
   * in order, from the other 7: P(7, k) = 7, 42, 210, 840, 2520, 5040, 5040 for k = 1..7.
   *   maxHops 3: 7 + 42 + 210                                      = 259
   *   maxHops 8: 7 + 42 + 210 + 840 + 2520 + 5040 + 5040           = 13699
   * (k = 8 is impossible: it would need 8 distinct nodes other than the source.)
   */
  it("halts on a dense cyclic graph and walks exactly the simple paths: 259 at 3 hops", () => {
    const effects = propagate(completeDigraph(8), "n0", 1, { maxHops: 3, decay: 0.5 });
    expect(effects).toHaveLength(7);
    expect(totalContributions(effects)).toBe(259);
  });

  it("halts at the hop limit of 8 and walks exactly 13699 simple paths", () => {
    const effects = propagate(completeDigraph(8), "n0", 1, {
      maxHops: MAX_HOPS_LIMIT,
      decay: 0.5,
    });
    expect(totalContributions(effects)).toBe(13699);
  });
});

/**
 * Independent path counter. It does not follow edges while building: it enumerates every
 * ordered selection of distinct non-source nodes and then filters by whether each consecutive
 * pair is linked. That is a different method from the implementation's edge-following walk.
 */
function countPathsByPermutation(
  nodeIds: string[],
  edges: PropagationEdge[],
  source: string,
  maxHops: number,
): Map<string, number> {
  const linked = new Set(edges.map((e) => `${e.from}>${e.to}`));
  const others = nodeIds.filter((id) => id !== source);
  const counts = new Map<string, number>();
  const pick = (chosen: string[]): void => {
    if (chosen.length > 0) {
      const sequence = [source, ...chosen];
      const connected = sequence.every(
        (node, i) => i === 0 || linked.has(`${sequence[i - 1] ?? ""}>${node}`),
      );
      const last = chosen[chosen.length - 1];
      if (connected && last !== undefined) counts.set(last, (counts.get(last) ?? 0) + 1);
    }
    if (chosen.length < maxHops) {
      for (const next of others) if (!chosen.includes(next)) pick([...chosen, next]);
    }
  };
  pick([]);
  return counts;
}

describe("properties on 300 seeded random graphs, including cyclic ones", () => {
  const TIERS = [0.25, 0.5, 0.75, 1];
  const DECAYS = [0.3, 0.5, 0.7, 1];

  it("every output is bounded, every path is genuine, and every value matches the formula", () => {
    const rand = mulberry32(20260919);
    for (let round = 0; round < 300; round++) {
      const n = 2 + Math.floor(rand() * 6);
      const nodeIds = Array.from({ length: n }, (_, i) => `n${String(i)}`);
      const edges: PropagationEdge[] = [];
      for (const from of nodeIds) {
        for (const to of nodeIds) {
          if (from !== to && rand() < 0.5) {
            edges.push(edge(from, to, rand() < 0.5 ? -1 : 1, TIERS[Math.floor(rand() * 4)] ?? 1));
          }
        }
      }
      const g: PropagationGraph = { nodes: nodeIds.map((id) => ({ id })), edges };
      const lever = rand() * 2 - 1;
      const params: PropagationParams = {
        maxHops: 1 + Math.floor(rand() * n),
        decay: DECAYS[Math.floor(rand() * 4)] ?? 1,
      };

      const effects = propagate(g, "n0", lever, params);
      const expectedCounts = countPathsByPermutation(nodeIds, edges, "n0", params.maxHops);
      expect(ids(effects)).toEqual([...expectedCounts.keys()].sort());

      const edgeById = new Map(edges.map((e) => [e.id, e]));
      const halved = propagateRaw(g, "n0", lever / 2, params);
      for (const effect of effects) {
        const count = expectedCounts.get(effect.nodeId) ?? 0;

        // Every simple path is found exactly once, and no other path is invented.
        expect(effect.contributions).toHaveLength(count);
        expect(new Set(effect.contributions.map((c) => c.edgeIds.join(","))).size).toBe(count);

        // Bounded: the output never leaves [-1, 1], and raw never exceeds |lever| * paths.
        expect(Math.abs(effect.delta)).toBeLessThanOrEqual(1);
        expect(effect.delta).toBe(noNegativeZero(Math.max(-1, Math.min(1, effect.raw))));
        expect(Math.abs(effect.raw)).toBeLessThanOrEqual(Math.abs(lever) * count * (1 + 1e-12));

        // raw is the sum of the listed contributions, in the listed order.
        expect(effect.contributions.reduce((sum, c) => sum + c.value, 0)).toBe(effect.raw);

        // Linearity: halving the lever halves raw exactly.
        expect(halved.get(effect.nodeId)).toBe(noNegativeZero(effect.raw / 2));

        for (const contribution of effect.contributions) {
          const path = contribution.edgeIds.map((id) => {
            const found = edgeById.get(id);
            if (found === undefined) throw new Error(`unknown edge ${id} in a contribution`);
            return found;
          });
          const first = path[0];
          const last = path[path.length - 1];
          expect(first?.from).toBe("n0");
          expect(last?.to).toBe(effect.nodeId);
          expect(path.length).toBeLessThanOrEqual(params.maxHops);
          path.forEach((step, i) => {
            if (i > 0) expect(step.from).toBe(path[i - 1]?.to);
          });
          const visited = ["n0", ...path.map((step) => step.to)];
          expect(new Set(visited).size).toBe(visited.length);

          // The formula, recomputed here with Math.pow and a running product.
          const signed = path.reduce(
            (product, step) => product * step.direction * step.strength,
            1,
          );
          const expected = lever * signed * Math.pow(params.decay, path.length - 1);
          expect(contribution.value).toBeCloseTo(expected, 12);
        }
      }
    }
  });
});

describe("input validation", () => {
  const ok = graphOf([edge("a", "b", 1, 0.5)]);

  it.each([1.0000001, -1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects a lever of %s",
    (lever) => {
      expect(() => propagate(ok, "a", lever, HALF)).toThrow(RangeError);
      expect(() => propagateRaw(ok, "a", lever, HALF)).toThrow(RangeError);
    },
  );

  it.each([1, -1])("accepts a lever of exactly %s", (lever) => {
    expect(() => propagate(ok, "a", lever, HALF)).not.toThrow();
  });

  it("rejects a source that is not a node", () => {
    expect(() => propagate(ok, "zzz", 1, HALF)).toThrow(RangeError);
  });

  it.each([0, -1, 1.5, Number.NaN, 9])("rejects maxHops of %s", (maxHops) => {
    expect(() => propagate(ok, "a", 1, { maxHops, decay: 0.5 })).toThrow(RangeError);
  });

  it("caps maxHops at 8 and accepts the cap itself", () => {
    expect(MAX_HOPS_LIMIT).toBe(8);
    expect(() => propagate(ok, "a", 1, { maxHops: 8, decay: 0.5 })).not.toThrow();
  });

  it.each([0, -0.1, 1.0000001, Number.NaN])("rejects a decay of %s", (decay) => {
    expect(() => propagate(ok, "a", 1, { maxHops: 3, decay })).toThrow(RangeError);
  });

  it("accepts a decay of exactly 1, which means no decay", () => {
    expect(propagateRaw(ok, "a", 1, { maxHops: 3, decay: 1 }).get("b")).toBe(0.5);
  });

  it.each([0, -0.5, 1.1, Number.NaN])("rejects an edge strength of %s", (strength) => {
    const g = graphOf([edge("a", "b", 1, strength)]);
    expect(() => propagate(g, "a", 1, HALF)).toThrow(RangeError);
  });

  it.each([0, 2, Number.NaN])("rejects an edge direction of %s", (direction) => {
    const g = graphOf([edge("a", "b", direction, 0.5)]);
    expect(() => propagate(g, "a", 1, HALF)).toThrow(RangeError);
  });

  it("rejects an edge that points at a node the graph does not contain", () => {
    const g: PropagationGraph = { nodes: [{ id: "a" }], edges: [edge("a", "ghost", 1, 0.5)] };
    expect(() => propagate(g, "a", 1, HALF)).toThrow(RangeError);
  });

  it("rejects two edges with the same id, because their order would be ambiguous", () => {
    const g = graphOf([edge("a", "b", 1, 0.5), edge("a", "b", -1, 0.25)]);
    expect(() => propagate(g, "a", 1, HALF)).toThrow(RangeError);
  });

  it("defaults to 3 hops and a decay of 0.7", () => {
    expect(DEFAULT_PARAMS).toEqual({ maxHops: 3, decay: 0.7 });
    // a->b->c, strength 1: c = 1 * 1 * 1 * 0.7^1 = 0.7
    const chain = graphOf([edge("a", "b", 1, 1), edge("b", "c", 1, 1)]);
    expect(propagateRaw(chain, "a", 1).get("c")).toBe(0.7);
  });
});

/*
 * The real graph. Default parameters: 3 hops, decay 0.7, so a path of k edges is scaled by
 * 0.7^(k-1): 1 for one edge, 0.7 for two, 0.49 for three, 0.343 for four.
 * These lock the current edge set. Changing an edge should change these on purpose.
 */
describe("the real graph, worked by hand", () => {
  const real = parseGraph(graphJson);

  /*
   * From fed_rate, lever +1. Signed strengths (direction * strength):
   *   E1 fed_rate->mortgage_rate +0.75          E6  mortgage_rate->household_debt -0.25
   *   E2 fed_rate->inflation -0.5               E7  inflation->real_avg_hourly_earnings -0.75
   *   E3 fed_rate->gdp_growth -0.5              E8  inflation->institutional_confidence -0.25
   *   E4 fed_rate->net_interest +0.75           E9  gdp_growth->payrolls_headline +0.5
   *   E5 fed_rate->savings_rate +0.25           E10 gdp_growth->debt_growth_rate -0.25
   *   E13 real_avg_hourly_earnings->median_household_income +0.5
   *   E14 real_avg_hourly_earnings->savings_rate +0.25
   *   E18 household_debt->savings_rate -0.25
   *
   *   mortgage_rate            E1                        = 0.75
   *   inflation                E2                        = -0.5
   *   gdp_growth               E3                        = -0.5
   *   net_interest             E4                        = 0.75
   *   household_debt           E1,E6      0.75*-0.25*0.7 = -0.13125
   *   real_avg_hourly_earnings E2,E7     -0.5*-0.75*0.7  = 0.2625
   *   institutional_confidence E2,E8     -0.5*-0.25*0.7  = 0.0875
   *   payrolls_headline        E3,E9     -0.5*0.5*0.7    = -0.175
   *   debt_growth_rate         E3,E10    -0.5*-0.25*0.7  = 0.0875
   *   median_household_income  E2,E7,E13 -0.5*-0.75*0.5*0.49 = 0.091875
   *   savings_rate  E5 = 0.25
   *                 E1,E6,E18  0.75*-0.25*-0.25*0.49 = 0.046875*0.49 = 0.02296875
   *                 E2,E7,E14  -0.5*-0.75*0.25*0.49  = 0.09375*0.49  = 0.0459375
   *                 total 0.31890625
   * Eleven nodes are reached. poverty_rate is four edges away and is not.
   */
  it("fed_rate at +1 reaches exactly eleven nodes with the values above", () => {
    const effects = propagate(real, "fed_rate", 1, DEFAULT_PARAMS);
    const expected: Record<string, number> = {
      mortgage_rate: 0.75,
      inflation: -0.5,
      gdp_growth: -0.5,
      net_interest: 0.75,
      household_debt: -0.13125,
      real_avg_hourly_earnings: 0.2625,
      institutional_confidence: 0.0875,
      payrolls_headline: -0.175,
      debt_growth_rate: 0.0875,
      median_household_income: 0.091875,
      savings_rate: 0.31890625,
    };
    expect(ids(effects)).toEqual(Object.keys(expected).sort());
    for (const [id, value] of Object.entries(expected)) {
      expect(effectOf(effects, id).raw).toBeCloseTo(value, 10);
    }
  });

  /*
   * With 4 hops, poverty_rate is reached by E2,E7,E13,E15 (income->poverty is -0.5):
   * -0.5 * -0.75 * 0.5 * -0.5 = -0.09375, scaled by 0.7^3 = 0.343: -0.03215625.
   */
  it("fed_rate at 4 hops also reaches poverty_rate at -0.03215625", () => {
    const effects = propagate(real, "fed_rate", 1, { maxHops: 4, decay: 0.7 });
    expect(effectOf(effects, "poverty_rate").raw).toBeCloseTo(-0.03215625, 10);
  });

  /*
   * From worker_bargaining_power at +1:
   *   real_avg_hourly_earnings  E12                    = 0.25
   *   median_household_income   E12,E13   0.25*0.5*0.7 = 0.0875
   *   savings_rate              E12,E14   0.25*0.25*0.7 = 0.04375
   *   poverty_rate              E12,E13,E15 0.25*0.5*-0.5*0.49 = -0.030625
   */
  it("worker_bargaining_power at +1 reaches four nodes, one of them negative", () => {
    const effects = propagate(real, "worker_bargaining_power", 1, DEFAULT_PARAMS);
    expect(ids(effects)).toEqual([
      "median_household_income",
      "poverty_rate",
      "real_avg_hourly_earnings",
      "savings_rate",
    ]);
    expect(effectOf(effects, "real_avg_hourly_earnings").raw).toBeCloseTo(0.25, 10);
    expect(effectOf(effects, "median_household_income").raw).toBeCloseTo(0.0875, 10);
    expect(effectOf(effects, "savings_rate").raw).toBeCloseTo(0.04375, 10);
    expect(effectOf(effects, "poverty_rate").raw).toBeCloseTo(-0.030625, 10);
  });

  it("fed_rate at -1 gives the exact negation of the fed_rate at +1 values", () => {
    const up = propagate(real, "fed_rate", 1, DEFAULT_PARAMS);
    const down = propagate(real, "fed_rate", -1, DEFAULT_PARAMS);
    expect(ids(down)).toEqual(ids(up));
    for (const effect of up) {
      expect(effectOf(down, effect.nodeId).raw).toBe(noNegativeZero(-effect.raw));
    }
  });

  it("hate_crimes has no edges, so moving it affects nothing", () => {
    expect(propagate(real, "hate_crimes", 1, DEFAULT_PARAMS)).toEqual([]);
  });

  it("no node in the real graph is ever pushed outside [-1, 1] from any source at full lever", () => {
    for (const node of real.nodes) {
      for (const lever of [-1, 1]) {
        for (const effect of propagate(real, node.id, lever, { maxHops: 8, decay: 1 })) {
          expect(Math.abs(effect.delta)).toBeLessThanOrEqual(1);
        }
      }
    }
  });
});
