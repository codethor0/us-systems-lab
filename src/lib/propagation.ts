/**
 * Causal propagation for the systems graph.
 *
 * Pure functions: no I/O, no randomness, no clock, and no mutation of the input.
 * This file is illustrative arithmetic for exploring interconnection. It is not
 * an economic model and it does not forecast anything.
 *
 * FORMULA
 *
 *   The user sets a lever on one source node, a number in [-1, 1] that means a
 *   fraction of that node's editorial display range. For a simple path of k edges
 *   e1..ek from the source to a node v, the contribution to v is
 *
 *     lever * (direction_1 * strength_1) * ... * (direction_k * strength_k)
 *           * decay^(k - 1)
 *
 *   direction is +1 or -1 and strength is in (0, 1]. A path of one edge gets no
 *   decay. A simple path never revisits a node, and the source counts as visited.
 *   Only paths of 1 to maxHops edges are walked. Then
 *
 *     raw(v)   = the sum of the contributions of every such path to v
 *     delta(v) = clamp(raw(v), -1, 1)
 *
 *   Summing over all paths means two routes to the same node add. That is a
 *   modelling choice, not a fact about the world. The default decay of 0.7 is a
 *   starting point with no empirical basis.
 *
 * PROPERTIES
 *
 *   1. Bounded. Every delta lies in [-1, 1].
 *      Let P(v) be the set of simple paths of at most maxHops edges from the
 *      source to v. A simple path is a sequence of distinct nodes, so P(v) is
 *      finite. Input validation guarantees |lever| <= 1, |direction| = 1,
 *      0 < strength <= 1 and 0 < decay <= 1, so each factor has magnitude at most
 *      1, and each contribution has magnitude at most |lever|. That holds in
 *      floating point too, because rounding is monotone and cannot push a product
 *      with a factor of magnitude at most 1 above the other factor. Hence
 *      |raw(v)| <= |P(v)| * |lever|, which is finite (up to rounding in the sum).
 *      delta(v) is clamp(raw(v), -1, 1), so |delta(v)| <= 1 by the definition of
 *      the clamp. The bound on the output comes from the clamp. Decay does not
 *      guarantee it; decay only makes the clamp engage less often. No induction on
 *      hop count is needed. The source itself keeps the lever, which is within
 *      [-1, 1] by validation.
 *
 *   2. Terminating. The walk halts on every graph, including cyclic ones.
 *      The recursion adds one edge per level and stops at maxHops, so its depth is
 *      at most maxHops. Each level loops over a finite list of outgoing edges, so
 *      the number of calls is at most the sum of D^k for k = 0..maxHops, where D
 *      is the largest out-degree. The hop limit alone guarantees this. The
 *      no-revisit rule is not needed for termination. It changes what is
 *      computed, because a feedback loop is not counted again, and not whether the
 *      function halts. maxHops is capped at MAX_HOPS_LIMIT so that the O(D^maxHops)
 *      cost stays bounded.
 *
 *   3. Deterministic. The same graph, source, lever and parameters always give the
 *      same output, bit for bit, whatever order the nodes and edges arrive in.
 *      Edges are sorted by id, compared by UTF-16 code unit and never by locale,
 *      before any traversal. Edge ids are unique (validated), so that order is
 *      total. The walk visits edges in that order, raw(v) accumulates in that
 *      order, and the output is sorted by node id. Floating-point addition is not
 *      associative, so a fixed order is what makes the sums reproducible.
 *
 *   4. Linear before the clamp. Each contribution is the lever times a factor that
 *      does not depend on the lever, so raw(k * lever) = k * raw(lever). This is
 *      exact in floating point when k is a power of two. The clamp is the only
 *      nonlinear step.
 *
 * WHAT THIS DOES NOT SHOW
 *
 *   Nothing here shows that any causal relationship is real, or that any strength
 *   is the right one. Those are empirical and political questions. The edge
 *   labels "empirical" and "modeled" in the data record how well each edge is
 *   supported. This module treats every edge the same.
 */

