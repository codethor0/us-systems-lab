/**
 * Local/CI e2e driver for the Block Board. Developer and CI tooling only; it never ships
 * in the built application and never runs in response to a network request.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, URLSearchParams } from "node:url";
import { startBrowser, requireCheck, sleep } from "./block-browser.mjs";
import { exactOracle } from "./block-oracle.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const graph = JSON.parse(await fs.readFile(path.join(root, "src/data/graph.json"), "utf8"));
const params = await fs.readFile(path.join(root, "src/lib/propagation.ts"), "utf8");
requireCheck(
  /DEFAULT_PARAMS[^=]*=\s*\{\s*maxHops:\s*3,\s*decay:\s*0\.7\s*\}/.test(params),
  "Oracle requires review: propagation defaults changed",
);
requireCheck(
  graph.nodes.length === 20 && graph.edges.length === 20,
  "Graph inventory changed; review required",
);
const expectedBuild = /BLOCK_BUILD\s*=\s*["']([^"']+)/.exec(
  await fs.readFile(path.join(root, "src/ui/blocks/build.ts"), "utf8"),
)?.[1];
requireCheck(expectedBuild, "Missing expected build identifier");
const expectedScenario = exactOracle(graph);
const session = await startBrowser();
const { cdp, artifacts } = session;
const report = {
  status: "RUNNING",
  cases: [],
  intermediateCases: [],
  viewports: [],
  assertions: [],
  target: session.base,
  // True only when this run used the fixed canonical production target rather than a
  // Vite preview of the local build. Assigned once at the very end; still false on a
  // crash, so a partial report never claims a production run it did not complete.
  productionVerified: false,
};
let timeout;

async function snapshot() {
  return await cdp.evaluate(`(() => ({
    build: document.querySelector('[data-block-board]')?.getAttribute('data-build'),
    query: location.search,
    urlSync: document.querySelector('[data-block-board]')?.getAttribute('data-url-sync'),
    resetDisabled: document.querySelector('[data-action="reset"]')?.disabled,
    counts: document.querySelector('.bb-counts')?.textContent,
    noticeHidden: document.querySelector('.bb-notice')?.hidden,
    cards: [...document.querySelectorAll('[data-indicator]')].map(el => ({
      id:el.dataset.indicator, own:Number(el.dataset.own), delta:Number(el.dataset.delta),
      position:Number(el.dataset.position), count:el.querySelectorAll('.bb-filled').length,
      cells:el.querySelectorAll('.bb-square').length,
      input:Number(el.querySelector('input[type=range]').value), step:el.querySelector('input[type=range]').step,
      value:Number(el.querySelector('.bb-value').textContent), state:el.dataset.state,
      valueFits:(v=>v.scrollWidth<=v.clientWidth+1&&v.getBoundingClientRect().height<=parseFloat(getComputedStyle(v).fontSize)*1.4)(el.querySelector('.bb-value')),
      color:el.style.getPropertyValue('--bb-fill'),
      colored:[...el.querySelectorAll('.bb-filled')].every(x=>getComputedStyle(x).backgroundColor!=='rgba(0, 0, 0, 0)'),
      status:el.querySelector('.bb-state').textContent,
      automatic:(()=>{const t=el.querySelector('[data-auto-response]'),f=el.querySelector('.bb-response-fill'),m=el.querySelector('.bb-response-marker');if(!t||!f||!m)return null;const tr=t.getBoundingClientRect(),fr=f.getBoundingClientRect(),mr=m.getBoundingClientRect();return {value:Number(t.getAttribute('aria-valuenow')),role:t.getAttribute('role'),width:fr.width,track:tr.width,marker:mr.left+mr.width/2-tr.left,color:getComputedStyle(f).backgroundColor,matchesFillColor:(()=>{const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d',{willReadFrequently:true});if(!ctx)return false;canvas.width=canvas.height=1;ctx.fillStyle=el.style.getPropertyValue('--bb-fill');ctx.fillRect(0,0,1,1);const expected=[...ctx.getImageData(0,0,1,1).data].join(',');ctx.clearRect(0,0,1,1);ctx.fillStyle=getComputedStyle(f).backgroundColor;ctx.fillRect(0,0,1,1);return expected===[...ctx.getImageData(0,0,1,1).data].join(',');})(),blockColor:el.querySelector('.bb-filled')?getComputedStyle(el.querySelector('.bb-filled')).backgroundColor:null};})()
    }))
  }))()`);
}
function assertState(state, entries, label) {
  requireCheck(state.cards.length === 20, `${label}: missing tiles`);
  const expected = expectedScenario(entries);
  const seen = new Set();
  for (const card of state.cards) {
    requireCheck(!seen.has(card.id), `${label}: duplicate tile`);
    seen.add(card.id);
    const e = expected[card.id];
    requireCheck(card.valueFits, `${label}: ${card.id} position text does not fit on one line`);
    requireCheck(e, `${label}: unknown tile ${card.id}`);
    const filled = e.filled;
    requireCheck(
      card.cells === 100 && card.count === filled,
      `${label}: actual blocks frozen/wrong at ${card.id}: ${card.count}, expected ${filled}`,
    );
    requireCheck(
      Math.abs(card.delta - e.delta) < 1e-10,
      `${label}: wrong model response ${card.id}`,
    );
    requireCheck(
      Math.abs(card.position - (50 + 50 * e.delta)) < 1e-10,
      `${label}: wrong display position ${card.id}`,
    );
    requireCheck(
      Math.abs(card.value - card.position) < 0.00051,
      `${label}: numerical display wrong ${card.id}`,
    );
    requireCheck(
      card.own === e.own && Math.abs(card.input - (50 + 50 * e.own)) < 1e-10,
      `${label}: propagated output became manual input ${card.id}`,
    );
    requireCheck(card.step === "5" && card.colored, `${label}: input resolution/fill lost`);
    const auto = card.automatic;
    requireCheck(
      auto && auto.role === "meter" && auto.track > 0,
      `${label}: missing automatic response bar ${card.id}`,
    );
    requireCheck(
      Math.abs(auto.value - e.position) < 1e-10 &&
        Math.abs((auto.width / auto.track) * 100 - e.position) < 0.05 &&
        Math.abs((auto.marker / auto.track) * 100 - e.position) < 0.05,
      `${label}: automatic response geometry ${card.id}`,
    );
    requireCheck(
      card.status ===
        (e.idle
          ? "Not adjusted"
          : e.delta > 0
            ? "Increased"
            : e.delta < 0
              ? "Decreased"
              : "Unchanged"),
      `${label}: incorrect response direction ${card.id}`,
    );
    const color = e.idle ? "#c84040" : `hsl(${Math.round(e.position * 1.2)} 65% 35%)`;
    requireCheck(
      card.color === color &&
        auto.matchesFillColor &&
        (auto.blockColor === null || auto.color === auto.blockColor),
      `${label}: response color mismatch ${card.id}`,
    );
  }
}
async function waitForScenario(entries, label) {
  const encoded = entries
    .filter(([, value]) => value !== 0)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([id, value]) => `${id}:${Math.round(value * 100)}`)
    .join(",");
  report.currentCheck = label;
  const expected = encoded || null;
  await cdp.wait(
    `document.querySelector('[data-block-board]')?.dataset.urlSync==='synced' && new URLSearchParams(location.search).get('l')===${JSON.stringify(expected)}${encoded ? "" : " && location.search===''"}`,
    label + " URL synchronization",
  );
}
async function reset() {
  report.currentCheck = "reset";
  const disabled = await cdp.evaluate(`document.querySelector('[data-action="reset"]').disabled`);
  if (!disabled) await cdp.click('[data-action="reset"]');
  await cdp.wait(
    `document.querySelector('[data-block-board]')?.dataset.urlSync==='synced' && location.search==='' && [...document.querySelectorAll('[data-indicator]')].length===20 && [...document.querySelectorAll('[data-indicator]')].every(el=>Number(el.dataset.own)===0)`,
    "Reset clears every input and the URL",
  );
  const state = await snapshot();
  assertState(state, [], "reset");
  requireCheck(state.query === "", "reset did not clear URL");
  requireCheck(
    state.resetDisabled &&
      state.noticeHidden &&
      state.counts === "20 indicators / 0 manual inputs / 0 tiles moved",
    "reset controls/notices/counts did not settle",
  );
}
async function extreme(id, sign) {
  await cdp.click(`#block-input-${id}`);
  await cdp.key(sign > 0 ? "End" : "Home");
  await cdp.wait(
    `document.querySelector('[data-indicator="${id}"]').dataset.own==='${sign}'`,
    `${id} native keyboard`,
  );
}
async function capture(name) {
  await cdp.evaluate("window.scrollTo(0,0)");
  await sleep(100);
  await cdp.screenshot(path.join(artifacts, name + ".png"));
}
async function run() {
  for (const [width, height] of [
    [1440, 1000],
    [390, 844],
    [320, 740],
  ]) {
    await session.viewport(width, height);
    await session.navigate();
    const initial = await snapshot();
    requireCheck(initial.build === expectedBuild, "Wrong build is being tested");
    assertState(initial, [], "baseline");
    requireCheck(
      initial.cards.every((x) => x.state === "idle" && x.color === "#c84040"),
      "baseline must be red/50",
    );
    const geometry =
      await cdp.evaluate(`(() => ({width:innerWidth,scroll:document.documentElement.scrollWidth,
      inputs:[...document.querySelectorAll('.bb-slider')].map(el=>{const r=el.getBoundingClientRect();return {w:r.width,h:r.height}}),
      titles:[...document.querySelectorAll('.bb-card h2')].map(el=>parseFloat(getComputedStyle(el).fontSize))}))()`);
    requireCheck(geometry.scroll <= width + 1, "horizontal overflow");
    requireCheck(
      geometry.inputs.every((r) => r.w >= 180 && r.h >= 40),
      "controls are too small",
    );
    requireCheck(
      geometry.titles.every((n) => n >= 16),
      "unreadable titles",
    );
    report.viewports.push({ width, height, geometry });
    await capture(`baseline-${width}`);
    for (const node of graph.nodes) {
      for (const sign of [1, -1]) {
        await reset();
        await extreme(node.id, sign);
        await waitForScenario([[node.id, sign]], `${width}/${node.id}/${sign}`);
        const state = await snapshot();
        assertState(state, [[node.id, sign]], `${width}/${node.id}/${sign}`);
        const query = new URLSearchParams(state.query).get("l");
        requireCheck(
          query === `${node.id}:${sign * 100}`,
          "URL contains more than the manual input",
        );
        report.cases.push({
          width,
          node: node.id,
          sign,
          blocks: Object.fromEntries(state.cards.map((c) => [c.id, c.count])),
        });
      }
    }
    if (width === 1440) {
      for (const node of graph.nodes) {
        await reset();
        await cdp.click(`#block-input-${node.id}`);
        await cdp.key("Home");
        for (let position = 0; position <= 100; position += 5) {
          if (position > 0) await cdp.key("ArrowRight");
          const entries = position === 50 ? [] : [[node.id, (position - 50) / 50]];
          assertState(await snapshot(), entries, `intermediate/${node.id}/${position}`);
          await waitForScenario(entries, `intermediate/${node.id}/${position}`);
          report.intermediateCases.push({ node: node.id, position });
        }
      }
    }
    await reset();
    await extreme("productivity", 1);
    await capture(`productivity-${width}`);
    await reset();
    await extreme("federal_debt", 1);
    assertState(await snapshot(), [["federal_debt", 1]], "debt example");
    await capture(`debt-${width}`);
    await reset();
    if (width === 390) {
      await cdp.evaluate(
        `document.querySelector('#block-input-productivity').scrollIntoView({block:'center'})`,
      );
      await sleep(100);
      const r = await cdp.evaluate(
        `(() => {const r=document.querySelector('#block-input-productivity').getBoundingClientRect();return {x:r.right-2,y:r.top+r.height/2}})()`,
      );
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [{ x: r.x, y: r.y }],
      });
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await cdp.wait(
        "document.querySelector('[data-indicator=productivity]').dataset.own==='1'",
        "native touch input",
      );
      assertState(await snapshot(), [["productivity", 1]], "touch");
      report.assertions.push("native touch input");
    }
  }
  await session.viewport(1440, 1000);
  await session.navigate();
  await cdp.click('[data-indicator="productivity"] [data-square="100"]');
  assertState(await snapshot(), [["productivity", 1]], "click square");
  await cdp.key("Tab");
  await reset();
  await cdp.click("#block-input-productivity");
  await cdp.key("ArrowRight");
  assertState(await snapshot(), [["productivity", 0.1]], "native ArrowRight increment");
  await reset();
  await sleep(1000);
  await cdp.send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: "no-preference" }],
  });
  await cdp.evaluate(
    "document.querySelector('#block-input-productivity').scrollIntoView({block:'center'})",
  );
  const drag = await cdp.evaluate(
    "(()=>{const r=document.querySelector('#block-input-productivity').getBoundingClientRect();return {left:r.left,right:r.right,y:r.top+r.height/2}})()",
  );
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: (drag.left + drag.right) / 2,
    y: drag.y,
    button: "left",
    buttons: 1,
    clickCount: 1,
  });
  for (let i = 1; i <= 10; i++)
    await cdp.send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: (drag.left + drag.right) / 2 + (drag.right - drag.left) * 0.049 * i,
      y: drag.y,
      button: "left",
      buttons: 1,
    });
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: drag.right - 2,
    y: drag.y,
    button: "left",
    buttons: 0,
    clickCount: 1,
  });
  assertState(await snapshot(), [["productivity", 1]], "native pointer drag");
  requireCheck(
    await cdp.evaluate("document.querySelectorAll('.bb-pulse').length>0"),
    "change pulse did not start",
  );
  await sleep(1000);
  requireCheck(
    await cdp.evaluate("document.querySelectorAll('.bb-pulse').length===0"),
    "pulse did not settle",
  );
  report.assertions.push(
    "native ArrowRight increment",
    "native pointer drag",
    "finite change pulse",
  );
  await reset();
  for (const [id, sign] of [
    ["fed_rate", 1],
    ["productivity", -1],
    ["poverty_rate", 1],
  ])
    await extreme(id, sign);
  await waitForScenario(
    [
      ["fed_rate", 1],
      ["productivity", -1],
      ["poverty_rate", 1],
    ],
    "multi-input",
  );
  const multi = await snapshot();
  assertState(
    multi,
    [
      ["fed_rate", 1],
      ["productivity", -1],
      ["poverty_rate", 1],
    ],
    "multi-input",
  );
  await cdp.click('[data-action="share"]');
  const share = await cdp.evaluate("document.querySelector('#bb-share-link').value");
  requireCheck(new URL(share).search === multi.query, "share link wrong");
  await session.navigate("/" + multi.query);
  assertState(
    await snapshot(),
    [
      ["fed_rate", 1],
      ["productivity", -1],
      ["poverty_rate", 1],
    ],
    "reload",
  );
  await reset();
  await cdp.click("#block-input-fed_rate");
  await cdp.key("Home");
  for (let i = 0; i < 14; i++) await cdp.key("ArrowRight");
  await cdp.click("#block-input-mortgage_rate");
  await cdp.key("Home");
  for (let i = 0; i < 7; i++) await cdp.key("ArrowRight");
  assertState(
    await snapshot(),
    [
      ["fed_rate", 0.4],
      ["mortgage_rate", -0.3],
    ],
    "exact cancellation",
  );
  await reset();
  for (const [search, expected] of [
    ["?l=fed_rate:55", 0.6],
    ["?l=fed_rate:-55", -0.6],
  ]) {
    await session.navigate("/" + search);
    assertState(await snapshot(), [["fed_rate", expected]], "off-grid URL");
    await waitForScenario([["fed_rate", expected]], "off-grid URL");
    requireCheck(
      (await snapshot()).query.includes(`fed_rate:${expected * 100}`),
      "URL normalization lost",
    );
  }
  await session.navigate("/?l=constructor:100,bogus:oops");
  assertState(await snapshot(), [], "invalid URL");
  requireCheck(
    await cdp.evaluate("!document.querySelector('.bb-notice').hidden"),
    "invalid URL not explained",
  );
  await reset();
  await cdp.evaluate(
    "history.pushState(null,'','/?l=federal_debt:100');dispatchEvent(new PopStateEvent('popstate'))",
  );
  assertState(await snapshot(), [["federal_debt", 1]], "history");
  await reset();
  await cdp.evaluate(
    "history.pushState(null,'','/?l=productivity:100');dispatchEvent(new PopStateEvent('popstate'))",
  );
  await cdp.click('[data-action="share"]');
  await cdp.evaluate("history.back()");
  await cdp.wait(
    "document.querySelector('[data-indicator=productivity]').dataset.own==='0'",
    "back to neutral",
  );
  const historyShare = await cdp.evaluate("document.querySelector('#bb-share-link').value");
  requireCheck(
    new URL(historyShare).search === "",
    "Open share link is stale after history back to neutral",
  );
  await reset();
  await cdp.send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: "reduce" }],
  });
  await extreme("productivity", 1);
  requireCheck(
    await cdp.evaluate("document.querySelectorAll('.bb-pulse').length===0"),
    "reduced motion not honored",
  );
  await cdp.send("Emulation.setEmulatedMedia", { features: [] });
  await reset();
  await cdp.click('input[aria-label="Pulse changes"]');
  await extreme("fed_rate", 1);
  requireCheck(
    await cdp.evaluate("document.querySelectorAll('.bb-pulse').length===0"),
    "motion toggle failed",
  );
  // Do not pace the burst: cubes/meters must keep up while History writes are coalesced.
  await reset();
  await cdp.click("#block-input-productivity");
  await cdp.key("Home");
  for (let i = 0; i < 250; i++) {
    const forward = Math.floor(i / 20) % 2 === 0;
    await cdp.key(forward ? "ArrowRight" : "ArrowLeft");
    const step = (i % 20) + 1;
    const position = forward ? step * 5 : 100 - step * 5;
    assertState(
      await snapshot(),
      position === 50 ? [] : [["productivity", (position - 50) / 50]],
      "rapid input",
    );
  }
  await cdp.key("End");
  await cdp.key("Home");
  assertState(await snapshot(), [["productivity", -1]], "latest rapid input before Reset");
  await reset();
  await sleep(1000);
  requireCheck((await snapshot()).query === "", "an older queued input returned after Reset");
  const queueTwoInputsThen = (action) =>
    `(() => {
      const board = document.querySelector('[data-block-board]');
      const input = document.querySelector('#block-input-productivity');
      const set = (value) => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, String(value));
        input.dispatchEvent(new Event('input', { bubbles: true }));
      };
      set(20);
      set(80);
      const pending = board.dataset.urlSync;
      ${action}
      return pending;
    })()`;
  requireCheck(
    (await cdp.evaluate(
      queueTwoInputsThen("document.querySelector('[data-action=\"reset\"]').click();"),
    )) === "pending",
    "Reset race was not exercised: no URL write was queued",
  );
  await sleep(1000);
  requireCheck(
    (await snapshot()).query === "",
    "a queued input overwrote the address bar after an immediate Reset",
  );
  requireCheck(
    (await cdp.evaluate(
      queueTwoInputsThen(
        "history.pushState(null, '', '/'); dispatchEvent(new PopStateEvent('popstate'));",
      ),
    )) === "pending",
    "History race was not exercised: no URL write was queued",
  );
  await sleep(1000);
  requireCheck(
    (await snapshot()).query === "" &&
      (await cdp.evaluate(
        "document.querySelector('[data-indicator=productivity]').dataset.own==='0'",
      )),
    "a queued input overwrote history navigation to a neutral scenario",
  );
  await extreme("fed_rate", 1);
  await waitForScenario([["fed_rate", 1]], "post-stress input");
  report.assertions.push(
    "250 unpaced native keyboard updates",
    "Reset wins over queued URL",
    "provably queued write loses to Reset and to neutral history navigation",
    "no browser history-throttling warnings",
  );
  // Mutate the actual downstream DOM. The same verifier must reject it, then accept restoration.
  assertState(await snapshot(), [["fed_rate", 1]], "pre-mutation");
  await cdp.evaluate(
    `document.querySelectorAll('[data-indicator="inflation"] .bb-square').forEach(el=>el.classList.toggle('bb-filled',Number(el.dataset.square)<=50))`,
  );
  let caught = false;
  try {
    assertState(await snapshot(), [["fed_rate", 1]], "negative control");
  } catch (error) {
    caught =
      error instanceof Error && error.message.includes("actual blocks frozen/wrong at inflation");
  }
  requireCheck(caught, "validator did not catch frozen downstream blocks");
  await reset();
  await extreme("fed_rate", 1);
  assertState(await snapshot(), [["fed_rate", 1]], "restored control");
  for (const [mutation, expectedReason] of [
    [
      "document.querySelector('[data-indicator=inflation] .bb-response-fill').style.width='50%'",
      "automatic response geometry",
    ],
    [
      "document.querySelector('[data-indicator=inflation]').style.setProperty('--bb-fill','#0000ff')",
      "response color mismatch",
    ],
  ]) {
    await cdp.evaluate(mutation);
    let detected = false;
    try {
      assertState(await snapshot(), [["fed_rate", 1]], "bar negative control");
    } catch (error) {
      detected = error instanceof Error && error.message.includes(expectedReason);
    }
    requireCheck(detected, "Automatic response validator did not reject deliberate breakage");
    await reset();
    await extreme("fed_rate", 1);
    assertState(await snapshot(), [["fed_rate", 1]], "bar restored control");
  }
  report.assertions.push(
    "square click",
    "120 signed scenarios",
    "multi-input composition",
    "share/reload",
    "off-grid signs",
    "invalid links",
    "history",
    "reduced motion",
    "motion toggle",
    "actual DOM negative control and restoration",
  );
  await cdp.evaluate("[...document.querySelectorAll('.bb-details')].forEach(d=>d.open=true)");
  const sources = await cdp.evaluate(
    "[...document.querySelectorAll('.bb-source')].map(a=>{const r=a.getBoundingClientRect();return {href:a.href,rel:a.rel,target:a.target,width:r.width,height:r.height}})",
  );
  const expectedSources = graph.nodes.filter((n) => n.sourceUrl !== null);
  requireCheck(
    sources.length === expectedSources.length &&
      expectedSources.every((n) =>
        sources.some(
          (s) =>
            s.href === new URL(n.sourceUrl).href &&
            s.rel.includes("noreferrer") &&
            s.target === "_blank",
        ),
      ),
    "source metadata links changed",
  );
  requireCheck(
    sources.every((source) => source.width >= 24 && source.height >= 24),
    "source link pointer targets are below 24px",
  );
  const failures = session.failures;
  requireCheck(
    Object.values(failures).every((a) => a.length === 0),
    "browser errors: " + JSON.stringify(failures),
  );
  requireCheck(
    report.cases.length === 120 && report.intermediateCases.length === 420,
    "incomplete browser scenarios",
  );
  report.assertions.push(
    "automatic response geometry and color",
    "420 intermediate input positions",
    "response-bar negative controls",
    "open share field after history back",
    "source link targets >=24px",
  );
  report.status = "PASS";
  report.failures = failures;
  report.productionVerified = session.production;
}
try {
  await Promise.race([
    run(),
    new Promise((_, reject) => {
      timeout = setTimeout(
        () => reject(new Error("Block Board browser deadline exceeded")),
        600000,
      );
    }),
  ]);
  console.log(
    "BLOCK BOARD BROWSER PASS: 20 indicators, 100 blocks each, 120 signed viewport scenarios plus 420 intermediate positions.",
  );
  console.log("Artifacts: " + artifacts);
} catch (error) {
  report.status = "FAIL";
  report.error = error instanceof Error ? error.message : String(error);
  report.failures = session.failures;
  try {
    report.lastSnapshot = await snapshot();
  } catch {
    /* Retain reports even when the page closes. */
  }
  try {
    await capture("failure");
  } catch {
    /* The browser may have exited; preserve other evidence. */
  }
  console.error(report.error);
  process.exitCode = 1;
} finally {
  clearTimeout(timeout);
  // Close Chrome, Vite, and the run lock even if the report cannot be written; they are
  // detached process groups and would otherwise outlive this process.
  try {
    await fs.writeFile(
      path.join(artifacts, "block-e2e-report.json"),
      JSON.stringify(report, null, 2) + "\n",
    );
  } finally {
    await session.close();
  }
}
