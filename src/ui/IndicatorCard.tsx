import type { GraphNode } from "../lib/schema";
import type { NodeDescription } from "../model/explain";
import { formatBaseline, formatEditorialRange, leverLabel, leverPercent } from "./present";

export interface IndicatorCardProps {
  readonly node: GraphNode;
  readonly lever: number;
  readonly description: NodeDescription | null;
  readonly flashKey: number;
  readonly onLeverChange: (nodeId: string, value: number) => void;
}

function stateClasses(description: NodeDescription | null): string {
  if (description?.direction === "up") return "border-sky-400 shadow-sky-100/80";
  if (description?.direction === "down") return "border-violet-400 shadow-violet-100/80";
  return "border-slate-200 shadow-slate-200/70";
}

export function IndicatorCard({
  node,
  lever,
  description,
  flashKey,
  onLeverChange,
}: IndicatorCardProps) {
  const sliderId = `lever-${node.id}`;
  const effectId = `effect-${node.id}`;
  const rangeId = `range-${node.id}`;
  const effectHeadline = description?.headline ?? `${node.label}: no visible change`;
  const direction = description?.direction ?? "none";
  const bucket = description?.bucket ?? "negligible";

  return (
    <article
      className={`relative h-full w-full overflow-hidden rounded-xl border bg-white p-3 text-slate-900 shadow-sm ${stateClasses(description)}`}
      data-node-id={node.id}
      data-effect={direction}
      data-bucket={bucket}
      title={node.description}
    >
      {flashKey > 0 ? (
        <span
          key={flashKey}
          className="usl-node-flash pointer-events-none absolute inset-0 rounded-xl"
          data-flash-key={flashKey}
          aria-hidden="true"
        />
      ) : null}

      <div className="flex items-center justify-between gap-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
        <span>{node.category}</span>
        <span>{node.valueType}</span>
      </div>

      <h2 className="mt-1 line-clamp-2 text-sm font-semibold leading-tight text-slate-950">
        {node.label}
      </h2>

      <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-slate-700">
        <span className="truncate" title={formatBaseline(node)}>
          {formatBaseline(node)}
        </span>
        {node.sourceUrl === null ? null : (
          <a
            className="nodrag nopan shrink-0 text-sky-700 underline decoration-sky-300 underline-offset-2 hover:text-sky-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600"
            href={node.sourceUrl}
            target="_blank"
            rel="noreferrer"
            aria-label="Baseline source"
          >
            Source
          </a>
        )}
      </div>

      <p
        id={rangeId}
        className="mt-1 truncate text-[10px] text-slate-500"
        title={formatEditorialRange(node)}
      >
        Display scale: {formatEditorialRange(node)}
      </p>

      <div className="nodrag nopan mt-2">
        <div className="flex items-center justify-between gap-2 text-[10px]">
          <label className="font-medium text-slate-700" htmlFor={sliderId}>
            Scenario adjustment
          </label>
          <output className="tabular-nums text-slate-500" htmlFor={sliderId}>
            {leverLabel(lever)}
          </output>
        </div>
        <input
          id={sliderId}
          className="nodrag nopan mt-1 h-4 w-full cursor-pointer accent-sky-600"
          type="range"
          min={-100}
          max={100}
          step={10}
          value={leverPercent(lever)}
          aria-label={`Scenario adjustment for ${node.label}`}
          aria-describedby={`${rangeId} ${effectId}`}
          onChange={(event) => {
            onLeverChange(node.id, Number(event.currentTarget.value) / 100);
          }}
        />
      </div>

      <p
        id={effectId}
        className="mt-1 truncate text-[10px] font-medium text-slate-700"
        title={description?.whyText ?? effectHeadline}
      >
        {effectHeadline}
      </p>
    </article>
  );
}
