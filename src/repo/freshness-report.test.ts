import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

/** The freshness report is offline: a fixed date gives a fixed report. */
function run(...args: string[]): { status: number; output: string } {
  try {
    const output = execFileSync("node", ["scripts/check-freshness.mjs", ...args], {
      encoding: "utf8",
      env: { ...process.env, GITHUB_STEP_SUMMARY: "" },
    });
    return { status: 0, output };
  } catch (error) {
    const failed = error as { status: number; stdout: string };
    return { status: failed.status, output: failed.stdout };
  }
}

describe("scripts/check-freshness.mjs", () => {
  it("lists every indicator and flags the likely stale ones for a fixed date", () => {
    const { status, output } = run("--today", "2026-09-27");
    expect(status).toBe(0);
    expect(output).toContain("3 of 20 baselines may have a newer release.");
    expect(output).toContain("| mortgage_rate | 2026-09-17 | weekly | 10 | check source |");
    expect(output).toContain("| inflation | 2026-08 | monthly | 27 | current |");
    expect(output).toContain("| worker_bargaining_power | none | none | n/a | not applicable |");
  });

  it("gives the same report every time for the same date", () => {
    expect(run("--today", "2026-09-27").output).toBe(run("--today", "2026-09-27").output);
  });

  it("fails only in strict mode, and only when something is flagged", () => {
    expect(run("--today", "2026-09-27", "--strict").status).toBe(1);
    expect(run("--today", "2026-08-20", "--strict").status).toBe(0);
  });

  it("rejects a malformed date", () => {
    expect(run("--today", "27/09/2026").status).toBe(2);
    expect(run("--today", "2026-02-30").status).toBe(2);
    expect(run("--today", "2026-13-45").status).toBe(2);
  });
});
