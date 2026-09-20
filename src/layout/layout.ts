/**
 * Layered layout: where each node of the graph goes.
 *
 * Pure, and free of dependencies, so that the placement of every node can be reviewed as code and
 * checked by hand. It is a plain layered layout and not an optimizer. It does not try to minimize
 * crossings, and a different row order could draw fewer. What it guarantees is under test.
 *
 * LAYERS. A node's layer is the length of the longest path that reaches it, so an edge always points
 * to a later layer. Sources, and nodes with no edges at all, are layer 0. A layer is drawn as a column.
 *
 * CYCLES. A cycle has no longest path. A depth-first search that starts from the ids in sorted order,
 * and follows each node's targets in sorted order, finds the back edges: the edges that point to a node
 * still on the search stack. They are ignored for layering and reported, so the caller can draw them
 * differently. Which edge of a cycle is called the back edge depends on where the search starts, and the
 * choice is not optimal. It is deterministic. Removing the back edges leaves an acyclic graph. Self
 * loops are ignored. The search is iterative, so a graph of any depth cannot overflow the stack.
 *
 * ROWS. Within a layer, nodes are ordered by category, in the order the caller supplies, then by
 * category name, then by id, all compared by UTF-16 code unit. A category that the caller did not list
 * comes after the listed ones. If a category is listed twice, its first position counts. Each layer is
 * centered vertically against the tallest one.
 *
 * COORDINATES, for the top-left corner of a box of nodeWidth by nodeHeight:
 *
 *   x = layer * (nodeWidth + columnGap)
 *   y = (row + (rows - layerSize) / 2) * (nodeHeight + rowGap)
 *
 * The result does not depend on the order in which nodes and edges arrive. Time is O((V + E) log V).
 */

export interface LayoutNode {
  readonly id: string;
  readonly category: string;
}

export interface LayoutEdge {
  readonly from: string;
  readonly to: string;
}

export interface LayoutGraph {
  readonly nodes: readonly LayoutNode[];
  readonly edges: readonly LayoutEdge[];
}

export interface LayoutOptions {
  readonly nodeWidth: number;
  readonly nodeHeight: number;
  /** Horizontal space between one column of boxes and the next. */
  readonly columnGap: number;
  /** Vertical space between one row of boxes and the next. */
  readonly rowGap: number;
  /** Categories in the order their rows should appear within a layer. */
  readonly categoryOrder: readonly string[];
}

/** The box size and gaps are editorial. The interface passes the size it actually draws. */
export const DEFAULT_LAYOUT_OPTIONS: LayoutOptions = {
  nodeWidth: 200,
  nodeHeight: 72,
  columnGap: 96,
  rowGap: 24,
  categoryOrder: [],
};

export interface Placement {
  readonly id: string;
  readonly layer: number;
  /** The row within the layer, from 0 at the top. */
  readonly row: number;
  readonly x: number;
  readonly y: number;
}

export interface BackEdge {
  readonly from: string;
  readonly to: string;
}

export interface Layout {
  /** One placement per node, sorted by id. */
  readonly placements: readonly Placement[];
  /** The number of columns. */
  readonly layers: number;
  /** The number of rows in the tallest column. */
  readonly rows: number;
  readonly width: number;
  readonly height: number;
  /** The edges ignored for layering because they close a cycle, sorted by from and then to. */
  readonly backEdges: readonly BackEdge[];
}

interface Frame {
  readonly node: string;
  next: number;
}

/** Ids are unique where this is used, so two of them never compare equal. */
function compareIds(a: string, b: string): number {
  return a < b ? -1 : 1;
}

function compareText(a: string, b: string): number {
  if (a < b) return -1;
  return a > b ? 1 : 0;
}

function assertPositive(name: string, value: number): void {
  if (!(Number.isFinite(value) && value > 0)) {
    throw new RangeError(`${name} must be a positive finite number, got ${String(value)}`);
  }
}

function assertNotNegative(name: string, value: number): void {
  if (!(Number.isFinite(value) && value >= 0)) {
    throw new RangeError(`${name} must be a finite number of at least 0, got ${String(value)}`);
  }
}

