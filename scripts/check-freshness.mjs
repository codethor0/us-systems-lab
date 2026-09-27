/**
 * Freshness report for stored baselines. Offline and deterministic: it reads graph.json and a date,
 * and fetches nothing, so a publisher's site being down can never fail it.
 *
 *   npm run check:freshness                       report as of today (UTC)
 *   npm run check:freshness -- --today 2026-09-27 report as of a fixed date
 *   npm run check:freshness -- --strict           exit 1 when any baseline is flagged
 *
 * A flag means a newer release has probably been published, judged from the node's cadence and the
 * end of its period (src/lib/freshness.ts). It does not mean the stored value is wrong. Refresh a
 * flagged node by reading the publisher's page and updating baseline, asOf, sourceUrl, sourceDetail
 * and retrievedDate together, as CONTRIBUTING.md describes. The weekly CI run writes this report to
 * the job summary and never fails on it.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const strict = args.includes("--strict");
const todayIndex = args.indexOf("--today");
const today = todayIndex >= 0 ? args[todayIndex + 1] : new Date().toISOString().slice(0, 10);
// Round-trip the date, so an impossible one such as 2026-02-30 is refused, not rolled over.
const parsed = new Date(`${today ?? ""}T00:00:00Z`);
if (
  !/^\d{4}-\d{2}-\d{2}$/.test(today ?? "") ||
  Number.isNaN(parsed.getTime()) ||
  parsed.toISOString().slice(0, 10) !== today
) {
  console.error("--today needs a date as YYYY-MM-DD");
  process.exit(2);
}

const source = await fs.readFile(path.join(root, "src/lib/freshness.ts"), "utf8");
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "usl-freshness-"));
let freshness;
try {
  const file = path.join(temporary, "freshness.mjs");
  await fs.writeFile(
    file,
    ts.transpileModule(source, {
      compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext },
    }).outputText,
  );
  ({ freshness } = await import(pathToFileURL(file).href));
} finally {
  await fs.rm(temporary, { recursive: true, force: true });
}

const graph = JSON.parse(await fs.readFile(path.join(root, "src/data/graph.json"), "utf8"));
const rows = graph.nodes.map((node) => ({ node, result: freshness(node, today) }));
const flagged = rows.filter((row) => row.result.status === "check");
const lines = [
  `## Baseline freshness as of ${today}`,
  "",
  `${String(flagged.length)} of ${String(rows.length)} baselines may have a newer release. A flag is a prompt to read the source, not a finding that the value is wrong.`,
  "",
  "| Indicator | As of | Cadence | Days since period end | Status |",
  "| --- | --- | --- | --- | --- |",
  ...rows.map(
    ({ node, result }) =>
      `| ${node.id} | ${node.asOf ?? "none"} | ${node.cadence ?? "none"} | ${result.ageDays === null ? "n/a" : String(result.ageDays)} | ${result.status === "check" ? "check source" : result.status === "current" ? "current" : "not applicable"} |`,
  ),
  "",
];
const text = lines.join("\n");
console.log(text);
if (process.env.GITHUB_STEP_SUMMARY) await fs.appendFile(process.env.GITHUB_STEP_SUMMARY, text);
if (strict && flagged.length > 0) process.exit(1);
