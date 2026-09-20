/**
 * Tests for stamp.ts, written before it exists.
 *
 * The data stamp is an integrity signal, not a security control. A shared scenario link carries the
 * stamp of the data it was made with, so that a page built from different edges can say "this link
 * was made with earlier data" and not silently show different numbers. It is FNV-1a 32-bit over a
 * canonical JSON of exactly what changes the numbers: the node ids, each edge's id, direction and
 * strength, and the propagation parameters. Labels, claims, baselines, confidence and display ranges
 * are left out on purpose, because editing a sentence must not falsely stale every old link.
 *
 * Every expected value below was computed by a separate Python script that shares no code with the
 * implementation. The vectors for "", "a" and "foobar" are the published FNV-1a test vectors.
 */
import { describe, expect, it } from "vitest";
import graphJson from "../data/graph.json";
import type { PropagationEdge, PropagationGraph, PropagationParams } from "../lib/propagation";
import { DEFAULT_PARAMS } from "../lib/propagation";
import { parseGraph } from "../lib/validate";
import { dataStamp, fnv1a32 } from "./stamp";

describe("fnv1a32", () => {
  it.each([
    ["", "811c9dc5"], // no input: the algorithm's own offset basis
    ["a", "e40c292c"],
    ["foobar", "bf9cf968"],
    ["b", "e70c2de5"],
    ["hello", "4f9f2cab"],
    ["é", "1e9de8c1"], // two UTF-8 bytes, c3 a9
    ["日本", "9f26ee51"], // six UTF-8 bytes
  ])("the hash of %j is %s", (text, expected) => {
    expect(fnv1a32(text)).toBe(expected);
  });

  it("hashes UTF-8 bytes and not UTF-16 code units: an accented letter is not two ASCII-range steps", () => {
    expect(fnv1a32("é")).not.toBe(fnv1a32("Ã©"));
    expect(fnv1a32("é")).toBe("1e9de8c1");
  });

  it("always returns eight lowercase hexadecimal digits", () => {
    for (const text of ["", "x", "a longer piece of text", "日本", "0".repeat(500)]) {
      expect(fnv1a32(text)).toMatch(/^[0-9a-f]{8}$/);
    }
  });

  it("is deterministic", () => {
    expect(fnv1a32("scenario")).toBe(fnv1a32("scenario"));
  });
});

function edge(from: string, to: string, direction: number, strength: number): PropagationEdge {
  return { id: `${from}__${to}`, from, to, direction, strength };
}

const PARAMS: PropagationParams = { maxHops: 3, decay: 0.7 };

/** Nodes a, b and e-acute (a non-ASCII id), edges a to b at +0.5 and b to e-acute at -0.25. */
function fixture(): PropagationGraph {
  return {
    nodes: [{ id: "a" }, { id: "b" }, { id: "é" }],
    edges: [edge("a", "b", 1, 0.5), edge("b", "é", -1, 0.25)],
  };
}

describe("dataStamp: the golden value", () => {
  /*
   * Canonical text, as computed independently:
   * {"v":1,"maxHops":3,"decay":0.7,"nodes":["a","b","é"],"edges":[["a__b",1,0.5],["b__é",-1,0.25]]}
   */
  it("is 3218742c for the fixture graph", () => {
    expect(dataStamp(fixture(), PARAMS)).toBe("3218742c");
  });

  it("uses the default parameters, 3 hops and a decay of 0.7, when none are given", () => {
    expect(DEFAULT_PARAMS).toEqual(PARAMS);
    expect(dataStamp(fixture())).toBe("3218742c");
  });

  it("keeps a leading zero: a strength of 0.75 gives 0530ce2f, not 530ce2f", () => {
    const graph = fixture();
    const changed: PropagationGraph = {
      nodes: graph.nodes,
      edges: [edge("a", "b", 1, 0.75), edge("b", "é", -1, 0.25)],
    };
    expect(dataStamp(changed, PARAMS)).toBe("0530ce2f");
  });
});

