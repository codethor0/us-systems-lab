import { useState } from "react";
import graphJson from "../data/graph.json";
import { parseGraph } from "../lib/validate";
import { dataStamp } from "../scenario/stamp";
import { decodeScenario } from "../scenario/url";
import type { DecodedScenario } from "../scenario/url";
import { GraphCanvas } from "./GraphCanvas";
import { ScenarioNotice } from "./ScenarioNotice";
import { changeLever, clearRuntime, createRuntime, scenarioLocation } from "./runtime";

const GRAPH = parseGraph(graphJson);
const STAMP = dataStamp(GRAPH);

interface InitialUiState {
  readonly report: DecodedScenario;
  readonly runtime: ReturnType<typeof createRuntime>;
  readonly search: string;
}

function initialUiState(): InitialUiState {
  const search = window.location.search;
  const report = decodeScenario(search, GRAPH, STAMP);
  return { report, runtime: createRuntime(GRAPH, report.levers), search };
}

export function App() {
  const [initial] = useState(initialUiState);
  const [report, setReport] = useState<DecodedScenario | null>(initial.report);
  const [reportSearch, setReportSearch] = useState(initial.search);
  const [runtime, setRuntime] = useState(initial.runtime);

  const writeLocation = (levers: ReadonlyMap<string, number>): void => {
    const next = scenarioLocation(window.location.pathname, window.location.hash, levers, STAMP);
    window.history.replaceState(null, "", next);
  };

  const handleLeverChange = (nodeId: string, value: number): void => {
    const next = changeLever(GRAPH, runtime, nodeId, value);
    setRuntime(next);
    setReport(null);
    setReportSearch("");
    writeLocation(next.levers);
  };

  const handleReset = (): void => {
    const next = clearRuntime(runtime);
    setRuntime(next);
    setReport(null);
    setReportSearch("");
    writeLocation(next.levers);
  };

  return (
    <div className="grid h-screen min-h-[640px] grid-rows-[auto_auto_1fr] overflow-hidden bg-white text-slate-900">
      <header className="border-b border-slate-200 bg-white/95 px-4 py-3 sm:px-6">
        <div className="mx-auto flex max-w-[1800px] items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-sky-700">
              Interactive causal graph
            </p>
            <h1 className="mt-1 text-xl font-semibold tracking-tight text-slate-950 sm:text-2xl">
              US Systems Lab
            </h1>
            <p className="mt-1 max-w-3xl text-xs leading-relaxed text-slate-600 sm:text-sm">
              Illustrative model only. Propagated changes are arithmetic on hand-assigned weights,
              not measured estimates, predictions, or forecasts.
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-2">
            <button
              type="button"
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:border-slate-400 hover:bg-slate-50 hover:text-slate-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600 disabled:cursor-not-allowed disabled:opacity-40"
              disabled={runtime.levers.size === 0}
              onClick={handleReset}
            >
              Reset scenario
            </button>
            <span className="text-[10px] tabular-nums text-slate-500">
              {String(runtime.levers.size)} active {runtime.levers.size === 1 ? "lever" : "levers"}
            </span>
          </div>
        </div>
        <div className="mx-auto mt-2 flex max-w-[1800px] flex-wrap gap-x-4 gap-y-1 text-[10px] text-slate-500">
          <span>Slider: scenario adjustment as a fraction of the editorial display range</span>
          <span>Dashed edge: modeled relationship</span>
          <span>Solid edge: empirical relationship</span>
          <span>URL updates automatically when a lever moves</span>
        </div>
      </header>

      <ScenarioNotice report={report} search={reportSearch} />

      <main className="usl-graph-region">
        <GraphCanvas
          graph={GRAPH}
          levers={runtime.levers}
          effects={runtime.effects}
          flash={runtime.flash}
          onLeverChange={handleLeverChange}
        />
      </main>
    </div>
  );
}
