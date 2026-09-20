import { describe, expect, it } from "vitest";
import graphJson from "../data/graph.json";
import { parseGraph } from "../lib/validate";
import { dataStamp } from "../scenario/stamp";
import { changeLever, clearRuntime, createRuntime, scenarioLocation } from "./runtime";

const graph = parseGraph(graphJson);
const stamp = dataStamp(graph);

describe("UI scenario runtime", () => {
  it("loads an existing scenario without flashing every affected node", () => {
    const runtime = createRuntime(graph, new Map([["fed_rate", 0.5]]));
    expect(runtime.levers.get("fed_rate")).toBe(0.5);
    expect(runtime.effects.length).toBeGreaterThan(1);
    expect(runtime.flash.visuals.size).toBeGreaterThan(0);
    expect(runtime.flash.keys.size).toBe(0);
  });

  it("changes one lever, removes zero, and advances flash keys only through the model rule", () => {
    const empty = createRuntime(graph, new Map());
    const moved = changeLever(graph, empty, "fed_rate", 0.2);
    expect(moved.levers.get("fed_rate")).toBe(0.2);
    expect(moved.flash.keys.get("fed_rate")).toBe(1);

    const sameBucket = changeLever(graph, moved, "fed_rate", 0.25);
    expect(sameBucket.flash.keys.get("fed_rate")).toBe(1);

    const removed = changeLever(graph, sameBucket, "fed_rate", 0);
    expect(removed.levers.has("fed_rate")).toBe(false);
    expect(removed.flash.visuals.size).toBe(0);
    expect(removed.flash.keys.get("fed_rate")).toBe(1);
  });

  it("clears a scenario without creating a new flash", () => {
    const moved = changeLever(graph, createRuntime(graph, new Map()), "fed_rate", 0.5);
    const cleared = clearRuntime(moved);
    expect(cleared.levers.size).toBe(0);
    expect(cleared.effects).toEqual([]);
    expect(cleared.flash.visuals.size).toBe(0);
    expect(cleared.flash.keys).toEqual(moved.flash.keys);
  });

  it("writes a canonical scenario URL while preserving path and hash, and cleans an empty scenario", () => {
    expect(scenarioLocation("/lab", "#graph", new Map([["fed_rate", 0.5]]), stamp)).toBe(
      `/lab?v=1&d=${stamp}&l=fed_rate:50#graph`,
    );
    expect(scenarioLocation("/lab", "#graph", new Map(), stamp)).toBe("/lab#graph");
  });
});