export interface PropagationParams {
  readonly maxHops: number;
  readonly decay: number;
}

export const DEFAULT_PARAMS: PropagationParams = { maxHops: 3, decay: 0.7 };

/** Upper bound on maxHops, which keeps the O(D^maxHops) walk bounded. */
export const MAX_HOPS_LIMIT = 8;

export interface PropagationEdge {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  readonly direction: number;
  readonly strength: number;
}

export interface PropagationGraph {
  readonly nodes: readonly { readonly id: string }[];
  readonly edges: readonly PropagationEdge[];
}

/** One simple path to a node and what it contributed. */
export interface PathContribution {
  readonly edgeIds: readonly string[];
  readonly value: number;
}

export interface NodeEffect {
  readonly nodeId: string;
  /** The sum of the contributions, before the clamp. */
  readonly raw: number;
  /** raw clamped to [-1, 1]. */
  readonly delta: number;
  /** Every simple path to this node, in traversal order. */
  readonly contributions: readonly PathContribution[];
}

/** Adding zero turns -0 into +0 and leaves every other number unchanged. */
function noNegativeZero(value: number): number {
  return value + 0;
}

/**
 * Adds the contributions in the order given. No contribution is -0 (each is normalized
 * where it is computed), and a sum of numbers none of which is -0 is never -0, because
 * x + (-x) is +0 in round-to-nearest. So raw and delta need no further normalization.
 */
function sumInOrder(contributions: readonly PathContribution[]): number {
  return contributions.reduce((sum, c) => sum + c.value, 0);
}

/** Edge ids are unique (validated first), so two edges never compare equal. */
function compareEdgesById(a: PropagationEdge, b: PropagationEdge): number {
  return a.id < b.id ? -1 : 1;
}

/** The entries of a map, sorted by key. Keys of a map are unique, so none compare equal. */
function sortedEntries<T>(map: ReadonlyMap<string, T>): [string, T][] {
  return [...map.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
}

function validateInputs(
  graph: PropagationGraph,
  sourceId: string,
  lever: number,
  params: PropagationParams,
): void {
  if (!(Math.abs(lever) <= 1)) {
    throw new RangeError(`lever must be a number in [-1, 1], got ${String(lever)}`);
  }
  if (!Number.isInteger(params.maxHops) || params.maxHops < 1 || params.maxHops > MAX_HOPS_LIMIT) {
    throw new RangeError(
      `maxHops must be an integer from 1 to ${String(MAX_HOPS_LIMIT)}, got ${String(params.maxHops)}`,
    );
  }
  if (!(params.decay > 0 && params.decay <= 1)) {
    throw new RangeError(`decay must be in (0, 1], got ${String(params.decay)}`);
  }

  const nodeIds = new Set(graph.nodes.map((node) => node.id));
  if (!nodeIds.has(sourceId)) {
    throw new RangeError(`source "${sourceId}" is not a node of the graph`);
  }
  const edgeIds = new Set<string>();
  for (const edge of graph.edges) {
    if (edgeIds.has(edge.id)) {
      throw new RangeError(`duplicate edge id "${edge.id}"`);
    }
    edgeIds.add(edge.id);
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) {
      throw new RangeError(`edge "${edge.id}" refers to a node the graph does not contain`);
    }
    if (edge.direction !== 1 && edge.direction !== -1) {
      throw new RangeError(`edge "${edge.id}" direction must be 1 or -1`);
    }
    if (!(edge.strength > 0 && edge.strength <= 1)) {
      throw new RangeError(`edge "${edge.id}" strength must be in (0, 1]`);
    }
  }
}

