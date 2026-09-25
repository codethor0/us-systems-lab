import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const browser = readFileSync("scripts/block-browser.mjs", "utf8");
const e2e = readFileSync("scripts/block-e2e.mjs", "utf8");
const math = readFileSync("scripts/model-audit.mjs", "utf8");
const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
const gitignore = readFileSync(".gitignore", "utf8");
const deployment = readFileSync("DEPLOYMENT.md", "utf8");
const testing = readFileSync("TESTING.md", "utf8");
const hygiene = readFileSync("src/repo/source-hygiene.test.ts", "utf8");
const emoji = readFileSync("scripts/check-no-emoji.py", "utf8");

describe("developer tooling security boundaries", () => {
  it("does not read executable, target, or artifact paths from environment variables", () => {
    expect(browser).not.toContain("CHROME_PATH");
    expect(browser).not.toContain("USL_E2E_URL");
    expect(e2e).not.toContain("USL_E2E_ARTIFACTS");
    expect(math).not.toContain("USL_MATH_ARTIFACTS");
  });

  it("pins remote browser verification to the canonical production origin", () => {
    expect(browser).toContain(
      'const PRODUCTION_URL = "https://us-systems-lab.codethor0.workers.dev/";',
    );
    expect(browser).toContain('process.env.USL_E2E_PRODUCTION === "1"');
    expect(deployment).toContain("USL_E2E_PRODUCTION=1 npm run test:e2e");
  });

  it("passes runtime selector and value data as DevTools protocol arguments", () => {
    expect(browser).toContain('"Runtime.callFunctionOn"');
    expect(browser).not.toContain("JSON.stringify(selector)");
    expect(browser).not.toContain("JSON.stringify(name)");
    expect(browser).not.toContain("JSON.stringify(value)");
  });

  it("keeps generated reports inside the ignored project-owned artifact directory", () => {
    expect(browser).toContain('path.join(projectRoot, ".artifacts", "e2e")');
    expect(math).toContain('path.join(root, ".artifacts", "math")');
    expect(gitignore.split(/\r?\n/)).toContain(".artifacts");
    expect(workflow).toContain("path: .artifacts/e2e");
    expect(workflow).toContain("include-hidden-files: true");
    expect(hygiene).toContain('".artifacts"');
    expect(testing).toContain("USL_MATH_REPORT=1");
  });

  it("keeps every repository scanner out of the local artifact directory", () => {
    expect(emoji).toMatch(/SKIP_DIRS = frozenset\(\{[^}]*"\.artifacts"[^}]*\}\)/);
    expect(hygiene).toContain('".artifacts"');
  });

  it("retries a slow Chrome start instead of failing on the first slow runner", () => {
    expect(browser).toContain("const CHROME_START_ATTEMPTS = 2;");
    expect(browser).toContain("const CHROME_START_TIMEOUT_MS = 30000;");
    expect(browser).not.toContain('requireCheck(debugPort, "Chrome DevTools did not start");');
  });

  it("does not suppress data-flow findings with inline CodeQL directives", () => {
    for (const source of [browser, e2e, math]) expect(source).not.toContain("codeql[");
  });
});
