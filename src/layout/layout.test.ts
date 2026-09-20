/**
 * Tests for layout.ts, written before it exists.
 *
 * layoutGraph places the nodes of the graph in columns and rows. It is pure, and it uses no
 * dependency. The rules:
 *
 *   - A node's layer is the length of the longest path that reaches it. Sources, and nodes with no
 *     edges at all, are layer 0. A layer is drawn as a column.
 *   - A cycle cannot be layered, so a depth-first search from the ids in sorted order finds back
 *     edges, which are ignored for layering and reported. Self loops are ignored. The search is
 *     iterative, so a very long chain cannot overflow the stack.
 *   - Within a layer, rows are ordered by category, in the order the caller supplies (alphabetical
 *     by default, unknown categories last), then by id. Each layer is centered vertically.
 *   - x = layer * (nodeWidth + columnGap), and y = (row + (rows - layerSize) / 2) * (nodeHeight +
 *     rowGap), for the top-left corner of a box of nodeWidth by nodeHeight.
 *
 * The expected placements below were computed by a separate Python script that layers nodes with
 * memoized recursion, where the implementation uses Kahn's algorithm, and that finds back edges
 * with a recursive search, where the implementation is iterative.
 */
import { describe, expect, it } from "vitest";
import graphJson from "../data/graph.json";
import { CATEGORIES } from "../lib/schema";
import { parseGraph } from "../lib/validate";
import { DEFAULT_LAYOUT_OPTIONS, layoutGraph } from "./layout";
import type { Layout, LayoutEdge, LayoutGraph, LayoutNode, LayoutOptions } from "./layout";

/** Small round numbers, so the arithmetic below can be checked by eye: a pitch of 16 by 6. */
const SMALL: Partial<LayoutOptions> = { nodeWidth: 10, nodeHeight: 4, columnGap: 6, rowGap: 2 };

function node(id: string, category = "c"): LayoutNode {
  return { id, category };
}

function edge(from: string, to: string): LayoutEdge {
  return { from, to };
}

function graphOf(ids: string[], edges: [string, string][]): LayoutGraph {
  return { nodes: ids.map((id) => node(id)), edges: edges.map(([from, to]) => edge(from, to)) };
}

function table(layout: Layout): [string, number, number, number, number][] {
  return layout.placements.map((p) => [p.id, p.layer, p.row, p.x, p.y]);
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
  return items.flatMap((first, i) =>
    permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [first, ...rest]),
  );
}

describe("the options", () => {
  it("default to 200 by 72 boxes with gaps of 96 and 24, and no category order", () => {
    expect(DEFAULT_LAYOUT_OPTIONS).toEqual({
      nodeWidth: 200,
      nodeHeight: 72,
      columnGap: 96,
      rowGap: 24,
      categoryOrder: [],
    });
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])("reject a node width of %s", (value) => {
    expect(() => layoutGraph(graphOf(["a"], []), { nodeWidth: value })).toThrow(RangeError);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])("reject a node height of %s", (value) => {
    expect(() => layoutGraph(graphOf(["a"], []), { nodeHeight: value })).toThrow(RangeError);
  });

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])("reject a column gap of %s", (value) => {
    expect(() => layoutGraph(graphOf(["a"], []), { columnGap: value })).toThrow(RangeError);
  });

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])("reject a row gap of %s", (value) => {
    expect(() => layoutGraph(graphOf(["a"], []), { rowGap: value })).toThrow(RangeError);
  });

  it("accept gaps of exactly zero, so boxes may touch", () => {
    expect(() =>
      layoutGraph(graphOf(["a", "b"], [["a", "b"]]), { columnGap: 0, rowGap: 0 }),
    ).not.toThrow();
  });
});

describe("the graph is checked", () => {
  it("rejects two nodes with the same id", () => {
    expect(() => layoutGraph(graphOf(["a", "a"], []))).toThrow(RangeError);
  });

  it("rejects an edge from a node that does not exist", () => {
    expect(() => layoutGraph(graphOf(["a"], [["nope", "a"]]))).toThrow(RangeError);
  });

  it("rejects an edge to a node that does not exist", () => {
    expect(() => layoutGraph(graphOf(["a"], [["a", "nope"]]))).toThrow(RangeError);
  });

  it("rejects a self loop on a node that does not exist, before ignoring self loops", () => {
    expect(() => layoutGraph(graphOf(["a"], [["nope", "nope"]]))).toThrow(RangeError);
  });
});

