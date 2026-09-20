import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const config = readFileSync("eslint.config.js", "utf8");
const crawler = readFileSync("scripts/deep-e2e.mjs", "utf8");

describe("E2E crawler lint boundary", () => {
  it("disables type-aware linting for plain .mjs files outside the TypeScript program", () => {
    expect(config).toContain('"**/*.mjs"');
    expect(config).toContain("tseslint.configs.disableTypeChecked");
  });

  it("declares only the runtime globals used by scripts/deep-e2e.mjs", () => {
    for (const name of [
      "AbortController",
      "Buffer",
      "URL",
      "WebSocket",
      "clearTimeout",
      "console",
      "fetch",
      "setTimeout",
    ]) {
      expect(config).toContain(`${name}: "readonly"`);
    }
  });

  it("does not hide best-effort failures in empty catch blocks", () => {
    expect(crawler).not.toContain("catch {}");
  });
});
