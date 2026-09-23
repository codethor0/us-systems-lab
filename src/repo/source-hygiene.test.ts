/**
 * Guard against raw control characters in text files, written before the fix it protects.
 *
 * A NUL byte, or any control character other than tab, newline and carriage return, makes git and
 * many editors treat a file as binary, hides text from review, and can change what a tool reads. One
 * reached a source file when an escape written as \u0000 was turned into a real NUL on its way to disk.
 * Source must write such characters as escapes. This test reads the bytes of every text file in the
 * repository.
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../../", import.meta.url));
const TEXT_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".mjs",
  ".json",
  ".md",
  ".yml",
  ".yaml",
  ".py",
  ".css",
  ".html",
]);
const TEXT_NAMES = new Set(["LICENSE", ".nvmrc", ".gitignore", ".prettierrc", ".prettierignore"]);
const SKIPPED_DIRECTORIES = new Set([
  "node_modules",
  ".git",
  "coverage",
  "dist",
  ".wrangler",
  ".artifacts",
]);

/** Offsets of bytes that are control characters other than tab, newline and carriage return. */
function controlByteOffsets(bytes: Uint8Array): number[] {
  const offsets: number[] = [];
  bytes.forEach((byte, offset) => {
    const isControl = byte < 0x20 || byte === 0x7f;
    if (isControl && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d) offsets.push(offset);
  });
  return offsets;
}

function textFiles(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry.name))
        found.push(...textFiles(join(directory, entry.name)));
    } else if (entry.isFile()) {
      const dot = entry.name.lastIndexOf(".");
      const extension = dot > 0 ? entry.name.slice(dot) : "";
      if (TEXT_EXTENSIONS.has(extension) || TEXT_NAMES.has(entry.name)) {
        found.push(join(directory, entry.name));
      }
    }
  }
  return found;
}

describe("the detector itself, which must be able to fail", () => {
  it.each([
    [[0x61, 0x00, 0x62], [1]],
    [[0x01], [0]],
    [
      [0x1b, 0x41, 0x1f],
      [0, 2],
    ],
    [[0x7f], [0]],
    [
      [0x0b, 0x0c],
      [0, 1],
    ],
  ])("flags the control bytes in %j at offsets %j", (bytes, offsets) => {
    expect(controlByteOffsets(Uint8Array.from(bytes))).toEqual(offsets);
  });

  it("allows tab, newline, carriage return, and ordinary and non-ASCII text", () => {
    const text = new TextEncoder().encode("plain\ttext\r\nwith é and 日本\n");
    expect(controlByteOffsets(text)).toEqual([]);
  });

  it("finds a NUL planted in a real file on disk, by the same path the repository scan takes", () => {
    const directory = mkdtempSync(join(tmpdir(), "hygiene-"));
    try {
      writeFileSync(join(directory, "planted.ts"), Uint8Array.from([0x61, 0x00, 0x62]));
      writeFileSync(join(directory, "clean.ts"), "const a = 1;\n");
      const flagged = textFiles(directory).filter(
        (file) => controlByteOffsets(readFileSync(file)).length > 0,
      );
      expect(flagged.map((file) => relative(directory, file))).toEqual(["planted.ts"]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe("the repository", () => {
  const files = textFiles(root);

  it("has text files to check, so the scan cannot pass by finding nothing", () => {
    expect(files.length).toBeGreaterThan(20);
    expect(files.some((file) => file.endsWith("src/lib/propagation.ts"))).toBe(true);
  });

  it("contains no raw control character in any text file", () => {
    const offenders = files
      .map((file) => ({
        file: relative(root, file),
        offsets: controlByteOffsets(readFileSync(file)),
      }))
      .filter((entry) => entry.offsets.length > 0);
    expect(offenders).toEqual([]);
  });
});
