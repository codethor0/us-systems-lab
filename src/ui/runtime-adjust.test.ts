import { describe, expect, it } from "vitest";
import { adjustmentMessage, leverAdjustments, normalizeLeversForUi } from "./runtime";

function adjust(entries: [string, number][]) {
  const requested = new Map(entries);
  return leverAdjustments(requested, normalizeLeversForUi(requested));
}

describe("shared-link rounding is made visible", () => {
  it("reports nothing for values already on the input grid", () => {
    expect(
      adjust([
        ["fed_rate", 0.6],
        ["gdp_growth", -1],
      ]),
    ).toEqual([]);
  });

  it("reports a value between steps with what was requested and what was applied", () => {
    expect(adjust([["fed_rate", 0.57]])).toEqual([{ id: "fed_rate", requested: 57, applied: 60 }]);
  });

  it("rounds halves away from zero and reports both signs as mirror images", () => {
    expect(
      adjust([
        ["a", 0.55],
        ["b", -0.55],
      ]),
    ).toEqual([
      { id: "a", requested: 55, applied: 60 },
      { id: "b", requested: -55, applied: -60 },
    ]);
  });

  it("reports an input that was rounded all the way to neutral", () => {
    expect(
      adjust([
        ["a", 0.04],
        ["b", -0.04],
      ]),
    ).toEqual([
      { id: "a", requested: 4, applied: 0 },
      { id: "b", requested: -4, applied: 0 },
    ]);
  });

  it("keeps the order in which the link listed the levers", () => {
    expect(
      adjust([
        ["z", 0.13],
        ["a", 0.2],
        ["m", -0.07],
      ]).map((item) => item.id),
    ).toEqual(["z", "m"]);
  });

  it("over every whole percent, reports exactly the off-grid values and moves none by more than half a step", () => {
    for (let percent = -100; percent <= 100; percent++) {
      const found = adjust([["x", percent / 100]]);
      if (percent % 10 === 0) {
        expect(found).toEqual([]);
      } else {
        expect(found).toHaveLength(1);
        const [item] = found;
        expect(item?.requested).toBe(percent);
        expect(Math.abs((item?.applied ?? 0) % 10)).toBe(0);
        expect(Math.abs((item?.applied ?? 0) - percent)).toBeLessThanOrEqual(5);
      }
    }
  });
});

describe("the rounding notice text", () => {
  const labels = new Map([["fed_rate", "Federal funds rate"]]);

  it("names a single rounded input by its label and slider positions", () => {
    expect(adjustmentMessage([{ id: "fed_rate", requested: 57, applied: 60 }], labels)).toBe(
      "This link has a value between the input steps of 5, so it was rounded: Federal funds rate 78.5/100 to 80/100.",
    );
  });

  it("lists several, marks neutral, and falls back to the id for an unknown label", () => {
    expect(
      adjustmentMessage(
        [
          { id: "fed_rate", requested: -55, applied: -60 },
          { id: "mystery", requested: 4, applied: 0 },
        ],
        labels,
      ),
    ).toBe(
      "This link has values between the input steps of 5, so they were rounded: Federal funds rate 22.5/100 to 20/100; mystery 52/100 to 50/100 (neutral).",
    );
  });
});
