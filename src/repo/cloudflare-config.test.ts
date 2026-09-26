import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../..");
const packageJson = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as {
  readonly devDependencies?: Readonly<Record<string, string>>;
};
const nvmrc = readFileSync(path.join(root, ".nvmrc"), "utf8").trim();
const wranglerPath = path.join(root, "wrangler.jsonc");

describe("Cloudflare static-only deployment contract", () => {
  it("pins the exact deployment runtime and Wrangler version", () => {
    expect(nvmrc).toBe("24.18.0");
    expect(packageJson.devDependencies?.wrangler).toBe("4.135.0");
  });

  it("uses an assets-only SPA configuration with no runtime bindings", () => {
    expect(existsSync(wranglerPath)).toBe(true);
    if (!existsSync(wranglerPath)) return;

    const rawConfig = readFileSync(wranglerPath, "utf8");
    const config = JSON.parse(rawConfig.replace(/,(?=\s*[}\]])/g, "")) as Record<string, unknown>;
    expect(config).toEqual({
      $schema: "./node_modules/wrangler/config-schema.json",
      name: "us-systems-lab",
      compatibility_date: "2026-09-19",
      workers_dev: true,
      assets: {
        directory: "./dist",
        not_found_handling: "single-page-application",
        run_worker_first: false,
      },
    });

    for (const forbidden of [
      "main",
      "route",
      "routes",
      "vars",
      "kv_namespaces",
      "d1_databases",
      "r2_buckets",
      "durable_objects",
      "queues",
      "ai",
      "vectorize",
      "hyperdrive",
      "services",
      "dispatch_namespaces",
      "analytics_engine_datasets",
      "browser",
    ]) {
      expect(config).not.toHaveProperty(forbidden);
    }
  });

  it("documents deployment as manual, not triggered by a merge to main", () => {
    const deployment = readFileSync(path.join(root, "DEPLOYMENT.md"), "utf8");
    expect(deployment).toContain("Deployment is manual.");
    expect(deployment).toContain("npx --no-install wrangler deploy");
    expect(deployment).not.toMatch(/Workers Builds can publish when the production branch changes/);
  });
});
