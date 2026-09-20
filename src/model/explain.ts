/**
 * What the interface may say about an effect.
 *
 * A description has a headline made of a direction and a bucket and never a number, and a "why"
 * path: the strongest route by which the change arrived, with the confidence of every step on it.
 * The confidence is the edge's own label and is never left out or rounded up, so a route made of
 * modeled edges is described as modeled all the way along. The wording is pinned by tests, because
 * wording is where a model can quietly claim more than it knows.
 *
 * "moves with" and "moves against" describe the edge's direction and not the lever's: a lever
 * moved down makes the same edges move the other way, and the sentence stays true.
 */
import { strongestOf } from "../lib/propagation";
import type { Graph, GraphEdge } from "../lib/schema";
import { bucketOf, directionOf } from "./buckets";
import type { Bucket, Direction } from "./buckets";
import type { ScenarioEffect } from "./effects";

export interface WhyStep {
  readonly edgeId: string;
  readonly from: string;
  readonly to: string;
  readonly fromLabel: string;
  readonly toLabel: string;
  readonly relation: "same" | "opposite";
  readonly confidence: GraphEdge["confidence"];
}

export interface Why {
  readonly sourceId: string;
  readonly sourceLabel: string;
  /** The signed contribution of this route. Used to rank routes, and never shown. */
  readonly value: number;
  readonly steps: readonly WhyStep[];
}

export interface NodeDescription {
  readonly nodeId: string;
  readonly label: string;
  readonly direction: Direction;
  readonly bucket: Bucket;
  readonly headline: string;
  /** True when the user set a lever on this node. */
  readonly isLever: boolean;
  /** The strongest route from another lever, or null when none reaches this node. */
  readonly why: Why | null;
  readonly whyText: string | null;
  /** How many routes besides the strongest one also contribute. */
  readonly otherRoutes: number;
}

function need<T>(map: ReadonlyMap<string, T>, key: string, what: string): T {
  const found = map.get(key);
  if (found === undefined) throw new RangeError(`the graph has no ${what} "${key}"`);
  return found;
}

function whyText(why: Why, otherRoutes: number): string {
  const steps = why.steps
    .map((step) => {
      const verb = step.relation === "same" ? "moves with" : "moves against";
      return `${verb} ${step.toLabel} (${step.confidence})`;
    })
    .join(", then ");
  let others = "";
  if (otherRoutes === 1) others = " 1 other route also contributes.";
  else if (otherRoutes > 1) others = ` ${String(otherRoutes)} other routes also contribute.`;
  return `From ${why.sourceLabel}: ${steps}.${others}`;
}

/** Throws RangeError if the effect refers to a node or an edge that the graph does not contain. */
export function describeEffect(graph: Graph, effect: ScenarioEffect): NodeDescription {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const edges = new Map(graph.edges.map((edge) => [edge.id, edge]));
  const node = need(nodes, effect.nodeId, "node");
  const bucket = bucketOf(effect.delta);
  const direction = directionOf(effect.delta);
  const headline =
    bucket === "negligible"
      ? `${node.label}: no visible change`
      : `${node.label}: ${direction}, ${bucket}`;

  const best = strongestOf(effect.contributions);
  const why: Why | null =
    best === undefined
      ? null
      : {
          sourceId: best.sourceId,
          sourceLabel: need(nodes, best.sourceId, "node").label,
          value: best.value,
          steps: best.edgeIds.map((edgeId): WhyStep => {
            const edge = need(edges, edgeId, "edge");
            return {
              edgeId: edge.id,
              from: edge.from,
              to: edge.to,
              fromLabel: need(nodes, edge.from, "node").label,
              toLabel: need(nodes, edge.to, "node").label,
              relation: edge.direction === 1 ? "same" : "opposite",
              confidence: edge.confidence,
            };
          }),
        };
  const otherRoutes = why === null ? 0 : effect.contributions.length - 1;

  return {
    nodeId: effect.nodeId,
    label: node.label,
    direction,
    bucket,
    headline,
    isLever: effect.own !== 0,
    why,
    whyText: why === null ? null : whyText(why, otherRoutes),
    otherRoutes,
  };
}
