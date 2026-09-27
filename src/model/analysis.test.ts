/**
 * Tests for analysis.ts, written before it exists. Every expected number is worked by hand.
 */
import { describe, expect, it } from "vitest";
import graphJson from "../data/graph.json";
import type { PropagationEdge, PropagationGraph } from "../lib/propagation";
import { parseGraph } from "../lib/validate";
import { compareDeltas, evidenceGraph, SENSITIVITY_SETTINGS, sensitivity } from "./analysis";
import { combineEffects } from "./effects";

function edge(from: string, to: string, direction: number, strength: number): PropagationEdge {
  return { id: `${from}__${to}`, from, to, direction, strength };
}

describe("evidenceGraph", () => {
  const graph = {
    nodes: [{ id: "a" }, { id: "b" }, { id: "c" }],
    edges: [
      { ...edge("a", "b", 1, 0.5), confidence: "empirical" as const },
      { ...edge("b", "c", 1, 0.5), confidence: "modeled" as const },
    ],
  };

  it("keeps every node and only the empirical edges", () => {
    const kept = evidenceGraph(graph);
    expect(kept.nodes).toEqual(graph.nodes);
    expect(kept.edges.map((e) => e.id)).toEqual(["a__b"]);
  });

  it("never lets a modeled edge carry an effect", () => {
    const effects = combineEffects(evidenceGraph(graph), new Map([["a", 1]]));
    expect(effects.map((e) => e.nodeId)).toEqual(["a", "b"]);
  });

  it("does not change the graph it was given", () => {
    evidenceGraph(graph);
    expect(graph.edges).toHaveLength(2);
  });

  it("leaves the real graph with no relationship today, because no edge is cited yet", () => {
    const real = parseGraph(graphJson);
    expect(evidenceGraph(real).edges).toEqual([]);
    expect(evidenceGraph(real).nodes).toHaveLength(real.nodes.length);
  });
});

describe("SENSITIVITY_SETTINGS", () => {
  it("is the nine combinations of decay 0.5, 0.7, 0.9 and 2, 3, 4 relationships, default included", () => {
    expect(SENSITIVITY_SETTINGS).toHaveLength(9);
    const keys = SENSITIVITY_SETTINGS.map((p) => `${String(p.maxHops)}:${String(p.decay)}`);
    expect(new Set(keys).size).toBe(9);
    for (const hops of [2, 3, 4])
      for (const decay of [0.5, 0.7, 0.9])
        expect(keys).toContain(`${String(hops)}:${String(decay)}`);
  });
});

