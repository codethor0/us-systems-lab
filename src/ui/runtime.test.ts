import { describe, expect, it } from "vitest";
import graphJson from "../data/graph.json";
import { parseGraph } from "../lib/validate";
import { dataStamp } from "../scenario/stamp";
import { normalizeLeversForUi, scenarioLocation } from "./runtime";

const graph = parseGraph(graphJson);
const stamp = dataStamp(graph);

describe("UI scenario runtime", () => {
  it("snaps decoded values to the 10-percent slider grid, symmetric around zero", () => {
    const normalized = normalizeLeversForUi(
      new Map([
        ["fed_rate", 0.55],
        ["inflation", -0.55],
        ["productivity", 0.54],
        ["poverty_rate", 0.56],
        ["unemployment", -0.54],
        ["gdp", -0.56],
        ["wages", 0.25],
        ["debt", -0.25],
        ["media_trust", 0.04],
        ["hate_crimes", -0.04],
        ["home_prices", 1],
        ["homelessness", -1],
      ]),
    );

    expect(normalized).toEqual(
      new Map([
        ["fed_rate", 0.6],
        ["inflation", -0.6],
        ["productivity", 0.5],
        ["poverty_rate", 0.6],
        ["unemployment", -0.5],
        ["gdp", -0.6],
        ["wages", 0.3],
        ["debt", -0.3],
        ["home_prices", 1],
        ["homelessness", -1],
      ]),
    );
  });

  it("writes a canonical scenario URL while preserving path and hash, and cleans an empty scenario", () => {
    expect(scenarioLocation("/lab", "#graph", new Map([["fed_rate", 0.5]]), stamp)).toBe(
      `/lab?v=1&d=${stamp}&l=fed_rate:50#graph`,
    );
    expect(scenarioLocation("/lab", "#graph", new Map(), stamp)).toBe("/lab#graph");
  });
});
