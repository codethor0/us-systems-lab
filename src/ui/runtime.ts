import type { Graph } from "../lib/schema";
import { combineEffects } from "../model/effects";
import type { ScenarioEffect } from "../model/effects";
import { initialFlashState, nextFlashState } from "../model/flash";
import type { FlashState } from "../model/flash";
import { encodeScenario } from "../scenario/url";

export interface UiRuntime {
  readonly levers: ReadonlyMap<string, number>;
  readonly effects: readonly ScenarioEffect[];
  readonly flash: FlashState;
}

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

export function createRuntime(graph: Graph, levers: ReadonlyMap<string, number>): UiRuntime {
  const copied = new Map(levers);
  const effects = combineEffects(graph, copied);
  return { levers: copied, effects, flash: initialFlashState(effects) };
}

export function changeLever(
  graph: Graph,
  previous: UiRuntime,
  nodeId: string,
  value: number,
): UiRuntime {
  const levers = new Map(previous.levers);
  if (value === 0) levers.delete(nodeId);
  else levers.set(nodeId, value);
  const effects = combineEffects(graph, levers);
  return {
    levers,
    effects,
    flash: nextFlashState(previous.flash, effects).state,
  };
}

export function clearRuntime(previous: UiRuntime): UiRuntime {
  return {
    levers: new Map(),
    effects: [],
    flash: nextFlashState(previous.flash, []).state,
  };
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
