import { describe, expect, it } from "vitest";
import graphJson from "../data/graph.json";
import { DUE_AFTER_DAYS, freshness, periodEnd } from "./freshness";
import { parseGraph } from "./validate";

const day = (iso: string) => Date.parse(`${iso}T00:00:00Z`);

describe("periodEnd", () => {
  it.each([
    ["2026-09-17", "2026-09-17"],
    ["2026-08", "2026-08-31"],
    ["2024-02", "2024-02-29"],
    ["2026-Q2", "2026-06-30"],
    ["2026-Q4", "2026-12-31"],
    ["FY2026", "2026-09-30"],
    ["2025", "2025-12-31"],
  ])("puts %s at the end of %s", (asOf, end) => {
    expect(periodEnd(asOf)).toBe(day(end));
  });

  it("returns null for text it cannot read", () => {
    expect(periodEnd("last week")).toBeNull();
  });
});

describe("freshness", () => {
  it("flags a weekly figure once nine days have passed since its date", () => {
    expect(freshness({ asOf: "2026-09-17", cadence: "weekly" }, "2026-09-26")).toEqual({
      status: "current",
      ageDays: 9,
      dueAfterDays: 9,
    });
    expect(freshness({ asOf: "2026-09-17", cadence: "weekly" }, "2026-09-27").status).toBe("check");
  });

  it("counts from the end of a month, quarter, fiscal year or year", () => {
    expect(freshness({ asOf: "2026-08", cadence: "monthly" }, "2026-09-27").ageDays).toBe(27);
    expect(freshness({ asOf: "2026-Q2", cadence: "quarterly" }, "2026-09-27").ageDays).toBe(89);
    // The fiscal year has three days to run, so its projection is not yet aged at all.
    expect(freshness({ asOf: "FY2026", cadence: "annual" }, "2026-09-27").ageDays).toBe(0);
    expect(freshness({ asOf: "2024", cadence: "annual" }, "2026-09-27").status).toBe("current");
    expect(freshness({ asOf: "2023", cadence: "annual" }, "2026-09-27")).toEqual({
      status: "check",
      ageDays: 1001,
      dueAfterDays: 730,
    });
  });

  it("does not apply to a node with no period, no cadence, or an unreadable date", () => {
    const none = { status: "not_applicable", ageDays: null, dueAfterDays: null };
    expect(freshness({ asOf: null, cadence: "daily" }, "2026-09-27")).toEqual(none);
    expect(freshness({ asOf: "2026-08", cadence: null }, "2026-09-27")).toEqual(none);
    expect(freshness({ asOf: "2026-08", cadence: "monthly" }, "today")).toEqual(none);
  });

  it("has a due period for every cadence, shortest for the most frequent", () => {
    const { daily, weekly, monthly, quarterly, annual } = DUE_AFTER_DAYS;
    expect(daily < weekly && weekly < monthly && monthly < quarterly && quarterly < annual).toBe(
      true,
    );
  });

  it("gives the stored graph a result for every node on a fixed date", () => {
    const graph = parseGraph(graphJson);
    const flagged = graph.nodes
      .filter((node) => freshness(node, "2026-09-27").status === "check")
      .map((node) => node.id)
      .sort();
    // federal_debt is a daily series last read for 2026-08-18, mortgage_rate is weekly from
    // 2026-09-17, and savings_rate is monthly for July 2026, 58 days before this date.
    expect(flagged).toEqual(["federal_debt", "mortgage_rate", "savings_rate"]);
  });
});