describe("hand-computed layouts, boxes 10 by 4 with gaps 6 and 2", () => {
  it("an empty graph has nothing and no size", () => {
    const layout = layoutGraph(graphOf([], []), SMALL);
    expect([layout.placements, layout.layers, layout.rows, layout.width, layout.height]).toEqual([
      [],
      0,
      0,
      0,
      0,
    ]);
    expect(layout.backEdges).toEqual([]);
  });

  it("a single node sits at the origin and the bounds are its box", () => {
    const layout = layoutGraph(graphOf(["a"], []), SMALL);
    expect(table(layout)).toEqual([["a", 0, 0, 0, 0]]);
    expect([layout.layers, layout.rows, layout.width, layout.height]).toEqual([1, 1, 10, 4]);
  });

  it("a chain a, b, c runs left to right: x is 0, 16, 32, and the width is 3 * 10 + 2 * 6 = 42", () => {
    const layout = layoutGraph(
      graphOf(
        ["a", "b", "c"],
        [
          ["a", "b"],
          ["b", "c"],
        ],
      ),
      SMALL,
    );
    expect(table(layout)).toEqual([
      ["a", 0, 0, 0, 0],
      ["b", 1, 0, 16, 0],
      ["c", 2, 0, 32, 0],
    ]);
    expect([layout.layers, layout.rows, layout.width, layout.height]).toEqual([3, 1, 42, 4]);
  });

  /*
   * Diamond a->b, a->c, b->d, c->d. Layer 1 has two rows, so the height is 2 * 4 + 2 = 10, and the
   * single nodes of layers 0 and 2 are centered: (2 - 1) / 2 * (4 + 2) = 3.
   */
  it("a diamond centers the single-node layers against the two-node layer", () => {
    const layout = layoutGraph(
      graphOf(
        ["a", "b", "c", "d"],
        [
          ["a", "b"],
          ["a", "c"],
          ["b", "d"],
          ["c", "d"],
        ],
      ),
      SMALL,
    );
    expect(table(layout)).toEqual([
      ["a", 0, 0, 0, 3],
      ["b", 1, 0, 16, 0],
      ["c", 1, 1, 16, 6],
      ["d", 2, 0, 32, 3],
    ]);
    expect([layout.layers, layout.rows, layout.width, layout.height]).toEqual([3, 2, 42, 10]);
  });

  it("uses the LONGEST path, not the shortest: c is layer 2 though a->c is direct", () => {
    const layout = layoutGraph(
      graphOf(
        ["a", "b", "c"],
        [
          ["a", "b"],
          ["b", "c"],
          ["a", "c"],
        ],
      ),
      SMALL,
    );
    expect(table(layout)).toEqual([
      ["a", 0, 0, 0, 0],
      ["b", 1, 0, 16, 0],
      ["c", 2, 0, 32, 0],
    ]);
  });

  it("a wide layer of three rows centers the lone source: (3 - 1) / 2 * 6 = 6", () => {
    const layout = layoutGraph(
      graphOf(
        ["a", "b", "c", "d"],
        [
          ["a", "b"],
          ["a", "c"],
          ["a", "d"],
        ],
      ),
      SMALL,
    );
    expect(table(layout)).toEqual([
      ["a", 0, 0, 0, 6],
      ["b", 1, 0, 16, 0],
      ["c", 1, 1, 16, 6],
      ["d", 1, 2, 16, 12],
    ]);
    expect([layout.width, layout.height]).toEqual([26, 16]);
  });

  it("layers of different sizes are each centered: two rows, then one", () => {
    const layout = layoutGraph(
      graphOf(
        ["a", "b", "c", "d"],
        [
          ["a", "b"],
          ["a", "c"],
          ["c", "d"],
        ],
      ),
      SMALL,
    );
    expect(table(layout)).toEqual([
      ["a", 0, 0, 0, 3],
      ["b", 1, 0, 16, 0],
      ["c", 1, 1, 16, 6],
      ["d", 2, 0, 32, 3],
    ]);
  });

  it("puts a node with no edges in layer 0, below the sources, and centers the next layer", () => {
    const layout = layoutGraph(graphOf(["a", "b", "z"], [["a", "b"]]), SMALL);
    expect(table(layout)).toEqual([
      ["a", 0, 0, 0, 0],
      ["b", 1, 0, 16, 3],
      ["z", 0, 1, 0, 6],
    ]);
    expect([layout.width, layout.height]).toEqual([26, 10]);
  });

  it("layers the parts of a disconnected graph independently", () => {
    const layout = layoutGraph(
      graphOf(
        ["a", "b", "c", "d"],
        [
          ["a", "b"],
          ["c", "d"],
        ],
      ),
      SMALL,
    );
    expect(layout.placements.map((p) => [p.id, p.layer])).toEqual([
      ["a", 0],
      ["b", 1],
      ["c", 0],
      ["d", 1],
    ]);
  });

  it("treats a repeated edge as one edge", () => {
    const once = layoutGraph(graphOf(["a", "b"], [["a", "b"]]), SMALL);
    const twice = layoutGraph(
      graphOf(
        ["a", "b"],
        [
          ["a", "b"],
          ["a", "b"],
        ],
      ),
      SMALL,
    );
    expect(twice).toEqual(once);
  });

  it("uses the defaults when no options are given: a pitch of 296 by 96", () => {
    const layout = layoutGraph(graphOf(["a", "b"], [["a", "b"]]));
    expect(table(layout)).toEqual([
      ["a", 0, 0, 0, 0],
      ["b", 1, 0, 296, 0],
    ]);
    expect([layout.width, layout.height]).toEqual([496, 72]);
  });

  it("accepts fractional sizes and gaps", () => {
    const layout = layoutGraph(graphOf(["a", "b"], [["a", "b"]]), {
      nodeWidth: 10.5,
      nodeHeight: 4.5,
      columnGap: 0.5,
      rowGap: 0.25,
    });
    expect(table(layout)[1]).toEqual(["b", 1, 0, 11, 0]);
    expect(layout.width).toBe(21.5);
  });
});

