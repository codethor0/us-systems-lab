import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import net from "node:net";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HOST = process.env.USL_E2E_HOST ?? "127.0.0.1";
const PORT = Number(process.env.USL_E2E_PORT ?? "4174");
const BASE_URL = `http://${HOST}:${PORT}`;
const ARTIFACT_DIR = process.env.USL_E2E_ARTIFACTS
  ? path.resolve(process.env.USL_E2E_ARTIFACTS)
  : path.join(process.env.TMPDIR ?? "/tmp", `usl-e2e-${Date.now()}`);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function fail(message) {
  throw new Error(message);
}

function sameMembers(actual, expected, label) {
  const a = [...actual].sort();
  const e = [...expected].sort();
  if (JSON.stringify(a) !== JSON.stringify(e)) {
    fail(`${label}: expected ${JSON.stringify(e)}, got ${JSON.stringify(a)}`);
  }
}

async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

async function waitForFile(file, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const text = await fs.readFile(file, "utf8");
      if (text.trim()) return text;
    } catch {
      // Transient startup failures are expected during bounded polling.
    }
    await sleep(100);
  }
  fail(`timed out waiting for ${file}`);
}

async function fetchJson(url, init = undefined, timeoutMs = 5000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    if (!response.ok) fail(`${response.status} ${response.statusText}: ${url}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function chromeCandidates() {
  return [
    process.env.CHROME_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].filter(Boolean);
}

async function findChrome() {
  for (const candidate of chromeCandidates()) {
    if (await exists(candidate)) return candidate;
  }
  fail("Chrome/Chromium not found. Set CHROME_PATH to the browser executable.");
}

function readGraph(raw) {
  if (!raw || !Array.isArray(raw.nodes) || !Array.isArray(raw.edges))
    fail("graph.json shape invalid");
  return raw;
}

function simpleReachable(graph, sourceId, maxHops) {
  const outgoing = new Map();
  for (const edge of graph.edges) {
    const list = outgoing.get(edge.from) ?? [];
    list.push(edge);
    outgoing.set(edge.from, list);
  }
  const reached = new Set();
  const walk = (nodeId, depth, visited) => {
    if (depth >= maxHops) return;
    for (const edge of outgoing.get(nodeId) ?? []) {
      if (visited.has(edge.to)) continue;
      reached.add(edge.to);
      const next = new Set(visited);
      next.add(edge.to);
      walk(edge.to, depth + 1, next);
    }
  };
  walk(sourceId, 0, new Set([sourceId]));
  return reached;
}

function invertDirection(value) {
  if (value === "up") return "down";
  if (value === "down") return "up";
  return "none";
}

function isNearWhite(rgba) {
  return (
    Array.isArray(rgba) &&
    rgba.length === 4 &&
    rgba[0] >= 250 &&
    rgba[1] >= 250 &&
    rgba[2] >= 250 &&
    rgba[3] >= 230
  );
}

function luminance([r, g, b]) {
  const channel = (v) => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(a, b) {
  const l1 = luminance(a);
  const l2 = luminance(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

class Cdp {
  constructor(url) {
    this.url = url;
    this.ws = null;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
  }

  async connect() {
    await new Promise((resolve, reject) => {
      const ws = new WebSocket(this.url);
      this.ws = ws;
      const timer = setTimeout(() => reject(new Error("DevTools WebSocket open timeout")), 5000);
      ws.addEventListener(
        "open",
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
      ws.addEventListener(
        "error",
        () => {
          clearTimeout(timer);
          reject(new Error("DevTools WebSocket open error"));
        },
        { once: true },
      );
      ws.addEventListener("message", (event) => this.onMessage(String(event.data)));
    });
  }

  onMessage(raw) {
    let message;
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }

    if (typeof message.id === "number") {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error)
        pending.reject(new Error(`${pending.method}: ${JSON.stringify(message.error)}`));
      else pending.resolve(message.result ?? {});
      return;
    }

    if (typeof message.method === "string") {
      for (const listener of this.listeners.get(message.method) ?? [])
        listener(message.params ?? {});
    }
  }

  send(method, params = {}, timeoutMs = 10000) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error(`WebSocket is not open for ${method}`));
    }

    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer, method });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  on(method, listener) {
    const list = this.listeners.get(method) ?? [];
    list.push(listener);
    this.listeners.set(method, list);
  }

  waitFor(method, timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
      const handler = (params) => {
        clearTimeout(timer);
        const list = this.listeners.get(method) ?? [];
        this.listeners.set(
          method,
          list.filter((item) => item !== handler),
        );
        resolve(params);
      };
      const timer = setTimeout(() => {
        const list = this.listeners.get(method) ?? [];
        this.listeners.set(
          method,
          list.filter((item) => item !== handler),
        );
        reject(new Error(`${method} event timed out`));
      }, timeoutMs);
      const list = this.listeners.get(method) ?? [];
      list.push(handler);
      this.listeners.set(method, list);
    });
  }

  close() {
    try {
      this.ws?.close();
    } catch {
      // Closing an already-closed DevTools socket is harmless.
    }
  }
}

async function evaluate(cdp, expression) {
  const response = await cdp.send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (response.exceptionDetails) {
    fail(`Runtime.evaluate exception: ${JSON.stringify(response.exceptionDetails)}`);
  }
  return response.result?.value;
}

async function mouseClick(cdp, x, y) {
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "none" });
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x,
    y,
    button: "left",
    buttons: 1,
    clickCount: 1,
  });
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x,
    y,
    button: "left",
    buttons: 0,
    clickCount: 1,
  });
}

async function key(cdp, keyName, code) {
  await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: keyName, code });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: keyName, code });
}

async function killProcess(child) {
  if (!child || child.killed) return;
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    // The process may already have exited before cleanup.
  }
  const deadline = Date.now() + 1500;
  while (child.exitCode === null && Date.now() < deadline) await sleep(50);
  if (child.exitCode === null) {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      // The process may already have exited before forced cleanup.
    }
  }
}

async function assertPortFree(host, port) {
  await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", (error) =>
      reject(new Error(`E2E port ${host}:${port} is unavailable: ${error.message}`)),
    );
    server.listen(port, host, () => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });
}

async function waitForHttp(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { redirect: "manual" });
      if (response.status >= 200 && response.status < 500) return;
    } catch {
      // Transient startup failures are expected during bounded polling.
    }
    await sleep(100);
  }
  fail(`preview did not become ready: ${url}`);
}

async function staticState(cdp) {
  return await evaluate(
    cdp,
    `(() => {
      const sliders = [...document.querySelectorAll('input[type="range"][id^="lever-"]')];
      const nodes = [...document.querySelectorAll('.react-flow__node-indicator')];
      const edges = [...document.querySelectorAll('.react-flow__edge')];
      const cards = [...document.querySelectorAll('[data-node-id]')];
      const wrapper = document.querySelector('.usl-graph-viewport');
      const flow = document.querySelector('.react-flow');
      const header = document.querySelector('header');
      const title = document.querySelector('h1');
      const firstCard = cards[0];
      const firstCardTitle = firstCard?.querySelector('h2') ?? null;
      const sourceLinks = [...document.querySelectorAll('a[aria-label="Baseline source"]')];
      const r1 = wrapper?.getBoundingClientRect();
      const r2 = flow?.getBoundingClientRect();

      const cssColorRgba = (value) => {
        const canvas = document.createElement('canvas');
        canvas.width = 1;
        canvas.height = 1;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context) return null;
        context.clearRect(0, 0, 1, 1);
        context.fillStyle = value;
        context.fillRect(0, 0, 1, 1);
        return [...context.getImageData(0, 0, 1, 1).data];
      };

      const bodyBackground = getComputedStyle(document.body).backgroundColor;
      const headerBackground = header ? getComputedStyle(header).backgroundColor : null;
      const cardBackground = firstCard ? getComputedStyle(firstCard).backgroundColor : null;
      const cardTitleColor = firstCardTitle ? getComputedStyle(firstCardTitle).color : null;
      const titleColor = title ? getComputedStyle(title).color : null;

      return {
        sliders: sliders.map((el) => ({ id: el.id, min: el.min, max: el.max, step: el.step, aria: el.getAttribute('aria-label') })),
        nodeIds: nodes.map((el) => el.getAttribute('data-id')),
        edgeIds: edges.map((el) => el.getAttribute('data-id')),
        cardIds: cards.map((el) => el.getAttribute('data-node-id')),
        sourceLinks: sourceLinks.map((el) => ({ href: el.href, target: el.target, rel: el.rel })),
        wrapperRect: r1 ? { width:r1.width, height:r1.height } : null,
        flowRect: r2 ? { width:r2.width, height:r2.height } : null,
        bodyBackground,
        bodyBackgroundRgba: cssColorRgba(bodyBackground),
        headerBackground,
        headerBackgroundRgba: headerBackground ? cssColorRgba(headerBackground) : null,
        cardBackground,
        cardBackgroundRgba: cardBackground ? cssColorRgba(cardBackground) : null,
        cardTitleColor,
        cardTitleColorRgba: cardTitleColor ? cssColorRgba(cardTitleColor) : null,
        titleColor,
        titleColorRgba: titleColor ? cssColorRgba(titleColor) : null,
        titleBackground: headerBackground,
        titleBackgroundRgba: headerBackground ? cssColorRgba(headerBackground) : null,
        viewportTransform: document.querySelector('.react-flow__viewport')?.style.transform ?? '',
        bodyScrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
      };
    })()`,
  );
}

async function scenarioState(cdp) {
  return await evaluate(
    cdp,
    `(() => {
      const active = [...document.querySelectorAll('header span')].find((el) => /active lever/.test(el.textContent ?? ''));
      const reset = [...document.querySelectorAll('button')].find((el) => el.textContent?.trim() === 'Reset scenario');
      const cards = [...document.querySelectorAll('[data-node-id]')].map((el) => ({
        id: el.getAttribute('data-node-id'),
        effect: el.getAttribute('data-effect'),
        bucket: el.getAttribute('data-bucket'),
        effectText: el.querySelector('[id^="effect-"]')?.textContent?.trim() ?? '',
      }));
      const sliders = [...document.querySelectorAll('input[type="range"][id^="lever-"]')].map((el) => ({ id:el.id, value:el.value }));
      return {
        activeText: active?.textContent?.trim() ?? '',
        resetDisabled: reset?.disabled ?? null,
        search: location.search,
        cards,
        sliders,
      };
    })()`,
  );
}

async function clickSlider(cdp, nodeId, sign) {
  const geometry = await evaluate(
    cdp,
    `(() => {
      const el = document.querySelector(${JSON.stringify(`#lever-${nodeId}`)});
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const x = ${sign > 0 ? "r.right - 5" : "r.left + 5"};
      const y = r.top + r.height / 2;
      const hit = document.elementFromPoint(x, y);
      return { x, y, hitId: hit?.id ?? null, hitTag: hit?.tagName ?? null, width:r.width, height:r.height };
    })()`,
  );
  if (!geometry) fail(`slider not found: ${nodeId}`);
  if (geometry.hitId !== `lever-${nodeId}`) {
    fail(`${nodeId}: pointer target is ${geometry.hitTag}#${geometry.hitId}, not the slider`);
  }
  await mouseClick(cdp, geometry.x, geometry.y);
  await sleep(90);
}

