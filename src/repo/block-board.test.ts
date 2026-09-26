import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FILL_HIGH, FILL_LOW, FILL_NEUTRAL, fillColor } from "../ui/blocks/view";

describe("active Block Board entry", () => {
  it("loads the block board as the actual application", () => {
    const entry = readFileSync("src/main.tsx", "utf8");
    expect(entry).toContain('from "./ui/blocks/BlockApp"');
    expect(entry).toContain("<BlockApp />");
    expect(entry).not.toContain("<App />");
  });
});

describe("Block Board colour contrast in both themes", () => {
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
  function tokens(block: string): Map<string, string> {
    return new Map(
      [...block.matchAll(/(--bb-[a-z0-9-]+):\s*(#[0-9a-f]{6})\s*;/gi)].map((m) => [
        m[1] ?? "",
        (m[2] ?? "").toLowerCase(),
      ]),
    );
  }
  const lightBlock = /^\.bb-app \{([^}]*)\}/m.exec(css)?.[1] ?? "";
  const darkBlock =
    /@media \(prefers-color-scheme: dark\) \{\s*\.bb-app \{([^}]*)\}/.exec(css)?.[1] ?? "";
  const light = tokens(lightBlock);
  const themes = { light, dark: new Map([...light, ...tokens(darkBlock)]) };
  function token(theme: Map<string, string>, name: string): string {
    const value = theme.get(name);
    if (value === undefined) throw new Error(`Missing ${name}`);
    return value;
  }

  it("defines a dark override for every light colour token", () => {
    expect(darkBlock).not.toBe("");
    const fillTokens = ["--bb-fill-low", "--bb-fill-neutral", "--bb-fill-high"];
    for (const name of light.keys()) {
      if (!fillTokens.includes(name)) expect(tokens(darkBlock).has(name), name).toBe(true);
    }
  });

  it("uses the same fill scale in the legend as on the tiles", () => {
    expect(token(light, "--bb-fill-low")).toBe(FILL_LOW);
    expect(token(light, "--bb-fill-neutral")).toBe(FILL_NEUTRAL);
    expect(token(light, "--bb-fill-high")).toBe(FILL_HIGH);
  });

  const textPairs = [
    ["--bb-text", "--bb-bg"],
    ["--bb-text", "--bb-card"],
    ["--bb-text-2", "--bb-bg"],
    ["--bb-text-2", "--bb-card"],
    ["--bb-text-3", "--bb-bg"],
    ["--bb-text-3", "--bb-card"],
    ["--bb-button-text", "--bb-card"],
    ["--bb-link", "--bb-card"],
    ["--bb-notice-text", "--bb-notice-bg"],
  ] as const;
  it.each(Object.entries(themes))("keeps text at 4.5:1 or better in the %s theme", (_, theme) => {
    for (const [text, surface] of textPairs) {
      expect(
        ratio(token(theme, text), token(theme, surface)),
        `${text} on ${surface}`,
      ).toBeGreaterThanOrEqual(4.5);
    }
    expect(ratio(token(theme, "--bb-focus"), token(theme, "--bb-bg"))).toBeGreaterThanOrEqual(3);
  });

  it.each(Object.entries(themes))(
    "keeps every tile colour at 3:1 or better on cards and empty squares in the %s theme",
    (_, theme) => {
      const colours = [fillColor(50, true)];
      for (let position = 0; position <= 100; position += 0.25) {
        colours.push(fillColor(position, false));
      }
      for (const surface of ["--bb-card", "--bb-empty"]) {
        const worst = Math.min(...colours.map((colour) => ratio(colour, token(theme, surface))));
        expect(worst, surface).toBeGreaterThanOrEqual(3);
      }
    },
  );

  it("styles small secondary text with the checked token", () => {
    for (const selector of [".bb-denominator", ".bb-footer"]) {
      const block = new RegExp(`(?:^|\\n)${selector.replace(".", "\\.")}\\s*\\{([^}]*)\\}`).exec(
        css,
      );
      expect(block?.[1], selector).toContain("color: var(--bb-text-3);");
    }
  });
});
