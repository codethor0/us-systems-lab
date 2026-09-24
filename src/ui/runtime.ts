import { encodeScenario } from "../scenario/url";

const UI_LEVER_STEP_PERCENT = 10;

/**
 * Snap decoded scenario values onto the exact grid the range input can represent.
 * The URL decoder intentionally accepts every whole percent; this UI boundary keeps
 * that format contract intact while preventing the browser from displaying a different
 * thumb value than the model, label, or canonical scenario URL.
 */
export function normalizeLeversForUi(levers: ReadonlyMap<string, number>): Map<string, number> {
  const normalized = new Map<string, number>();
  for (const [id, value] of levers) {
    // Recover the whole percent first: -0.55 * 100 is -55.00000000000001 in binary floating point.
    const whole = Math.round(value * 100);
    // Snap half away from zero so +55 and -55 are mirror images (Math.round alone rounds -5.5 to -5).
    const percent =
      Math.sign(whole) *
      Math.round(Math.abs(whole) / UI_LEVER_STEP_PERCENT) *
      UI_LEVER_STEP_PERCENT;
    if (percent !== 0) normalized.set(id, percent / 100);
  }
  return normalized;
}

/** A lever a link set between input steps, and the value the board applied instead. */
export interface LeverAdjustment {
  readonly id: string;
  /** The whole percent the link asked for, from -100 to 100. */
  readonly requested: number;
  /** The whole percent applied after snapping to the input grid; 0 means the input was cleared. */
  readonly applied: number;
}

/**
 * Every lever whose value changed when it was snapped onto the input grid, in the order the link
 * listed them. The snap itself is unchanged; this only makes it visible to the person who opened
 * the link, so a shared scenario is never silently different from the one that was sent.
 */
export function leverAdjustments(
  requested: ReadonlyMap<string, number>,
  applied: ReadonlyMap<string, number>,
): LeverAdjustment[] {
  const adjustments: LeverAdjustment[] = [];
  for (const [id, value] of requested) {
    const from = Math.round(value * 100);
    const to = Math.round((applied.get(id) ?? 0) * 100);
    if (from !== to) adjustments.push({ id, requested: from, applied: to });
  }
  return adjustments;
}

/** A lever percent as the 0..100 input position the person sees on the slider. */
function inputPosition(percent: number): string {
  return String(50 + percent / 2);
}

/** One notice sentence naming every rounded input, with the requested and the applied position. */
export function adjustmentMessage(
  adjustments: readonly LeverAdjustment[],
  labels: ReadonlyMap<string, string>,
): string {
  const items = adjustments.map((item) => {
    const neutral = item.applied === 0 ? " (neutral)" : "";
    return `${labels.get(item.id) ?? item.id} ${inputPosition(item.requested)}/100 to ${inputPosition(item.applied)}/100${neutral}`;
  });
  const one = adjustments.length === 1;
  return `This link has ${one ? "a value" : "values"} between the input steps of 5, so ${one ? "it was" : "they were"} rounded: ${items.join("; ")}.`;
}

export function scenarioLocation(
  pathname: string,
  hash: string,
  levers: ReadonlyMap<string, number>,
  stamp: string,
): string {
  if (levers.size === 0) return `${pathname}${hash}`;
  return `${pathname}${encodeScenario(levers, stamp)}${hash}`;
}
