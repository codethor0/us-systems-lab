import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("active Block Board entry", () => {
  it("loads the block board as the actual application", () => {
    const entry = readFileSync("src/main.tsx", "utf8");
    expect(entry).toContain('from "./ui/blocks/BlockApp"');
    expect(entry).toContain("<BlockApp />");
    expect(entry).not.toContain("<App />");
  });
});

describe("Block Board small-text contrast", () => {
  const css = readFileSync("src/ui/blocks/board.css", "utf8");
  function channel(value: number): number {
    const unit = value / 255;
    return unit <= 0.03928 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
  }
  function luminance(hex: string): number {
    const [r, g, b] = [1, 3, 5].map((start) => channel(parseInt(hex.slice(start, start + 2), 16)));
    return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
  }
  function ratio(foreground: string, background: string): number {
    const [light, dark] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
    return ((light ?? 0) + 0.05) / ((dark ?? 0) + 0.05);
  }
  function colorOf(selector: string): string {
    const block = new RegExp(`(?:^|\\n)${selector.replace(".", "\\.")}\\s*\\{([^}]*)\\}`).exec(css);
    const color = /(?:^|;|\s)color:\s*(#[0-9a-f]{6})/i.exec(block?.[1] ?? "")?.[1];
    if (color === undefined) throw new Error(`No solid color for ${selector}`);
    return color;
  }
  it.each([
    [".bb-denominator", "#ffffff"],
    [".bb-footer", "#f6f7f9"],
  ])("keeps %s at 4.5:1 or better on its background", (selector, background) => {
    expect(ratio(colorOf(selector), background)).toBeGreaterThanOrEqual(4.5);
  });
});
