import { describe, expect, it } from "vitest";
import {
  blockPosition,
  fillColor,
  inputLever,
  levelText,
  movedText,
  signed,
  summaryText,
} from "./view";

describe("Block Board display coordinates", () => {
  it("maps neutral and signed endpoints without changing the model score", () => {
    expect(blockPosition(0)).toEqual({ position: 50, filled: 50, direction: "Unchanged" });
    expect(blockPosition(1)).toEqual({ position: 100, filled: 100, direction: "Increased" });
    expect(blockPosition(-1)).toEqual({ position: 0, filled: 0, direction: "Decreased" });
    expect(blockPosition(0.25)).toEqual({ position: 62.5, filled: 63, direction: "Increased" });
    expect(blockPosition(-0.25)).toEqual({ position: 37.5, filled: 37, direction: "Decreased" });
    expect(blockPosition(0.004)).toEqual({ position: 50.2, filled: 50, direction: "Increased" });
  });
  it.each([NaN, Infinity, -Infinity, 1.01, -1.01])("rejects invalid score %s", (value) => {
    expect(() => blockPosition(value)).toThrow(RangeError);
  });
  it("preserves the existing manual step and symmetric half steps", () => {
    expect(inputLever(0)).toBe(-1);
    expect(inputLever(100)).toBe(1);
    expect(inputLever(50)).toBe(0);
    expect(Object.is(inputLever(49), -0)).toBe(false);
    expect(inputLever(62.5)).toBe(0.3);
    expect(inputLever(37.5)).toBe(-0.3);
    for (let level = 0; level <= 100; level += 5) {
      expect(inputLever(level)).toBe((level - 50) / 50);
    }
  });
  it.each([NaN, Infinity, -1, 101])("rejects invalid manual position %s", (value) => {
    expect(() => inputLever(value)).toThrow(RangeError);
  });
  it("draws mirror-image block counts for all thousandths", () => {
    for (let i = 0; i <= 1000; i++) {
      expect(blockPosition(i / 1000).filled + blockPosition(-i / 1000).filled).toBe(100);
    }
  });
  it("stabilizes roundoff at half blocks without changing continuous scores", () => {
    expect(blockPosition(0.6 * 0.75).filled).toBe(73);
    expect(blockPosition(-0.6 * 0.75).filled).toBe(27);
    expect(blockPosition(0.4 * 0.5 * 0.5 * 0.7).filled).toBe(54);
    expect(blockPosition(-0.4 * 0.5 * 0.5 * 0.7).filled).toBe(46);
    expect(blockPosition(0.45 - 1e-9).filled).toBe(72);
    expect(blockPosition(0.45 + 1e-9).filled).toBe(73);
    expect(blockPosition(0.6 * 0.75).position).toBe(50 + 50 * (0.6 * 0.75));
  });
  it("does not announce a floating-point cancellation residue as an increase", () => {
    const cancelled = 0.4 * 0.75 - 0.3;
    expect(cancelled).not.toBe(0);
    expect(blockPosition(cancelled)).toEqual({ position: 50, filled: 50, direction: "Unchanged" });
    expect(signed(cancelled)).toBe("0");
    expect(signed(-cancelled)).toBe("0");
    expect(blockPosition(1e-10).direction).toBe("Increased");
    expect(signed(0.00001)).toBe("+1.00e-5");
    expect(signed(-0.00001)).toBe("-1.00e-5");
    // Position 21.25 is 0.575 of the way to blue: (87, 124, 176).
    expect(fillColor(50 + 50 * (0.3 * 0.75 - 0.8), false)).toBe("#577cb0");
  });
  it("colours untouched tiles grey and blends grey to blue (lower) or orange (higher)", () => {
    expect(fillColor(50, true)).toBe("#7c848f");
    expect(fillColor(50, false)).toBe("#7c848f");
    expect(fillColor(0, false)).toBe("#3b76c8");
    expect(fillColor(100, false)).toBe("#c2640f");
    // Halfway to orange: (124 + 70/2, 132 - 32/2, 143 - 128/2) = (159, 116, 79).
    expect(fillColor(75, false)).toBe("#9f744f");
    // Halfway to blue: (124 - 65/2, 132 - 14/2, 143 + 57/2) = (91.5, 125, 171.5), rounded up.
    expect(fillColor(25, false)).toBe("#5c7dac");
    // 45 is 0.1 toward blue, so red is 124 - 6.5 = 117.5 -> 118 (0x76). The model draws this
    // tile at 44.99999999999999; one ulp must not round the tie the other way.
    expect(fillColor(45, false)).toBe("#768395");
    expect(fillColor(44.99999999999999, false)).toBe("#768395");
  });
  it("formats signed text without a spurious sign", () => {
    expect(signed(0)).toBe("0");
    expect(signed(-0)).toBe("0");
    expect(signed(-0.25)).toBe("-0.25");
    expect(signed(0.25)).toBe("+0.25");
    expect(levelText(62.5)).toBe("62.5");
  });
  it("uses singular and plural wording that matches the counts", () => {
    expect(summaryText(20, 0, 0)).toBe("20 indicators / 0 manual inputs / 0 tiles moved");
    expect(summaryText(20, 1, 1)).toBe("20 indicators / 1 manual input / 1 tile moved");
    expect(summaryText(20, 2, 5)).toBe("20 indicators / 2 manual inputs / 5 tiles moved");
    expect(movedText(0)).toBe("0 tiles moved.");
    expect(movedText(1)).toBe("1 tile moved.");
    expect(movedText(5)).toBe("5 tiles moved.");
  });
});
