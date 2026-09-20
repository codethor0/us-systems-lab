/**
 * Tests for explain.ts, written before it exists.
 *
 * describeEffect turns a numeric effect into what the interface may say about it: a headline made of
 * a direction and a bucket and never a decimal, and a "why" path naming the strongest route, with the
 * confidence of every step on it. The wording is pinned exactly, because the wording is where a
 * model can quietly claim more than it knows.
 *
 * Expected text is composed by hand from the real graph's edges:
 *   E2  fed_rate -> inflation, opposite            E7  inflation -> real_avg_hourly_earnings, opposite
 *   E5  fed_rate -> savings_rate, same             E12 worker_bargaining_power -> real_avg_hourly_earnings, same
 *   E13 real earnings -> median income, same       E15 median income -> poverty_rate, opposite
 * and every edge in the graph is modeled.
 */
import { describe, expect, it } from "vitest";
import graphJson from "../data/graph.json";
import type { Graph } from "../lib/schema";
import { parseGraph } from "../lib/validate";
import { combineEffects } from "./effects";
import type { ScenarioEffect } from "./effects";
import { bucketOf, directionOf } from "./buckets";
import { describeEffect } from "./explain";

const real: Graph = parseGraph(graphJson);

function levers(values: Record<string, number>): Map<string, number> {
  return new Map(Object.entries(values));
}

function describeAll(values: Record<string, number>, graph: Graph = real) {
  const effects = combineEffects(graph, levers(values));
  return new Map(effects.map((effect) => [effect.nodeId, describeEffect(graph, effect)]));
}

