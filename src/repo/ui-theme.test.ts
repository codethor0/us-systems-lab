import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const app = readFileSync("src/ui/App.tsx", "utf8");
const card = readFileSync("src/ui/IndicatorCard.tsx", "utf8");
const notice = readFileSync("src/ui/ScenarioNotice.tsx", "utf8");
const graphCanvas = readFileSync("src/ui/GraphCanvas.tsx", "utf8");
const css = readFileSync("src/styles.css", "utf8");

describe("light presentation contract", () => {
  it("uses a white shell, white cards, and light notices", () => {
    expect(app).toContain("bg-white text-slate-900");
    expect(app).toContain("border-slate-200 bg-white/95");
    expect(app).toContain("text-slate-950");
    expect(card).toContain("bg-white p-3 text-slate-900 shadow-sm");
    expect(card).toContain("border-slate-200 shadow-slate-200/70");
    expect(card).toContain("leading-tight text-slate-950");
    expect(card).not.toContain("leading-tight text-white");
    expect(notice).toContain("bg-amber-50");
    expect(notice).toContain("bg-slate-50");
    expect(notice).toContain("bg-rose-50");
  });

  it("keeps the canvas and graph chrome legible on white", () => {
    expect(css).toContain("background: #ffffff;");
    expect(css).toMatch(/\.react-flow__handle \{[\s\S]*background: #ffffff;/);
    expect(graphCanvas).toContain('<Background color="#cbd5e1" gap={24} size={1} />');
  });
});
