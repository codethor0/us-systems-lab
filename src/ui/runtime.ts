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

export function scenarioLocation(
  pathname: string,
  hash: string,
  levers: ReadonlyMap<string, number>,
  stamp: string,
): string {
  if (levers.size === 0) return `${pathname}${hash}`;
  return `${pathname}${encodeScenario(levers, stamp)}${hash}`;
}
