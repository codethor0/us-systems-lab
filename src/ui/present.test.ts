import { describe, expect, it } from "vitest";
import type { GraphNode } from "../lib/schema";
import {
  formatBaseline,
  formatEditorialRange,
  leverLabel,
  leverPercent,
  scenarioParametersPresent,
} from "./present";

function node(overrides: Partial<GraphNode> = {}): GraphNode {
  return {
    id: "sample",
    label: "Sample",
    category: "economic",
    valueType: "observed",
    unit: "% YoY",
    baseline: 3.4,
    range: { min: 0, max: 10 },
    asOf: "2026-08",
    verification: "primary",
    sourceUrl: "https://example.com",
    sourceDetail: "Example",
    retrievedDate: "2026-09-19",
    description: "A sample node.",
    ...overrides,
  };
}

describe("presentation helpers", () => {
  it("formats ordinary, dollar, trillion-dollar, index and pending baselines without inventing data", () => {
    expect(formatBaseline(node())).toBe("3.4 % YoY");
    expect(formatBaseline(node({ baseline: 87460, unit: "$" }))).toBe("$87,460");
    expect(formatBaseline(node({ baseline: 18.8, unit: "$T" }))).toBe("$18.8T");
    expect(
      formatBaseline(node({ baseline: null, valueType: "index", unit: "index (0-100)" })),
    ).toBe("No measured baseline");
    expect(formatBaseline(node({ baseline: null, verification: "pending" }))).toBe(
      "Baseline pending",
    );
  });

  it("formats the editorial range as a display scale and not as a measurement", () => {
    expect(formatEditorialRange(node())).toBe("0 to 10 % YoY");
    expect(formatEditorialRange(node({ range: { min: 10, max: 25 }, unit: "$T" }))).toBe(
      "$10T to $25T",
    );
    expect(formatEditorialRange(node({ range: { min: 50000, max: 120000 }, unit: "$" }))).toBe(
      "$50,000 to $120,000",
    );
  });

  it("renders lever settings as signed whole percentages of the display range", () => {
    expect(leverPercent(0)).toBe(0);
    expect(leverPercent(0.5)).toBe(50);
    expect(leverPercent(-0.25)).toBe(-25);
    expect(leverLabel(0)).toBe("0% of display range");
    expect(leverLabel(0.5)).toBe("+50% of display range");
    expect(leverLabel(-0.25)).toBe("-25% of display range");
  });

  it("recognizes only scenario parameters, not unrelated query parameters", () => {
    expect(scenarioParametersPresent("")).toBe(false);
    expect(scenarioParametersPresent("?utm_source=test")).toBe(false);
    expect(scenarioParametersPresent("?v=1")).toBe(true);
    expect(scenarioParametersPresent("?d=24ecb4b5")).toBe(true);
    expect(scenarioParametersPresent("?l=fed_rate:50")).toBe(true);
  });
});
