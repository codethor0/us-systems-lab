/**
 * Policy tests for .github/dependabot.yml, written before the file.
 *
 * Dependabot cannot run here, so these tests read the file as text and enforce the decisions
 * that matter: pull requests only, never merged automatically, weekly, delayed after release,
 * Conventional Commit prefixes, and two ignore rules that must stay consistent with the
 * dependencies actually installed.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function read(relative: string): string {
  return readFileSync(new URL(`../../${relative}`, import.meta.url), "utf8");
}

const config = read(".github/dependabot.yml");
const packageJson = JSON.parse(read("package.json")) as {
  devDependencies: Record<string, string>;
};

/** The text of one `- package-ecosystem:` block. */
function block(ecosystem: string): string {
  const parts = config.split(/^ {2}- (?=package-ecosystem:)/m).slice(1);
  const found = parts.find((part) => part.startsWith(`package-ecosystem: "${ecosystem}"`));
  if (found === undefined) throw new Error(`no update block for ${ecosystem}`);
  return found;
}

describe("structure", () => {
  it("is version 2", () => {
    expect(config).toMatch(/^version: 2$/m);
  });

  it("updates exactly the npm and github-actions ecosystems", () => {
    const names = [...config.matchAll(/^ {2}- package-ecosystem: "([^"]+)"$/gm)].map((m) => m[1]);
    expect(names).toEqual(["npm", "github-actions"]);
  });

  it.each(["npm", "github-actions"])("looks for %s files in the repository root", (name) => {
    expect(block(name)).toMatch(/^ {4}directory: "\/"$/m);
  });
});

describe("pull requests only, and never merged automatically", () => {
  it("contains no auto-merge configuration of any spelling", () => {
    expect(config).not.toMatch(/auto-?merge/i);
  });

  it("does not let Dependabot run external code or use private registries", () => {
    expect(config).not.toMatch(/insecure-external-code-execution/);
    expect(config).not.toMatch(/^registries:/m);
  });

  it.each(["npm", "github-actions"])(
    "opens no %s version-update pull requests, so no bot becomes a contributor",
    (name) => {
      const limit = /^ {4}open-pull-requests-limit: (\d+)$/m.exec(block(name))?.[1];
      expect(limit).toBe("0");
    },
  );
});

describe("schedule and delay", () => {
  it.each(["npm", "github-actions"])("checks %s weekly", (name) => {
    expect(block(name)).toMatch(/^ {4}schedule:\n {6}interval: "weekly"$/m);
  });

  it.each(["npm", "github-actions"])(
    "waits at least 7 days after a release for %s, longer than the documented 3-day default",
    (name) => {
      const days = /^ {4}cooldown:\n {6}default-days: (\d+)$/m.exec(block(name))?.[1];
      expect(Number(days)).toBeGreaterThanOrEqual(7);
    },
  );
});

describe("commit messages", () => {
  it("prefixes npm updates with chore(deps), in Conventional Commit form", () => {
    expect(block("npm")).toMatch(/^ {4}commit-message:\n {6}prefix: "chore\(deps\)"$/m);
  });

  it("prefixes action updates with chore(ci)", () => {
    expect(block("github-actions")).toMatch(/^ {4}commit-message:\n {6}prefix: "chore\(ci\)"$/m);
  });
});

describe("groups that must move together", () => {
  it("updates vitest and its coverage package in one pull request", () => {
    expect(block("npm")).toMatch(
      /^ {6}vitest:\n {8}patterns:\n {10}- "vitest"\n {10}- "@vitest\/\*"$/m,
    );
  });

  it("updates the lint toolchain in one pull request", () => {
    const lint =
      /^ {6}lint:\n {8}patterns:\n((?: {10}- "[^"]+"\n)+)/m.exec(block("npm"))?.[1] ?? "";
    for (const pattern of [
      "eslint",
      "@eslint/*",
      "typescript-eslint",
      "eslint-config-prettier",
      "eslint-plugin-react-hooks",
    ]) {
      expect(lint).toContain(`- "${pattern}"`);
    }
  });

  it("updates the React runtime and its type packages in one pull request", () => {
    const react =
      /^ {6}react:\n {8}patterns:\n((?: {10}- "[^"]+"\n)+)/m.exec(block("npm"))?.[1] ?? "";
    for (const pattern of ["react", "react-dom", "@types/react", "@types/react-dom"]) {
      expect(react).toContain(`- "${pattern}"`);
    }
  });

  it("names every grouped package as a dependency that is actually installed", () => {
    for (const name of ["vitest", "@vitest/coverage-v8", "eslint", "@eslint/js"]) {
      expect(Object.keys(packageJson.devDependencies)).toContain(name);
    }
  });
});

describe("ignore rules that mirror the installed toolchain", () => {
  it("ignores TypeScript at and above the first release typescript-eslint does not support", () => {
    const peer = (
      JSON.parse(read("node_modules/typescript-eslint/package.json")) as {
        peerDependencies: { typescript: string };
      }
    ).peerDependencies.typescript;
    const firstUnsupported = /<(\d+\.\d+\.\d+)/.exec(peer)?.[1];
    expect(firstUnsupported, `typescript-eslint peer range was ${peer}`).toBeDefined();
    expect(block("npm")).toContain(
      `- dependency-name: "typescript"\n        versions: [">=${String(firstUnsupported)}"]`,
    );
  });

  it("keeps the TypeScript version inside typescript-eslint's peer range today", () => {
    const peer = (
      JSON.parse(read("node_modules/typescript-eslint/package.json")) as {
        peerDependencies: { typescript: string };
      }
    ).peerDependencies.typescript;
    const upper = /<(\d+)\.(\d+)\.(\d+)/.exec(peer);
    const installed = /^(\d+)\.(\d+)\.(\d+)$/.exec(packageJson.devDependencies["typescript"] ?? "");
    expect(upper).not.toBeNull();
    expect(installed).not.toBeNull();
    const asNumber = (parts: RegExpExecArray | null): number =>
      Number(parts?.[1]) * 1e6 + Number(parts?.[2]) * 1e3 + Number(parts?.[3]);
    expect(asNumber(installed)).toBeLessThan(asNumber(upper));
  });

  it("ignores major @types/node updates, because the supported Node major comes from .nvmrc", () => {
    expect(block("npm")).toContain(
      `- dependency-name: "@types/node"\n        update-types: ["version-update:semver-major"]`,
    );
    const nodeMajorMatch = /^(\d+)(?:\.|$)/.exec(
      readFileSync(new URL("../../.nvmrc", import.meta.url), "utf8").trim(),
    );
    expect(nodeMajorMatch).not.toBeNull();
    const nodeMajor = Number(nodeMajorMatch?.[1]);

    const typesMajor = Number(
      /^(\d+)\./.exec(packageJson.devDependencies["@types/node"] ?? "")?.[1],
    );
    expect(typesMajor).toBe(nodeMajor);
  });
});