/** Walks every simple path of 1..maxHops edges and groups the contributions by end node. */
function collectContributions(
  graph: PropagationGraph,
  sourceId: string,
  lever: number,
  params: PropagationParams,
): Map<string, PathContribution[]> {
  const outgoing = new Map<string, PropagationEdge[]>();
  for (const edge of [...graph.edges].sort(compareEdgesById)) {
    const list = outgoing.get(edge.from);
    if (list === undefined) outgoing.set(edge.from, [edge]);
    else list.push(edge);
  }

  const found = new Map<string, PathContribution[]>();
  const visited = new Set<string>([sourceId]);
  const path: string[] = [];

  const extend = (node: string, product: number): void => {
    for (const edge of outgoing.get(node) ?? []) {
      if (visited.has(edge.to)) continue;

      const signed = product * edge.direction * edge.strength;
      path.push(edge.id);
      const hops = path.length;
      const value = noNegativeZero(lever * signed * Math.pow(params.decay, hops - 1));

      const list = found.get(edge.to);
      const contribution: PathContribution = { edgeIds: [...path], value };
      if (list === undefined) found.set(edge.to, [contribution]);
      else list.push(contribution);

      if (hops < params.maxHops) {
        visited.add(edge.to);
        extend(edge.to, signed);
        visited.delete(edge.to);
      }
      path.pop();
    }
  };
  extend(sourceId, 1);
  return found;
}

/** The unclamped sum for every node reached by at least one path. The source is never listed. */
export function propagateRaw(
  graph: PropagationGraph,
  sourceId: string,
  lever: number,
  params: PropagationParams = DEFAULT_PARAMS,
): Map<string, number> {
  validateInputs(graph, sourceId, lever, params);
  const found = collectContributions(graph, sourceId, lever, params);
  const raw = new Map<string, number>();
  for (const [nodeId, contributions] of sortedEntries(found)) {
    raw.set(nodeId, sumInOrder(contributions));
  }
  return raw;
}

/**
 * Every node reached by at least one path, sorted by node id, with the raw sum, the
 * clamped delta, and the contributions behind them. A node whose paths cancel is
 * still listed, with a delta of 0.
 */
export function propagate(
  graph: PropagationGraph,
  sourceId: string,
  lever: number,
  params: PropagationParams = DEFAULT_PARAMS,
): NodeEffect[] {
  validateInputs(graph, sourceId, lever, params);
  const found = collectContributions(graph, sourceId, lever, params);
  return sortedEntries(found).map(([nodeId, contributions]) => {
    const raw = sumInOrder(contributions);
    const delta = Math.max(-1, Math.min(1, raw));
    return { nodeId, raw, delta, contributions };
  });
}

/**
 * Joins edge ids with U+0000, which sorts below every character an id can contain, so
 * comparing two keys of equal-length sequences orders them lexicographically, id by id.
 */
function sequenceKey(edgeIds: readonly string[]): string {
  return edgeIds.join("\u0000");
}

/**
 * The candidate that most explains an effect, for the "why" label. The largest magnitude
 * wins. Ties go to the path with fewer edges, then to the lower edge id sequence, so the
 * choice is deterministic and does not depend on the order of the list. It is generic so
 * that a caller whose contributions carry more fields, such as the lever they came from,
 * gets back the very object it passed in.
 */
export function strongestOf<T extends PathContribution>(candidates: readonly T[]): T | undefined {
  let best: T | undefined;
  for (const candidate of candidates) {
    if (best === undefined) {
      best = candidate;
      continue;
    }
    const byMagnitude = Math.abs(candidate.value) - Math.abs(best.value);
    if (byMagnitude > 0) best = candidate;
    else if (byMagnitude === 0) {
      const byLength = candidate.edgeIds.length - best.edgeIds.length;
      if (byLength < 0) best = candidate;
      else if (byLength === 0 && sequenceKey(candidate.edgeIds) < sequenceKey(best.edgeIds)) {
        best = candidate;
      }
    }
  }
  return best;
}

/** The contribution that most explains a node's effect. See strongestOf. */
export function strongestContribution(effect: NodeEffect): PathContribution | undefined {
  return strongestOf(effect.contributions);
}