describe("rows within a layer follow the category order", () => {
  /* a feeds p (category b), q (category a) and r (category b). All three are in layer 1. */
  function withCategories(order: string[] | undefined, categories: [string, string, string]) {
    const [p, q, r] = categories;
    const graph: LayoutGraph = {
      nodes: [node("a", "x"), node("p", p), node("q", q), node("r", r)],
      edges: [edge("a", "p"), edge("a", "q"), edge("a", "r")],
    };
    return table(
      layoutGraph(graph, order === undefined ? SMALL : { ...SMALL, categoryOrder: order }),
    );
  }

  it("is alphabetical by category, then by id, when no order is given: q (a), then p and r (b)", () => {
    expect(withCategories(undefined, ["b", "a", "b"])).toEqual([
      ["a", 0, 0, 0, 6],
      ["p", 1, 1, 16, 6],
      ["q", 1, 0, 16, 0],
      ["r", 1, 2, 16, 12],
    ]);
  });

  it("follows the order the caller gives: b before a puts p and r before q", () => {
    expect(withCategories(["b", "a"], ["b", "a", "b"])).toEqual([
      ["a", 0, 0, 0, 6],
      ["p", 1, 0, 16, 0],
      ["q", 1, 2, 16, 12],
      ["r", 1, 1, 16, 6],
    ]);
  });

  it("puts categories missing from the order after the listed ones, alphabetically among themselves", () => {
    expect(withCategories(["b"], ["b", "a", "zz"])).toEqual([
      ["a", 0, 0, 0, 6],
      ["p", 1, 0, 16, 0],
      ["q", 1, 1, 16, 6],
      ["r", 1, 2, 16, 12],
    ]);
    expect(withCategories(["b"], ["zz", "a", "b"])).toEqual([
      ["a", 0, 0, 0, 6],
      ["p", 1, 2, 16, 12],
      ["q", 1, 1, 16, 6],
      ["r", 1, 0, 16, 0],
    ]);
  });

  it("uses the first position when a category is listed twice", () => {
    /* order [a, b, a]: a is rank 0 and b is rank 1, so q (a) comes before p (b), not after. */
    expect(withCategories(["a", "b", "a"], ["b", "a", "b"])).toEqual([
      ["a", 0, 0, 0, 6],
      ["p", 1, 1, 16, 6],
      ["q", 1, 0, 16, 0],
      ["r", 1, 2, 16, 12],
    ]);
  });

  it("breaks a tie within one category by id, in code-unit order", () => {
    const graph: LayoutGraph = {
      nodes: [node("s"), node("a_1", "k"), node("a1", "k")],
      edges: [edge("s", "a_1"), edge("s", "a1")],
    };
    /* "1" is 49 and "_" is 95, so a1 sorts before a_1. Locale order would put a_1 first. */
    expect(table(layoutGraph(graph, SMALL)).map((r) => [r[0], r[2]])).toEqual([
      ["a1", 0],
      ["a_1", 1],
      ["s", 0],
    ]);
  });

  it("orders sources by category too, with an unconnected node among them", () => {
    const graph: LayoutGraph = {
      nodes: [node("z", "b"), node("m", "a"), node("k", "b")],
      edges: [],
    };
    expect(table(layoutGraph(graph, SMALL)).map((r) => [r[0], r[2]])).toEqual([
      ["k", 1],
      ["m", 0],
      ["z", 2],
    ]);
  });
});

