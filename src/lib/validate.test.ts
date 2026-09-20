import { describe, expect, it } from "vitest";
import { parseGraph, validateGraph } from "./validate";

type Raw = Record<string, unknown>;
interface RawGraph {
  nodes: Raw[];
  edges: Raw[];
}

/**
 * Fixture data only. Nothing here is a claim about the real economy.
 * Node order: inflation 0, fed_rate 1, net_interest 2, worker_bargaining_power 3, spare_lever 4.
 * Edge order: fed_rate__inflation 0, worker_bargaining_power__inflation 1.
 */
function fixture(): RawGraph {
  const index = {
    valueType: "index",
    unit: "index (0-100)",
    baseline: null,
    range: { min: 0, max: 100 },
    asOf: null,
    verification: null,
    sourceUrl: null,
    sourceDetail: null,
    retrievedDate: null,
  };
  return {
    nodes: [
      {
        id: "inflation",
        label: "Inflation",
        category: "economic",
        valueType: "observed",
        unit: "% YoY",
        baseline: 3.4,
        range: { min: 0, max: 10 },
        asOf: "2026-08",
        verification: "primary",
        sourceUrl: "https://www.bls.gov/fixture/cpi",
        sourceDetail: "Fixture: CPI release, table 1",
        retrievedDate: "2026-09-19",
        description: "Fixture node.",
      },
      {
        id: "fed_rate",
        label: "Federal funds rate",
        category: "policy",
        valueType: "observed",
        unit: "%",
        baseline: 3.875,
        range: { min: 0, max: 8 },
        asOf: "2026-09-16",
        verification: "secondary",
        sourceUrl: "https://news.example.com/fixture/fomc",
        sourceDetail: "Fixture: news report of the decision",
        retrievedDate: "2026-09-19",
        description: "Fixture node.",
      },
      {
        id: "net_interest",
        label: "Net interest",
        category: "fiscal",
        valueType: "projected",
        unit: "$T",
        baseline: 1,
        range: { min: 0, max: 3 },
        asOf: "FY2026",
        verification: "pending",
        sourceUrl: null,
        sourceDetail: "Fixture: primary page not yet located",
        retrievedDate: null,
        description: "Fixture node.",
      },
      {
        id: "worker_bargaining_power",
        label: "Worker bargaining power",
        category: "institutional",
        ...index,
        description: "Fixture lever.",
      },
      {
        id: "spare_lever",
        label: "Spare lever",
        category: "policy",
        ...index,
        description: "Fixture lever referenced by no edge.",
      },
    ],
    edges: [
      {
        id: "fed_rate__inflation",
        from: "fed_rate",
        to: "inflation",
        direction: -1,
        strength: 0.5,
        confidence: "empirical",
        sourceUrl: "https://www.federalreserve.gov/fixture/paper",
        sourceDetail: "Fixture: working paper",
        retrievedDate: "2026-09-19",
        claim: "Fixture claim: higher policy rates tend to lower inflation.",
      },
      {
        id: "worker_bargaining_power__inflation",
        from: "worker_bargaining_power",
        to: "inflation",
        direction: 1,
        strength: 0.25,
        confidence: "modeled",
        sourceUrl: null,
        sourceDetail: null,
        retrievedDate: null,
        claim: "Fixture claim: commonly argued, magnitude contested.",
      },
    ],
  };
}

function find(list: Raw[], id: string): Raw {
  const item = list.find((x) => x["id"] === id);
  if (item === undefined) throw new Error(`fixture has no item ${id}`);
  return item;
}

function withNode(id: string, patch: Raw): RawGraph {
  const g = fixture();
  Object.assign(find(g.nodes, id), patch);
  return g;
}

function withEdge(id: string, patch: Raw): RawGraph {
  const g = fixture();
  Object.assign(find(g.edges, id), patch);
  return g;
}

function summarize(input: unknown): [string, string][] {
  return validateGraph(input).map((e) => [e.path, e.code]);
}

function deepFreeze(value: unknown): void {
  if (typeof value !== "object" || value === null) return;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
}

