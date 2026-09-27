/**
 * Explanatory analysis on top of combineEffects. Nothing here is a second model: every number comes
 * from the production engine, run on a filtered graph or with other stated parameters.
 *
 * evidenceGraph keeps only edges whose confidence is "empirical", so an evidence-only view can never
 * use a modeled edge.
 *
 * sensitivity reruns a scenario under SENSITIVITY_SETTINGS, nine nearby choices of the two editorial
 * parameters (decay 0.5, 0.7 and 0.9; paths of up to 2, 3 and 4 relationships; the default 0.7 and 3
 * is one of them), and classifies each node's clamped score:
 *
 *   none       zero under every setting
 *   robust     the same sign under every setting
 *   partial    one sign where it moves, but zero under some settings, usually the shorter path limit
 *   direction  up under some settings and down under others
 *
 * A score within NOISE of zero counts as zero, so floating-point cancellation is never a direction.
 */
import type { PropagationEdge, PropagationGraph, PropagationParams } from "../lib/propagation";
import { combineEffects } from "./effects";

export const SENSITIVITY_SETTINGS: readonly PropagationParams[] = [2, 3, 4].flatMap((maxHops) =>
  [0.5, 0.7, 0.9].map((decay) => ({ maxHops, decay })),
);

/** Scores closer to zero than this are floating-point noise. */
const NOISE = 1e-12;

export type Robustness = "none" | "robust" | "partial" | "direction";

export interface NodeSensitivity {
  readonly nodeId: string;
  readonly robustness: Robustness;
  /** The lowest and highest clamped score over the settings. */
  readonly min: number;
  readonly max: number;
}

function clean(value: number): number {
  return Math.abs(value) < NOISE ? 0 : value;
}

/** The same nodes, with only the edges that carry a citation. The input is not changed. */
export function evidenceGraph<
  N,
  E extends PropagationEdge & { readonly confidence: string },
>(graph: {
  readonly nodes: readonly N[];
  readonly edges: readonly E[];
}): { nodes: N[]; edges: E[] } {
  return {
    nodes: [...graph.nodes],
    edges: graph.edges.filter((edge) => edge.confidence === "empirical"),
  };
}

export function sensitivity(
  graph: PropagationGraph,
  levers: ReadonlyMap<string, number>,
  settings: readonly PropagationParams[] = SENSITIVITY_SETTINGS,
): Map<string, NodeSensitivity> {
  const scores = new Map<string, number[]>(
    [...graph.nodes].sort((a, b) => (a.id < b.id ? -1 : 1)).map((node) => [node.id, []]),
  );
  for (const params of settings) {
    const deltas = new Map(
      combineEffects(graph, levers, params).map((effect) => [effect.nodeId, effect.delta]),
    );
    for (const [id, list] of scores) list.push(clean(deltas.get(id) ?? 0));
  }
  const result = new Map<string, NodeSensitivity>();
  for (const [nodeId, list] of scores) {
    const up = list.some((score) => score > 0);
    const down = list.some((score) => score < 0);
    const zero = list.some((score) => score === 0);
    const robustness: Robustness =
      up && down ? "direction" : !up && !down ? "none" : zero ? "partial" : "robust";
    result.set(nodeId, {
      nodeId,
      robustness,
      min: Math.min(...list) + 0,
      max: Math.max(...list) + 0,
    });
  }
  return result;
}

export interface ComparedNode {
  readonly nodeId: string;
  readonly a: number;
  readonly b: number;
  readonly change: number;
}

/** Scenario A against B (usually the current inputs), node by node, in the order given. */
export function compareDeltas(
  nodeIds: readonly string[],
  a: ReadonlyMap<string, number>,
  b: ReadonlyMap<string, number>,
): { entries: ComparedNode[]; changed: number } {
  const entries = nodeIds.map((nodeId) => {
    const before = a.get(nodeId) ?? 0;
    const after = b.get(nodeId) ?? 0;
    return { nodeId, a: before, b: after, change: clean(after - before) };
  });
  return { entries, changed: entries.filter((entry) => entry.change !== 0).length };
}