describe("cycles", () => {
  it("a three-cycle: a is the root, so c to a is the back edge, and the layers are 0, 1, 2", () => {
    const layout = layoutGraph(
      graphOf(
        ["a", "b", "c"],
        [
          ["a", "b"],
          ["b", "c"],
          ["c", "a"],
        ],
      ),
      SMALL,
    );
    expect(layout.backEdges).toEqual([{ from: "c", to: "a" }]);
    expect(layout.placements.map((p) => [p.id, p.layer])).toEqual([
      ["a", 0],
      ["b", 1],
      ["c", 2],
    ]);
  });

  it("a two-cycle is broken at the edge that closes it: the search starts at a, so z to a is back", () => {
    const layout = layoutGraph(
      graphOf(
        ["z", "a"],
        [
          ["z", "a"],
          ["a", "z"],
        ],
      ),
      SMALL,
    );
    expect(layout.backEdges).toEqual([{ from: "z", to: "a" }]);
    expect(layout.placements.map((p) => [p.id, p.layer])).toEqual([
      ["a", 0],
      ["z", 1],
    ]);
  });

  it("a cycle with a tail keeps the tail after it: c to b is back, and d is layer 3", () => {
    const layout = layoutGraph(
      graphOf(
        ["a", "b", "c", "d"],
        [
          ["a", "b"],
          ["b", "c"],
          ["c", "b"],
          ["c", "d"],
        ],
      ),
      SMALL,
    );
    expect(layout.backEdges).toEqual([{ from: "c", to: "b" }]);
    expect(layout.placements.map((p) => [p.id, p.layer])).toEqual([
      ["a", 0],
      ["b", 1],
      ["c", 2],
      ["d", 3],
    ]);
  });

  it("lists several back edges from one node sorted by their targets", () => {
    const layout = layoutGraph(
      graphOf(
        ["a", "b", "c"],
        [
          ["a", "b"],
          ["b", "c"],
          ["c", "a"],
          ["c", "b"],
        ],
      ),
      SMALL,
    );
    expect(layout.backEdges).toEqual([
      { from: "c", to: "a" },
      { from: "c", to: "b" },
    ]);
  });

  it("does not call a forward or cross edge a back edge", () => {
    const forward = layoutGraph(
      graphOf(
        ["a", "b", "c"],
        [
          ["a", "b"],
          ["a", "c"],
          ["b", "c"],
        ],
      ),
      SMALL,
    );
    expect(forward.backEdges).toEqual([]);
    const diamond = layoutGraph(
      graphOf(
        ["a", "b", "c", "d"],
        [
          ["a", "b"],
          ["a", "c"],
          ["b", "d"],
          ["c", "d"],
        ],
      ),
      SMALL,
    );
    expect(diamond.backEdges).toEqual([]);
  });

  it("ignores a self loop, and does not report it as a back edge", () => {
    const layout = layoutGraph(
      graphOf(
        ["a", "b"],
        [
          ["a", "a"],
          ["a", "b"],
        ],
      ),
      SMALL,
    );
    expect(layout.backEdges).toEqual([]);
    expect(layout.placements.map((p) => [p.id, p.layer])).toEqual([
      ["a", 0],
      ["b", 1],
    ]);
  });

  /*
   * a->b, a->c, b->c, c->b. Targets are followed in id order, so from a the search enters b first,
   * b enters c, and c to b closes the cycle: c to b is the back edge, and the layers are 0, 1, 2. Had c
   * been followed first, c would enter b and b to c would close it, giving 0, 2, 1. The choice must not
   * depend on the order in which the edges arrive, so all 24 orders are tried.
   */
  it("picks the same back edge for a cycle with branches, in all 24 orders of its edges", () => {
    const edges: [string, string][] = [
      ["a", "b"],
      ["a", "c"],
      ["b", "c"],
      ["c", "b"],
    ];
    for (const order of permutations(edges)) {
      const layout = layoutGraph(graphOf(["c", "a", "b"], order), SMALL);
      expect(layout.backEdges, JSON.stringify(order)).toEqual([{ from: "c", to: "b" }]);
      expect(
        layout.placements.map((p) => [p.id, p.layer]),
        JSON.stringify(order),
      ).toEqual([
        ["a", 0],
        ["b", 1],
        ["c", 2],
      ]);
    }
  });

  it("gives the same layout however the nodes and edges are ordered, cycles included", () => {
    const ids = ["a", "b", "c", "d", "e"];
    const edges: [string, string][] = [
      ["a", "b"],
      ["b", "c"],
      ["c", "a"],
      ["c", "d"],
      ["d", "e"],
      ["e", "c"],
    ];
    const baseline = layoutGraph(graphOf(ids, edges), SMALL);
    const rand = mulberry32(5);
    for (let i = 0; i < 50; i++) {
      expect(layoutGraph(graphOf(shuffled(ids, rand), shuffled(edges, rand)), SMALL)).toEqual(
        baseline,
      );
    }
  });
});