describe("validateGraph: accepts", () => {
  it("the fixture graph with no errors", () => {
    expect(validateGraph(fixture())).toEqual([]);
  });

  it("an empty graph", () => {
    expect(validateGraph({ nodes: [], edges: [] })).toEqual([]);
  });

  it("a pending node that carries a supplied value but no source page", () => {
    const g = fixture();
    expect(find(g.nodes, "net_interest")["verification"]).toBe("pending");
    expect(validateGraph(g)).toEqual([]);
  });

  it("unproven and approves, which contain but are not the forbidden words", () => {
    const g = withEdge("worker_bargaining_power__inflation", {
      claim: "Unproven and contested; the effect size is unknown and one review approves.",
    });
    expect(validateGraph(g)).toEqual([]);
  });

  it("does not mutate its input", () => {
    const g = fixture();
    deepFreeze(g);
    expect(() => validateGraph(g)).not.toThrow();
  });
});

describe("validateGraph: rejects, edges", () => {
  it("an empirical edge with no sourceUrl", () => {
    expect(summarize(withEdge("fed_rate__inflation", { sourceUrl: null }))).toEqual([
      ["edges[0].sourceUrl", "source_required"],
    ]);
  });

  it("an empirical edge with no sourceDetail", () => {
    expect(summarize(withEdge("fed_rate__inflation", { sourceDetail: null }))).toEqual([
      ["edges[0].sourceDetail", "source_required"],
    ]);
  });

  it("an empirical edge with no retrievedDate", () => {
    expect(summarize(withEdge("fed_rate__inflation", { retrievedDate: null }))).toEqual([
      ["edges[0].retrievedDate", "source_required"],
    ]);
  });

  it("a modeled edge that carries a sourceUrl", () => {
    const g = withEdge("worker_bargaining_power__inflation", {
      sourceUrl: "https://www.bls.gov/fixture/made-up",
    });
    expect(summarize(g)).toEqual([["edges[1].sourceUrl", "source_forbidden"]]);
  });

  it("an edge whose target does not exist", () => {
    const g = withEdge("fed_rate__inflation", { to: "nope", id: "fed_rate__nope" });
    expect(summarize(g)).toEqual([["edges[0].to", "dangling_reference"]]);
  });

  it("an edge whose source does not exist", () => {
    const g = withEdge("fed_rate__inflation", { from: "nope", id: "nope__inflation" });
    expect(summarize(g)).toEqual([["edges[0].from", "dangling_reference"]]);
  });

  it("a self loop", () => {
    const g = withEdge("fed_rate__inflation", {
      from: "inflation",
      to: "inflation",
      id: "inflation__inflation",
    });
    expect(summarize(g)).toEqual([["edges[0]", "self_loop"]]);
  });

  it("an edge id that is not from__to", () => {
    expect(summarize(withEdge("fed_rate__inflation", { id: "edge_one" }))).toEqual([
      ["edges[0].id", "id_mismatch"],
    ]);
  });

  it("a duplicate edge id", () => {
    const g = fixture();
    g.edges.push({ ...find(g.edges, "fed_rate__inflation") });
    expect(summarize(g)).toEqual([["edges[2].id", "duplicate_id"]]);
  });

  it("a strength that is not one of the tiers", () => {
    expect(summarize(withEdge("fed_rate__inflation", { strength: 0.8 }))).toEqual([
      ["edges[0].strength", "invalid_strength"],
    ]);
  });

  it.each([0, 2, "1", null])("direction %j", (direction) => {
    expect(summarize(withEdge("fed_rate__inflation", { direction }))).toEqual([
      ["edges[0].direction", "invalid_direction"],
    ]);
  });

  it("a confidence outside the two allowed labels", () => {
    expect(summarize(withEdge("fed_rate__inflation", { confidence: "likely" }))).toEqual([
      ["edges[0].confidence", "invalid_enum"],
    ]);
  });

  it.each(["This is proven.", "The data proves it", "PROVEN beyond doubt", "It proves\nit"])(
    "the forbidden word in claim %j",
    (claim) => {
      const codes = summarize(withEdge("worker_bargaining_power__inflation", { claim })).map(
        ([, code]) => code,
      );
      expect(codes).toContain("forbidden_word");
    },
  );

  it.each(["", "   ", "line one\nline two"])("claim %j", (claim) => {
    expect(summarize(withEdge("fed_rate__inflation", { claim }))).toEqual([
      ["edges[0].claim", "invalid_claim"],
    ]);
  });
});

