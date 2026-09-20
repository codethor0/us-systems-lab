import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function rootFile(path: string): URL {
  return new URL(`../../${path}`, import.meta.url);
}

function read(path: string): string {
  return readFileSync(rootFile(path), "utf8");
}

const requiredFiles = [
  "SECURITY.md",
  "TESTING.md",
  ".github/pull_request_template.md",
  ".github/ISSUE_TEMPLATE/bug_report.yml",
  ".github/ISSUE_TEMPLATE/feature_request.yml",
  ".github/ISSUE_TEMPLATE/model_data_change.yml",
  ".github/ISSUE_TEMPLATE/config.yml",
] as const;

describe("public repository governance contract", () => {
  it("ships the required public governance files", () => {
    for (const path of requiredFiles) {
      expect(existsSync(rootFile(path)), path).toBe(true);
    }
  });

  it("provides a private-first vulnerability reporting policy", () => {
    const security = read("SECURITY.md");
    expect(security).toContain("# Security Policy");
    expect(security).toContain("Private vulnerability reporting");
    expect(security).toContain("Do not open a public issue");
    expect(security).toContain("client-side");
  });

  it("documents the exact release runtime and reproducible verification commands", () => {
    const testing = read("TESTING.md");
    expect(testing).toContain("Node.js 24.18.0");
    expect(testing).toContain("npm 10.9.2");
    expect(testing).toContain("npm ci");
    expect(testing).toContain("npm run verify");
    expect(testing).toContain("npm run test:e2e");
    expect(testing).toContain("Chrome or Chromium");
  });

  it("requires focused pull requests, validation, provenance, and secret hygiene", () => {
    const template = read(".github/pull_request_template.md");
    for (const token of [
      "npm run verify",
      "npm run test:e2e",
      "No secrets",
      "Source/provenance",
      "modeled",
      "empirical",
      "unrelated changes",
    ]) {
      expect(template).toContain(token);
    }
  });

  it("keeps blank issues disabled and routes security reports to the policy", () => {
    const config = read(".github/ISSUE_TEMPLATE/config.yml");
    expect(config).toContain("blank_issues_enabled: false");
    expect(config).toContain("Security vulnerability");
    expect(config).toContain("/security/policy");
  });

  it("collects reproducible bug reports without requesting secrets", () => {
    const bug = read(".github/ISSUE_TEMPLATE/bug_report.yml");
    expect(bug).toContain("name: Bug report");
    expect(bug).toContain("id: reproduction");
    expect(bug).toContain("id: expected");
    expect(bug).toContain("id: actual");
    expect(bug).toContain("Never include credentials");
  });

  it("collects feature requests as problem statements rather than implementation demands", () => {
    const feature = read(".github/ISSUE_TEMPLATE/feature_request.yml");
    expect(feature).toContain("name: Feature request");
    expect(feature).toContain("id: problem");
    expect(feature).toContain("id: proposal");
    expect(feature).toContain("id: alternatives");
  });

  it("requires provenance and classification for data or causal-model changes", () => {
    const model = read(".github/ISSUE_TEMPLATE/model_data_change.yml");
    expect(model).toContain("name: Data or model change");
    expect(model).toContain("id: affected");
    expect(model).toContain("id: evidence");
    expect(model).toContain("id: classification");
    expect(model).toContain("Observed baseline");
    expect(model).toContain("Modeled relationship");
    expect(model).toContain("Empirical relationship");
  });
});
