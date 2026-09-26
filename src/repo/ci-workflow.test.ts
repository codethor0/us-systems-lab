/**
 * Policy tests for .github/workflows/ci.yml, written before the workflow.
 *
 * GitHub Actions cannot run here, so these tests read the file as text and enforce the rules
 * that matter most: what may run, with what permissions, and that it only runs commands that
 * exist. They are deliberately strict, so that a later edit cannot loosen the workflow without
 * a test failing and a reviewer seeing it.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(new URL("../../.github/workflows/ci.yml", import.meta.url), "utf8");
const packageJson = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
) as { scripts: Record<string, string> };

function lines(): string[] {
  return workflow.split("\n");
}

function runCommands(): string[] {
  return lines()
    .map((line) => /^\s*(?:-\s+)?run:\s*(.+?)\s*$/.exec(line)?.[1])
    .filter((command): command is string => command !== undefined);
}

function indexOfCommand(command: string): number {
  return runCommands().indexOf(command);
}

describe("triggers", () => {
  it("runs on pull requests to main", () => {
    expect(workflow).toMatch(/^on:\n {2}pull_request:\n {4}branches: \[main\]$/m);
  });

  it("runs on pushes to main, so the merged result is checked too", () => {
    expect(workflow).toMatch(/^ {2}push:\n {4}branches: \[main\]$/m);
  });

  it("never runs on pull_request_target or workflow_run, which run with elevated trust", () => {
    expect(workflow).not.toMatch(/pull_request_target/);
    expect(workflow).not.toMatch(/workflow_run/);
  });
});

describe("permissions and secrets", () => {
  it("grants the token read access to contents and nothing else", () => {
    // The lookahead forbids a further indented key under permissions. It must not use \s,
    // which would also match the newline and reject any file where another block follows.
    expect(workflow).toMatch(/^permissions:\n {2}contents: read\n(?! +\w)/m);
  });

  it("never asks for write access anywhere", () => {
    expect(workflow).not.toMatch(/:\s*write\b/);
  });

  it("references no secrets", () => {
    expect(workflow).not.toMatch(/secrets\./);
  });

  it("does not leave the token in the checked-out repository", () => {
    expect(workflow).toMatch(
      /actions\/checkout@[0-9a-f]{40}[^\n]*\n\s+with:\n\s+persist-credentials: false/,
    );
  });
});

describe("third-party actions", () => {
  const references = lines()
    .map((line) => /^\s*(?:-\s+)?uses:\s*(\S+)/.exec(line)?.[1])
    .filter((ref): ref is string => ref !== undefined);

  it("uses at least the checkout, setup-node, and upload-artifact actions", () => {
    expect(references.map((ref) => ref.split("@")[0]).sort()).toEqual([
      "actions/checkout",
      "actions/setup-node",
      "actions/upload-artifact",
    ]);
  });

  it.each(references)("pins %s to a full 40-character commit SHA and not a movable tag", (ref) => {
    expect(ref).toMatch(/^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/);
  });

  it("keeps the human-readable version beside each SHA as a comment", () => {
    const usesLines = lines().filter((line) => /^\s*(?:-\s+)?uses:/.test(line));
    expect(usesLines).toHaveLength(3);
    for (const line of usesLines) expect(line).toMatch(/@[0-9a-f]{40} # v\d+\.\d+\.\d+$/);
  });
});

describe("the job", () => {
  it("is named verify, which is the status check name branch protection will require", () => {
    expect(workflow).toMatch(/^ {2}verify:\n {4}name: verify$/m);
  });

  it("has a timeout so that a hung step cannot run for the default six hours", () => {
    expect(workflow).toMatch(/^ {4}timeout-minutes: \d+$/m);
  });

  it("cancels a superseded run for the same ref", () => {
    expect(workflow).toMatch(/^concurrency:\n {2}group: .+\n {2}cancel-in-progress: true$/m);
  });

  it("takes the Node version from .nvmrc, the single source of truth", () => {
    expect(workflow).toMatch(/node-version-file: \.nvmrc/);
    expect(workflow).not.toMatch(/node-version: /);
  });

  it("caches npm downloads through setup-node", () => {
    expect(workflow).toMatch(/^\s+cache: npm$/m);
  });
});

describe("the steps", () => {
  const required = [
    "npm run lint",
    "npm run typecheck",
    "npm run format:check",
    "npm run coverage",
    "npm run build",
    "npm run test:scripts",
    "npm run check:emoji",
    "npm audit --audit-level=low",
  ];

  it("installs from the lockfile with npm ci and never npm install", () => {
    expect(runCommands()).toContain("npm ci");
    expect(runCommands().some((command) => /^npm (install|i)\b/.test(command))).toBe(false);
  });

  it.each(required)("runs %s", (command) => {
    expect(runCommands()).toContain(command);
  });

  it.each(required)("runs npm ci before %s", (command) => {
    expect(indexOfCommand("npm ci")).toBeGreaterThanOrEqual(0);
    expect(indexOfCommand("npm ci")).toBeLessThan(indexOfCommand(command));
  });

  it("runs the coverage command, which enforces the 100 percent threshold, and not bare vitest", () => {
    expect(runCommands()).not.toContain("npm test");
    expect(packageJson.scripts["coverage"]).toBe("vitest run --coverage");
  });

  it("runs only npm scripts that exist in package.json", () => {
    const named = runCommands()
      .map((command) => /^npm run (\S+)$/.exec(command)?.[1])
      .filter((name): name is string => name !== undefined);
    expect(named.length).toBeGreaterThan(0);
    for (const name of named) expect(Object.keys(packageJson.scripts)).toContain(name);
  });

  it("contains no command that pipes downloaded content into a shell", () => {
    for (const command of runCommands()) {
      expect(command).not.toMatch(/(curl|wget)[^|]*\|\s*(ba)?sh/);
    }
  });

  it("pins every job to an explicit runner image rather than a moving -latest label", () => {
    const runners = lines()
      .map((line) => /^\s*runs-on:\s*(\S+)\s*$/.exec(line)?.[1])
      .filter((label): label is string => label !== undefined);
    expect(runners).toEqual(["ubuntu-24.04"]);
    const config = lines().filter((line) => !/^\s*#/.test(line));
    expect(config.join("\n")).not.toMatch(/-latest\b/);
  });

  it("does not deploy or publish anything; production changes only by a manual owner deploy", () => {
    expect(workflow).not.toMatch(/\b(deploy|publish|wrangler|cloudflare)\b/i);
  });
});
