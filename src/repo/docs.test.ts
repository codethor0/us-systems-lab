/**
 * Tests for README.md, CONTRIBUTING.md and LICENSE, written before the documents.
 *
 * The project's central honesty rule is that a reader is never told more than the data supports.
 * These tests keep the documents tied to the data: the disclosure must sit near the top, the
 * numbers the README states about the graph must match graph.json, every citation must appear,
 * and the contribution rules must name every value the schema accepts.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import graphJson from "../data/graph.json";
import { CATEGORIES, STRENGTH_TIERS, VALUE_TYPES, VERIFICATIONS } from "../lib/schema";
import { parseGraph } from "../lib/validate";

const root = fileURLToPath(new URL("../../", import.meta.url));

function read(relative: string): string {
  return readFileSync(resolve(root, relative), "utf8");
}

function collapse(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Prose with blockquote markers and line breaks removed, so that rewrapping cannot break a match. */
function prose(text: string): string {
  return collapse(text.replace(/^>\s?/gm, ""));
}

/** The text from a heading up to the next heading of the same or higher level. */
function section(text: string, heading: RegExp): string {
  const start = heading.exec(text);
  if (start === null) throw new Error(`no heading matching ${String(heading)}`);
  const rest = text.slice(start.index + start[0].length);
  const next = /^## /m.exec(rest);
  return next === null ? rest : rest.slice(0, next.index);
}

const graph = parseGraph(graphJson);
const readme = read("README.md");
const readmeText = prose(readme);
const contributing = read("CONTRIBUTING.md");
const contributingText = prose(contributing);

const MIT_BODY = collapse(`
  Permission is hereby granted, free of charge, to any person obtaining a copy of this software and
  associated documentation files (the "Software"), to deal in the Software without restriction, including
  without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
  copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the
  following conditions:

  The above copyright notice and this permission notice shall be included in all copies or substantial
  portions of the Software.

  THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT
  LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO
  EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
  IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
  USE OR OTHER DEALINGS IN THE SOFTWARE.
`);

describe("LICENSE", () => {
  const license = collapse(read("LICENSE"));

  it("is the MIT license, the standard SPDX text word for word after the copyright line", () => {
    const match =
      /^MIT License Copyright \(c\) 2026 (\S.*?) (Permission is hereby granted.*)$/.exec(license);
    expect(
      match,
      "expected: MIT License, a 2026 copyright line, then the standard text",
    ).not.toBeNull();
    expect(match?.[2]).toBe(MIT_BODY);
  });

  it("names a copyright holder", () => {
    expect(/Copyright \(c\) 2026 (\S.*?) Permission/.exec(license)?.[1]?.length).toBeGreaterThan(0);
  });

  it("agrees with the license field in package.json", () => {
    const pkg = JSON.parse(read("package.json")) as { license: string };
    expect(pkg.license).toBe("MIT");
  });
});

describe("README: the disclosure", () => {
  const top = prose(readme.split("\n").slice(0, 25).join("\n"));

  it("says within the first 25 lines that this is an illustrative model", () => {
    expect(top).toMatch(/illustrative model/i);
  });

  it("says within the first 25 lines that it is not a predictive tool or a forecast", () => {
    expect(top).toMatch(/not a predictive/i);
    expect(top).toMatch(/not a forecast/i);
  });

  it("uses the word forecast only in the negative, everywhere in the README", () => {
    const occurrences = [...readmeText.matchAll(/forecast/gi)];
    expect(occurrences.length).toBeGreaterThan(0);
    for (const match of occurrences) {
      expect(readmeText.slice(Math.max(0, match.index - 6), match.index).toLowerCase()).toBe(
        "not a ",
      );
    }
  });

  it("says the propagated numbers are arithmetic on assigned weights and not estimates", () => {
    expect(readmeText).toMatch(/arithmetic/i);
    expect(readmeText).toMatch(/not estimates/i);
  });
});

