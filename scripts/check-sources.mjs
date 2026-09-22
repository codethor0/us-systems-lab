/**
 * Optional, best-effort report on whether each cited baseline source URL still responds.
 *
 * Run with `npm run check:sources`. It needs network access and is not part of `npm run verify`
 * or CI, because third-party sites fail, rate-limit and block automated requests for reasons that
 * say nothing about this repository. Only HTTP 2xx and 3xx count as reachable. The report is
 * diagnostic: it does not establish that a source is valid, correct or current.
 */
import { readFile } from "node:fs/promises";

const graph = JSON.parse(
  await readFile(new URL("../src/data/graph.json", import.meta.url), "utf8"),
);
const urls = [...new Set(graph.nodes.map((node) => node.sourceUrl).filter(Boolean))];

async function probe(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, 5000);
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
}

const results = await Promise.all(urls.map(probe));
for (const result of results) {
  const detail = result.status === undefined ? result.error : String(result.status);
  console.log(`${result.ok ? "reachable  " : "UNREACHABLE"} ${detail}\t${result.url}`);
}
const failed = results.filter((result) => !result.ok).length;
console.log(`\n${String(results.length - failed)} of ${String(results.length)} sources reachable.`);
console.log("Diagnostic only: reachability is not evidence that a source is valid or current.");
