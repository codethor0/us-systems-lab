import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const crawler = readFileSync("scripts/deep-e2e.mjs", "utf8");

describe("deep browser harness portability", () => {
  it("normalizes CSS colors in Chrome instead of depending on CSS serialization syntax", () => {
    expect(crawler).toContain("cssColorRgba");
    expect(crawler).toContain("bodyBackgroundRgba");
    expect(crawler).toContain("headerBackgroundRgba");
    expect(crawler).toContain("cardBackgroundRgba");
    expect(crawler).toContain("titleColorRgba");
    expect(crawler).not.toContain('startsWith("rgba(255, 255, 255")');
  });

  it("explicitly closes Chrome stdout and stderr FileHandles", () => {
    expect(crawler).toContain("let chromeOut;");
    expect(crawler).toContain("let chromeErr;");
    expect(crawler).toContain("if (chromeOut) await chromeOut.close();");
    expect(crawler).toContain("if (chromeErr) await chromeErr.close();");
  });
});
