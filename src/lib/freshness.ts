/**
 * Freshness heuristic for stored baselines. Pure: no I/O and no clock; the caller passes today.
 *
 * Each observed or projected node records how often its publisher releases a new figure
 * (`cadence`). A baseline is flagged "check" when more time has passed since the end of its period
 * than a release usually takes at that cadence, so a newer figure has probably been published. Age
 * alone does not show that a value is wrong, and a fresh date does not catch revisions to the same
 * period, such as a third GDP estimate. The report says where to look; a person reads the source.
 */
import type { Cadence } from "./schema";

/**
 * Days after the end of a period by which the next release has usually appeared. Annual series are
 * slow: a 2024 survey is often published late in 2025 and replaced late in 2026, so two years pass
 * before an annual figure is overdue.
 */
export const DUE_AFTER_DAYS: Readonly<Record<Cadence, number>> = {
  daily: 3,
  weekly: 9,
  monthly: 50,
  quarterly: 120,
  irregular: 60,
  annual: 730,
};

export type FreshnessStatus = "current" | "check" | "not_applicable";

export interface Freshness {
  readonly status: FreshnessStatus;
  /**
   * Whole days from the end of the baseline period to today, and 0 while the period is still open,
   * as for a projection of the current fiscal year; null when not applicable.
   */
  readonly ageDays: number | null;
  readonly dueAfterDays: number | null;
}

const DAY_MS = 86_400_000;

/** The last day of the period an asOf string names, as a UTC timestamp, or null if unparsable. */
export function periodEnd(asOf: string): number | null {
  let match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(asOf);
  if (match) return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  match = /^(\d{4})-(\d{2})$/.exec(asOf);
  if (match) return Date.UTC(Number(match[1]), Number(match[2]), 0);
  match = /^(\d{4})-Q([1-4])$/.exec(asOf);
  if (match) return Date.UTC(Number(match[1]), Number(match[2]) * 3, 0);
  match = /^FY(\d{4})$/.exec(asOf);
  if (match) return Date.UTC(Number(match[1]), 8, 30);
  match = /^(\d{4})$/.exec(asOf);
  if (match) return Date.UTC(Number(match[1]), 11, 31);
  return null;
}

export function freshness(
  node: { readonly asOf: string | null; readonly cadence: Cadence | null },
  today: string,
): Freshness {
  const end = node.asOf === null ? null : periodEnd(node.asOf);
  const now = periodEnd(today);
  if (node.cadence === null || end === null || now === null) {
    return { status: "not_applicable", ageDays: null, dueAfterDays: null };
  }
  const ageDays = Math.max(0, Math.round((now - end) / DAY_MS));
  const dueAfterDays = DUE_AFTER_DAYS[node.cadence];
  return { status: ageDays > dueAfterDays ? "check" : "current", ageDays, dueAfterDays };
}
