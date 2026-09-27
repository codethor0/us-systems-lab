import { CATEGORIES } from "../../lib/schema";
import type { Category, Graph, GraphNode } from "../../lib/schema";
import { DEFAULT_PARAMS } from "../../lib/propagation";
import { createUrlSync } from "./url-sync";
import { compareDeltas } from "../../model/analysis";
import type { NodeSensitivity } from "../../model/analysis";
import type { ScenarioEffect } from "../../model/effects";
import {
  blockPosition,
  compareText,
  fillColor,
  inputLever,
  levelText,
  movedText,
  relationshipBadge,
  sensitivityText,
  signed,
  summaryText,
} from "./view";

export interface LoadedBoard {
  readonly levers: ReadonlyMap<string, number>;
  readonly warnings: readonly string[];
}
export interface BoardServices {
  /** evidenceOnly runs the same engine on the cited relationships alone. */
  readonly calculate: (
    levers: ReadonlyMap<string, number>,
    evidenceOnly: boolean,
  ) => readonly ScenarioEffect[];
  /** The same scenario under the tested settings; see src/model/analysis.ts. */
  readonly sensitivity: (
    levers: ReadonlyMap<string, number>,
    evidenceOnly: boolean,
  ) => ReadonlyMap<string, NodeSensitivity>;
  readonly sensitivitySettings: number;
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
  readonly robustness: HTMLElement;
  readonly compare: HTMLElement;
  /** The "Directly drives" note, and its text for every relationship and for cited ones only. */
  readonly feeds: HTMLElement | null;
  readonly feedsAll: string;
  readonly feedsCited: string;
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
  let evidenceOnly = false;
  let shownCategory: Category | "all" = "all";
  /** Scenario A: display scores saved in memory only, never in the address bar. */
  let saved: { deltas: Map<string, number>; evidenceOnly: boolean } | null = null;
  let currentDeltas = new Map<string, number>();
  const citedCount = graph.edges.filter((edge) => edge.confidence === "empirical").length;
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
    showShareLink();
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
  const copyStatus = element("p", "bb-share-status");
  copyStatus.setAttribute("role", "status");
  const copy = button("Copy link", () => {
    const link = shareInput.value;
    const fallback = (): void => {
      if (destroyed || shareInput.value !== link) return;
      shareInput.focus();
      shareInput.select();
      copyStatus.textContent =
        "Could not copy automatically. The link is selected; copy it from there.";
    };
    // Not every browser or context exposes the Clipboard API, and a write can be refused.
    const clipboard = (navigator as { clipboard?: Pick<Clipboard, "writeText"> }).clipboard;
    if (clipboard === undefined) {
      fallback();
      return;
    }
    clipboard.writeText(link).then(() => {
      if (!destroyed && shareInput.value === link) copyStatus.textContent = "Link copied.";
    }, fallback);
  });
  copy.dataset.action = "copy-link";
  /** Keeps the share field on the current scenario; a copy confirmation for an older link is cleared. */
  function showShareLink(): void {
    const link = new URL(services.location(levers), window.location.href).href;
    if (shareInput.value !== link) copyStatus.textContent = "";
    shareInput.value = link;
  }
  shareBox.append(
    shareLabel,
    shareInput,
    copy,
    button("Close link", () => {
      shareBox.hidden = true;
      share.focus();
    }),
    copyStatus,
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
      "50 is unchanged and grey. Blue is lower, orange is higher. Color shows level, not good or bad.",
    ),
    scale,
  );
  const tools = element("section", "bb-tools");
  tools.setAttribute("aria-label", "View options");
  const filter = element("fieldset", "bb-filter");
  filter.append(element("legend", "", "Show"));
  for (const option of ["all", ...CATEGORIES] as const) {
    const label = element("label", "bb-choice");
    const radio = element("input");
    radio.type = "radio";
    radio.name = "bb-category";
    radio.value = option;
    radio.checked = option === "all";
    radio.addEventListener("change", () => {
      shownCategory = option;
      update();
    });
    label.append(radio, document.createTextNode(option === "all" ? "All indicators" : option));
    filter.append(label);
  }
  const evidenceLabel = element("label", "bb-choice");
  const evidence = element("input");
  evidence.type = "checkbox";
  evidence.dataset.action = "evidence-only";
  evidence.addEventListener("change", () => {
    evidenceOnly = evidence.checked;
    lastAction = evidenceOnly
      ? "Showing cited relationships only."
      : "Showing every reviewed relationship.";
    update();
  });
  evidenceLabel.append(evidence, document.createTextNode("Cited relationships only"));
  const saveA = button("Save as scenario A", () => {
    saved = { deltas: currentDeltas, evidenceOnly };
    lastAction = "Saved the current results as scenario A.";
    update();
  });
  saveA.dataset.action = "save-a";
  const clearA = button("Clear A", () => {
    saved = null;
    lastAction = "Cleared scenario A.";
    update();
    saveA.focus();
  });
  clearA.dataset.action = "clear-a";
  const compareGroup = element("div", "bb-compare-actions");
  compareGroup.append(saveA, clearA);
  const toolNotes = element("div", "bb-tool-notes");
  const filterNote = element("p", "");
  const evidenceNote = element("p", "");
  const compareNote = element("p", "");
  toolNotes.append(filterNote, evidenceNote, compareNote);
  tools.append(filter, evidenceLabel, compareGroup, toolNotes);

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
    tileRoot.append(
      element(
        "p",
        "bb-baseline",
        node.valueType === "index"
          ? "Real-world value: none (abstract 0 to 100 lever)"
          : node.baseline === null
            ? "Real-world baseline: not stored yet"
            : `Real-world ${node.valueType === "projected" ? "projection" : "baseline"}: ${services.baseline(node)}${node.asOf === null ? "" : ` (${node.asOf})`}`,
      ),
    );
    const readout = element("div", "bb-readout");
    const grid = element("div", "bb-grid");
    grid.setAttribute("role", "img");
    grid.title =
      "Blocks show the normalized model response, not the real-world value. Click a block to set your manual input, or use the slider below.";
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
      element("p", "bb-micro", "MODEL RESPONSE"),
      value,
      element("span", "bb-denominator", " / 100"),
      status,
      change,
    );
    readout.append(grid, result);
    tileRoot.append(readout);
    const responseCaption = element(
      "p",
      "bb-response-caption",
      "Model response, normalized 0 to 100 (automatic)",
    );
    const response = element("div", "bb-response-track");
    response.dataset.autoResponse = node.id;
    response.setAttribute("role", "meter");
    response.setAttribute("aria-label", `${node.label} normalized model response`);
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
    const robustness = element("p", "bb-robustness");
    const compare = element("p", "bb-compare");
    compare.hidden = true;
    const clear = button(
      "Neutral",
      () => {
        setInput(node.id, 50);
      },
      "bb-neutral",
    );
    clear.setAttribute("aria-label", `Neutral: clear input for ${node.label}`);
    inputRow.append(clear);
    tileRoot.append(inputRow, input, ticks, controlNote, why, robustness, compare);
    // Static connectivity note: what this indicator can move directly, before any input is set.
    const drives = [
      ...new Set(
        graph.edges
          .filter((edge) => edge.from === node.id)
          .map((edge) => labels.get(edge.to) ?? edge.to),
      ),
    ];
    const citedDrives = [
      ...new Set(
        graph.edges
          .filter((edge) => edge.from === node.id && edge.confidence === "empirical")
          .map((edge) => labels.get(edge.to) ?? edge.to),
      ),
    ];
    tileRoot.dataset.drives = String(drives.length);
    let feeds: HTMLElement | null = null;
    const feedsAll = `Directly drives: ${drives.join(", ")}.`;
    const feedsCited =
      citedDrives.length > 0
        ? `Directly drives through cited relationships: ${citedDrives.join(", ")}.`
        : "Drives nothing through cited relationships; its links are modeled.";
    if (drives.length > 0) {
      feeds = element("p", "bb-feeds", feedsAll);
      tileRoot.append(feeds);
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
    const paths = element("ol", "bb-paths");
    paths.setAttribute("aria-label", `Paths into ${node.label}, strongest first`);
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
      details.append(element("p", "", `No modeled connections. ${node.terminal ?? ""}`.trim()));
    else {
      if (node.terminal !== null)
        details.append(element("p", "bb-terminal", `Drives nothing: ${node.terminal}`));
      const list = element("ul");
      for (const edge of connected) {
        const item = element("li");
        item.append(
          element("span", "bb-badge", relationshipBadge(edge)),
          document.createTextNode(
            ` ${labels.get(edge.from) ?? edge.from} > ${labels.get(edge.to) ?? edge.to}: ${edge.direction > 0 ? "positive" : "negative"}, weight ${String(edge.strength)}. ${edge.claim}`,
          ),
        );
        list.append(item);
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
      robustness,
      compare,
      feeds,
      feedsAll,
      feedsCited,
      numbers,
      paths,
      clear,
      delta: 0,
      lastPulse: -1000,
    });
  }

  const footer = element("footer", "bb-footer");
  const footerGrid = element("div", "bb-footer-grid");

  const projectPanel = element("section", "bb-footer-panel");
  const projectTitle = element("h2", "bb-footer-title", "US Systems Lab");
  projectTitle.id = "bb-about-project";
  projectPanel.setAttribute("aria-labelledby", projectTitle.id);
  projectPanel.append(
    element("p", "bb-footer-eyebrow", "ABOUT THIS PROJECT"),
    projectTitle,
    element(
      "p",
      "bb-footer-copy",
      "An open-source interactive lab for exploring relationships across U.S. economic and social indicators. Built to make assumptions visible, testable, and easy to inspect.",
    ),
  );

  const authorPanel = element("section", "bb-footer-panel");
  const authorTitle = element("h2", "bb-footer-title", "Ruot Koang Thor (Thor Thor)");
  authorTitle.id = "bb-about-author";
  authorPanel.setAttribute("aria-labelledby", authorTitle.id);
  const authorLinks = element("nav", "bb-footer-links");
  authorLinks.setAttribute("aria-label", "Author links");
  const linkedIn = element("a", "bb-footer-link", "LinkedIn");
  linkedIn.href =
    "https://www.linkedin.com/in/ruot-koang-thor-monyjang-luak-pech-both-doah-yoal-joak";
  linkedIn.target = "_blank";
  linkedIn.rel = "noreferrer noopener";
  const github = element("a", "bb-footer-link", "GitHub");
  github.href = "https://github.com/codethor0";
  github.target = "_blank";
  github.rel = "noreferrer noopener";
  const source = element("a", "bb-footer-link", "Source");
  source.href = "https://github.com/codethor0/us-systems-lab";
  source.target = "_blank";
  source.rel = "noreferrer noopener";
  authorLinks.append(linkedIn, github, source);
  authorPanel.append(
    element("p", "bb-footer-eyebrow", "BUILT BY"),
    authorTitle,
    element(
      "p",
      "bb-footer-copy",
      "Cybersecurity researcher, open-source builder, inventor, and author exploring security, AI, systems, and society.",
    ),
    authorLinks,
  );

  footerGrid.append(projectPanel, authorPanel);
  footer.append(
    footerGrid,
    element(
      "p",
      "bb-footer-meta",
      `Block Board v1 | Build ${services.build} | Model ${services.stamp} | ${String(graph.nodes.length)} indicators / ${String(graph.edges.length)} relationships. Sources and assumptions are inside each tile.`,
    ),
  );
  // A labelled section keeps the disclaimer and counts inside a landmark (axe "region").
  const summary = element("section", "bb-summary");
  summary.setAttribute("aria-label", "Board summary");
  summary.append(info, counts);
  container.append(header, shareBox, legend, tools, summary, message, notice, board, footer);
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
      showShareLink();
    }
  }

  function update(): void {
    if (destroyed) return;
    const effects = new Map(
      services.calculate(levers, evidenceOnly).map((effect) => [effect.nodeId, effect]),
    );
    const robust = services.sensitivity(levers, evidenceOnly);
    const active = evidenceOnly
      ? graph.edges.filter((edge) => edge.confidence === "empirical")
      : graph.edges;
    const deltas = new Map<string, number>();
    let responding = 0;
    let shown = 0;
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
      deltas.set(tile.node.id, delta);
      tile.root.hidden = shownCategory !== "all" && tile.node.category !== shownCategory;
      if (!tile.root.hidden) shown++;
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
            : active.some((edge) => edge.to === tile.node.id)
              ? `No input reaches this tile within ${String(DEFAULT_PARAMS.maxHops)} relationships.`
              : evidenceOnly && graph.edges.some((edge) => edge.to === tile.node.id)
                ? "No cited relationship reaches this tile. That is a gap in citations, not evidence of no effect."
                : "No incoming relationships; only your own input moves this tile.";
      if (!graph.edges.some((edge) => edge.from === tile.node.id || edge.to === tile.node.id))
        tile.why.textContent = "No modeled connections.";
      tile.numbers.textContent = `Manual ${signed(own)}; incoming ${signed(effect?.propagated ?? 0)}; total ${signed(effect?.total ?? 0)}; clamped score ${signed(delta)}. Display position = 50 + 50 x score. Whole blocks are rounded symmetrically; calculations keep full precision.`;
      if (tile.feeds !== null)
        tile.feeds.textContent = evidenceOnly ? tile.feedsCited : tile.feedsAll;
      const entry = robust.get(tile.node.id);
      tile.robustness.textContent =
        entry === undefined || idle ? "" : sensitivityText(entry, services.sensitivitySettings);
      tile.compare.hidden = saved === null;
      tile.compare.textContent =
        saved === null ? "" : compareText(saved.deltas.get(tile.node.id) ?? 0, delta);
      tile.paths.replaceChildren();
      // Strongest first; the sort is stable, so ties keep the deterministic traversal order.
      const routes = [...(effect?.contributions ?? [])]
        .filter((item) => item.value !== 0)
        .sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
      for (const item of routes) {
        const route = [labels.get(item.sourceId) ?? item.sourceId];
        const steps: string[] = [];
        for (const id of item.edgeIds) {
          const edge = edges.get(id);
          if (edge === undefined) continue;
          route.push(labels.get(edge.to) ?? edge.to);
          steps.push(`${edge.direction > 0 ? "up" : "down"} (${relationshipBadge(edge)})`);
        }
        const row = element("li");
        row.append(
          element("span", "", `${route.join(" > ")}: ${signed(item.value)}`),
          element("span", "bb-steps", `Each step: ${steps.join("; ")}`),
        );
        tile.paths.append(row);
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
    currentDeltas = deltas;
    filterNote.textContent =
      shownCategory === "all"
        ? ""
        : `Showing ${String(shown)} of ${String(graph.nodes.length)} indicators. Hidden tiles still take part in the calculation.`;
    evidenceNote.textContent = !evidenceOnly
      ? ""
      : `Cited relationships only: ${String(citedCount)} of ${String(graph.edges.length)} relationships have a citation.${citedCount === 0 ? " None do yet, so no input reaches another tile in this view." : ""} Share links carry inputs only and open with every relationship.`;
    if (saved === null) compareNote.textContent = "";
    else {
      const { changed } = compareDeltas([...deltas.keys()], saved.deltas, deltas);
      compareNote.textContent = `Comparing with scenario A${saved.evidenceOnly === evidenceOnly ? "" : ", saved in the other relationship view"}: ${String(changed)} of ${String(graph.nodes.length)} tiles differ. A is kept in this tab only.`;
    }
    clearA.hidden = saved === null;
    board.dataset.evidenceOnly = String(evidenceOnly);
    reset.disabled = levers.size === 0 && warnings.length === 0 && window.location.search === "";
    counts.textContent = summaryText(graph.nodes.length, levers.size, responding);
    message.textContent = `${lastAction} ${movedText(responding)}`;
    notice.replaceChildren(...warnings.map((text) => element("p", "", text)));
    notice.hidden = warnings.length === 0;
    // History can load zero inputs without calling writeLocation. Keep an open
    // share field tied to the current scenario rather than the previous one.
    if (!shareBox.hidden) {
      showShareLink();
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