describe("README: empirical and modeled", () => {
  const explanation = prose(section(readme, /^## .*empirical.*modeled.*$/im));

  it("has a section that defines both labels in plain language", () => {
    expect(explanation).toMatch(/\bempirical\b/i);
    expect(explanation).toMatch(/\bmodeled\b/i);
    expect(explanation).toMatch(/citation|cited/i);
  });

  it("says a citation supports the direction and not the size", () => {
    expect(explanation).toMatch(/not (a )?(measured )?(coefficient|the size)/i);
  });

  it("explains the separate labels for starting values", () => {
    for (const word of VERIFICATIONS) expect(explanation).toContain(word);
  });

  it("states counts that match graph.json exactly", () => {
    const stated =
      /The graph currently has (\d+) nodes and (\d+) edges: (\d+) empirical and (\d+) modeled\./.exec(
        explanation,
      );
    expect(
      stated,
      "expected the sentence 'The graph currently has N nodes and M edges: E empirical and D modeled.'",
    ).not.toBeNull();
    expect(stated?.slice(1).map(Number)).toEqual([
      graph.nodes.length,
      graph.edges.length,
      graph.edges.filter((e) => e.confidence === "empirical").length,
      graph.edges.filter((e) => e.confidence === "modeled").length,
    ]);
  });
});

describe("README: data and citations", () => {
  it("cites the source of every node that has one, by its exact URL", () => {
    const cited = graph.nodes.filter((n) => n.sourceUrl !== null);
    expect(cited.length).toBeGreaterThan(0);
    for (const node of cited) expect(readme, node.id).toContain(String(node.sourceUrl));
  });

  it("names every indicator that has a baseline", () => {
    for (const node of graph.nodes.filter((n) => n.baseline !== null)) {
      expect(readme, node.id).toContain(node.label);
    }
  });

  it("says the edges are editorial drafts that the posts do not contain", () => {
    expect(readmeText).toMatch(/editorial draft/i);
  });

  it("says in the data section which nodes have no baseline, so none is read as measured", () => {
    const data = prose(section(readme, /^## Data and sources$/m));
    expect(data).toMatch(/no baseline/i);
    for (const node of graph.nodes.filter((n) => n.baseline === null)) {
      expect(data, node.id).toContain(node.id);
    }
  });
});

describe("CONTRIBUTING: the hard rule and the schema", () => {
  it("has a section on empirical and modeled edges", () => {
    expect(() => section(contributing, /^## .*empirical.*modeled.*$/im)).not.toThrow();
  });

  it("lists the three source fields an empirical edge needs, each as its own bullet", () => {
    const rule = section(contributing, /^## .*empirical.*modeled.*$/im);
    for (const field of ["sourceUrl", "sourceDetail", "retrievedDate"]) {
      expect(rule).toMatch(new RegExp("^\\s*- `" + field + "`:", "m"));
    }
  });

  it("makes modeled the default", () => {
    expect(contributingText).toMatch(
      /default(s)? to (a )?modeled|modeled by default|modeled unless/i,
    );
  });

  it("forbids the words prove, proves and proven in a claim", () => {
    for (const word of ["prove", "proves", "proven"]) expect(contributingText).toContain(word);
  });

  it.each([...CATEGORIES, ...VALUE_TYPES, ...VERIFICATIONS])(
    "lists the schema value %s",
    (value) => {
      expect(contributingText).toContain(value);
    },
  );

  it("lists the strength tiers exactly as the schema defines them, in full wherever they appear", () => {
    expect(contributingText).toContain(STRENGTH_TIERS.join(", "));
    const partial = contributingText.match(/0\.25, 0\.5, 0\.75(?!, 1)/);
    expect(partial, "a strength tier list in CONTRIBUTING.md is missing its last tier").toBeNull();
  });

  it("points at the place where the primary-source allowlist lives", () => {
    expect(contributingText).toContain("src/lib/validate.ts");
  });
});

describe("CONTRIBUTING: process", () => {
  it("tells contributors to run npm run verify before opening a pull request", () => {
    expect(contributingText).toContain("npm run verify");
  });

  it("names the Conventional Commit types", () => {
    for (const type of ["feat", "fix", "docs", "chore"])
      expect(contributingText).toContain(`${type}:`);
  });

  it("states the no-emoji rule", () => {
    expect(contributingText).toMatch(/no emoji/i);
  });

  it("explains that unsigned commits on a pull request branch can block the merge", () => {
    expect(contributingText).toMatch(/signed/i);
    expect(contributingText).toMatch(/pull request branch|head branch/i);
    expect(contributingText).toContain("about-protected-branches");
  });

  it("tells contributors that changing an edge changes tests that lock the edge set", () => {
    expect(contributingText).toContain("src/data/graph.test.ts");
    expect(contributingText).toContain("src/lib/propagation.test.ts");
  });

  it("says that hate_crimes has no edges on purpose", () => {
    expect(contributingText).toContain("hate_crimes");
  });
});

describe("links between the documents resolve", () => {
  it.each(["README.md", "CONTRIBUTING.md", "DEPLOYMENT.md"])("%s", (file) => {
    const text = read(file);
    const targets = [...text.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)]
      .map((m) => m[1] ?? "")
      .filter((target) => !/^(https?:|mailto:|#)/.test(target));
    for (const target of targets) {
      const path = resolve(dirname(resolve(root, file)), target.split("#")[0] ?? "");
      expect(existsSync(path), `${file} links to ${target}`).toBe(true);
    }
  });

  it("README links to the other documents and to the data", () => {
    for (const target of ["LICENSE", "CONTRIBUTING.md", "DEPLOYMENT.md", "src/data/graph.json"]) {
      expect(readme).toContain(`](${target})`);
    }
  });
});
