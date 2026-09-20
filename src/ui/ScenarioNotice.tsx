import type { DecodedScenario } from "../scenario/url";
import { scenarioParametersPresent } from "./present";

export interface ScenarioNoticeProps {
  readonly report: DecodedScenario | null;
  readonly search: string;
}

export function ScenarioNotice({ report, search }: ScenarioNoticeProps) {
  if (report === null) return null;
  const hasScenario = scenarioParametersPresent(search);
  const showMissing = hasScenario && report.stamp === "missing" && report.problems.length === 0;
  const hasProblems = report.problems.length > 0 || report.problemsOmitted > 0;
  if (report.stamp !== "stale" && !showMissing && !hasProblems) return null;

  return (
    <div className="space-y-2 px-4 pb-3 sm:px-6">
      {report.stamp === "stale" ? (
        <section
          className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900"
          role="status"
        >
          This scenario link was created against a different graph data stamp. The lever settings
          were loaded, but the results may differ from when the link was created.
        </section>
      ) : null}

      {showMissing ? (
        <section
          className="rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-xs text-slate-700"
          role="status"
        >
          This scenario link has no data stamp. The lever settings were loaded, but compatibility
          with the current graph could not be checked.
        </section>
      ) : null}

      {hasProblems ? (
        <section
          className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-900"
          role="alert"
        >
          <p className="font-semibold">Some parts of the link were ignored.</p>
          <ul className="mt-1 list-disc space-y-1 pl-4">
            {report.problems.map((problem, index) => (
              <li key={`${problem.code}-${String(index)}`}>{problem.message}</li>
            ))}
          </ul>
          {report.problemsOmitted > 0 ? (
            <p className="mt-1">
              {String(report.problemsOmitted)} additional link problems were not shown.
            </p>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