describe("validateGraph: rejects, nodes", () => {
  it("a duplicate node id", () => {
    const g = withNode("spare_lever", { id: "inflation" });
    expect(summarize(g)).toEqual([["nodes[4].id", "duplicate_id"]]);
  });

  it.each(["Spare Lever", "a__b", "_a", "a_", "1a", "spare-lever", ""])("the node id %j", (id) => {
    expect(summarize(withNode("spare_lever", { id }))).toEqual([["nodes[4].id", "invalid_id"]]);
  });

  it("a category outside the allowed set", () => {
    expect(summarize(withNode("inflation", { category: "sports" }))).toEqual([
      ["nodes[0].category", "invalid_enum"],
    ]);
  });

  it("a baseline outside the display range", () => {
    expect(summarize(withNode("inflation", { baseline: 11 }))).toEqual([
      ["nodes[0].baseline", "baseline_out_of_range"],
    ]);
  });

  it.each([
    { min: 5, max: 5 },
    { min: 9, max: 1 },
  ])("range %j", (range) => {
    expect(summarize(withNode("inflation", { range }))).toEqual([
      ["nodes[0].range", "invalid_range"],
    ]);
  });

  it("a baseline with no asOf", () => {
    expect(summarize(withNode("inflation", { asOf: null }))).toEqual([
      ["nodes[0].asOf", "as_of_required"],
    ]);
  });

  it.each(["August 2026", "2026-13", "2026-02-30", "2026-Q5", "FY26", ""])("asOf %j", (asOf) => {
    expect(summarize(withNode("inflation", { asOf }))).toEqual([
      ["nodes[0].asOf", "invalid_as_of"],
    ]);
  });

  it.each(["2026", "2026-08", "2026-09-16", "2026-Q2", "FY2026"])("asOf %j is accepted", (asOf) => {
    expect(validateGraph(withNode("inflation", { asOf }))).toEqual([]);
  });

  it("an index node that has a baseline", () => {
    expect(summarize(withNode("spare_lever", { baseline: 50 }))).toEqual([
      ["nodes[4].baseline", "baseline_forbidden"],
    ]);
  });

  it("an index node that claims a verification", () => {
    expect(summarize(withNode("spare_lever", { verification: "primary" }))).toEqual([
      ["nodes[4].verification", "verification_mismatch"],
    ]);
  });

  it("an observed node with no verification", () => {
    expect(summarize(withNode("inflation", { verification: null }))).toEqual([
      ["nodes[0].verification", "verification_mismatch"],
    ]);
  });

  it("a primary node with no retrievedDate", () => {
    expect(summarize(withNode("inflation", { retrievedDate: null }))).toEqual([
      ["nodes[0].retrievedDate", "source_required"],
    ]);
  });

  it("a primary node with no baseline", () => {
    expect(summarize(withNode("inflation", { baseline: null, asOf: null }))).toEqual([
      ["nodes[0].baseline", "baseline_required"],
    ]);
  });

  it("a secondary node with no sourceUrl", () => {
    expect(summarize(withNode("fed_rate", { sourceUrl: null }))).toEqual([
      ["nodes[1].sourceUrl", "source_required"],
    ]);
  });

  it("a pending node that carries a sourceUrl", () => {
    const g = withNode("net_interest", { sourceUrl: "https://www.cbo.gov/fixture" });
    expect(summarize(g)).toEqual([["nodes[2].sourceUrl", "source_forbidden"]]);
  });

  it("a pending node that carries a retrievedDate", () => {
    const g = withNode("net_interest", { retrievedDate: "2026-09-19" });
    expect(summarize(g)).toEqual([["nodes[2].retrievedDate", "source_forbidden"]]);
  });

  it("an index node that carries a source", () => {
    const g = withNode("spare_lever", { sourceDetail: "made up" });
    expect(summarize(g)).toEqual([["nodes[4].sourceDetail", "source_forbidden"]]);
  });
});