describe("rows at scale", () => {
  /* Forty nodes in one layer, four categories interleaved by id, so ten nodes tie within each category. */
  const ids = Array.from({ length: 40 }, (_, i) => `n${String(i).padStart(2, "0")}`);
  const categories = ["delta", "alpha", "charlie", "bravo"];
  const nodes = ids.map((id, i) => node(id, categories[i % 4]));
  const idsIn = (category: string): string[] =>
    nodes.filter((n) => n.category === category).map((n) => n.id);
  const rowOrder = (layout: Layout): string[] =>
    [...layout.placements].sort((a, b) => a.row - b.row).map((p) => p.id);

  it("sorts by category, and by id among the ten that tie in each, when no order is given", () => {
    const layout = layoutGraph({ nodes, edges: [] }, SMALL);
    expect(layout.rows).toBe(40);
    expect(rowOrder(layout)).toEqual([
      ...idsIn("alpha"),
      ...idsIn("bravo"),
      ...idsIn("charlie"),
      ...idsIn("delta"),
    ]);
  });

  it("follows a given category order, with ties still broken by id", () => {
    const layout = layoutGraph(
      { nodes, edges: [] },
      { ...SMALL, categoryOrder: ["delta", "bravo"] },
    );
    expect(rowOrder(layout)).toEqual([
      ...idsIn("delta"),
      ...idsIn("bravo"),
      ...idsIn("alpha"),
      ...idsIn("charlie"),
    ]);
  });

  it("gives the same rows however the forty nodes arrive", () => {
    const rand = mulberry32(17);
    const baseline = rowOrder(layoutGraph({ nodes, edges: [] }, SMALL));
    for (let i = 0; i < 20; i++) {
      expect(rowOrder(layoutGraph({ nodes: shuffled(nodes, rand), edges: [] }, SMALL))).toEqual(
        baseline,
      );
    }
  });
});