async function resetScenario(cdp) {
  const state = await scenarioState(cdp);
  if (/0 active levers/.test(state.activeText)) return;
  const rect = await evaluate(
    cdp,
    `(() => {
      const el = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Reset scenario');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x:r.left + r.width / 2, y:r.top + r.height / 2, disabled:el.disabled };
    })()`,
  );
  if (!rect || rect.disabled) fail("Reset scenario is unavailable with active levers");
  await mouseClick(cdp, rect.x, rect.y);
  await sleep(80);
  const after = await scenarioState(cdp);
  if (
    !/0 active levers/.test(after.activeText) ||
    after.search !== "" ||
    after.resetDisabled !== true
  ) {
    fail(`reset failed: ${JSON.stringify(after)}`);
  }
}

async function capture(cdp, file) {
  const shot = await cdp.send("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
    captureBeyondViewport: false,
  });
  await fs.writeFile(file, Buffer.from(shot.data, "base64"));
}

async function bestEffortSourceCrawl(graph) {
  const urls = [...new Set(graph.nodes.map((node) => node.sourceUrl).filter(Boolean))];
  return await Promise.all(
    urls.map(async (url) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      try {
        const response = await fetch(url, {
          method: "HEAD",
          redirect: "follow",
          signal: controller.signal,
          headers: { "user-agent": "US-Systems-Lab-link-check/1.0" },
        });
        return {
          url,
          ok: response.status >= 200 && response.status < 400,
          status: response.status,
          finalUrl: response.url,
        };
      } catch (error) {
        return { url, ok: false, error: error instanceof Error ? error.message : String(error) };
      } finally {
        clearTimeout(timer);
      }
    }),
  );
}