describe("validateGraph: rejects, sources", () => {
  it("a primary node whose host is a news outlet", () => {
    const g = withNode("inflation", { sourceUrl: "https://www.aljazeera.com/economy/x" });
    expect(summarize(g)).toEqual([["nodes[0].sourceUrl", "primary_host_required"]]);
  });

  it.each([
    "https://notbls.gov/x",
    "https://bls.gov.evil.example/x",
    "https://evil.example/bls.gov",
    "https://www.bls.gov.evil.example/x",
    "https://nothuduser.gov/x",
    "https://huduser.gov.evil.example/x",
  ])("a primary node with the look-alike host %s", (sourceUrl) => {
    expect(summarize(withNode("inflation", { sourceUrl }))).toEqual([
      ["nodes[0].sourceUrl", "primary_host_required"],
    ]);
  });

  it.each([
    "https://www.bls.gov/news.release/cpi.nr0.htm",
    "https://bls.gov/cpi",
    "https://data.bls.gov/timeseries/CUUR0000SA0",
    "https://www.huduser.gov/portal/datasets/ahar.html",
    "https://huduser.gov/portal/sites/default/files/pdf/2025-AHAR-Part-1.pdf",
    "https://www.hud.gov/news/hud-no-26-037",
  ])("a primary node at the allowed host %s", (sourceUrl) => {
    expect(validateGraph(withNode("inflation", { sourceUrl }))).toEqual([]);
  });

  it.each(["https://bls.gov@evil.example/x", "https://user:pass@www.bls.gov/x"])(
    "a sourceUrl with embedded credentials %s",
    (sourceUrl) => {
      expect(summarize(withNode("inflation", { sourceUrl }))).toEqual([
        ["nodes[0].sourceUrl", "invalid_url"],
      ]);
    },
  );

  it("a non-https sourceUrl", () => {
    const g = withNode("inflation", { sourceUrl: "http://www.bls.gov/cpi" });
    expect(summarize(g)).toEqual([["nodes[0].sourceUrl", "invalid_url"]]);
  });

  it("a sourceUrl that does not parse", () => {
    const g = withNode("fed_rate", { sourceUrl: "not a url" });
    expect(summarize(g)).toEqual([["nodes[1].sourceUrl", "invalid_url"]]);
  });

  it.each(["2026-02-30", "2026/09/19", "19-09-2026", "2026-9-19", "yesterday"])(
    "retrievedDate %j",
    (retrievedDate) => {
      expect(summarize(withNode("inflation", { retrievedDate }))).toEqual([
        ["nodes[0].retrievedDate", "invalid_date"],
      ]);
    },
  );

  it("a leap day on a leap year is a valid retrievedDate", () => {
    expect(validateGraph(withNode("inflation", { retrievedDate: "2028-02-29" }))).toEqual([]);
  });

  it("2000-02-29 is valid because 2000 is divisible by 400", () => {
    expect(validateGraph(withNode("inflation", { retrievedDate: "2000-02-29" }))).toEqual([]);
  });

  it("2100-02-29 is invalid because 2100 is a century year not divisible by 400", () => {
    expect(summarize(withNode("inflation", { retrievedDate: "2100-02-29" }))).toEqual([
      ["nodes[0].retrievedDate", "invalid_date"],
    ]);
  });

  it("a leap day on a non-leap year is not", () => {
    expect(summarize(withNode("inflation", { retrievedDate: "2027-02-29" }))).toEqual([
      ["nodes[0].retrievedDate", "invalid_date"],
    ]);
  });
});

describe("validateGraph: rejects, structure", () => {
  it("an unknown key on a node, which catches typos such as sourceURL", () => {
    expect(summarize(withNode("inflation", { sourceURL: "x" }))).toEqual([
      ["nodes[0].sourceURL", "unknown_key"],
    ]);
  });

  it("an unknown key on an edge", () => {
    expect(summarize(withEdge("fed_rate__inflation", { weight: 3 }))).toEqual([
      ["edges[0].weight", "unknown_key"],
    ]);
  });

  it("an unknown top-level key", () => {
    expect(summarize({ ...fixture(), extra: [] })).toEqual([["extra", "unknown_key"]]);
  });

  it("a missing required key", () => {
    const g = fixture();
    Reflect.deleteProperty(find(g.nodes, "inflation"), "label");
    expect(summarize(g)).toEqual([["nodes[0].label", "invalid_type"]]);
  });

  it("a node field of the wrong type", () => {
    expect(summarize(withNode("inflation", { baseline: "3.4" }))).toEqual([
      ["nodes[0].baseline", "invalid_type"],
    ]);
  });

  it.each([null, undefined, 42, "graph", []])("a top-level value of %j", (input) => {
    expect(summarize(input)).toEqual([["", "invalid_type"]]);
  });

  it("nodes that are not an array", () => {
    expect(summarize({ nodes: {}, edges: [] })).toEqual([["nodes", "invalid_type"]]);
  });

  it("reports every fault in one pass rather than stopping at the first", () => {
    const g = fixture();
    Object.assign(find(g.nodes, "inflation"), { baseline: 11 });
    Object.assign(find(g.edges, "fed_rate__inflation"), { strength: 0.8 });
    expect(summarize(g)).toEqual([
      ["nodes[0].baseline", "baseline_out_of_range"],
      ["edges[0].strength", "invalid_strength"],
    ]);
  });
});

