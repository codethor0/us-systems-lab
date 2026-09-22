import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import graphJson from "../data/graph.json";
import { parseGraph } from "../lib/validate";

/**
 * Independent connectivity facts about the stored graph, kept in step with README.md.
 * Nothing here changes the model. It exists so that the documented statement "moving these
 * indicators changes nothing else" cannot silently drift from graph.json.
 */
const graph = parseGraph(graphJson);
const ids = graph.nodes.map((node) => node.id);
const hasOutgoing = new Set(graph.edges.map((edge) => edge.from));
const hasIncoming = new Set(graph.edges.map((edge) => edge.to));

const NO_OUTGOING = [
  "debt_growth_rate",
  "food_insecurity",
  "hate_crimes",
  "homelessness",
  "institutional_confidence",
  "net_interest",
  "payrolls_headline",
  "savings_rate",
];

describe("graph connectivity", () => {
  it("has exactly the documented indicators with no outgoing relationship", () => {
    expect(ids.filter((id) => !hasOutgoing.has(id)).sort()).toEqual(NO_OUTGOING);
  });

  it("has exactly one indicator with no relationship at all, on purpose", () => {
    expect(ids.filter((id) => !hasOutgoing.has(id) && !hasIncoming.has(id))).toEqual([
      "hate_crimes",
    ]);
  });

  it("documents every no-outgoing indicator in the README by id", () => {
    const readme = readFileSync("README.md", "utf8");
    const section = /## What moves what([\s\S]*?)(?=\n## )/.exec(readme)?.[1] ?? "";
    for (const id of NO_OUTGOING) expect(section, id).toContain(id);
  });
});
