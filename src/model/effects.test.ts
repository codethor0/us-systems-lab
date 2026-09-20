/**
 * Tests for effects.ts, written before it exists.
 *
 * combineEffects generalizes propagate to several levers at once. The rule, approved in review:
 *
 *   total(v)  = own(v) + the sum, over every lever on another node, of that lever's UNCLAMPED
 *               propagated value at v
 *   delta(v)  = clamp(total(v), -1, 1), applied once, at the end
 *
 * own(v) is the lever set on v itself, or 0. Levers set to exactly 0 are treated as not set. A node
 * appears in the result if it has a lever or is reached by at least one path from a lever.
 *
 * Every expected number is worked out by hand in a comment. The real-graph values were also
 * recomputed by a separate script that shares no code with the implementation.
 */
import { describe, expect, it } from "vitest";
import graphJson from "../data/graph.json";
import { propagate, propagateRaw } from "../lib/propagation";
import type { PropagationEdge, PropagationGraph, PropagationParams } from "../lib/propagation";
import { parseGraph } from "../lib/validate";
import { combineEffects } from "./effects";
import type { ScenarioEffect } from "./effects";

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

function levers(values: Record<string, number>): Map<string, number> {
  return new Map(Object.entries(values));
}

function effectOf(effects: readonly ScenarioEffect[], id: string): ScenarioEffect {
  const found = effects.find((e) => e.nodeId === id);
  if (found === undefined) throw new Error(`no effect for node ${id}`);
  return found;
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

function deepFreeze(value: unknown): void {
  if (typeof value !== "object" || value === null) return;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
}

describe("with no lever set", () => {
  const g = graphOf([edge("a", "b", 1, 0.5)]);

  it("returns nothing for an empty scenario", () => {
    expect(combineEffects(g, new Map(), HALF)).toEqual([]);
  });

  it("returns nothing when every lever is exactly zero, including negative zero", () => {
    expect(combineEffects(g, levers({ a: 0, b: -0 }), HALF)).toEqual([]);
  });

  it("lists no node that only a zero lever would have reached", () => {
    expect(combineEffects(g, levers({ a: 0 }), HALF).map((e) => e.nodeId)).toEqual([]);
  });
});

describe("one lever: identical to propagate, plus the lever's own node", () => {
  /* a -> b (+1, 0.5), lever a = 0.5, decay 0.5: b = 0.5 * 0.5 = 0.25. a itself: own 0.5. */
  it("a single hop", () => {
    const g = graphOf([edge("a", "b", 1, 0.5)]);
    expect(combineEffects(g, levers({ a: 0.5 }), HALF)).toEqual([
      { nodeId: "a", own: 0.5, propagated: 0, total: 0.5, delta: 0.5, contributions: [] },
      {
        nodeId: "b",
        own: 0,
        propagated: 0.25,
        total: 0.25,
        delta: 0.25,
        contributions: [{ sourceId: "a", edgeIds: ["a__b"], value: 0.25 }],
      },
    ]);
  });

  it("matches propagate exactly for every node it reaches, on the real graph", () => {
    const real = parseGraph(graphJson);
    const combined = combineEffects(real, levers({ fed_rate: 1 }));
    const single = propagate(real, "fed_rate", 1);
    for (const effect of single) {
      const found = effectOf(combined, effect.nodeId);
      expect(found.total).toBe(effect.raw);
      expect(found.delta).toBe(effect.delta);
      expect(found.own).toBe(0);
    }
    expect(combined.map((e) => e.nodeId).sort()).toEqual(
      ["fed_rate", ...single.map((e) => e.nodeId)].sort(),
    );
  });
});

describe("two levers add before the clamp", () => {
  /*
   * Real graph, decay 0.7, 3 hops, fed_rate = 1 and worker_bargaining_power = 1.
   *   savings_rate:  fed 0.25 + 0.0459375 + 0.02296875 = 0.31890625, worker 0.25 * 0.25 * 0.7 = 0.04375
   *                  total 0.36265625
   *   real_avg_hourly_earnings: fed 0.2625 (E2, E7), worker 0.25 (E12)         total 0.5125
   *   median_household_income:  fed 0.091875 (E2, E7, E13), worker 0.0875      total 0.179375
   *   poverty_rate: only worker reaches it within 3 hops: -0.030625
   *   fed_rate and worker_bargaining_power: own 1 each, nothing reaches them.
   * Fourteen nodes are listed: the 11 fed_rate reaches, poverty_rate, and the two levers.
   */
  const real = parseGraph(graphJson);
  const effects = combineEffects(real, levers({ fed_rate: 1, worker_bargaining_power: 1 }));

  it("lists exactly the nodes with a lever or a path from one", () => {
    expect(effects.map((e) => e.nodeId)).toEqual([
      "debt_growth_rate",
      "fed_rate",
      "gdp_growth",
      "household_debt",
      "inflation",
      "institutional_confidence",
      "median_household_income",
      "mortgage_rate",
      "net_interest",
      "payrolls_headline",
      "poverty_rate",
      "real_avg_hourly_earnings",
      "savings_rate",
      "worker_bargaining_power",
    ]);
  });

  it.each([
    ["savings_rate", 0.36265625],
    ["real_avg_hourly_earnings", 0.5125],
    ["median_household_income", 0.179375],
    ["poverty_rate", -0.030625],
    ["mortgage_rate", 0.75],
    ["inflation", -0.5],
    ["household_debt", -0.13125],
  ])("%s has a total of %s", (id, expected) => {
    expect(effectOf(effects, id).total).toBeCloseTo(expected, 10);
    expect(effectOf(effects, id).delta).toBeCloseTo(expected, 10);
  });

  it("gives each lever's own node its lever and nothing propagated", () => {
    for (const id of ["fed_rate", "worker_bargaining_power"]) {
      const e = effectOf(effects, id);
      expect([e.own, e.propagated, e.total, e.delta]).toEqual([1, 0, 1, 1]);
    }
  });

  it("keeps a contribution for every route: 4 into savings_rate and 2 into real earnings", () => {
    expect(effectOf(effects, "savings_rate").contributions).toHaveLength(4);
    expect(effectOf(effects, "real_avg_hourly_earnings").contributions).toHaveLength(2);
  });

  it("labels each contribution with the lever it came from, sources in ascending id order", () => {
    const sources = effectOf(effects, "savings_rate").contributions.map((c) => c.sourceId);
    expect(sources).toEqual(["fed_rate", "fed_rate", "fed_rate", "worker_bargaining_power"]);
  });
});

describe("a moved node that another lever also reaches", () => {
  /*
   * a -> b (+1, 0.5). Levers a = 1 and b = 0.5, decay 0.5.
   * b: own 0.5, propagated from a = 1 * 0.5 = 0.5, total 1, delta 1. a: own 1, nothing reaches it.
   */
  const g = graphOf([edge("a", "b", 1, 0.5)]);

  it("adds its own lever to what arrives", () => {
    const b = effectOf(combineEffects(g, levers({ a: 1, b: 0.5 }), HALF), "b");
    expect([b.own, b.propagated, b.total, b.delta]).toEqual([0.5, 0.5, 1, 1]);
    const a = effectOf(combineEffects(g, levers({ a: 1, b: 0.5 }), HALF), "a");
    expect([a.own, a.propagated, a.total]).toEqual([1, 0, 1]);
  });

  it("clamps the total and not the parts: 0.75 + 0.5 = 1.25 reports total 1.25 and delta 1", () => {
    const b = effectOf(combineEffects(g, levers({ a: 1, b: 0.75 }), HALF), "b");
    expect([b.total, b.delta]).toEqual([1.25, 1]);
  });

  it("can cancel completely: the real graph, fed_rate 1 and inflation 0.5 leave inflation at 0", () => {
    /* inflation: own 0.5, propagated from fed_rate: E2 direct = -0.5, so total 0 and delta 0. */
    const real = parseGraph(graphJson);
    const inflation = effectOf(
      combineEffects(real, levers({ fed_rate: 1, inflation: 0.5 })),
      "inflation",
    );
    expect([inflation.own, inflation.propagated, inflation.total, inflation.delta]).toEqual([
      0.5, -0.5, 0, 0,
    ]);
  });
});

describe("the clamp happens once, at the end", () => {
  /*
   * a -> c (+1, 1), a -> b (+1, 1), b -> c (+1, 1), d -> c (-1, 1). Levers a = 1, d = 1, decay 0.5.
   *   from a to c:  a->b->c = 1 * 1 * 1 * 0.5 = 0.5, and a->c = 1, so raw 1.5
   *   from d to c:  -1
   *   propagated 1.5 - 1 = 0.5, so c ends at 0.5.
   * Clamping each lever's contribution first would give 1 - 1 = 0. The test pins 0.5.
   */
  const g = graphOf([
    edge("a", "c", 1, 1),
    edge("a", "b", 1, 1),
    edge("b", "c", 1, 1),
    edge("d", "c", -1, 1),
  ]);
  const effects = combineEffects(g, levers({ a: 1, d: 1 }), HALF);

  it("adds unclamped values: c is 0.5, not 0", () => {
    const c = effectOf(effects, "c");
    expect([c.propagated, c.total, c.delta]).toEqual([0.5, 0.5, 0.5]);
  });

  it("lists c's contributions by source and then in traversal order", () => {
    expect(effectOf(effects, "c").contributions).toEqual([
      { sourceId: "a", edgeIds: ["a__b", "b__c"], value: 0.5 },
      { sourceId: "a", edgeIds: ["a__c"], value: 1 },
      { sourceId: "d", edgeIds: ["d__c"], value: -1 },
    ]);
  });

  it("still clamps at the end when the sum exceeds one: b = 1 from a alone stays 1", () => {
    expect(effectOf(effects, "b").delta).toBe(1);
  });

  it("clamps a total below -1 to -1 and keeps the raw total", () => {
    /* two levers of -1 into the same node by direct edges of strength 1: total -2, delta -1 */
    const h = graphOf([edge("x", "z", 1, 1), edge("y", "z", 1, 1)]);
    const z = effectOf(combineEffects(h, levers({ x: -1, y: -1 }), HALF), "z");
    expect([z.total, z.delta]).toEqual([-2, -1]);
  });
});

describe("input validation", () => {
  const g = graphOf([edge("a", "b", 1, 0.5)]);

  it("rejects a lever on a node the graph does not contain, even when it is zero", () => {
    expect(() => combineEffects(g, levers({ nope: 0.5 }), HALF)).toThrow(RangeError);
    expect(() => combineEffects(g, levers({ nope: 0 }), HALF)).toThrow(RangeError);
  });

  it.each([1.0000001, -1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects a lever of %s",
    (value) => {
      expect(() => combineEffects(g, levers({ a: value }), HALF)).toThrow(RangeError);
    },
  );

  it("names the offending node in the error, which propagate's own message cannot do", () => {
    expect(() => combineEffects(g, levers({ a: 1.5 }), HALF)).toThrow(
      /lever on "a" must be in \[-1, 1\], got 1\.5/,
    );
    expect(() => combineEffects(g, levers({ b: Number.NaN }), HALF)).toThrow(
      /lever on "b" must be in \[-1, 1\], got NaN/,
    );
    expect(() => combineEffects(g, levers({ nope: 0.5 }), HALF)).toThrow(
      /lever on "nope", which is not a node/,
    );
  });

  it("validates every lever before propagating any, so a bad one is reported even after good ones", () => {
    expect(() => combineEffects(g, levers({ a: 1, b: -3 }), HALF)).toThrow(/lever on "b"/);
  });

  it("accepts levers of exactly 1 and -1", () => {
    expect(() => combineEffects(g, levers({ a: 1, b: -1 }), HALF)).not.toThrow();
  });

  it("uses the default parameters when none are given: 3 hops and a decay of 0.7", () => {
    const chain = graphOf([edge("a", "b", 1, 1), edge("b", "c", 1, 1)]);
    /* c = 1 * 1 * 1 * 0.7 = 0.7 */
    expect(effectOf(combineEffects(chain, levers({ a: 1 })), "c").total).toBe(0.7);
  });

  it("passes custom parameters through: decay 0.5 gives c = 0.5", () => {
    const chain = graphOf([edge("a", "b", 1, 1), edge("b", "c", 1, 1)]);
    expect(effectOf(combineEffects(chain, levers({ a: 1 }), HALF), "c").total).toBe(0.5);
  });
});

describe("purity and determinism", () => {
  it("does not mutate the graph or the lever map", () => {
    const g = graphOf([edge("a", "b", 1, 0.5), edge("b", "c", -1, 0.5)]);
    deepFreeze(g);
    const map = levers({ a: 1, c: 0.25 });
    const before = [...map.entries()];
    expect(() => combineEffects(g, map, HALF)).not.toThrow();
    expect([...map.entries()]).toEqual(before);
  });

  it("gives identical output however the edges, nodes and lever map are ordered", () => {
    const real = parseGraph(graphJson);
    const pairs: [string, number][] = [
      ["fed_rate", 0.7],
      ["worker_bargaining_power", -0.4],
      ["productivity", 0.3],
    ];
    const baseline = combineEffects(real, new Map(pairs));
    const rand = mulberry32(99);
    for (let i = 0; i < 50; i++) {
      const rearranged: PropagationGraph = {
        nodes: shuffled(real.nodes, rand),
        edges: shuffled(real.edges, rand),
      };
      expect(combineEffects(rearranged, new Map(shuffled(pairs, rand)))).toEqual(baseline);
    }
  });

  it("returns effects sorted by node id in code-unit order, never by discovery order", () => {
    const g = graphOf([edge("a", "b", 1, 1), edge("b", "d", 1, 1), edge("a", "c", 1, 1)]);
    expect(combineEffects(g, levers({ a: 1 }), HALF).map((e) => e.nodeId)).toEqual([
      "a",
      "b",
      "c",
      "d",
    ]);
    const odd = graphOf([edge("s", "a_1", 1, 1), edge("s", "a1", 1, 1)]);
    expect(combineEffects(odd, levers({ s: 1 }), HALF).map((e) => e.nodeId)).toEqual([
      "a1",
      "a_1",
      "s",
    ]);
  });

  it("works for ids that are also properties of Object, because it keys on a Map", () => {
    const g = graphOf([
      edge("constructor", "toString", 1, 0.5),
      edge("toString", "valueOf", 1, 0.5),
    ]);
    const effects = combineEffects(g, levers({ constructor: 1 }), HALF);
    expect(effects.map((e) => [e.nodeId, e.total])).toEqual([
      ["constructor", 1],
      ["toString", 0.5],
      ["valueOf", 0.125],
    ]);
  });
});

describe("properties on 200 seeded random graphs and lever sets", () => {
  it("each total is the own lever plus the sum of every other lever's propagateRaw, in source order", () => {
    const rand = mulberry32(20260919);
    const TIERS = [0.25, 0.5, 0.75, 1];
    for (let round = 0; round < 200; round++) {
      const n = 2 + Math.floor(rand() * 5);
      const ids = Array.from({ length: n }, (_, i) => `n${String(i)}`);
      const edges: PropagationEdge[] = [];
      for (const from of ids) {
        for (const to of ids) {
          if (from !== to && rand() < 0.4) {
            edges.push(edge(from, to, rand() < 0.5 ? -1 : 1, TIERS[Math.floor(rand() * 4)] ?? 1));
          }
        }
      }
      const g: PropagationGraph = { nodes: ids.map((id) => ({ id })), edges };
      const params: PropagationParams = {
        maxHops: 1 + Math.floor(rand() * 3),
        decay: [0.5, 0.7, 1][Math.floor(rand() * 3)] ?? 1,
      };
      const chosen = shuffled(ids, rand).slice(0, 1 + Math.floor(rand() * 3));
      const set = new Map(chosen.map((id) => [id, Math.round((rand() * 2 - 1) * 20) / 10 / 2]));
      const active = [...set].filter(([, v]) => v !== 0).sort((x, y) => (x[0] < y[0] ? -1 : 1));
      const activeLevers = new Map(active);

      const result = combineEffects(g, set, params);
      const reached = new Set<string>(active.map(([id]) => id));
      for (const [source, lever] of active) {
        for (const id of propagateRaw(g, source, lever, params).keys()) reached.add(id);
      }
      expect(result.map((e) => e.nodeId)).toEqual([...reached].sort());

      for (const effect of result) {
        let propagated = 0;
        for (const [source, lever] of active) {
          propagated += propagateRaw(g, source, lever, params).get(effect.nodeId) ?? 0;
        }
        const own = activeLevers.get(effect.nodeId) ?? 0;
        expect(effect.own).toBe(own);
        expect(effect.propagated).toBe(propagated);
        expect(effect.total).toBe(own + propagated);
        expect(effect.delta).toBe(Math.max(-1, Math.min(1, own + propagated)));
        expect(Math.abs(effect.delta)).toBeLessThanOrEqual(1);
        // Per-source subtotals are added, so a flat sum associates differently: compare with a tolerance.
        const flat = effect.contributions.reduce((sum, c) => sum + c.value, 0);
        expect(flat).toBeCloseTo(effect.propagated, 12);
      }
    }
  });

  it("is additive before the clamp: the totals of two lever sets sum to the totals of their union", () => {
    const real = parseGraph(graphJson);
    const left = combineEffects(real, levers({ fed_rate: 0.5 }));
    const right = combineEffects(
      real,
      levers({ worker_bargaining_power: -0.5, productivity: 0.25 }),
    );
    const both = combineEffects(
      real,
      levers({ fed_rate: 0.5, worker_bargaining_power: -0.5, productivity: 0.25 }),
    );
    for (const effect of both) {
      const a = left.find((e) => e.nodeId === effect.nodeId)?.total ?? 0;
      const b = right.find((e) => e.nodeId === effect.nodeId)?.total ?? 0;
      expect(effect.total).toBeCloseTo(a + b, 12);
    }
  });
});