describe("very large graphs", () => {
  const id = (i: number): string => `n${String(i).padStart(5, "0")}`;
  const chain = (length: number): [string, string][] =>
    Array.from({ length: length - 1 }, (_, i): [string, string] => [id(i), id(i + 1)]);

  it("lays out a chain of 5000 nodes without overflowing the stack", () => {
    const ids = Array.from({ length: 5000 }, (_, i) => id(i));
    const layout = layoutGraph(graphOf(ids, chain(5000)), SMALL);
    expect(layout.layers).toBe(5000);
    expect(layout.backEdges).toEqual([]);
    expect(layout.placements.at(-1)).toMatchObject({ id: id(4999), layer: 4999 });
  });

  it("lays out a single cycle of 5000 nodes, with exactly one back edge", () => {
    const ids = Array.from({ length: 5000 }, (_, i) => id(i));
    const layout = layoutGraph(graphOf(ids, [...chain(5000), [id(4999), id(0)]]), SMALL);
    expect(layout.layers).toBe(5000);
    expect(layout.backEdges).toEqual([{ from: id(4999), to: id(0) }]);
  });
});

/* ------------------------------------------------------------------------------------------ */
/* Independent checks for the property tests. Each uses a different method from the layout.   */

function isAcyclic(ids: string[], edges: [string, string][]): boolean {
  const indegree = new Map(ids.map((i) => [i, 0]));
  for (const [, to] of edges) indegree.set(to, (indegree.get(to) ?? 0) + 1);
  const ready = ids.filter((i) => indegree.get(i) === 0);
  let seen = 0;
  while (ready.length > 0) {
    const current = ready.pop() as string;
    seen += 1;
    for (const [from, to] of edges) {
      if (from !== current) continue;
      indegree.set(to, (indegree.get(to) ?? 0) - 1);
      if (indegree.get(to) === 0) ready.push(to);
    }
  }
  return seen === ids.length;
}

function reaches(edges: [string, string][], from: string, to: string): boolean {
  const visited = new Set<string>([from]);
  const frontier = [from];
  while (frontier.length > 0) {
    const current = frontier.pop() as string;
    if (current === to) return true;
    for (const [a, b] of edges) {
      if (a === current && !visited.has(b)) {
        visited.add(b);
        frontier.push(b);
      }
    }
  }
  return false;
}

