/** Display coordinates only. Never feed calculated block counts back into the model. */
export interface BlockPosition {
  readonly position: number;
  readonly filled: number;
  readonly direction: "Increased" | "Decreased" | "Unchanged";
}

/** Treat machine-roundoff noise as neutral in presentation, not in the model. */
function displayNumber(value: number): number {
  return Math.abs(value) <= 32 * Number.EPSILON ? 0 : value;
}

function roundStable(value: number): number {
  const half = Math.round(value * 2) / 2;
  const tolerance = 32 * Number.EPSILON * Math.max(1, Math.abs(value));
  return Math.round(Math.abs(value - half) <= tolerance ? half : value);
}

export function blockPosition(delta: number): BlockPosition {
  if (!Number.isFinite(delta) || Math.abs(delta) > 1) {
    throw new RangeError("Block response must be finite and in [-1, 1]");
  }
  const shown = displayNumber(delta);
  return {
    position: 50 + 50 * shown,
    filled: 50 + Math.sign(shown) * roundStable(Math.abs(shown) * 50),
    direction: shown > 0 ? "Increased" : shown < 0 ? "Decreased" : "Unchanged",
  };
}

/** Preserve the existing 21-position manual input grid, now displayed as 0..100. */
export function inputLever(level: number): number {
  if (!Number.isFinite(level) || level < 0 || level > 100) {
    throw new RangeError("Input position must be finite and in [0, 100]");
  }
  const offset = level - 50;
  return (Math.sign(offset) * Math.round(Math.abs(offset) / 5)) / 10 + 0;
}

export function signed(value: number): string {
  const shown = displayNumber(value);
  const formatted = new Intl.NumberFormat("en-US", { maximumFractionDigits: 4 }).format(shown + 0);
  // A real small response must not be displayed as +0 or -0.
  const text =
    shown !== 0 && (formatted === "0" || formatted === "-0") ? shown.toExponential(2) : formatted;
  return shown > 0 ? `+${text}` : text;
}

export function levelText(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 }).format(value);
}

export function fillColor(position: number, idle: boolean): string {
  return idle ? "#c84040" : `hsl(${String(roundStable(position * 1.2))} 65% 35%)`;
}

function count(n: number, one: string, many: string): string {
  return `${String(n)} ${n === 1 ? one : many}`;
}

/** Status line text. "Moved" means the tile's combined result differs from the neutral 50. */
export function summaryText(indicators: number, inputs: number, moved: number): string {
  return `${String(indicators)} indicators / ${count(inputs, "manual input", "manual inputs")} / ${count(moved, "tile moved", "tiles moved")}`;
}

export function movedText(moved: number): string {
  return `${count(moved, "tile", "tiles")} moved.`;
}