describe("dataStamp: everything that changes the numbers changes the stamp", () => {
  const base = "3218742c";
  const parts = fixture();

  it.each<[string, PropagationGraph, PropagationParams, string]>([
    [
      "an edge strength",
      { nodes: parts.nodes, edges: [edge("a", "b", 1, 0.75), edge("b", "é", -1, 0.25)] },
      PARAMS,
      "0530ce2f",
    ],
    [
      "an edge direction",
      { nodes: parts.nodes, edges: [edge("a", "b", -1, 0.5), edge("b", "é", -1, 0.25)] },
      PARAMS,
      "257385a7",
    ],
    [
      "an extra edge",
      { nodes: parts.nodes, edges: [...parts.edges, edge("a", "é", 1, 1)] },
      PARAMS,
      "6a9d4f47",
    ],
    ["a removed edge", { nodes: parts.nodes, edges: [edge("a", "b", 1, 0.5)] }, PARAMS, "22efa12d"],
    [
      "an extra node",
      { nodes: [...parts.nodes, { id: "c" }], edges: parts.edges },
      PARAMS,
      "86162c5f",
    ],
    [
      "a renamed node",
      { nodes: [{ id: "a" }, { id: "b" }, { id: "z" }], edges: parts.edges },
      PARAMS,
      "c77f8316",
    ],
    ["maxHops", parts, { maxHops: 2, decay: 0.7 }, "7d1c0619"],
    ["decay", parts, { maxHops: 3, decay: 0.5 }, "f669ceaa"],
  ])("%s", (_name, graph, params, expected) => {
    const stamp = dataStamp(graph, params);
    expect(stamp).toBe(expected);
    expect(stamp).not.toBe(base);
  });
});

describe("dataStamp: what does not change the numbers does not change the stamp", () => {
  it("ignores the order of the nodes and the edges", () => {
    const graph = fixture();
    const reversed: PropagationGraph = {
      nodes: [...graph.nodes].reverse(),
      edges: [...graph.edges].reverse(),
    };
    expect(dataStamp(reversed, PARAMS)).toBe(dataStamp(graph, PARAMS));
  });

  it("ignores fields that the propagation does not read", () => {
    const graph = fixture();
    const decorated = {
      nodes: graph.nodes.map((n) => ({ ...n, label: "Some label", baseline: 12 })),
      edges: graph.edges.map((e) => ({ ...e, claim: "A sentence.", confidence: "empirical" })),
    };
    expect(dataStamp(decorated, PARAMS)).toBe(dataStamp(graph, PARAMS));
  });

  it("does not reorder the arrays it is given, even when they are frozen and out of order", () => {
    const unsorted = {
      nodes: Object.freeze([{ id: "b" }, { id: "a" }, { id: "\u00e9" }]),
      edges: Object.freeze([edge("b", "\u00e9", -1, 0.25), edge("a", "b", 1, 0.5)]),
    };
    expect(() => dataStamp(unsorted, PARAMS)).not.toThrow();
    expect(unsorted.edges.map((e) => e.id)).toEqual(["b__\u00e9", "a__b"]);
    expect(unsorted.nodes.map((n) => n.id)).toEqual(["b", "a", "\u00e9"]);
    expect(dataStamp(unsorted, PARAMS)).toBe("3218742c");
  });

  it("does not mutate the graph it is given", () => {
    const graph = fixture();
    const before = JSON.stringify(graph);
    dataStamp(graph, PARAMS);
    expect(JSON.stringify(graph)).toBe(before);
  });
});

describe("dataStamp on the real graph", () => {
  const real = parseGraph(graphJson);
  const stamp = dataStamp(real);

  it("is eight lowercase hexadecimal digits and repeatable", () => {
    expect(stamp).toMatch(/^[0-9a-f]{8}$/);
    expect(dataStamp(parseGraph(graphJson))).toBe(stamp);
  });

  it("changes when one edge is reweighted", () => {
    const reweighted = {
      ...real,
      edges: real.edges.map((e) => (e.id === "fed_rate__inflation" ? { ...e, strength: 0.25 } : e)),
    };
    expect(dataStamp(reweighted)).not.toBe(stamp);
  });

  it("does not change when a label, a claim, a baseline or a confidence is edited", () => {
    const edited = {
      nodes: real.nodes.map((n) => ({ ...n, label: `${n.label} (edited)`, baseline: 0 })),
      edges: real.edges.map((e) => ({ ...e, claim: "Edited.", confidence: "empirical" as const })),
    };
    expect(dataStamp(edited)).toBe(stamp);
  });
});
