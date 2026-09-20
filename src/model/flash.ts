/**
 * When a node flashes. This module decides WHEN, and never how a flash looks.
 *
 * The interface flashes a node once when its visible state changes, then leaves it in a settled
 * "changed" state. A node's visible state is its direction and its bucket. It flashes when:
 *
 *   - it becomes visible, meaning it was negligible or absent and now is not, or
 *   - its direction flips, or
 *   - its bucket changes.
 *
 * It does not flash on a smaller change inside the same bucket, which is what stops a slider drag
 * from strobing. It never flashes when it settles back to negligible or leaves the effects, for
 * example after a reset. And a scenario loaded from a link starts from initialFlashState, which
 * flashes nothing, so opening a link does not animate the whole page.
 *
 * Each node has a key that increases by one at each flash and never decreases. The interface
 * restarts a node's CSS animation when its key changes. Keys are never reused, because a repeated
 * key would silently swallow a real flash.
 *
 * Pure: the previous state is never mutated, and the result does not depend on the order of the
 * effects.
 */
import { bucketOf } from "./buckets";
import type { Bucket } from "./buckets";

export interface NodeVisual {
  readonly direction: "up" | "down";
  readonly bucket: Exclude<Bucket, "negligible">;
}

export interface FlashState {
  /** The visible state of every node that is not negligible. Absent means negligible. */
  readonly visuals: ReadonlyMap<string, NodeVisual>;
  /** The flash key of every node that has ever flashed. Absent means 0. */
  readonly keys: ReadonlyMap<string, number>;
}

export interface FlashStep {
  readonly state: FlashState;
  /** The ids of the nodes whose key increased in this step, sorted. */
  readonly flashed: readonly string[];
}

interface EffectLike {
  readonly nodeId: string;
  readonly delta: number;
}

/** The visible state for a clamped delta, or undefined when it is negligible. */
export function visualOf(delta: number): NodeVisual | undefined {
  const bucket = bucketOf(delta);
  if (bucket === "negligible") return undefined;
  return { direction: delta > 0 ? "up" : "down", bucket };
}

function sortedById(effects: readonly EffectLike[]): EffectLike[] {
  return [...effects].sort((a, b) => (a.nodeId < b.nodeId ? -1 : 1));
}

/** The state for a scenario that is already showing, such as one just loaded from a link. */
export function initialFlashState(effects: readonly EffectLike[]): FlashState {
  const visuals = new Map<string, NodeVisual>();
  for (const effect of sortedById(effects)) {
    const visual = visualOf(effect.delta);
    if (visual !== undefined) visuals.set(effect.nodeId, visual);
  }
  return { visuals, keys: new Map() };
}

/** The state after the effects change, and which nodes flash because of it. */
export function nextFlashState(previous: FlashState, effects: readonly EffectLike[]): FlashStep {
  const visuals = new Map<string, NodeVisual>();
  const keys = new Map(previous.keys);
  const flashed: string[] = [];
  for (const effect of sortedById(effects)) {
    const visual = visualOf(effect.delta);
    if (visual === undefined) continue;
    visuals.set(effect.nodeId, visual);
    const before = previous.visuals.get(effect.nodeId);
    if (
      before === undefined ||
      before.direction !== visual.direction ||
      before.bucket !== visual.bucket
    ) {
      keys.set(effect.nodeId, (keys.get(effect.nodeId) ?? 0) + 1);
      flashed.push(effect.nodeId);
    }
  }
  return { state: { visuals, keys }, flashed };
}