/** Throws RangeError for a bad option, a repeated node id, or an edge that names an unknown node. */
export function layoutGraph(graph: LayoutGraph, options: Partial<LayoutOptions> = {}): Layout {
  const { nodeWidth, nodeHeight, columnGap, rowGap, categoryOrder } = {
    ...DEFAULT_LAYOUT_OPTIONS,
    ...options,
  };
  assertPositive("nodeWidth", nodeWidth);
  assertPositive("nodeHeight", nodeHeight);
  assertNotNegative("columnGap", columnGap);
  assertNotNegative("rowGap", rowGap);

  const categories = new Map<string, string>();
  for (const node of graph.nodes) {
    if (categories.has(node.id)) throw new RangeError(`node id "${node.id}" is repeated`);
    categories.set(node.id, node.category);
  }
  const ids = [...categories.keys()].sort(compareIds);

  const targetSets = new Map<string, Set<string>>(ids.map((id) => [id, new Set()]));
  for (const edge of graph.edges) {
    if (!categories.has(edge.from) || !categories.has(edge.to)) {
      throw new RangeError(
        `edge from "${edge.from}" to "${edge.to}" names a node that does not exist`,
      );
    }
    if (edge.from !== edge.to) (targetSets.get(edge.from) as Set<string>).add(edge.to);
  }
  const targets = new Map<string, string[]>(
    ids.map((id) => [id, [...(targetSets.get(id) as Set<string>)].sort(compareIds)]),
  );

  // Back edges, by an iterative depth-first search. State 1 is on the stack, 2 is finished.
  const state = new Map<string, 1 | 2>();
  const backEdges: BackEdge[] = [];
  for (const root of ids) {
    if (state.has(root)) continue;
    state.set(root, 1);
    const stack: Frame[] = [{ node: root, next: 0 }];
    while (stack.length > 0) {
      const frame = stack[stack.length - 1] as Frame;
      const outgoing = targets.get(frame.node) as string[];
      if (frame.next >= outgoing.length) {
        state.set(frame.node, 2);
        stack.pop();
        continue;
      }
      const target = outgoing[frame.next] as string;
      frame.next += 1;
      const seen = state.get(target);
      if (seen === 1) backEdges.push({ from: frame.node, to: target });
      else if (seen === undefined) {
        state.set(target, 1);
        stack.push({ node: target, next: 0 });
      }
    }
  }
  // NUL sorts below every character an id can contain, so comparing joined keys sorts by from, then to.
  const key = (edge: BackEdge): string => `${edge.from}\u0000${edge.to}`;
  backEdges.sort((a, b) => compareIds(key(a), key(b)));
  const isBack = new Set(backEdges.map(key));

  // Longest-path layers, by Kahn's algorithm over the edges that remain.
  const remaining = new Map<string, string[]>(
    ids.map((id) => [
      id,
      (targets.get(id) as string[]).filter((to) => !isBack.has(key({ from: id, to }))),
    ]),
  );
  const indegree = new Map<string, number>(ids.map((id) => [id, 0]));
  for (const to of [...remaining.values()].flat())
    indegree.set(to, (indegree.get(to) as number) + 1);
  const layerOf = new Map<string, number>(ids.map((id) => [id, 0]));
  const queue = ids.filter((id) => indegree.get(id) === 0);
  for (let head = 0; head < queue.length; head++) {
    const current = queue[head] as string;
    const next = (layerOf.get(current) as number) + 1;
    for (const to of remaining.get(current) as string[]) {
      if ((layerOf.get(to) as number) < next) layerOf.set(to, next);
      const left = (indegree.get(to) as number) - 1;
      indegree.set(to, left);
      if (left === 0) queue.push(to);
    }
  }

  // Rows within each layer.
  const rank = new Map<string, number>();
  categoryOrder.forEach((category, position) => {
    if (!rank.has(category)) rank.set(category, position);
  });
  const rankOf = (id: string): number =>
    rank.get(categories.get(id) as string) ?? categoryOrder.length;
  let deepest = -1;
  for (const layer of layerOf.values()) if (layer > deepest) deepest = layer;
  const layers = deepest + 1;
  const columns: string[][] = Array.from({ length: layers }, () => []);
  for (const id of ids) (columns[layerOf.get(id) as number] as string[]).push(id);
  let rows = 0;
  for (const column of columns) {
    column.sort(
      (a, b) =>
        rankOf(a) - rankOf(b) ||
        compareText(categories.get(a) as string, categories.get(b) as string) ||
        compareIds(a, b),
    );
    if (column.length > rows) rows = column.length;
  }

  const placements: Placement[] = [];
  columns.forEach((column, layer) => {
    column.forEach((id, row) => {
      placements.push({
        id,
        layer,
        row,
        x: layer * (nodeWidth + columnGap),
        y: (row + (rows - column.length) / 2) * (nodeHeight + rowGap),
      });
    });
  });
  placements.sort((a, b) => compareIds(a.id, b.id));

  return {
    placements,
    layers,
    rows,
    width: layers === 0 ? 0 : layers * nodeWidth + (layers - 1) * columnGap,
    height: rows === 0 ? 0 : rows * nodeHeight + (rows - 1) * rowGap,
    backEdges,
  };
}
