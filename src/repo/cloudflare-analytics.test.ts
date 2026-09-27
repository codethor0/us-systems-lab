import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../..");
const index = readFileSync(path.join(root, "index.html"), "utf8");
const loader = readFileSync(path.join(root, "public/cf-analytics.js"), "utf8");
const headers = readFileSync(path.join(root, "public/_headers"), "utf8");

describe("Cloudflare Web Analytics", () => {
  it("loads through a first-party script and never contacts Cloudflare on localhost", () => {
    expect(index).toContain('src="/cf-analytics.js"');
    expect(index).not.toContain('src="https://static.cloudflareinsights.com/beacon.min.js"');
    expect(loader).toContain(
      'globalThis.location.hostname !== "us-systems-lab.codethor0.workers.dev"',
    );
    expect(loader).toContain("https://static.cloudflareinsights.com/beacon.min.js");
    expect(loader).toMatch(/token: "[0-9a-f]{32}"/);
  });

  it("keeps the CSP limited to the required analytics endpoints", () => {
    const csp = headers
      .split("\n")
      .find((line) => line.trimStart().startsWith("Content-Security-Policy:"));
    expect(csp).toContain("script-src 'self' https://static.cloudflareinsights.com/beacon.min.js");
    expect(csp).toContain("connect-src 'self' https://cloudflareinsights.com");
  });
});
