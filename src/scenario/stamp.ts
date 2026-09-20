/**
 * The data stamp: a short fingerprint of the data that decides a scenario's numbers.
 *
 * A shared scenario link carries the stamp of the data it was made with. When a page built from
 * different edges opens the link, the stamps differ, and the interface can say that the link was made
 * with earlier data and its results may differ, instead of silently showing different numbers.
 *
 * This is an integrity signal and not a security control. FNV-1a is fast and simple and has no secret,
 * so anyone can craft a matching stamp. Nothing here relies on it for safety.
 *
 * The stamp covers exactly what changes the numbers: the format version, the propagation parameters,
 * the node ids, and each edge's id, direction and strength. It leaves out labels, claims, baselines,
 * confidence and display ranges, because editing a sentence must not make every old link look stale.
 * The fingerprinted text is a JSON document with a fixed key order and sorted arrays, so it does not
 * depend on the order in which nodes or edges arrive, and it needs no delimiter that an id could
 * contain. The hash is over the UTF-8 bytes of that text.
 */
import { DEFAULT_PARAMS } from "../lib/propagation";
import type { PropagationGraph, PropagationParams } from "../lib/propagation";
import { SCENARIO_VERSION } from "./url";

const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/** FNV-1a, 32 bits, over the UTF-8 bytes of the text, as eight lowercase hexadecimal digits. */
export function fnv1a32(text: string): string {
  let hash = FNV_OFFSET_BASIS;
  for (const byte of new TextEncoder().encode(text)) {
    hash ^= byte;
    hash = Math.imul(hash, FNV_PRIME);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** The stamp of a graph and the parameters that turn it into numbers. */
export function dataStamp(
  graph: PropagationGraph,
  params: PropagationParams = DEFAULT_PARAMS,
): string {
  const nodes = graph.nodes.map((node) => node.id).sort();
  const edges = [...graph.edges]
    .sort((a, b) => (a.id < b.id ? -1 : 1))
    .map((edge) => [edge.id, edge.direction, edge.strength]);
  return fnv1a32(
    JSON.stringify({
      v: SCENARIO_VERSION,
      maxHops: params.maxHops,
      decay: params.decay,
      nodes,
      edges,
    }),
  );
}
