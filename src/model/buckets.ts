/**
 * Buckets: what the interface shows in place of a number.
 *
 * A propagated value is arithmetic on assigned weights, so showing "0.3189" would claim a precision
 * the model does not have. The interface shows a direction and a coarse size instead. The thresholds
 * are editorial. They are a starting point that can be tuned, and they are not derived from anything.
 * By magnitude: below 0.05 is negligible, 0.05 up to 0.15 is small, 0.15 up to 0.4 is moderate, and
 * 0.4 and above is large.
 *
 * A negligible change has no direction, so a tiny change is never drawn as an arrow.
 */

export const BUCKET_THRESHOLDS = { small: 0.05, moderate: 0.15, large: 0.4 } as const;

export type Bucket = "negligible" | "small" | "moderate" | "large";
export type Direction = "up" | "down" | "none";

/** The bucket of a clamped delta. Throws for anything that is not a number in [-1, 1]. */
export function bucketOf(delta: number): Bucket {
  if (!(Math.abs(delta) <= 1)) {
    throw new RangeError(`delta must be a number in [-1, 1], got ${String(delta)}`);
  }
  const size = Math.abs(delta);
  if (size < BUCKET_THRESHOLDS.small) return "negligible";
  if (size < BUCKET_THRESHOLDS.moderate) return "small";
  if (size < BUCKET_THRESHOLDS.large) return "moderate";
  return "large";
}

/** "up" or "down" by sign, or "none" when the change is negligible. */
export function directionOf(delta: number): Direction {
  if (bucketOf(delta) === "negligible") return "none";
  return delta > 0 ? "up" : "down";
}
