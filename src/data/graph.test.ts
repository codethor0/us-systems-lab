import { describe, expect, it } from "vitest";
import graphJson from "./graph.json";
import { parseGraph, validateGraph } from "../lib/validate";

const SEED_NODE_IDS = [
  "inflation",
  "fed_rate",
  "mortgage_rate",
  "gdp_growth",
  "payrolls_headline",
  "real_avg_hourly_earnings",
  "household_debt",
  "savings_rate",
  "federal_debt",
  "net_interest",
  "productivity",
  "median_household_income",
  "poverty_rate",
  "food_insecurity",
  "homelessness",
  "institutional_confidence",
  "media_trust",
  "hate_crimes",
  "worker_bargaining_power",
  "debt_growth_rate",
];

/** Edges accepted in review, E1 to E20, with E10 retargeted to debt_growth_rate. */
const ACCEPTED_EDGE_IDS = [
  "fed_rate__mortgage_rate",
  "fed_rate__inflation",
  "fed_rate__gdp_growth",
  "fed_rate__net_interest",
  "fed_rate__savings_rate",
  "mortgage_rate__household_debt",
  "inflation__real_avg_hourly_earnings",
  "inflation__institutional_confidence",
  "gdp_growth__payrolls_headline",
  "gdp_growth__debt_growth_rate",
  "productivity__real_avg_hourly_earnings",
  "worker_bargaining_power__real_avg_hourly_earnings",
  "real_avg_hourly_earnings__median_household_income",
  "real_avg_hourly_earnings__savings_rate",
  "median_household_income__poverty_rate",
  "poverty_rate__food_insecurity",
  "poverty_rate__homelessness",
  "household_debt__savings_rate",
  "federal_debt__net_interest",
  "media_trust__institutional_confidence",
];

describe("src/data/graph.json", () => {
  it("passes every schema and provenance rule", () => {
    expect(validateGraph(graphJson)).toEqual([]);
  });

  const graph = parseGraph(graphJson);

  it("contains exactly the seed nodes, so a deletion or a stray addition is noticed", () => {
    expect(graph.nodes.map((n) => n.id).sort()).toEqual([...SEED_NODE_IDS].sort());
  });

  it("keeps the two census figures on two different reports", () => {
    const income = graph.nodes.find((n) => n.id === "median_household_income");
    const poverty = graph.nodes.find((n) => n.id === "poverty_rate");
    expect(income?.sourceUrl).toBeTruthy();
    expect(poverty?.sourceUrl).toBeTruthy();
    expect(income?.sourceUrl).not.toBe(poverty?.sourceUrl);
  });

  it("labels the CBO net interest figure as a projection and never as an observation", () => {
    const node = graph.nodes.find((n) => n.id === "net_interest");
    expect(node?.valueType).toBe("projected");
  });

  it("leaves the abstract lever without a baseline or a verification", () => {
    const node = graph.nodes.find((n) => n.id === "worker_bargaining_power");
    expect(node?.baseline).toBeNull();
    expect(node?.verification).toBeNull();
  });

  it("contains exactly the accepted edges", () => {
    expect(graph.edges.map((e) => e.id).sort()).toEqual([...ACCEPTED_EDGE_IDS].sort());
  });

  it("marks every edge modeled, because no edge has a citation yet", () => {
    expect(graph.edges.filter((e) => e.confidence !== "modeled")).toEqual([]);
  });

  it("does not point growth at the federal debt level, which is a stock and not a rate", () => {
    expect(graph.edges.filter((e) => e.from === "gdp_growth" && e.to === "federal_debt")).toEqual(
      [],
    );
    const growth = graph.edges.find((e) => e.id === "gdp_growth__debt_growth_rate");
    expect(growth?.direction).toBe(-1);
  });

  it("stores no derived value for debt_growth_rate", () => {
    const node = graph.nodes.find((n) => n.id === "debt_growth_rate");
    expect(node?.baseline).toBeNull();
    expect(node?.verification).toBe("pending");
  });
});
