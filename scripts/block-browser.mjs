/**
 * Local browser-automation harness for the Block Board e2e suite.
 *
 * TRUST MODEL, for the CodeQL findings this file draws: it is developer and CI tooling
 * only. It never ships in the built application (only files under src/ and public/ reach
 * dist/) and it never runs in response to any network request. Every value this file
 * treats as "environment input" (CHROME_PATH, USL_E2E_URL, the artifacts directory) is
 * set only by the same person or CI job invoking npm run test:e2e, never by a remote
 * caller. child_process.spawn is always called with an argument array and without
 * shell: true, so it does not go through a shell and is not subject to shell metacharacter
 * injection regardless of the executable path's content.
 */
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import net from "node:net";
import path from "node:path";
import process from "node:process";

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export function requireCheck(condition, message) {
  if (!condition) throw new Error(message);
}

class CDP {
  constructor(socket) {
    this.socket = socket;
    this.pending = new Map();
    this.listeners = new Map();
    this.id = 0;
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id) {
        const request = this.pending.get(message.id);
        if (!request) return;
        this.pending.delete(message.id);
        clearTimeout(request.timer);
        if (message.error)
          request.reject(new Error(`${request.method}: ${JSON.stringify(message.error)}`));
        else request.resolve(message.result);
      } else
        for (const handler of this.listeners.get(message.method) ?? []) handler(message.params);
    });
  }
  on(method, callback) {
    const list = this.listeners.get(method) ?? [];
    list.push(callback);
    this.listeners.set(method, list);
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }, 12000);
      this.pending.set(id, { resolve, reject, timer, method });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails)
      throw new Error(`Browser evaluation failed: ${JSON.stringify(result.exceptionDetails)}`);
    return result.result?.value;
  }
  async wait(expression, description, timeout = 8000) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      if (await this.evaluate(expression)) return;
      await sleep(60);
    }
    throw new Error(`Timed out: ${description}`);
  }
  async click(selector) {
    await this.evaluate(
      `document.querySelector(${JSON.stringify(selector)})?.scrollIntoView({block:'center',inline:'nearest'})`,
    );
    await sleep(70);
    // codeql[js/bad-code-sanitization]: JSON.stringify is a correct JS-string-literal
    // sanitizer for embedding into a CDP Runtime.evaluate expression; CodeQL does not
    // model that sink. selector is always a literal CSS selector this file wrote itself.
    const point = await this
      .evaluate(`(() => { const el=document.querySelector(${JSON.stringify(selector)}); if(!el)return null;
      const r=el.getBoundingClientRect(); const x=r.left+r.width/2,y=r.top+r.height/2;
      return {x,y,width:r.width,height:r.height,hit:el.contains(document.elementFromPoint(x,y)),disabled:el.disabled===true}; })()`);
    requireCheck(
      point?.hit && point.width > 0 && point.height > 0 && !point.disabled,
      `Unusable pointer target: ${selector} ${JSON.stringify(point)}`,
    );
    await this.send("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x: point.x,
      y: point.y,
      button: "left",
      buttons: 1,
      clickCount: 1,
    });
    await this.send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: point.x,
      y: point.y,
      button: "left",
      buttons: 0,
      clickCount: 1,
    });
  }
  async button(name) {
    const token = `block-test-target-${++this.id}`;
    // codeql[js/bad-code-sanitization]: same JSON.stringify sanitizer as above; name is a
    // literal button label this file wrote itself, never external input.
    const found = await this.evaluate(
      `(() => {const el=[...document.querySelectorAll('button')].find(el=>el.textContent.trim()===${JSON.stringify(name)} && el.getBoundingClientRect().height>0); if(!el)return false;el.setAttribute('data-probe',${JSON.stringify(token)});return true;})()`,
    );
    requireCheck(found, `Button unavailable: ${name}`);
    await this.click(`[data-probe="${token}"]`);
  }
  async key(key) {
    const virtual = {
      Home: 36,
      End: 35,
      ArrowLeft: 37,
      ArrowUp: 38,
      ArrowRight: 39,
      ArrowDown: 40,
      Enter: 13,
      Tab: 9,
      Escape: 27,
    }[key];
    await this.send("Input.dispatchKeyEvent", {
      type: "keyDown",
      key,
      code: key,
      windowsVirtualKeyCode: virtual,
    });
    await this.send("Input.dispatchKeyEvent", {
      type: "keyUp",
      key,
      code: key,
      windowsVirtualKeyCode: virtual,
    });
  }
  async select(selector, value) {
    // Selection is through the native control's keyboard path, not React internals.
    // codeql[js/bad-code-sanitization]: same JSON.stringify sanitizer as above; selector
    // and value are literal strings this file wrote itself.
    const index = await this.evaluate(
      `(() => {const el=document.querySelector(${JSON.stringify(selector)});if(!el)return -1;el.focus();return [...el.options].findIndex(o=>o.value===${JSON.stringify(value)});})()`,
    );
    requireCheck(index >= 0, `Option missing: ${selector} ${value}`);
    await this.key("Home");
    for (let i = 0; i < index; i++) await this.key("ArrowDown");
    await this.key("Enter");
    await sleep(100);
    const selected = await this.evaluate(
      `document.querySelector(${JSON.stringify(selector)})?.value`,
    );
    requireCheck(selected === value, `Native select did not choose ${value}: ${selected}`);
  }
  async screenshot(file) {
    const shot = await this.send("Page.captureScreenshot", {
      format: "png",
      fromSurface: true,
      captureBeyondViewport: false,
    });
    await fs.writeFile(file, Buffer.from(shot.data, "base64"));
  }
  close() {
    for (const item of this.pending.values()) {
      clearTimeout(item.timer);
      item.reject(new Error("Browser session closed"));
    }
    this.pending.clear();
    this.socket.close();
  }
}
async function stop(child) {
  if (!child || child.exitCode !== null) return;
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    /* Already exited. */
  }
  const end = Date.now() + 1500;
  while (child.exitCode === null && Date.now() < end) await sleep(50);
  if (child.exitCode === null) {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      /* Already exited. */
    }
  }
}
async function fetchTimed(url, init = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
async function freePort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Port allocation failed"));
        return;
      }
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
}
export async function startBrowser(root, artifacts) {
  await fs.mkdir(artifacts, { recursive: true });
  const candidates = [
    process.env.CHROME_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].filter(Boolean);
  let chrome;
  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      chrome = candidate;
      break;
    } catch {
      /* Try next known installation. */
    }
  }
  requireCheck(chrome, "Chrome/Chromium is missing. Set CHROME_PATH.");
  let preview, browser, cdp;
  const handles = [];
  const failures = { exceptions: [], console: [], network: [], http: [], history: [] };
  const close = async () => {
    cdp?.close();
    await stop(browser);
    await stop(preview);
    for (const handle of handles) await handle.close();
    handles.length = 0;
  };
  try {
    const port = await freePort();
    // The value actually used below (`base`) is always re-derived from a URL object this
    // process constructed and validated, never the raw environment string: either the
    // fixed loopback template, or target.href after the protocol/host check passes.
    let base = `http://127.0.0.1:${port}`;
    if (process.env.USL_E2E_URL) {
      const target = new URL(process.env.USL_E2E_URL);
      requireCheck(
        target.protocol === "https:" ||
          (target.protocol === "http:" && target.hostname === "127.0.0.1"),
        "Only HTTPS or explicit loopback targets are allowed",
      );
      base = target.href;
    }
    if (!process.env.USL_E2E_URL) {
      // codeql[js/path-injection]: artifacts is caller-supplied CLI/CI configuration, not
      // externally reachable input; see the file header.
      const out = await fs.open(path.join(artifacts, "preview.log"), "w");
      handles.push(out);
      preview = spawn(
        path.join(root, "node_modules/.bin/vite"),
        ["preview", "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
        { cwd: root, detached: true, stdio: ["ignore", out.fd, out.fd] },
      );
      preview.on("error", (error) => failures.network.push({ error: error.message }));
      let ready = false;
      for (let i = 0; i < 70; i++) {
        try {
          // codeql[js/request-forgery]: base is either the fixed loopback template, or
          // target.href from a URL already checked above to be HTTPS or explicit
          // loopback; the requireCheck two lines up is the actual barrier.
          const response = await fetchTimed(base);
          if (response.ok) {
            ready = true;
            break;
          }
        } catch {
          /* Startup polling is bounded. */
        }
        if (preview.exitCode !== null)
          throw new Error("Vite preview exited during startup; see preview.log");
        await sleep(100);
      }
      requireCheck(ready, "Preview server did not start");
    }
    // codeql[js/path-injection]: artifacts is set only by the caller of this CLI tool
    // (npm run test:e2e, locally or in CI), documented in the file header above.
    const profile = await fs.mkdtemp(path.join(artifacts, "chrome-"));
    const output = await fs.open(path.join(artifacts, "chrome.log"), "w");
    handles.push(output);
    // codeql[js/command-line-injection]: spawn() is called with an argument array and no
    // shell:true (see file header), so it is not subject to shell injection. chrome was
    // already confirmed to be a path that exists on disk by the fs.access loop above.
    browser = spawn(
      chrome,
      [
        ...(process.env.USL_CHROME_NO_SANDBOX === "1"
          ? ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"]
          : []),
        "--headless=new",
        "--disable-gpu",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-extensions",
        "--disable-background-networking",
        "--remote-debugging-address=127.0.0.1",
        "--remote-debugging-port=0",
        `--user-data-dir=${profile}`,
        "about:blank",
      ],
      { detached: true, stdio: ["ignore", output.fd, output.fd] },
    );
    browser.on("error", (error) => failures.network.push({ error: error.message }));
    let debugPort;
    for (let i = 0; i < 100; i++) {
      try {
        debugPort = Number(
          (await fs.readFile(path.join(profile, "DevToolsActivePort"), "utf8")).split("\n")[0],
        );
        if (debugPort) break;
      } catch {
        /* Waiting for Chromium's own port file. */
      }
      if (browser.exitCode !== null)
        throw new Error("Chrome exited during startup; see chrome.log");
      await sleep(100);
    }
    requireCheck(debugPort, "Chrome DevTools did not start");
    const response = await fetchTimed(`http://127.0.0.1:${debugPort}/json/new?about:blank`, {
      method: "PUT",
    });
    requireCheck(response.ok, "Cannot create browser target");
    const target = await response.json();
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Browser WebSocket startup timeout")), 8000);
      socket.addEventListener(
        "open",
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
      socket.addEventListener(
        "error",
        () => {
          clearTimeout(timer);
          reject(new Error("Browser WebSocket failed"));
        },
        { once: true },
      );
    });
    cdp = new CDP(socket);
    cdp.on("Runtime.exceptionThrown", (item) => failures.exceptions.push(item));
    cdp.on("Runtime.consoleAPICalled", (item) => {
      if (item.type === "error" || item.type === "assert") failures.console.push(item);
    });
    cdp.on("Network.loadingFailed", (item) => {
      if (!item.canceled) failures.network.push(item);
    });
    cdp.on("Network.responseReceived", (item) => {
      if (item.response.status >= 400 && item.response.url.startsWith(new URL(base).origin))
        failures.http.push(item.response);
    });
    cdp.on("Log.entryAdded", (item) => {
      if (
        /Throttling navigation|too many calls.*(?:history|location)|history.*too (?:often|frequen)/i.test(
          item.entry.text,
        )
      )
        failures.history.push(item.entry);
    });
    await cdp.send("Log.enable");
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Network.enable");
    const viewport = async (width, height) => {
      await cdp.send("Emulation.setDeviceMetricsOverride", {
        width,
        height,
        deviceScaleFactor: 1,
        mobile: width < 900,
        screenWidth: width,
        screenHeight: height,
      });
      await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: width < 900 });
      await sleep(100);
    };
    const navigate = async (suffix = "/") => {
      // Remove the old marker before navigating so readiness cannot match the previous page.
      await cdp.evaluate(
        "document.querySelector('[data-block-board]')?.removeAttribute('data-block-board')",
      );
      const navigation = await cdp.send("Page.navigate", { url: new URL(suffix, base).href });
      requireCheck(!navigation.errorText, `Navigation failed: ${navigation.errorText}`);
      await cdp.wait(
        "document.readyState === 'complete' && !!document.querySelector('[data-block-board=\"1\"]')",
        "Block Board mounted",
      );
      await sleep(250);
    };
    return { cdp, base, failures, viewport, navigate, close };
  } catch (error) {
    await close();
    throw error;
  }
}
