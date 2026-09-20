import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function read(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

const workflow = read(".github/workflows/ci.yml");
const testing = read("TESTING.md");
const crawler = read("scripts/deep-e2e.mjs");
const css = read("src/styles.css");
const headers = read("public/_headers");
const prettierIgnore = read(".prettierignore");
const packageJson = JSON.parse(read("package.json") || "{}") as { packageManager?: string };

describe("release hardening contracts", () => {
  it("pins the release package manager and checks the exact CI toolchain", () => {
    expect(packageJson.packageManager).toBe("npm@10.9.2");
    expect(workflow).toContain("node-version-file: .nvmrc");
    expect(workflow).toContain("npm install --global npm@10.9.2 --no-audit --no-fund");
    expect(workflow).toContain('test "$(npm --version)" = "10.9.2"');
    expect(workflow).toContain('test "$(node --version)" = "v24.18.0"');
  });

  it("gates browser behavior and low-severity dependency findings in CI", () => {
    expect(workflow).toContain("run: npm run test:e2e");
    expect(workflow).toContain("run: npm audit --audit-level=low");
    expect(workflow).not.toContain("run: npm audit --audit-level=high");
  });

  it("documents verification layers and their assurance limits", () => {
    expect(testing).toContain("USL_E2E_CRAWL_SOURCES=1");
    expect(testing).toContain("best-effort external source reachability report");
    expect(testing).toContain("does not establish source validity");
    expect(testing).toContain("No automated axe/WCAG conformance scan");
    expect(testing).toContain("npm audit --audit-level=low");
  });

  it("does not classify HTTP 4xx source responses as successful reachability", () => {
    expect(crawler).toContain("ok: response.status >= 200 && response.status < 400");
    expect(crawler).not.toContain("ok: response.status < 500");
  });

  it("keeps node flash one-shot and provides a reduced-motion path", () => {
    const easing = ["ease", "out"].join("-");
    const oneShot = `animation: usl-node-flash 620ms ${easing} 1;`;
    expect(css).toContain(oneShot);
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*?animation-duration:\s*1ms;/,
    );
  });

  it("ships static-asset security headers without adding a Worker script", () => {
    expect(headers).toContain("X-Content-Type-Options: nosniff");
    expect(headers).toContain("X-Frame-Options: DENY");
    expect(headers).toContain("Referrer-Policy: no-referrer");
    expect(headers).toContain("Permissions-Policy:");
    expect(headers).toContain("Content-Security-Policy:");
    expect(headers).toContain("script-src 'self'");
    expect(headers).toContain("style-src 'self' 'unsafe-inline'");
    expect(headers).toContain("frame-ancestors 'none'");
    expect(prettierIgnore).toContain("public/_headers");
  });
});
