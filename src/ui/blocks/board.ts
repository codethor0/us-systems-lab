import type { Graph, GraphNode } from "../../lib/schema";
import { createUrlSync } from "./url-sync";
import type { ScenarioEffect } from "../../model/effects";
import {
  blockPosition,
  fillColor,
  inputLever,
  levelText,
  movedText,
  signed,
  summaryText,
} from "./view";

export interface LoadedBoard {
  readonly levers: ReadonlyMap<string, number>;
  readonly warnings: readonly string[];
}
export interface BoardServices {
  readonly calculate: (levers: ReadonlyMap<string, number>) => readonly ScenarioEffect[];
  readonly load: (search: string) => LoadedBoard;
  readonly location: (levers: ReadonlyMap<string, number>) => string;
  readonly baseline: (node: GraphNode) => string;
  readonly build: string;
  readonly stamp: string;
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = "",
  text = "",
): HTMLElementTagNameMap[K] {
  const item = document.createElement(tag);
  item.className = className;
  item.textContent = text;
  return item;
}

function button(text: string, action: () => void, className = "bb-button"): HTMLButtonElement {
  const item = element("button", className, text);
  item.type = "button";
  item.addEventListener("click", action);
  return item;
}

interface Tile {
  readonly node: GraphNode;
  readonly root: HTMLElement;
  readonly grid: HTMLElement;
  readonly squares: readonly HTMLElement[];
  readonly value: HTMLElement;
  readonly status: HTMLElement;
  readonly response: HTMLElement;
  readonly responseFill: HTMLElement;
  readonly responseMarker: HTMLElement;
  readonly change: HTMLElement;
  readonly input: HTMLInputElement;
  readonly inputValue: HTMLElement;
  readonly why: HTMLElement;
  readonly numbers: HTMLElement;
  readonly paths: HTMLElement;
  readonly clear: HTMLButtonElement;
  delta: number;
  lastPulse: number;
}