/** Longest path by memoized recursion over predecessors. */
function longestPathLayers(ids: string[], edges: [string, string][]): Map<string, number> {
  const memo = new Map<string, number>();
  const layerOf = (v: string): number => {
    const known = memo.get(v);
    if (known !== undefined) return known;
    const predecessors = edges.filter(([, to]) => to === v).map(([from]) => from);
    const value = predecessors.length === 0 ? 0 : 1 + Math.max(...predecessors.map(layerOf));
    memo.set(v, value);
    return value;
  };
  for (const v of ids) layerOf(v);
  return memo;
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

describe("properties on 400 seeded random graphs, cycles, self loops and repeated edges included", () => {
  it("every guarantee holds, checked with independent methods", () => {
    const rand = mulberry32(20260919);
    const categories = ["econ", "fiscal", "social", "zz"];
    const pick = <T>(items: readonly T[]): T => items[Math.floor(rand() * items.length)] as T;

    for (let round = 0; round < 400; round++) {
      const n = 1 + Math.floor(rand() * 9);
      const ids = Array.from({ length: n }, (_, i) => `n${String(i)}`);
      const probability = 0.1 + rand() * 0.4;
      const edges: [string, string][] = [];
      for (const from of ids) {
        for (const to of ids) {
          if (rand() < probability) {
            edges.push([from, to]);
            if (rand() < 0.15) edges.push([from, to]);
          }
        }
      }
      const nodes = ids.map((id) => node(id, pick(categories)));
      const order = shuffled([...categories, pick(categories)], rand).slice(
        0,
        Math.floor(rand() * 6),
      );
      const options: LayoutOptions = {
        nodeWidth: pick([1, 10, 200]),
        nodeHeight: pick([1, 4, 72]),
        columnGap: pick([0, 6, 96]),
        rowGap: pick([0, 2, 24.5]),
        categoryOrder: order,
      };
      const layout = layoutGraph(
        { nodes, edges: edges.map(([from, to]) => edge(from, to)) },
        options,
      );
      const label = `round ${String(round)}`;

      // every node is placed exactly once
      expect(
        layout.placements.map((p) => p.id),
        label,
      ).toEqual([...ids].sort());

      // coordinates follow the formulas
      const size = new Map<number, number>();
      for (const p of layout.placements) size.set(p.layer, (size.get(p.layer) ?? 0) + 1);
      const rows = Math.max(...size.values());
      expect(layout.rows, label).toBe(rows);
      expect(layout.layers, label).toBe(Math.max(...layout.placements.map((p) => p.layer)) + 1);
      for (const p of layout.placements) {
        expect(p.x, label).toBe(p.layer * (options.nodeWidth + options.columnGap));
        expect(p.y, label).toBe(
          (p.row + (rows - (size.get(p.layer) ?? 0)) / 2) * (options.nodeHeight + options.rowGap),
        );
      }
      expect(layout.width, label).toBe(
        layout.layers * options.nodeWidth + (layout.layers - 1) * options.columnGap,
      );
      expect(layout.height, label).toBe(rows * options.nodeHeight + (rows - 1) * options.rowGap);

      // rows in a layer are 0..size-1 with no repeats
      for (const [layer, count] of size) {
        const seen = layout.placements
          .filter((p) => p.layer === layer)
          .map((p) => p.row)
          .sort((a, b) => a - b);
        expect(seen, label).toEqual(Array.from({ length: count }, (_, i) => i));
      }

      // no two boxes overlap, and every box is inside the bounds
      const eps = 1e-9;
      for (const a of layout.placements) {
        expect(a.x, label).toBeGreaterThanOrEqual(0);
        expect(a.y, label).toBeGreaterThanOrEqual(-eps);
        expect(a.x + options.nodeWidth, label).toBeLessThanOrEqual(layout.width + eps);
        expect(a.y + options.nodeHeight, label).toBeLessThanOrEqual(layout.height + eps);
        for (const b of layout.placements) {
          if (a.id >= b.id) continue;
          const overlapsX =
            a.x < b.x + options.nodeWidth - eps && b.x < a.x + options.nodeWidth - eps;
          const overlapsY =
            a.y < b.y + options.nodeHeight - eps && b.y < a.y + options.nodeHeight - eps;
          expect(overlapsX && overlapsY, `${label}: ${a.id} overlaps ${b.id}`).toBe(false);
        }
      }

      // back edges are real edges, unique, sorted, and never self loops
      const realEdges = new Set(edges.filter(([f, t]) => f !== t).map(([f, t]) => `${f}>${t}`));
      const back = layout.backEdges.map((b) => `${b.from}>${b.to}`);
      for (const key of back) expect(realEdges.has(key), label).toBe(true);
      expect(new Set(back).size, label).toBe(back.length);
      expect(back, label).toEqual(
        [...layout.backEdges]
          .sort((x, y) => compareText(x.from, y.from) || compareText(x.to, y.to))
          .map((b) => `${b.from}>${b.to}`),
      );

      // removing them leaves an acyclic graph, and each closes a cycle that the rest still has
      const backSet = new Set(back);
      const rest = [...new Set(edges.filter(([f, t]) => f !== t).map(([f, t]) => `${f}>${t}`))]
        .filter((key) => !backSet.has(key))
        .map((key): [string, string] => {
          const [from, to] = key.split(">");
          return [from as string, to as string];
        });
      expect(isAcyclic(ids, rest), label).toBe(true);
      for (const b of layout.backEdges)
        expect(reaches(rest, b.to, b.from), `${label}: ${b.from}>${b.to}`).toBe(true);
      if (
        isAcyclic(
          ids,
          [...realEdges].map((k): [string, string] => k.split(">") as [string, string]),
        )
      ) {
        expect(layout.backEdges, label).toEqual([]);
      }

      // layers are exactly the longest paths, and every remaining edge points strictly right
      const expectedLayers = longestPathLayers(ids, rest);
      const layerById = new Map(layout.placements.map((p) => [p.id, p.layer]));
      for (const id of ids)
        expect(layerById.get(id), `${label}: ${id}`).toBe(expectedLayers.get(id));
      for (const [from, to] of rest) {
        expect(layerById.get(to) as number, label).toBeGreaterThan(layerById.get(from) as number);
      }

      // rows in each layer are sorted by category rank, category, then id
      const rank = new Map<string, number>();
      order.forEach((c, i) => {
        if (!rank.has(c)) rank.set(c, i);
      });
      const rankOf = (id: string): number =>
        rank.get(nodes.find((x) => x.id === id)?.category ?? "") ?? order.length;
      const categoryOf = (id: string): string => nodes.find((x) => x.id === id)?.category ?? "";
      for (const layer of size.keys()) {
        const inRowOrder = layout.placements
          .filter((p) => p.layer === layer)
          .sort((a, b) => a.row - b.row)
          .map((p) => p.id);
        const expected = [...inRowOrder].sort(
          (a, b) =>
            rankOf(a) - rankOf(b) || compareText(categoryOf(a), categoryOf(b)) || compareText(a, b),
        );
        expect(inRowOrder, `${label}: layer ${String(layer)}`).toEqual(expected);
      }
    }
  });
});

describe("the real graph", () => {
  const real = parseGraph(graphJson);
  const layout = layoutGraph(real, { categoryOrder: CATEGORIES });
  const layerOf = (id: string): number => layout.placements.find((p) => p.id === id)?.layer ?? -1;

  it("has no cycle, so no back edge", () => {
    expect(layout.backEdges).toEqual([]);
  });

  it.each([
    ["fed_rate", 0],
    ["productivity", 0],
    ["worker_bargaining_power", 0],
    ["hate_crimes", 0],
    ["inflation", 1],
    ["gdp_growth", 1],
    ["net_interest", 1],
    ["real_avg_hourly_earnings", 2],
    ["savings_rate", 3],
    ["median_household_income", 3],
    ["poverty_rate", 4],
    ["food_insecurity", 5],
    ["homelessness", 5],
  ])("puts %s in layer %s", (id, expected) => {
    expect(layerOf(id)).toBe(expected);
  });

  it("puts every edge strictly left to right", () => {
    for (const e of real.edges) expect(layerOf(e.to), e.id).toBeGreaterThan(layerOf(e.from));
  });

  it("places every node once, with no overlap, inside bounds that follow the defaults", () => {
    expect(layout.placements.map((p) => p.id)).toEqual(real.nodes.map((n) => n.id).sort());
    const { nodeWidth, nodeHeight, columnGap, rowGap } = DEFAULT_LAYOUT_OPTIONS;
    expect(layout.width).toBe(layout.layers * nodeWidth + (layout.layers - 1) * columnGap);
    expect(layout.height).toBe(layout.rows * nodeHeight + (layout.rows - 1) * rowGap);
    for (const a of layout.placements) {
      for (const b of layout.placements) {
        if (a.id >= b.id) continue;
        const apart =
          a.x + nodeWidth <= b.x ||
          b.x + nodeWidth <= a.x ||
          a.y + nodeHeight <= b.y ||
          b.y + nodeHeight <= a.y;
        expect(apart, `${a.id} and ${b.id}`).toBe(true);
      }
    }
  });

  it("orders each layer by the schema's category order", () => {
    const categoryOf = new Map(real.nodes.map((n) => [n.id, n.category as string]));
    const rank = (id: string): number =>
      CATEGORIES.indexOf(categoryOf.get(id) as (typeof CATEGORIES)[number]);
    for (let layer = 0; layer < layout.layers; layer++) {
      const ranks = layout.placements
        .filter((p) => p.layer === layer)
        .sort((a, b) => a.row - b.row)
        .map((p) => rank(p.id));
      expect(ranks, `layer ${String(layer)}`).toEqual([...ranks].sort((a, b) => a - b));
    }
  });

  it("matches an independent longest-path calculation for every node", () => {
    const ids = real.nodes.map((n) => n.id);
    const expected = longestPathLayers(
      ids,
      real.edges.map((e): [string, string] => [e.from, e.to]),
    );
    for (const id of ids) expect(layerOf(id), id).toBe(expected.get(id));
  });

  it("gives the same layout however the nodes and edges are ordered", () => {
    const rand = mulberry32(3);
    for (let i = 0; i < 20; i++) {
      const rearranged = { nodes: shuffled(real.nodes, rand), edges: shuffled(real.edges, rand) };
      expect(layoutGraph(rearranged, { categoryOrder: CATEGORIES })).toEqual(layout);
    }
  });
});
