/**
 * Reproducible numerical audit. Temporary compilation never modifies repository source.
 * Developer and CI tooling only; never ships in the built application.
 */
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";
import { exactOracle, expectedFill } from "./block-oracle.mjs";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const reportDirectory = path.join(root, ".artifacts", "math");
const graph = JSON.parse(await fs.readFile(path.join(root, "src/data/graph.json"), "utf8"));
const expect = exactOracle(graph),
  ids = graph.nodes.map((n) => n.id).sort();
const cases = [];
for (const id of ids) for (let a = -10; a <= 10; a++) cases.push([[id, a / 10]]);
for (let a = 0; a < ids.length; a++)
  for (let b = a + 1; b < ids.length; b++) {
    for (const x of [-1, 1])
      for (const y of [-1, 1])
        cases.push([
          [ids[a], x],
          [ids[b], y],
        ]);
  }
let seed = 20260921;
for (let i = 0; i < 500; i++)
  cases.push(
    ids.map((id) => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return [id, ((seed % 21) - 10) / 10];
    }),
  );
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "usl-math-audit-"));
const report = {
  status: "RUNNING",
  scenarios: cases.length,
  nodeComparisons: 0,
  maxError: 0,
  errors: [],
  mutationDetected: false,
};
function need(condition, message) {
  if (!condition) throw new Error(message);
}
function compile(text) {
  const result = ts.transpileModule(text, {
    compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext },
    reportDiagnostics: true,
  });
  need(
    !(result.diagnostics ?? []).some((d) => d.category === ts.DiagnosticCategory.Error),
    "Audit compilation failed",
  );
  return result.outputText;
}
try {
  const propagation = await fs.readFile(path.join(root, "src/lib/propagation.ts"), "utf8");
  need(
    /DEFAULT_PARAMS[^=]*=\s*\{\s*maxHops:\s*3,\s*decay:\s*0\.7\s*\}/.test(propagation),
    "Review oracle after parameter change",
  );
  await fs.writeFile(path.join(temporary, "propagation.mjs"), compile(propagation));
  const effectText = await fs.readFile(path.join(root, "src/model/effects.ts"), "utf8");
  const compiled = compile(effectText);
  need(compiled.split('"../lib/propagation"').length === 2, "Review core import before audit");
  const effectCode = compiled.replace('"../lib/propagation"', '"./propagation.mjs"');
  await fs.writeFile(path.join(temporary, "effects.mjs"), effectCode);
  await fs.writeFile(
    path.join(temporary, "view.mjs"),
    compile(await fs.readFile(path.join(root, "src/ui/blocks/view.ts"), "utf8")),
  );
  const { combineEffects } = await import(pathToFileURL(path.join(temporary, "effects.mjs")).href);
  const { blockPosition, fillColor } = await import(
    pathToFileURL(path.join(temporary, "view.mjs")).href
  );
  need(
    expect([["productivity", 1]]).real_avg_hourly_earnings.delta === 0.25,
    "Hand proof: productivity -> earnings",
  );
  need(
    expect([["federal_debt", 0.6]]).net_interest.filled === 73,
    "Hand proof: debt -> interest half-block",
  );
  for (let c = 0; c < cases.length; c++) {
    const entries = cases[c],
      reference = expect(entries);
    const effects = combineEffects(graph, new Map(entries));
    const actual = new Map(effects.map((e) => [e.nodeId, e]));
    const reordered = combineEffects(
      { nodes: [...graph.nodes].reverse(), edges: [...graph.edges].reverse() },
      new Map([...entries].reverse()),
    );
    need(JSON.stringify(effects) === JSON.stringify(reordered), "Determinism failed");
    for (const id of ids) {
      const wanted = reference[id],
        seen = actual.get(id) ?? { own: 0, propagated: 0, total: 0, delta: 0 };
      for (const key of ["own", "propagated", "total", "delta"]) {
        const difference = Math.abs(wanted[key] - seen[key]);
        report.maxError = Math.max(report.maxError, difference);
        if (difference > 1e-12)
          report.errors.push({ scenario: c, id, key, expected: wanted[key], actual: seen[key] });
      }
      const drawn = blockPosition(seen.delta);
      if (drawn.filled !== wanted.filled)
        report.errors.push({
          scenario: c,
          id,
          key: "filled",
          expected: wanted.filled,
          actual: drawn.filled,
        });
      const direction =
        wanted.delta > 0 ? "Increased" : wanted.delta < 0 ? "Decreased" : "Unchanged";
      if (drawn.direction !== direction)
        report.errors.push({
          scenario: c,
          id,
          key: "direction",
          expected: direction,
          actual: drawn.direction,
        });
      const wantedColor = expectedFill(wanted.position, wanted.idle);
      if (fillColor(drawn.position, wanted.idle) !== wantedColor)
        report.errors.push({ scenario: c, id, key: "color" });
      report.nodeComparisons++;
    }
  }
  need(
    effectCode.split("target.propagated += effect.raw;").length === 2,
    "Mutation anchor changed",
  );
  await fs.writeFile(
    path.join(temporary, "bad.mjs"),
    effectCode.replace("target.propagated += effect.raw;", "target.propagated -= effect.raw;"),
  );
  const bad = await import(pathToFileURL(path.join(temporary, "bad.mjs")).href);
  const mutated = bad
    .combineEffects(graph, new Map([["productivity", 1]]))
    .find((e) => e.nodeId === "real_avg_hourly_earnings");
  report.mutationDetected =
    mutated?.delta !== expect([["productivity", 1]]).real_avg_hourly_earnings.delta;
  need(report.mutationDetected, "Known-bad sign was not caught");
  need(
    report.errors.length === 0,
    "Numerical mismatches: " + JSON.stringify(report.errors.slice(0, 5)),
  );
  report.status = "PASS";
  console.log(
    `MODEL AUDIT PASS: ${String(report.scenarios)} scenarios, ${String(report.nodeComparisons)} node comparisons, sign mutation detected.`,
  );
} catch (error) {
  report.status = "FAIL";
  report.error = error instanceof Error ? error.message : String(error);
  console.error(report.error);
  process.exitCode = 1;
} finally {
  if (process.env.USL_MATH_REPORT === "1") {
    await fs.mkdir(reportDirectory, { recursive: true });
    await fs.writeFile(
      path.join(reportDirectory, "model-audit.json"),
      JSON.stringify(report, null, 2) + "\n",
    );
  }
  await fs.rm(temporary, { recursive: true, force: true });
}