async function run() {
  await fs.mkdir(ARTIFACT_DIR, { recursive: true });
  const graph = readGraph(
    JSON.parse(await fs.readFile(path.join(ROOT, "src/data/graph.json"), "utf8")),
  );
  const propagationSource = await fs.readFile(path.join(ROOT, "src/lib/propagation.ts"), "utf8");
  const hopMatch = /DEFAULT_PARAMS[^=]*=\s*\{\s*maxHops:\s*(\d+)/m.exec(propagationSource);
  if (!hopMatch) fail("could not read DEFAULT_PARAMS.maxHops");
  const maxHops = Number(hopMatch[1]);

  const chrome = await findChrome();
  const vite = path.join(ROOT, "node_modules/.bin/vite");
  if (!(await exists(vite))) fail("Vite binary is missing; run npm ci first");
  if (!(await exists(path.join(ROOT, "dist/index.html"))))
    fail("dist/index.html is missing; run npm run build first");

  await assertPortFree(HOST, PORT);

  const previewOut = await fs.open(path.join(ARTIFACT_DIR, "preview.stdout.log"), "w");
  const previewErr = await fs.open(path.join(ARTIFACT_DIR, "preview.stderr.log"), "w");
  const preview = spawn(vite, ["preview", "--host", HOST, "--port", String(PORT), "--strictPort"], {
    cwd: ROOT,
    detached: true,
    stdio: ["ignore", previewOut.fd, previewErr.fd],
  });

  let chromeProcess;

  let chromeOut;

  let chromeErr;

  let cdp;
  const exceptions = [];
  const consoleErrors = [];
  const report = {
    graph: { nodes: graph.nodes.length, edges: graph.edges.length, maxHops },
    chrome,
    singleLeverChecks: [],
    multiLever: null,
    keyboard: null,
    zoom: null,
    mobile: null,
    sourceCrawl: [],
  };

  try {
    await waitForHttp(BASE_URL, 10000);

    const profile = path.join(ARTIFACT_DIR, "chrome-profile");
    await fs.rm(profile, { recursive: true, force: true });
    await fs.mkdir(profile, { recursive: true });
    chromeOut = await fs.open(path.join(ARTIFACT_DIR, "chrome.stdout.log"), "w");

    chromeErr = await fs.open(path.join(ARTIFACT_DIR, "chrome.stderr.log"), "w");

    chromeProcess = spawn(
      chrome,
      [
        "--headless=new",
        "--disable-gpu",
        "--disable-extensions",
        "--disable-background-networking",
        "--disable-component-update",
        "--disable-default-apps",
        "--no-first-run",
        "--no-default-browser-check",
        "--remote-debugging-address=127.0.0.1",
        "--remote-debugging-port=0",
        "--remote-allow-origins=*",
        `--user-data-dir=${profile}`,
        "about:blank",
      ],
      { detached: true, stdio: ["ignore", chromeOut.fd, chromeErr.fd] },
    );

    const active = await waitForFile(path.join(profile, "DevToolsActivePort"), 10000);
    const port = Number(active.trim().split(/\r?\n/)[0]);
    const target = await fetchJson(
      `http://127.0.0.1:${port}/json/new?${encodeURIComponent("about:blank")}`,
      { method: "PUT" },
    );

    cdp = new Cdp(target.webSocketDebuggerUrl);
    await cdp.connect();
    cdp.on("Runtime.exceptionThrown", (params) => exceptions.push(params));
    cdp.on("Runtime.consoleAPICalled", (params) => {
      if (params.type === "error" || params.type === "assert") consoleErrors.push(params);
    });

    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: 1440,
      height: 1000,
      deviceScaleFactor: 1,
      mobile: false,
      screenWidth: 1440,
      screenHeight: 1000,
    });

    const loaded = cdp.waitFor("Page.loadEventFired", 12000);
    const navigation = await cdp.send("Page.navigate", { url: `${BASE_URL}/` }, 12000);
    if (navigation.errorText) fail(`navigation failed: ${navigation.errorText}`);
    await loaded;
    await sleep(700);

    const staticDesktop = await staticState(cdp);
    report.staticDesktop = staticDesktop;
    if (staticDesktop.sliders.length !== graph.nodes.length)
      fail(`expected ${graph.nodes.length} sliders, got ${staticDesktop.sliders.length}`);
    if (staticDesktop.nodeIds.length !== graph.nodes.length)
      fail(`expected ${graph.nodes.length} React Flow nodes, got ${staticDesktop.nodeIds.length}`);
    if (staticDesktop.edgeIds.length !== graph.edges.length)
      fail(`expected ${graph.edges.length} React Flow edges, got ${staticDesktop.edgeIds.length}`);
    sameMembers(
      staticDesktop.nodeIds,
      graph.nodes.map((node) => node.id),
      "React Flow node ids",
    );
    sameMembers(
      staticDesktop.cardIds,
      graph.nodes.map((node) => node.id),
      "card ids",
    );
    sameMembers(
      staticDesktop.edgeIds,
      graph.edges.map((edge) => edge.id),
      "edge ids",
    );
    sameMembers(
      staticDesktop.sliders.map((item) => item.id),
      graph.nodes.map((node) => `lever-${node.id}`),
      "slider ids",
    );

    for (const slider of staticDesktop.sliders) {
      if (slider.min !== "-100" || slider.max !== "100" || slider.step !== "10") {
        fail(`${slider.id}: expected min=-100 max=100 step=10, got ${JSON.stringify(slider)}`);
      }
      if (!slider.aria?.startsWith("Scenario adjustment for "))
        fail(`${slider.id}: missing accessible name`);
    }

    if (
      !staticDesktop.wrapperRect ||
      staticDesktop.wrapperRect.height < 300 ||
      staticDesktop.wrapperRect.width < 300
    )
      fail("graph wrapper has invalid dimensions");
    if (
      !staticDesktop.flowRect ||
      staticDesktop.flowRect.height < 300 ||
      staticDesktop.flowRect.width < 300
    )
      fail("React Flow surface has invalid dimensions");
    if (!isNearWhite(staticDesktop.bodyBackgroundRgba))
      fail(
        `body is not white: ${staticDesktop.bodyBackground} -> ${JSON.stringify(staticDesktop.bodyBackgroundRgba)}`,
      );
    if (!isNearWhite(staticDesktop.headerBackgroundRgba))
      fail(
        `header is not white: ${staticDesktop.headerBackground} -> ${JSON.stringify(staticDesktop.headerBackgroundRgba)}`,
      );
    if (!isNearWhite(staticDesktop.cardBackgroundRgba))
      fail(
        `cards are not white: ${staticDesktop.cardBackground} -> ${JSON.stringify(staticDesktop.cardBackgroundRgba)}`,
      );
    if (
      !staticDesktop.cardTitleColorRgba ||
      !staticDesktop.cardBackgroundRgba ||
      contrast(staticDesktop.cardTitleColorRgba, staticDesktop.cardBackgroundRgba) < 4.5
    )
      fail(
        `card title contrast is below 4.5:1: ${JSON.stringify(staticDesktop.cardTitleColorRgba)} on ${JSON.stringify(staticDesktop.cardBackgroundRgba)}`,
      );
    if (
      !staticDesktop.titleColorRgba ||
      !staticDesktop.titleBackgroundRgba ||
      contrast(staticDesktop.titleColorRgba, staticDesktop.titleBackgroundRgba) < 7
    )
      fail(
        `title contrast is below 7:1: ${JSON.stringify(staticDesktop.titleColorRgba)} on ${JSON.stringify(staticDesktop.titleBackgroundRgba)}`,
      );

    const expectedSources = graph.nodes.filter((node) => node.sourceUrl !== null);
    if (staticDesktop.sourceLinks.length !== expectedSources.length)
      fail(
        `expected ${expectedSources.length} source links, got ${staticDesktop.sourceLinks.length}`,
      );
    for (const source of expectedSources) {
      const match = staticDesktop.sourceLinks.find(
        (item) => item.href === new URL(source.sourceUrl).href,
      );
      if (!match) fail(`missing source link for ${source.id}: ${source.sourceUrl}`);
      if (match.target !== "_blank" || !match.rel.includes("noreferrer"))
        fail(`unsafe source link attributes for ${source.id}`);
    }

    await capture(cdp, path.join(ARTIFACT_DIR, "desktop-baseline.png"));

    const offGridLoaded = cdp.waitFor("Page.loadEventFired", 12000);
    const offGridNavigation = await cdp.send(
      "Page.navigate",
      { url: `${BASE_URL}/?l=fed_rate:55` },
      12000,
    );
    if (offGridNavigation.errorText)
      fail(`off-grid scenario navigation failed: ${offGridNavigation.errorText}`);
    await offGridLoaded;
    await sleep(500);
    const offGridScenario = await evaluate(
      cdp,
      `(() => {
        const slider = document.querySelector('#lever-fed_rate');
        const output = document.querySelector('[data-node-id="fed_rate"] output');
        const card = document.querySelector('[data-node-id="fed_rate"]');
        return {
          sliderValue: slider?.value ?? null,
          label: output?.textContent?.trim() ?? null,
          search: location.search,
          effect: card?.getAttribute('data-effect') ?? null,
        };
      })()`,
    );
    report.offGridScenario = offGridScenario;
    if (offGridScenario.sliderValue !== "60")
      fail(`off-grid URL did not normalize the slider to 60: ${JSON.stringify(offGridScenario)}`);
    if (offGridScenario.label !== "+60% of display range")
      fail(`off-grid URL left the label inconsistent: ${JSON.stringify(offGridScenario)}`);
    if (
      !offGridScenario.search.includes("fed_rate:60") ||
      offGridScenario.search.includes("fed_rate:55")
    )
      fail(`off-grid URL was not canonicalized: ${JSON.stringify(offGridScenario)}`);
    if (offGridScenario.effect !== "up")
      fail(
        `off-grid URL did not drive the model from the normalized value: ${JSON.stringify(offGridScenario)}`,
      );
    await resetScenario(cdp);

    for (const node of graph.nodes) {
      const reachable = simpleReachable(graph, node.id, maxHops);
      reachable.add(node.id);
      const snapshots = {};

      for (const sign of [1, -1]) {
        await resetScenario(cdp);
        await clickSlider(cdp, node.id, sign);
        const state = await scenarioState(cdp);
        const slider = state.sliders.find((item) => item.id === `lever-${node.id}`);
        if (!slider) fail(`${node.id}: slider disappeared after interaction`);
        const expectedValue = sign > 0 ? "100" : "-100";
        if (slider.value !== expectedValue)
          fail(
            `${node.id}: ${sign > 0 ? "+" : "-"} click produced ${slider.value}, expected ${expectedValue}`,
          );
        if (!/1 active lever/.test(state.activeText))
          fail(`${node.id}: active lever count did not become 1`);
        if (state.resetDisabled !== false) fail(`${node.id}: Reset scenario did not enable`);
        if (!state.search.includes(`${node.id}:${sign > 0 ? "100" : "-100"}`))
          fail(`${node.id}: URL did not encode the lever correctly: ${state.search}`);

        const cardMap = new Map(state.cards.map((card) => [card.id, card]));
        const sourceCard = cardMap.get(node.id);
        if (!sourceCard) fail(`${node.id}: source card missing`);
        const expectedDirection = sign > 0 ? "up" : "down";
        if (sourceCard.effect !== expectedDirection || sourceCard.bucket !== "large")
          fail(
            `${node.id}: source card did not show ${expectedDirection}/large: ${JSON.stringify(sourceCard)}`,
          );

        const visible = new Set();
        for (const card of state.cards) {
          if (card.effect !== "none") {
            visible.add(card.id);
            if (!reachable.has(card.id))
              fail(`${node.id}: effect leaked upstream/unrelated to ${card.id}`);
          }
        }
        if (!visible.has(node.id)) fail(`${node.id}: its own lever was not visible`);

        snapshots[sign > 0 ? "plus" : "minus"] = state.cards;
        report.singleLeverChecks.push({
          nodeId: node.id,
          sign,
          visible: [...visible].sort(),
          url: state.search,
        });
        await resetScenario(cdp);
      }

      const plus = new Map(snapshots.plus.map((card) => [card.id, card]));
      const minus = new Map(snapshots.minus.map((card) => [card.id, card]));
      for (const target of graph.nodes) {
        const p = plus.get(target.id);
        const m = minus.get(target.id);
        if (!p || !m) fail(`${node.id}: missing symmetry card ${target.id}`);
        if (p.bucket !== m.bucket)
          fail(
            `${node.id} -> ${target.id}: bucket is not sign-symmetric (${p.bucket} vs ${m.bucket})`,
          );
        if (m.effect !== invertDirection(p.effect))
          fail(
            `${node.id} -> ${target.id}: direction is not sign-symmetric (${p.effect} vs ${m.effect})`,
          );
      }
    }

    await resetScenario(cdp);
    const multi = [
      ["fed_rate", 1],
      ["productivity", -1],
      ["poverty_rate", 1],
    ].filter(([id]) => graph.nodes.some((node) => node.id === id));
    for (const [id, sign] of multi) await clickSlider(cdp, id, sign);
    const multiBeforeReload = await scenarioState(cdp);
    if (!new RegExp(`^${multi.length} active levers?$`).test(multiBeforeReload.activeText))
      fail(`multi-lever count wrong: ${multiBeforeReload.activeText}`);
    const multiUrl = `${BASE_URL}/${multiBeforeReload.search}`;
    report.multiLever = { beforeReload: multiBeforeReload, url: multiUrl };

    const reloadLoaded = cdp.waitFor("Page.loadEventFired", 12000);
    const nav2 = await cdp.send("Page.navigate", { url: multiUrl }, 12000);
    if (nav2.errorText) fail(`scenario reload navigation failed: ${nav2.errorText}`);
    await reloadLoaded;
    await sleep(500);
    const multiAfterReload = await scenarioState(cdp);
    report.multiLever.afterReload = multiAfterReload;
    if (multiAfterReload.search !== multiBeforeReload.search)
      fail("scenario URL changed across reload");
    if (multiAfterReload.activeText !== multiBeforeReload.activeText)
      fail("active lever count changed across reload");
    for (const [id, sign] of multi) {
      const slider = multiAfterReload.sliders.find((item) => item.id === `lever-${id}`);
      if (!slider || slider.value !== (sign > 0 ? "100" : "-100"))
        fail(`scenario reload lost ${id}`);
    }
    for (const beforeCard of multiBeforeReload.cards) {
      const afterCard = multiAfterReload.cards.find((card) => card.id === beforeCard.id);
      if (
        !afterCard ||
        afterCard.effect !== beforeCard.effect ||
        afterCard.bucket !== beforeCard.bucket
      )
        fail(`scenario reload changed effect state for ${beforeCard.id}`);
    }
    await resetScenario(cdp);

    const keyboardRect = await evaluate(
      cdp,
      `(() => { const el=document.querySelector('#lever-inflation'); if(!el)return null; const r=el.getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2}; })()`,
    );
    if (keyboardRect) {
      await mouseClick(cdp, keyboardRect.x, keyboardRect.y);
      await key(cdp, "Home", "Home");
      await sleep(80);
      const keyboardState = await scenarioState(cdp);
      const inflation = keyboardState.sliders.find((item) => item.id === "lever-inflation");
      report.keyboard = keyboardState;
      if (
        !inflation ||
        inflation.value !== "-100" ||
        !/1 active lever/.test(keyboardState.activeText)
      )
        fail("keyboard Home did not drive the Inflation slider to -100");
      await resetScenario(cdp);
    }

    const beforeZoom = await staticState(cdp);
    const zoomRect = await evaluate(
      cdp,
      `(() => { const el=document.querySelector('button[aria-label="Zoom In"]'); if(!el)return null; const r=el.getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2}; })()`,
    );
    if (!zoomRect) fail("Zoom In control missing");
    await mouseClick(cdp, zoomRect.x, zoomRect.y);
    await sleep(150);
    const afterZoom = await staticState(cdp);
    report.zoom = { before: beforeZoom.viewportTransform, after: afterZoom.viewportTransform };
    if (afterZoom.viewportTransform === beforeZoom.viewportTransform)
      fail("Zoom In control did not change the viewport transform");

    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true,
      screenWidth: 390,
      screenHeight: 844,
    });
    const mobileLoaded = cdp.waitFor("Page.loadEventFired", 12000);
    await cdp.send("Page.reload", {}, 12000);
    await mobileLoaded;
    await sleep(500);
    const mobile = await staticState(cdp);
    report.mobile = mobile;
    if (!mobile.wrapperRect || mobile.wrapperRect.width < 300 || mobile.wrapperRect.height < 250)
      fail(`mobile graph dimensions invalid: ${JSON.stringify(mobile.wrapperRect)}`);
    if (mobile.sliders.length !== graph.nodes.length) fail("mobile view lost sliders");
    if (mobile.bodyScrollWidth > mobile.innerWidth + 1)
      fail(
        `mobile page has horizontal document overflow: ${mobile.bodyScrollWidth} > ${mobile.innerWidth}`,
      );
    await capture(cdp, path.join(ARTIFACT_DIR, "mobile-baseline.png"));

    if (process.env.USL_E2E_CRAWL_SOURCES === "1") {
      report.sourceCrawl = await bestEffortSourceCrawl(graph);
    }

    if (exceptions.length) fail(`browser exceptions: ${exceptions.length}`);
    if (consoleErrors.length) fail(`browser console errors/asserts: ${consoleErrors.length}`);

    await fs.writeFile(
      path.join(ARTIFACT_DIR, "exceptions.json"),
      JSON.stringify(exceptions, null, 2) + "\n",
    );
    await fs.writeFile(
      path.join(ARTIFACT_DIR, "console-errors.json"),
      JSON.stringify(consoleErrors, null, 2) + "\n",
    );
    await fs.writeFile(
      path.join(ARTIFACT_DIR, "deep-e2e-report.json"),
      JSON.stringify(report, null, 2) + "\n",
    );

    console.log(
      `Deep E2E PASS: ${graph.nodes.length} nodes, ${graph.edges.length} edges, ${report.singleLeverChecks.length} signed single-lever browser scenarios.`,
    );
    console.log(`Artifacts: ${ARTIFACT_DIR}`);
  } finally {
    try {
      cdp?.close();
    } catch {
      // Cleanup must not mask the primary E2E result.
    }
    await killProcess(chromeProcess);
    await killProcess(preview);
    if (chromeOut) await chromeOut.close();
    if (chromeErr) await chromeErr.close();
    await previewOut.close();
    await previewErr.close();
  }
}

const timeout = new Promise((_, reject) => {
  setTimeout(() => reject(new Error("deep E2E overall timeout")), 120000);
});

try {
  await Promise.race([run(), timeout]);
} catch (error) {
  console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
  process.exitCode = 1;
}
