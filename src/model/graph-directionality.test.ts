import { describe, expect, it } from "vitest";
import graphJson from "../data/graph.json";
import { DEFAULT_PARAMS } from "../lib/propagation";
import { parseGraph } from "../lib/validate";
import { bucketOf, directionOf } from "./buckets";
import { combineEffects } from "./effects";

const graph = parseGraph(graphJson);
const edgeById = new Map(graph.edges.map((edge) => [edge.id, edge]));

function reachableBySimplePath(sourceId: string): Set<string> {
  const outgoing = new Map<string, typeof graph.edges>();
  for (const edge of graph.edges) {
    const current = outgoing.get(edge.from) ?? [];
    outgoing.set(edge.from, [...current, edge]);
  }

  const reached = new Set<string>();
  const walk = (nodeId: string, depth: number, visited: ReadonlySet<string>): void => {
    if (depth >= DEFAULT_PARAMS.maxHops) return;
    for (const edge of outgoing.get(nodeId) ?? []) {
      if (visited.has(edge.to)) continue;
      reached.add(edge.to);
      const next = new Set(visited);
      next.add(edge.to);
      walk(edge.to, depth + 1, next);
    }
  };

  walk(sourceId, 0, new Set([sourceId]));
  return reached;
}

function inverted(direction: ReturnType<typeof directionOf>): ReturnType<typeof directionOf> {
  if (direction === "up") return "down";
  if (direction === "down") return "up";
  return "none";
}

describe.each(graph.nodes.map((node) => [node.id] as const))(
  "single-lever graph contract: %s",
  (sourceId) => {
    it("is directional, bounded to simple outgoing paths, and sign-symmetric", () => {
      const plus = combineEffects(graph, new Map([[sourceId, 1]]));
      const minus = combineEffects(graph, new Map([[sourceId, -1]]));
      const plusByNode = new Map(plus.map((effect) => [effect.nodeId, effect]));
      const minusByNode = new Map(minus.map((effect) => [effect.nodeId, effect]));

      const expectedIds = reachableBySimplePath(sourceId);
      expectedIds.add(sourceId);
      expect(new Set(plusByNode.keys())).toEqual(expectedIds);
      expect(new Set(minusByNode.keys())).toEqual(expectedIds);

      const sourcePlus = plusByNode.get(sourceId);
      const sourceMinus = minusByNode.get(sourceId);
      expect(sourcePlus?.own).toBe(1);
      expect(sourceMinus?.own).toBe(-1);
      expect(sourcePlus?.propagated).toBe(0);
      expect(sourceMinus?.propagated).toBe(0);

      for (const nodeId of expectedIds) {
        const positive = plusByNode.get(nodeId);
        const negative = minusByNode.get(nodeId);
        expect(positive).toBeDefined();
        expect(negative).toBeDefined();
        if (positive === undefined || negative === undefined) continue;

        expect(negative.own).toBeCloseTo(-positive.own, 12);
        expect(negative.propagated).toBeCloseTo(-positive.propagated, 12);
        expect(negative.total).toBeCloseTo(-positive.total, 12);
        expect(negative.delta).toBeCloseTo(-positive.delta, 12);
        expect(bucketOf(negative.delta)).toBe(bucketOf(positive.delta));
        expect(directionOf(negative.delta)).toBe(inverted(directionOf(positive.delta)));
        expect(negative.contributions).toHaveLength(positive.contributions.length);

        for (const effect of [positive, negative]) {
          for (const contribution of effect.contributions) {
            expect(contribution.sourceId).toBe(sourceId);
            expect(contribution.edgeIds.length).toBeGreaterThan(0);
            expect(contribution.edgeIds.length).toBeLessThanOrEqual(DEFAULT_PARAMS.maxHops);

            let current = sourceId;
            const visited = new Set([sourceId]);
            for (const edgeId of contribution.edgeIds) {
              const edge = edgeById.get(edgeId);
              expect(edge).toBeDefined();
              if (edge === undefined) continue;
              expect(edge.from).toBe(current);
              expect(visited.has(edge.to)).toBe(false);
              current = edge.to;
              visited.add(current);
            }
            expect(current).toBe(nodeId);
          }
        }
      }
    });
  },
);

describe("directed-edge semantics", () => {
  it("never invents a reverse relationship when the graph has no directed return path", () => {
    for (const edge of graph.edges) {
      const reverseReachable = reachableBySimplePath(edge.to);
      if (reverseReachable.has(edge.from)) continue;
      const effects = combineEffects(graph, new Map([[edge.to, 1]]));
      expect(effects.some((effect) => effect.nodeId === edge.from)).toBe(false);
    }
  });
});