/** A small DOM view hosted by React. The supplied engine is the unchanged repository engine. */
export function mountBlockBoard(
  root: HTMLElement,
  graph: Graph,
  services: BoardServices,
): () => void {
  const initial = services.load(window.location.search);
  let levers = new Map(initial.levers);
  let warnings = [...initial.warnings];
  let lastAction = "Not adjusted. Move an input to begin.";
  let destroyed = false;
  const labels = new Map(graph.nodes.map((node) => [node.id, node.label]));
  const edges = new Map(graph.edges.map((edge) => [edge.id, edge]));
  const container = element("div", "bb-app");
  container.dataset.blockBoard = "1";
  container.dataset.build = services.build;

  const header = element("header", "bb-header");
  const heading = element("div", "bb-heading");
  heading.append(element("p", "bb-eyebrow", "US SYSTEMS LAB"), element("h1", "", "Block Board"));
  const subtitle = element(
    "p",
    "bb-subtitle",
    "Move one input. Watch the connected blocks respond.",
  );
  heading.append(subtitle);
  const actions = element("div", "bb-actions");
  const reset = button("Reset", () => {
    levers = new Map();
    warnings = [];
    lastAction = "Reset. Every indicator is back at 50.";
    writeLocation();
    update();
  });
  reset.dataset.action = "reset";
  const share = button("Share", () => {
    shareBox.hidden = false;
    shareInput.value = new URL(services.location(levers), window.location.href).href;
    shareInput.focus();
    shareInput.select();
  });
  share.dataset.action = "share";
  const motionLabel = element("label", "bb-motion");
  const motion = element("input");
  motion.type = "checkbox";
  motion.checked = true;
  motion.setAttribute("aria-label", "Pulse changes");
  motion.addEventListener("change", () => {
    if (!motion.checked) {
      for (const tile of tiles) tile.root.classList.remove("bb-pulse");
    }
  });
  motionLabel.append(motion, document.createTextNode("Pulse changes"));
  actions.append(reset, share, motionLabel);
  header.append(heading, actions);

  const shareBox = element("section", "bb-share");
  shareBox.hidden = true;
  const shareLabel = element("label", "", "Copy this scenario link");
  shareLabel.htmlFor = "bb-share-link";
  const shareInput = element("input");
  shareInput.id = "bb-share-link";
  shareInput.type = "text";
  shareInput.readOnly = true;
  shareBox.append(
    shareLabel,
    shareInput,
    button("Close link", () => {
      shareBox.hidden = true;
      share.focus();
    }),
  );

  const legend = element("section", "bb-legend");
  legend.setAttribute("aria-label", "How to read the board");
  const scale = element("div", "bb-scale");
  scale.append(
    element("span", "", "LOWER"),
    element("span", "bb-spectrum"),
    element("span", "", "HIGHER"),
  );
  legend.append(
    element(
      "p",
      "",
      "50 is unchanged. Red at rest means not adjusted. Color shows level, not good or bad.",
    ),
    scale,
  );
  const info = element(
    "p",
    "bb-disclaimer",
    "Illustrative model, not a forecast. Scores and blocks are normalized model responses, not real-world percentages or predicted values.",
  );
  const counts = element("p", "bb-counts");
  counts.dataset.counts = "1";
  const message = element("p", "bb-message");
  message.setAttribute("role", "status");
  message.setAttribute("aria-live", "polite");
  message.setAttribute("aria-atomic", "true");
  const notice = element("div", "bb-notice");
  notice.setAttribute("role", "status");

  const board = element("main", "bb-board");
  board.setAttribute("aria-label", "Economic indicator block board");
  const priority = [
    "productivity",
    "federal_debt",
    "gdp_growth",
    "fed_rate",
    "real_avg_hourly_earnings",
    "median_household_income",
    "savings_rate",
    "poverty_rate",
  ];
  const ordered = [...graph.nodes].sort((a, b) => {
    const aRank = priority.indexOf(a.id),
      bRank = priority.indexOf(b.id);
    return (aRank < 0 ? 100 : aRank) - (bRank < 0 ? 100 : bRank);
  });
  const tiles: Tile[] = [];
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  function setInput(id: string, level: number): void {
    const next = inputLever(level);
    if ((levers.get(id) ?? 0) === next) return;
    const copied = new Map(levers);
    if (next === 0) copied.delete(id);
    else copied.set(id, next);
    levers = copied;
    warnings = [];
    lastAction = `${labels.get(id) ?? id}: input ${levelText(50 + 50 * next)}/100.`;
    writeLocation();
    update();
  }

  for (const node of ordered) {
    const tileRoot = element("article", "bb-card");
    tileRoot.dataset.indicator = node.id;
    tileRoot.setAttribute("aria-labelledby", `bb-title-${node.id}`);
    const title = element("h2", "", node.label);
    title.id = `bb-title-${node.id}`;
    tileRoot.append(element("p", "bb-category", node.category), title);
    const readout = element("div", "bb-readout");
    const grid = element("div", "bb-grid");
    grid.setAttribute("role", "img");
    grid.title =
      "Blocks show the combined result. Click a block to set your manual input, or use the slider below.";
    const squares: HTMLElement[] = [];
    for (let row = 9; row >= 0; row--) {
      for (let col = 1; col <= 10; col++) {
        const square = element("span", "bb-square");
        square.dataset.square = String(row * 10 + col);
        square.setAttribute("aria-hidden", "true");
        squares.push(square);
        grid.append(square);
      }
    }
    grid.addEventListener("click", (event) => {
      const target = event.target;
      if (target instanceof HTMLElement && target.dataset.square !== undefined) {
        setInput(node.id, Number(target.dataset.square));
      }
    });
    const result = element("div", "bb-result");
    const value = element("strong", "bb-value");
    const status = element("p", "bb-state");
    const change = element("p", "bb-change");
    result.append(
      element("p", "bb-micro", "COMBINED RESULT"),
      value,
      element("span", "bb-denominator", " / 100"),
      status,
      change,
    );
    readout.append(grid, result);
    tileRoot.append(readout);
    const responseCaption = element("p", "bb-response-caption", "Combined response (automatic)");
    const response = element("div", "bb-response-track");
    response.dataset.autoResponse = node.id;
    response.setAttribute("role", "meter");
    response.setAttribute("aria-label", `${node.label} combined modeled response`);
    response.setAttribute("aria-valuemin", "0");
    response.setAttribute("aria-valuemax", "100");
    const responseFill = element("span", "bb-response-fill");
    const responseMarker = element("span", "bb-response-marker");
    responseFill.setAttribute("aria-hidden", "true");
    responseMarker.setAttribute("aria-hidden", "true");
    response.append(responseFill, responseMarker);
    tileRoot.append(responseCaption, response);

    const inputRow = element("div", "bb-input-caption");
    const inputLabel = element("label", "", "Your input");
    inputLabel.htmlFor = `block-input-${node.id}`;
    const inputValue = element("output");
    inputValue.setAttribute("for", inputLabel.htmlFor);
    inputRow.append(inputLabel, inputValue);
    const input = element("input", "bb-slider");
    input.type = "range";
    input.id = inputLabel.htmlFor;
    input.min = "0";
    input.max = "100";
    input.step = "5";
    input.value = "50";
    input.setAttribute("aria-label", `Your input for ${node.label}`);
    input.setAttribute("aria-describedby", `bb-control-note-${node.id}`);
    input.addEventListener("input", () => {
      setInput(node.id, Number(input.value));
    });
    const ticks = element("div", "bb-ticks");
    ticks.append(
      element("span", "", "0"),
      element("span", "", "50 neutral"),
      element("span", "", "100"),
    );
    const controlNote = element(
      "p",
      "bb-sr-only",
      "Your input moves in steps of five, preserving the existing model's input grid. The blocks show the combined result, which includes other inputs.",
    );
    controlNote.id = `bb-control-note-${node.id}`;
    const why = element("p", "bb-why");
    const clear = button(
      "Neutral",
      () => {
        setInput(node.id, 50);
      },
      "bb-neutral",
    );
    clear.setAttribute("aria-label", `Neutral: clear input for ${node.label}`);
    inputRow.append(clear);
    tileRoot.append(inputRow, input, ticks, controlNote, why);
    // Static connectivity note: what this indicator can move directly, before any input is set.
    const drives = [
      ...new Set(
        graph.edges
          .filter((edge) => edge.from === node.id)
          .map((edge) => labels.get(edge.to) ?? edge.to),
      ),
    ];
    tileRoot.dataset.drives = String(drives.length);
    if (drives.length > 0) {
      tileRoot.append(element("p", "bb-feeds", `Directly drives: ${drives.join(", ")}.`));
    } else if (graph.edges.some((edge) => edge.to === node.id)) {
      tileRoot.append(
        element(
          "p",
          "bb-feeds",
          "Drives nothing else in this model, so moving it changes only this tile.",
        ),
      );
    }

    const details = element("details", "bb-details");
    details.append(element("summary", "", "Why & source"));
    const numbers = element("p", "bb-explanation");
    const paths = element("div", "bb-paths");
    details.append(numbers, paths);
    const metadata = element(
      "p",
      "bb-provenance",
      `Stored ${node.valueType} baseline: ${services.baseline(node)}. Period: ${node.asOf ?? "not available"}. Verification recorded as ${node.verification ?? "not applicable"}.`,
    );
    details.append(metadata);
    if (node.sourceUrl !== null) {
      const link = element("a", "bb-source", "Open baseline source");
      link.href = node.sourceUrl;
      link.target = "_blank";
      link.rel = "noreferrer noopener";
      details.append(link);
    }
    if (node.sourceDetail !== null)
      details.append(element("p", "bb-source-detail", node.sourceDetail));
    const connected = graph.edges.filter((edge) => edge.from === node.id || edge.to === node.id);
    if (connected.length === 0)
      details.append(
        element("p", "", "No modeled connections. This indicator is intentionally isolated."),
      );
    else {
      const list = element("ul");
      for (const edge of connected) {
        list.append(
          element(
            "li",
            "",
            `${labels.get(edge.from) ?? edge.from} > ${labels.get(edge.to) ?? edge.to}: ${edge.direction > 0 ? "positive" : "negative"}, weight ${String(edge.strength)}, ${edge.confidence}. ${edge.claim}`,
          ),
        );
      }
      details.append(list);
    }
    tileRoot.append(details);
    board.append(tileRoot);
    tileRoot.addEventListener("animationend", () => {
      tileRoot.classList.remove("bb-pulse");
    });
    tiles.push({
      node,
      root: tileRoot,
      grid,
      squares,
      value,
      status,
      response,
      responseFill,
      responseMarker,
      change,
      input,
      inputValue,
      why,
      numbers,
      paths,
      clear,
      delta: 0,
      lastPulse: -1000,
    });
  }

  const footer = element(
    "footer",
    "bb-footer",
    `Block Board v1 | Build ${services.build} | Model ${services.stamp} | ${String(graph.nodes.length)} indicators / ${String(graph.edges.length)} relationships. Sources and assumptions are inside each tile.`,
  );
  container.append(header, shareBox, legend, info, counts, message, notice, board, footer);
  root.replaceChildren(container);

  const linkNotice = element("p", "bb-notice");
  linkNotice.setAttribute("role", "status");
  linkNotice.hidden = true;
  notice.after(linkNotice);
  const urlSync = createUrlSync({
    read: () => window.location.pathname + window.location.search + window.location.hash,
    write: (url) => {
      window.history.replaceState(null, "", url);
    },
    now: () => performance.now(),
    schedule: (callback, delay) => window.setTimeout(callback, delay),
    clear: (id) => {
      window.clearTimeout(id);
    },
    status: (status) => {
      container.dataset.urlSync = status;
      linkNotice.hidden = status !== "error";
      linkNotice.textContent =
        status === "error"
          ? "The address bar could not be updated. Use Share for the current scenario."
          : "";
      reset.disabled = levers.size === 0 && warnings.length === 0 && window.location.search === "";
    },
  });
  container.dataset.urlSync = "synced";

  function writeLocation(): void {
    // Only URL writes are coalesced; squares, meters, and inputs render immediately.
    urlSync.request(services.location(levers));
    if (!shareBox.hidden) {
      shareInput.value = new URL(services.location(levers), window.location.href).href;
    }
  }

  function update(): void {
    if (destroyed) return;
    const effects = new Map(services.calculate(levers).map((effect) => [effect.nodeId, effect]));
    let responding = 0;
    for (const tile of tiles) {
      const effect = effects.get(tile.node.id);
      const own = levers.get(tile.node.id) ?? 0;
      const rawDelta = effect?.delta ?? 0;
      const block = blockPosition(rawDelta);
      const delta = block.direction === "Unchanged" ? 0 : rawDelta;
      const idle =
        own === 0 &&
        delta === 0 &&
        !(effect?.contributions.some((item) => item.value !== 0) ?? false);
      if (delta !== 0) responding++;
      tile.root.dataset.delta = String(rawDelta);
      tile.root.dataset.displayDelta = String(delta);
      tile.root.dataset.own = String(own);
      tile.root.dataset.position = String(block.position);
      tile.root.dataset.filled = String(block.filled);
      tile.root.dataset.state = idle
        ? "idle"
        : delta === 0
          ? "balanced"
          : delta > 0
            ? "up"
            : "down";
      tile.root.style.setProperty("--bb-fill", fillColor(block.position, idle));
      tile.response.setAttribute("aria-valuenow", String(block.position));
      tile.response.setAttribute(
        "aria-valuetext",
        `${levelText(block.position)} of 100; ${idle ? "not adjusted" : block.direction.toLowerCase()}; 50 is unchanged`,
      );
      tile.responseFill.style.width = `${String(block.position)}%`;
      tile.responseMarker.style.left = `${String(block.position)}%`;
      for (const square of tile.squares) {
        const filled = Number(square.dataset.square) <= block.filled;
        square.classList.toggle("bb-filled", filled);
      }
      tile.grid.setAttribute(
        "aria-label",
        `${tile.node.label}: ${String(block.filled)} of 100 blocks filled; exact modeled position ${levelText(block.position)}; ${block.direction.toLowerCase()}.`,
      );
      tile.value.textContent = levelText(block.position);
      const digits = tile.value.textContent.length;
      tile.value.dataset.size = digits <= 3 ? "short" : digits === 4 ? "mid" : "long";
      tile.status.textContent = idle ? "Not adjusted" : block.direction;
      tile.change.textContent = `Score ${signed(delta)}`;
      if (delta !== 0 && block.filled === 50) tile.change.textContent += " (less than one block)";
      // Float sums can land a few ulps above an exact total of 1; that is not a clamp.
      if (Math.abs(effect?.total ?? 0) > 1 + 1e-9) tile.change.textContent += " (display limit)";
      tile.input.value = String(50 + 50 * own);
      // <output> is a live region: rewrite it only when the text actually changes.
      const inputText = `${levelText(50 + 50 * own)}/100`;
      if (tile.inputValue.textContent !== inputText) tile.inputValue.textContent = inputText;
      tile.input.setAttribute(
        "aria-valuetext",
        `${levelText(50 + 50 * own)} of 100; 50 is neutral; signed input ${signed(own)}`,
      );
      tile.clear.disabled = own === 0;
      const contributors = [
        ...new Set(
          (effect?.contributions ?? [])
            .filter((item) => item.value !== 0)
            .map((item) => item.sourceId),
        ),
      ];
      tile.why.textContent =
        contributors.length > 0
          ? `Affected by ${contributors.map((id) => labels.get(id) ?? id).join(", ")}.`
          : own !== 0
            ? "Your manual input."
            : "No incoming modeled response.";
      if (!graph.edges.some((edge) => edge.from === tile.node.id || edge.to === tile.node.id))
        tile.why.textContent = "No modeled connections.";
      tile.numbers.textContent = `Manual ${signed(own)}; incoming ${signed(effect?.propagated ?? 0)}; total ${signed(effect?.total ?? 0)}; clamped score ${signed(delta)}. Display position = 50 + 50 x score. Whole blocks are rounded symmetrically; calculations keep full precision.`;
      tile.paths.replaceChildren();
      for (const item of effect?.contributions ?? []) {
        if (item.value === 0) continue;
        const route = [labels.get(item.sourceId) ?? item.sourceId];
        for (const id of item.edgeIds) {
          const edge = edges.get(id);
          if (edge !== undefined) route.push(labels.get(edge.to) ?? edge.to);
        }
        tile.paths.append(element("p", "", `${route.join(" > ")}: ${signed(item.value)}`));
      }
      if (
        delta !== tile.delta &&
        motion.checked &&
        !reducedMotion.matches &&
        performance.now() - tile.lastPulse >= 1000
      ) {
        tile.root.classList.add("bb-pulse");
        tile.root.dataset.pulses = String(Number(tile.root.dataset.pulses ?? "0") + 1);
        tile.lastPulse = performance.now();
      }
      tile.delta = delta;
    }
    reset.disabled = levers.size === 0 && warnings.length === 0 && window.location.search === "";
    counts.textContent = summaryText(graph.nodes.length, levers.size, responding);
    message.textContent = `${lastAction} ${movedText(responding)}`;
    notice.replaceChildren(...warnings.map((text) => element("p", "", text)));
    notice.hidden = warnings.length === 0;
    // History can load zero inputs without calling writeLocation. Keep an open
    // share field tied to the current scenario rather than the previous one.
    if (!shareBox.hidden) {
      shareInput.value = new URL(services.location(levers), window.location.href).href;
    }
  }
  const loadLocation = (): void => {
    urlSync.cancel();
    const loaded = services.load(window.location.search);
    levers = new Map(loaded.levers);
    warnings = [...loaded.warnings];
    lastAction = "Scenario loaded from the URL.";
    if (levers.size > 0) writeLocation();
    update();
  };
  const onMotion = (): void => {
    if (reducedMotion.matches) for (const tile of tiles) tile.root.classList.remove("bb-pulse");
  };
  window.addEventListener("popstate", loadLocation);
  reducedMotion.addEventListener("change", onMotion);
  if (levers.size > 0) {
    lastAction = "Shared scenario loaded.";
    writeLocation();
  }
  update();
  return () => {
    destroyed = true;
    urlSync.dispose();
    window.removeEventListener("popstate", loadLocation);
    reducedMotion.removeEventListener("change", onMotion);
    root.replaceChildren();
  };
}