describe("sensitivity", () => {
  /*
   * a -> b +0.5, b -> c +1, c -> d +1, a -> e -0.25, c -> e +1; f has no edges. Lever a = 1.
   *   a: own 1 in every setting                              robust, 1 to 1
   *   b: 0.5 in every setting                                robust, 0.5 to 0.5
   *   c: 0.5 * decay, reached from 2 relationships           robust, 0.25 to 0.45
   *   d: 0.5 * decay^2, needs 3 relationships; 0 at 2        partial, 0 to 0.405
   *   e: -0.25 at 2 relationships; -0.25 + 0.5 * decay^2 at 3 or 4:
   *      decay 0.5 -> -0.125, 0.7 -> -0.005, 0.9 -> +0.155   direction, -0.25 to 0.155
   *   f: never reached                                       none, 0 to 0
   */
  const graph: PropagationGraph = {
    nodes: ["a", "b", "c", "d", "e", "f"].map((id) => ({ id })),
    edges: [
      edge("a", "b", 1, 0.5),
      edge("b", "c", 1, 1),
      edge("c", "d", 1, 1),
      edge("a", "e", -1, 0.25),
      edge("c", "e", 1, 1),
    ],
  };
  const result = sensitivity(graph, new Map([["a", 1]]));

  it.each([
    ["a", "robust", 1, 1],
    ["b", "robust", 0.5, 0.5],
    ["c", "robust", 0.25, 0.45],
    ["d", "partial", 0, 0.405],
    ["e", "direction", -0.25, 0.155],
    ["f", "none", 0, 0],
  ])("%s is %s, from %s to %s", (id, robustness, min, max) => {
    const entry = result.get(id);
    expect(entry?.robustness).toBe(robustness);
    expect(entry?.min).toBeCloseTo(min, 12);
    expect(entry?.max).toBeCloseTo(max, 12);
  });

  it("lists every node of the graph, in node id order", () => {
    expect([...result.keys()]).toEqual(["a", "b", "c", "d", "e", "f"]);
  });

  it("is sign symmetric: a negated lever negates and swaps the range", () => {
    const negated = sensitivity(graph, new Map([["a", -1]]));
    for (const [id, entry] of result) {
      const other = negated.get(id);
      expect(other?.robustness).toBe(entry.robustness);
      expect(other?.min).toBeCloseTo(-entry.max, 12);
      expect(other?.max).toBeCloseTo(-entry.min, 12);
    }
  });

  it("uses clamped scores, so a total beyond 1 counts as 1", () => {
    const g: PropagationGraph = {
      nodes: [{ id: "x" }, { id: "y" }],
      edges: [edge("x", "y", 1, 1)],
    };
    const both = sensitivity(
      g,
      new Map([
        ["x", 1],
        ["y", 1],
      ]),
    );
    expect(both.get("y")).toEqual({ nodeId: "y", robustness: "robust", min: 1, max: 1 });
  });

  it("treats floating-point cancellation noise as zero", () => {
    // y gets 0.1 + 0.2 from two routes and -0.3 from its own lever: 5.55e-17, not a direction.
    const g: PropagationGraph = {
      nodes: [{ id: "p" }, { id: "q" }, { id: "y" }],
      edges: [edge("p", "y", 1, 0.25), edge("q", "y", 1, 0.25)],
    };
    const noisy = sensitivity(
      g,
      new Map([
        ["p", 0.4],
        ["q", 0.8],
        ["y", -0.3],
      ]),
      [{ maxHops: 1, decay: 1 }],
    );
    expect(noisy.get("y")?.robustness).toBe("none");
    expect(noisy.get("y")?.min).toBe(0);
  });

  it("gives the same answer on every call and for any lever order", () => {
    const a = sensitivity(
      graph,
      new Map([
        ["a", 0.5],
        ["c", -0.25],
      ]),
    );
    const b = sensitivity(
      graph,
      new Map([
        ["c", -0.25],
        ["a", 0.5],
      ]),
    );
    expect([...b]).toEqual([...a]);
  });

  it("reports the real graph's fed_rate effect on poverty_rate as partial: it needs 4 relationships", () => {
    const real = parseGraph(graphJson);
    const entry = sensitivity(real, new Map([["fed_rate", 1]])).get("poverty_rate");
    expect(entry?.robustness).toBe("partial");
    // fed -> inflation -> real earnings -> median income -> poverty at 4 relationships:
    // -0.5 * -0.75 * 0.5 * -0.5 = -0.09375, times decay^3: 0.125 * -0.09375 at 0.5 ... 0.729 at 0.9.
    expect(entry?.min).toBeCloseTo(-0.09375 * 0.729, 12);
    expect(entry?.max).toBe(0);
  });
});

describe("compareDeltas", () => {
  it("reports each node's score in A and now, the change, and how many changed", () => {
    const result = compareDeltas(
      ["x", "y", "z"],
      new Map([
        ["x", 0.5],
        ["y", 0.25],
      ]),
      new Map([
        ["x", 0.5],
        ["z", -0.5],
      ]),
    );
    expect(result.entries).toEqual([
      { nodeId: "x", a: 0.5, b: 0.5, change: 0 },
      { nodeId: "y", a: 0.25, b: 0, change: -0.25 },
      { nodeId: "z", a: 0, b: -0.5, change: -0.5 },
    ]);
    expect(result.changed).toBe(2);
  });

  it("ignores a change smaller than floating-point noise", () => {
    const result = compareDeltas(["x"], new Map([["x", 0.3]]), new Map([["x", 0.1 + 0.2]]));
    expect(result.entries[0]?.change).toBe(0);
    expect(result.changed).toBe(0);
  });
});
