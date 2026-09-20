import type { GraphNode } from "../lib/schema";

const NUMBER = new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 });

function formatNumber(value: number): string {
  return NUMBER.format(value);
}

function formatValue(value: number, unit: string): string {
  if (unit === "$") return `$${formatNumber(value)}`;
  if (unit === "$T") return `$${formatNumber(value)}T`;
  return `${formatNumber(value)} ${unit}`;
}

export function formatBaseline(node: GraphNode): string {
  if (node.baseline === null) {
    return node.valueType === "index" ? "No measured baseline" : "Baseline pending";
  }
  return formatValue(node.baseline, node.unit);
}

export function formatEditorialRange(node: GraphNode): string {
  const min = formatValue(node.range.min, node.unit);
  const max = formatValue(node.range.max, node.unit);
  if (node.unit === "$" || node.unit === "$T") return `${min} to ${max}`;
  return `${formatNumber(node.range.min)} to ${formatNumber(node.range.max)} ${node.unit}`;
}

export function leverPercent(lever: number): number {
  return Math.round(lever * 100);
}

export function leverLabel(lever: number): string {
  const percent = leverPercent(lever);
  const sign = percent > 0 ? "+" : "";
  return `${sign}${String(percent)}% of display range`;
}

export function scenarioParametersPresent(search: string): boolean {
  const parameters = new URLSearchParams(search);
  return ["v", "d", "l"].some((name) => parameters.has(name));
}
