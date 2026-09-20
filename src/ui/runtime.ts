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
