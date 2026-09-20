/**
 * Effects of a scenario: several levers moved at once.
 *
 * propagate handles one lever. A scenario sets several, and the rule for combining them is
 * superposition with a single clamp at the end:
 *
 *   total(v) = own(v) + the sum, over every lever on another node, of that lever's UNCLAMPED
 *              propagated value at v
 *   delta(v) = clamp(total(v), -1, 1)
 *
 * own(v) is the lever set on v itself, or 0. A lever set to exactly 0 counts as not set. Adding the
 * unclamped values and clamping once means that a large effect from one lever and an opposing
 * effect from another cancel as arithmetic says they should, instead of the clamp hiding part of
 * one of them first. Like the rest of the model, this is arithmetic on assigned weights and not an
 * estimate of anything.
 *
 * The lever map is a Map, and every accumulator here is a Map, so a node id that happens to match
 * an Object property, such as "constructor", is an ordinary key.
 *
 * Deterministic: sources are added in ascending id order, contributions are listed in that order and
 * then in propagate's traversal order, and the result is sorted by node id, compared by UTF-16 code
 * unit. The same graph, levers and parameters give the same output, bit for bit, whatever order the
 * edges, nodes and lever map arrive in.
 */
import { DEFAULT_PARAMS, propagate } from "../lib/propagation";
import type { PropagationGraph, PropagationParams } from "../lib/propagation";

/** One simple path that carried some of a lever's effect to a node. */
export interface SourceContribution {
  readonly sourceId: string;
  readonly edgeIds: readonly string[];
  readonly value: number;
}

export interface ScenarioEffect {
  readonly nodeId: string;
  /** The lever set on this node, or 0. */
  readonly own: number;
  /** The sum of the unclamped propagated values arriving from other levers. */
  readonly propagated: number;
  /** own + propagated, before the clamp. */
  readonly total: number;
  /** total clamped to [-1, 1]. */
  readonly delta: number;
  /** Every route from another lever, by source id and then in traversal order. */
  readonly contributions: readonly SourceContribution[];
}

interface Accumulator {
  own: number;
  propagated: number;
  contributions: SourceContribution[];
}

/**
 * Every node with a lever set to a nonzero value, or reached by at least one path from one,
 * sorted by node id. Throws RangeError for a lever on an unknown node or outside [-1, 1], zero
 * levers included.
 */
export function combineEffects(
  graph: PropagationGraph,
  levers: ReadonlyMap<string, number>,
  params: PropagationParams = DEFAULT_PARAMS,
): ScenarioEffect[] {
  const nodeIds = new Set(graph.nodes.map((node) => node.id));
  for (const [id, value] of levers) {
    if (!nodeIds.has(id))
      throw new RangeError(`lever on "${id}", which is not a node of the graph`);
    if (!(Math.abs(value) <= 1)) {
      throw new RangeError(`lever on "${id}" must be in [-1, 1], got ${String(value)}`);
    }
  }

  const accumulators = new Map<string, Accumulator>();
  const slot = (id: string): Accumulator => {
    const existing = accumulators.get(id);
    if (existing !== undefined) return existing;
    const created: Accumulator = { own: 0, propagated: 0, contributions: [] };
    accumulators.set(id, created);
    return created;
  };

  const sources = [...levers]
    .filter(([, value]) => value !== 0)
    .sort((a, b) => (a[0] < b[0] ? -1 : 1));
  for (const [sourceId, lever] of sources) {
    slot(sourceId).own = lever;
    for (const effect of propagate(graph, sourceId, lever, params)) {
      const target = slot(effect.nodeId);
      target.propagated += effect.raw;
      for (const contribution of effect.contributions) {
        target.contributions.push({
          sourceId,
          edgeIds: contribution.edgeIds,
          value: contribution.value,
        });
      }
    }
  }

  return [...accumulators.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([nodeId, accumulator]) => {
      const total = accumulator.own + accumulator.propagated;
      return {
        nodeId,
        own: accumulator.own,
        propagated: accumulator.propagated,
        total,
        delta: Math.max(-1, Math.min(1, total)),
        contributions: accumulator.contributions,
      };
    });
}