describe("validateGraph: rejects, wrong types", () => {
  it("a node that is not an object", () => {
    expect(summarize({ nodes: [42], edges: [] })).toEqual([["nodes[0]", "invalid_type"]]);
  });

  it("an edge that is not an object", () => {
    expect(summarize({ nodes: [], edges: ["x"] })).toEqual([["edges[0]", "invalid_type"]]);
  });

  it("edges that are not an array", () => {
    expect(summarize({ nodes: [], edges: {} })).toEqual([["edges", "invalid_type"]]);
  });

  it("a node id that is not a string", () => {
    expect(summarize(withNode("spare_lever", { id: 5 }))).toEqual([
      ["nodes[4].id", "invalid_type"],
    ]);
  });

  it("an edge id that is not a string", () => {
    expect(summarize(withEdge("fed_rate__inflation", { id: 5 }))).toEqual([
      ["edges[0].id", "invalid_type"],
    ]);
  });

  it.each(["sourceUrl", "sourceDetail", "retrievedDate"])(
    "a node %s that is neither a string nor null",
    (key) => {
      expect(summarize(withNode("inflation", { [key]: 42 }))).toEqual([
        [`nodes[0].${key}`, "invalid_type"],
      ]);
    },
  );

  it.each(["category", "valueType"])("a node %s that is not a string", (key) => {
    expect(summarize(withNode("inflation", { [key]: 5 }))).toEqual([
      [`nodes[0].${key}`, "invalid_type"],
    ]);
  });

  it("a valueType outside the allowed set, which skips the rules that depend on it", () => {
    expect(summarize(withNode("inflation", { valueType: "measured" }))).toEqual([
      ["nodes[0].valueType", "invalid_enum"],
    ]);
  });

  it("a confidence that is not a string", () => {
    expect(summarize(withEdge("fed_rate__inflation", { confidence: 5 }))).toEqual([
      ["edges[0].confidence", "invalid_type"],
    ]);
  });

  it("a claim that is not a string", () => {
    expect(summarize(withEdge("fed_rate__inflation", { claim: 5 }))).toEqual([
      ["edges[0].claim", "invalid_type"],
    ]);
  });

  it.each([null, "wide", { min: "0", max: 10 }, { min: 0 }, { min: 0, max: Number.NaN }])(
    "a range of %j",
    (range) => {
      expect(summarize(withNode("inflation", { range }))).toEqual([
        ["nodes[0].range", "invalid_type"],
      ]);
    },
  );

  it("an unknown key inside a range", () => {
    expect(summarize(withNode("inflation", { range: { min: 0, max: 10, step: 1 } }))).toEqual([
      ["nodes[0].range.step", "unknown_key"],
    ]);
  });

  it("an index node that describes a period", () => {
    expect(summarize(withNode("spare_lever", { asOf: "2026" }))).toEqual([
      ["nodes[4].asOf", "invalid_as_of"],
    ]);
  });

  it("an infinite baseline", () => {
    expect(summarize(withNode("inflation", { baseline: Number.POSITIVE_INFINITY }))).toEqual([
      ["nodes[0].baseline", "invalid_type"],
    ]);
  });
});

describe("parseGraph", () => {
  it("returns the graph when it is valid", () => {
    const g = fixture();
    expect(parseGraph(g)).toEqual(g);
  });

  it("throws an error that names every failing path and code", () => {
    const g = fixture();
    Object.assign(find(g.nodes, "inflation"), { baseline: 11 });
    Object.assign(find(g.edges, "fed_rate__inflation"), { strength: 0.8 });
    expect(() => parseGraph(g)).toThrow(/nodes\[0\]\.baseline.*baseline_out_of_range/s);
    expect(() => parseGraph(g)).toThrow(/edges\[0\]\.strength.*invalid_strength/s);
  });
});
