import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const canvas = readFileSync("src/ui/GraphCanvas.tsx", "utf8");
const card = readFileSync("src/ui/IndicatorCard.tsx", "utf8");

describe("React Flow embedded-control interaction contract", () => {
  it("keeps nodes fixed and non-selectable while explicitly allowing pointer events", () => {
    expect(canvas).toContain("draggable: false,");
    expect(canvas).toContain("selectable: false,");
    expect(canvas).toContain('style: { pointerEvents: "all" },');

    expect(canvas).toContain("nodesDraggable={false}");
    expect(canvas).toContain("nodesConnectable={false}");
    expect(canvas).toContain("elementsSelectable={false}");
  });

  it("marks the slider controls as non-dragging and non-panning", () => {
    expect(card).toMatch(/className="nodrag nopan[^"]*"/);
    expect(card).toContain('type="range"');
  });
});