function mustGet<T>(map: ReadonlyMap<string, T>, key: string): T {
  const found = map.get(key);
  if (found === undefined) throw new Error(`no entry for ${key}`);
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

describe("a node reached by one route", () => {
  it("describes inflation under a fed_rate lever, in full", () => {
    /* delta -0.5: large and down. Strongest route is E2 alone. */
    expect(mustGet(describeAll({ fed_rate: 1 }), "inflation")).toEqual({
      nodeId: "inflation",
      label: "Inflation",
      direction: "down",
      bucket: "large",
      headline: "Inflation: down, large",
      isLever: false,
      why: {
        sourceId: "fed_rate",
        sourceLabel: "Federal funds rate",
        value: -0.5,
        steps: [
          {
            edgeId: "fed_rate__inflation",
            from: "fed_rate",
            to: "inflation",
            fromLabel: "Federal funds rate",
            toLabel: "Inflation",
            relation: "opposite",
            confidence: "modeled",
          },
        ],
      },
      whyText: "From Federal funds rate: moves against Inflation (modeled).",
      otherRoutes: 0,
    });
  });

  it("uses 'moves with' for a same-direction edge", () => {
    expect(mustGet(describeAll({ fed_rate: 1 }), "mortgage_rate").whyText).toBe(
      "From Federal funds rate: moves with 30-year mortgage rate (modeled).",
    );
  });

  it("names every step on a two-step route, each with its own confidence", () => {
    /* E2 then E7: 0.2625, moderate and up. */
    const d = mustGet(describeAll({ fed_rate: 1 }), "real_avg_hourly_earnings");
    expect(d.headline).toBe("Real hourly earnings: up, moderate");
    expect(d.whyText).toBe(
      "From Federal funds rate: moves against Inflation (modeled), then moves against Real hourly earnings (modeled).",
    );
    expect(d.why?.steps.map((s) => s.edgeId)).toEqual([
      "fed_rate__inflation",
      "inflation__real_avg_hourly_earnings",
    ]);
  });

  it("names a three-step route from another lever", () => {
    /* worker: E12, E13, E15 = -0.030625, which is negligible. */
    const d = mustGet(describeAll({ worker_bargaining_power: 1 }), "poverty_rate");
    expect(d.whyText).toBe(
      "From Worker bargaining power: moves with Real hourly earnings (modeled), then moves with Median household income (modeled), then moves against Official poverty rate (modeled).",
    );
  });

  it("shows a change below the visibility threshold as no visible change, with no direction", () => {
    const d = mustGet(describeAll({ worker_bargaining_power: 1 }), "poverty_rate");
    expect([d.direction, d.bucket, d.headline]).toEqual([
      "none",
      "negligible",
      "Official poverty rate: no visible change",
    ]);
  });
});

describe("a node reached by several routes", () => {
  it("names the strongest and counts the others: real earnings under two levers", () => {
    /* fed route 0.2625 beats worker route 0.25. One other route. */
    const d = mustGet(
      describeAll({ fed_rate: 1, worker_bargaining_power: 1 }),
      "real_avg_hourly_earnings",
    );
    expect(d.why?.sourceId).toBe("fed_rate");
    expect(d.otherRoutes).toBe(1);
    expect(d.whyText).toBe(
      "From Federal funds rate: moves against Inflation (modeled), then moves against Real hourly earnings (modeled). 1 other route also contributes.",
    );
  });

  it("uses the plural for more than one other route: savings under two levers has three", () => {
    /* direct E5 is 0.25, the three-step routes are 0.0459375 and 0.02296875, worker is 0.04375. */
    const d = mustGet(describeAll({ fed_rate: 1, worker_bargaining_power: 1 }), "savings_rate");
    expect(d.otherRoutes).toBe(3);
    expect(d.whyText).toBe(
      "From Federal funds rate: moves with Personal saving rate (modeled). 3 other routes also contribute.",
    );
  });

  it("puts nothing about other routes when there are none", () => {
    expect(mustGet(describeAll({ fed_rate: 1 }), "inflation").whyText).not.toMatch(/other route/);
  });
});

describe("a moved node", () => {
  it("has no why path when nothing else reaches it", () => {
    const d = mustGet(describeAll({ fed_rate: 1 }), "fed_rate");
    expect(d.isLever).toBe(true);
    expect([d.why, d.whyText, d.otherRoutes]).toEqual([null, null, 0]);
    expect(d.headline).toBe("Federal funds rate: up, large");
  });

  it("says so when another lever cancels it: inflation moved to 0.5 while fed_rate is at 1", () => {
    /* own 0.5, propagated -0.5, total 0. The route that cancels it is still named. */
    const d = mustGet(describeAll({ fed_rate: 1, inflation: 0.5 }), "inflation");
    expect(d.isLever).toBe(true);
    expect(d.headline).toBe("Inflation: no visible change");
    expect(d.whyText).toBe("From Federal funds rate: moves against Inflation (modeled).");
  });
});

describe("the confidence label is the edge's own", () => {
  it("says empirical for an empirical edge, and modeled for the rest of the same route", () => {
    const changed: Graph = {
      ...real,
      edges: real.edges.map((e) =>
        e.id === "fed_rate__inflation" ? { ...e, confidence: "empirical" } : e,
      ),
    };
    const d = mustGet(describeAll({ fed_rate: 1 }, changed), "real_avg_hourly_earnings");
    expect(d.whyText).toBe(
      "From Federal funds rate: moves against Inflation (empirical), then moves against Real hourly earnings (modeled).",
    );
  });
});

describe("the wording never claims more than the model knows", () => {
  const scenarios: Record<string, number>[] = [
    { fed_rate: 1 },
    { fed_rate: -1 },
    { worker_bargaining_power: 1 },
    { fed_rate: 1, worker_bargaining_power: 1 },
    { fed_rate: 1, inflation: 0.5 },
    { productivity: 0.5, media_trust: -0.5, federal_debt: 0.3 },
  ];

  it("contains no decimal number, no forbidden word, and one confidence tag per step", () => {
    for (const scenario of scenarios) {
      for (const d of describeAll(scenario).values()) {
        const texts = [d.headline, d.whyText ?? ""];
        for (const text of texts) {
          expect(text).not.toMatch(/\d\.\d/);
          expect(text).not.toMatch(/\b(prove|proves|proven)\b/i);
        }
        const tags = (d.whyText ?? "").match(/\((modeled|empirical)\)/g) ?? [];
        expect(tags).toHaveLength(d.why?.steps.length ?? 0);
      }
    }
  });

  it("agrees with bucketOf and directionOf for every node", () => {
    for (const scenario of scenarios) {
      const effects = combineEffects(real, levers(scenario));
      for (const effect of effects) {
        const d = describeEffect(real, effect);
        expect(d.bucket).toBe(bucketOf(effect.delta));
        expect(d.direction).toBe(directionOf(effect.delta));
        expect(d.isLever).toBe(effect.own !== 0);
        expect(d.headline.startsWith(`${d.label}: `)).toBe(true);
      }
    }
  });

  it("names the strongest route: its magnitude is the largest among a node's contributions, on 100 random scenarios", () => {
    const rand = mulberry32(31);
    const ids = real.nodes.map((n) => n.id);
    for (let round = 0; round < 100; round++) {
      const values = new Map<string, number>();
      for (let k = 0; k < 1 + Math.floor(rand() * 3); k++) {
        const id = ids[Math.floor(rand() * ids.length)] ?? "fed_rate";
        values.set(id, Math.round((rand() * 2 - 1) * 10) / 10);
      }
      for (const effect of combineEffects(real, values)) {
        const d = describeEffect(real, effect);
        if (effect.contributions.length === 0) {
          expect(d.why).toBeNull();
          continue;
        }
        const largest = Math.max(...effect.contributions.map((c) => Math.abs(c.value)));
        expect(Math.abs(d.why?.value ?? 0)).toBe(largest);
        expect(d.otherRoutes).toBe(effect.contributions.length - 1);
      }
    }
  });
});

describe("a description that cannot be built", () => {
  const fed = combineEffects(real, levers({ fed_rate: 1 }));
  const savings = fed.find((e) => e.nodeId === "real_avg_hourly_earnings") as ScenarioEffect;

  it("throws for an effect whose node is not in the graph", () => {
    expect(() => describeEffect(real, { ...savings, nodeId: "no_such_node" })).toThrow(RangeError);
  });

  it("throws when a contribution names an edge the graph does not have", () => {
    const withoutEdge: Graph = {
      ...real,
      edges: real.edges.filter((e) => e.id !== "fed_rate__inflation"),
    };
    expect(() => describeEffect(withoutEdge, savings)).toThrow(RangeError);
  });

  it("throws when a step names a node the graph does not have", () => {
    const withoutNode: Graph = { ...real, nodes: real.nodes.filter((n) => n.id !== "inflation") };
    expect(() => describeEffect(withoutNode, savings)).toThrow(RangeError);
  });
});
