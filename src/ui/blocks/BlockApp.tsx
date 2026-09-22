import { useEffect, useRef } from "react";
import graphJson from "../../data/graph.json";
import { parseGraph } from "../../lib/validate";
import { combineEffects } from "../../model/effects";
import { dataStamp } from "../../scenario/stamp";
import { decodeScenario } from "../../scenario/url";
import { formatBaseline, scenarioParametersPresent } from "../present";
import { normalizeLeversForUi, scenarioLocation } from "../runtime";
import { mountBlockBoard } from "./board";
import type { BoardServices } from "./board";
import { BLOCK_BUILD } from "./build";
import "./board.css";

const GRAPH = parseGraph(graphJson);
const STAMP = dataStamp(GRAPH);
const SERVICES: BoardServices = {
  build: BLOCK_BUILD,
  stamp: STAMP,
  calculate: (levers) => combineEffects(GRAPH, levers),
  baseline: formatBaseline,
  location: (levers) =>
    scenarioLocation(window.location.pathname, window.location.hash, levers, STAMP),
  load: (search) => {
    const report = decodeScenario(search, GRAPH, STAMP);
    const warnings = report.problems.map((problem) => problem.message);
    if (report.stamp === "stale")
      warnings.push("This link uses a different model data stamp. Results may differ.");
    if (scenarioParametersPresent(search) && report.stamp === "missing")
      warnings.push("This link has no data stamp; model compatibility was not verified.");
    if (report.problemsOmitted > 0)
      warnings.push(`${String(report.problemsOmitted)} additional link problems were omitted.`);
    return { levers: normalizeLeversForUi(report.levers), warnings };
  },
};

export function BlockApp() {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const current = host.current;
    if (current === null) throw new Error("Block Board host is unavailable");
    return mountBlockBoard(current, GRAPH, SERVICES);
  }, []);
  return <div ref={host} />;
}
