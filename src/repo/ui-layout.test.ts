import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const app = readFileSync("src/ui/App.tsx", "utf8");
const css = readFileSync("src/styles.css", "utf8");

function block(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, "m").exec(css)?.[1] ?? "";
}

describe("browser shell layout contract", () => {
  it("pins the graph to row 3 because ScenarioNotice can render null", () => {
    expect(app).toContain("grid-rows-[auto_auto_1fr]");
    expect(app).toContain("<ScenarioNotice report={report} search={reportSearch} />");
    expect(app).toContain('className="usl-graph-region"');

    const graphRegion = block(".usl-graph-region");
    expect(graphRegion).toContain("grid-row: 3;");
    expect(graphRegion).toContain("position: relative;");
    expect(graphRegion).toContain("min-height: 0;");
  });
});
