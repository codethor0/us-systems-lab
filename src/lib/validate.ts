import { CATEGORIES, CONFIDENCES, STRENGTH_TIERS, VALUE_TYPES, VERIFICATIONS } from "./schema";
import type { Graph, ValidationCode, ValidationError, Verification } from "./schema";

type Raw = Record<string, unknown>;
type Report = (path: string, code: ValidationCode, message: string) => void;

/**
 * Hosts a node may cite when it claims verification "primary". A host matches
 * when it equals an entry or is a subdomain of one, so notbls.gov and
 * bls.gov.evil.example do not match bls.gov.
 */
const PRIMARY_HOSTS = [
  "bea.gov",
  "bls.gov",
  "cbo.gov",
  "census.gov",
  "fbi.gov",
  "federalreserve.gov",
  "freddiemac.com",
  "gallup.com",
  "hud.gov",
  "huduser.gov",
  "newyorkfed.org",
  "treasury.gov",
  "treasurydirect.gov",
  "usda.gov",
] as const;

const TOP_KEYS = ["nodes", "edges"];
const NODE_KEYS = [
  "id",
  "label",
  "category",
  "valueType",
  "unit",
  "baseline",
  "range",
  "asOf",
  "verification",
  "sourceUrl",
  "sourceDetail",
  "retrievedDate",
  "description",
];
const EDGE_KEYS = [
  "id",
  "from",
  "to",
  "direction",
  "strength",
  "confidence",
  "sourceUrl",
  "sourceDetail",
  "retrievedDate",
  "claim",
];

/** Single underscores only, so that "__" can separate the two ids in an edge id. */
const ID_PATTERN = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;

/** Modeled edges are contested by definition, so no claim may say otherwise. */
const FORBIDDEN_WORDS = /\b(?:prove|proves|proven)\b/i;

export function isPrimaryHost(hostname: string): boolean {
  return PRIMARY_HOSTS.some((host) => hostname === host || hostname.endsWith(`.${host}`));
}

function isRecord(value: unknown): value is Raw {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function join(base: string, key: string): string {
  return base === "" ? key : `${base}.${key}`;
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function isIsoDate(text: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (match === null) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month);
}

function isValidAsOf(text: string): boolean {
  if (/^\d{4}$/.test(text) || /^\d{4}-Q[1-4]$/.test(text) || /^FY\d{4}$/.test(text)) return true;
  const yearMonth = /^\d{4}-(\d{2})$/.exec(text);
  if (yearMonth !== null) {
    const month = Number(yearMonth[1]);
    return month >= 1 && month <= 12;
  }
  return isIsoDate(text);
}

function checkKeys(raw: Raw, allowed: readonly string[], path: string, report: Report): void {
  for (const key of Object.keys(raw)) {
    if (!allowed.includes(key)) report(join(path, key), "unknown_key", `unknown key "${key}"`);
  }
}

function requireString(raw: Raw, key: string, path: string, report: Report): string | undefined {
  const value = raw[key];
  if (typeof value !== "string" || value.trim() === "") {
    report(join(path, key), "invalid_type", `${key} must be a non-empty string`);
    return undefined;
  }
  return value;
}

/** Returns undefined, after reporting, when the field is neither a string nor null. */
function readNullableString(
  raw: Raw,
  key: string,
  path: string,
  report: Report,
): string | null | undefined {
  const value = raw[key];
  if (value === null || typeof value === "string") return value;
  report(join(path, key), "invalid_type", `${key} must be a string or null`);
  return undefined;
}

function readEnum<T extends string>(
  raw: Raw,
  key: string,
  allowed: readonly T[],
  path: string,
  report: Report,
): T | undefined {
  const value = raw[key];
  if (typeof value !== "string") {
    report(join(path, key), "invalid_type", `${key} must be a string`);
    return undefined;
  }
  const match = allowed.find((candidate) => candidate === value);
  if (match === undefined) {
    report(join(path, key), "invalid_enum", `${key} must be one of: ${allowed.join(", ")}`);
  }
  return match;
}

/**
 * required:  sourceUrl, sourceDetail and retrievedDate must all be present.
 * primary:   as required, and the host must be a primary-source host.
 * pending:   no page has been read, so sourceUrl and retrievedDate must be null.
 *            sourceDetail may hold a free-text note.
 * forbidden: nothing to cite, so all three must be null.
 * null:      the governing field was invalid; check field types only.
 */
type SourceMode = "required" | "primary" | "pending" | "forbidden";

function checkUrl(url: string, path: string, primaryOnly: boolean, report: Report): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    report(path, "invalid_url", "sourceUrl does not parse as a URL");
    return;
  }
  if (parsed.protocol !== "https:" || parsed.username !== "" || parsed.password !== "") {
    report(path, "invalid_url", "sourceUrl must be https and must not embed credentials");
    return;
  }
  if (primaryOnly && !isPrimaryHost(parsed.hostname)) {
    report(
      path,
      "primary_host_required",
      `host ${parsed.hostname} is not a primary-source host; use verification "secondary"`,
    );
  }
}

function checkSource(raw: Raw, path: string, mode: SourceMode | null, report: Report): void {
  const url = readNullableString(raw, "sourceUrl", path, report);
  const detail = readNullableString(raw, "sourceDetail", path, report);
  const date = readNullableString(raw, "retrievedDate", path, report);
  if (mode === null) return;

  const fields: [string, string | null | undefined][] = [
    ["sourceUrl", url],
    ["sourceDetail", detail],
    ["retrievedDate", date],
  ];
  const mustBePresent = mode === "required" || mode === "primary";
  for (const [key, value] of fields) {
    if (value === undefined) continue;
    if (mustBePresent) {
      if (value === null || value.trim() === "") {
        report(join(path, key), "source_required", `${key} is required here`);
      }
    } else if (value !== null && (mode === "forbidden" || key !== "sourceDetail")) {
      report(join(path, key), "source_forbidden", `${key} must be null here`);
    }
  }

  if (mustBePresent) {
    if (typeof url === "string" && url.trim() !== "") {
      checkUrl(url, join(path, "sourceUrl"), mode === "primary", report);
    }
    if (typeof date === "string" && date.trim() !== "" && !isIsoDate(date)) {
      report(
        join(path, "retrievedDate"),
        "invalid_date",
        "retrievedDate must be a real YYYY-MM-DD",
      );
    }
  }
}

function readBaseline(raw: Raw, path: string, report: Report): number | null | undefined {
  const value = raw["baseline"];
  if (value === null) return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  report(join(path, "baseline"), "invalid_type", "baseline must be a finite number or null");
  return undefined;
}

function readRange(
  raw: Raw,
  path: string,
  report: Report,
): { min: number; max: number } | undefined {
  const value = raw["range"];
  const rangePath = join(path, "range");
  const min = isRecord(value) ? value["min"] : undefined;
  const max = isRecord(value) ? value["max"] : undefined;
  if (
    !isRecord(value) ||
    typeof min !== "number" ||
    typeof max !== "number" ||
    !Number.isFinite(min) ||
    !Number.isFinite(max)
  ) {
    report(rangePath, "invalid_type", "range must be { min, max } with finite numbers");
    return undefined;
  }
  checkKeys(value, ["min", "max"], rangePath, report);
  if (!(min < max)) {
    report(rangePath, "invalid_range", "range.min must be less than range.max");
    return undefined;
  }
  return { min, max };
}

function validateNode(raw: unknown, index: number, seen: Set<string>, report: Report): void {
  const path = `nodes[${String(index)}]`;
  if (!isRecord(raw)) {
    report(path, "invalid_type", "node must be an object");
    return;
  }

  const id = raw["id"];
  if (typeof id !== "string") {
    report(join(path, "id"), "invalid_type", "id must be a string");
  } else {
    if (!ID_PATTERN.test(id)) {
      report(join(path, "id"), "invalid_id", "id must be snake_case with single underscores");
    } else if (seen.has(id)) {
      report(join(path, "id"), "duplicate_id", `duplicate node id "${id}"`);
    } else {
      seen.add(id);
    }
  }
  requireString(raw, "label", path, report);
  readEnum(raw, "category", CATEGORIES, path, report);
  const valueType = readEnum(raw, "valueType", VALUE_TYPES, path, report);
  requireString(raw, "unit", path, report);
  const baseline = readBaseline(raw, path, report);
  const range = readRange(raw, path, report);
  requireString(raw, "description", path, report);

  let asOf = readNullableString(raw, "asOf", path, report);
  if (typeof asOf === "string" && !isValidAsOf(asOf)) {
    report(
      join(path, "asOf"),
      "invalid_as_of",
      "asOf must be YYYY, YYYY-MM, YYYY-MM-DD, YYYY-Qn, or FYYYYY",
    );
    asOf = undefined;
  }

  let verification: Verification | null | undefined;
  if (raw["verification"] === null) verification = null;
  else verification = readEnum(raw, "verification", VERIFICATIONS, path, report);

  let mode: SourceMode | null = null;
  if (valueType === "index") {
    if (typeof baseline === "number") {
      report(join(path, "baseline"), "baseline_forbidden", "index nodes have no baseline");
    }
    if (typeof asOf === "string") {
      report(join(path, "asOf"), "invalid_as_of", "index nodes describe no period");
    }
    if (typeof verification === "string") {
      report(
        join(path, "verification"),
        "verification_mismatch",
        "index nodes have nothing to verify",
      );
    }
    mode = "forbidden";
  } else if (valueType !== undefined) {
    if (verification === null) {
      report(
        join(path, "verification"),
        "verification_mismatch",
        `${valueType} nodes need a verification of primary, secondary, or pending`,
      );
    }
    if (verification === "primary") mode = "primary";
    else if (verification === "secondary") mode = "required";
    else if (verification === "pending") mode = "pending";

    if ((verification === "primary" || verification === "secondary") && baseline === null) {
      report(join(path, "baseline"), "baseline_required", `${verification} nodes need a baseline`);
    }
    if (typeof baseline === "number") {
      if (asOf === null) {
        report(join(path, "asOf"), "as_of_required", "a baseline needs the period it describes");
      }
      if (range !== undefined && (baseline < range.min || baseline > range.max)) {
        report(join(path, "baseline"), "baseline_out_of_range", "baseline lies outside range");
      }
    }
  }

  checkSource(raw, path, mode, report);
  checkKeys(raw, NODE_KEYS, path, report);
}

function validateEdge(
  raw: unknown,
  index: number,
  nodeIds: ReadonlySet<string>,
  seen: Set<string>,
  report: Report,
): void {
  const path = `edges[${String(index)}]`;
  if (!isRecord(raw)) {
    report(path, "invalid_type", "edge must be an object");
    return;
  }

  const id = requireString(raw, "id", path, report);
  const from = requireString(raw, "from", path, report);
  const to = requireString(raw, "to", path, report);
  if (id !== undefined) {
    if (seen.has(id)) report(join(path, "id"), "duplicate_id", `duplicate edge id "${id}"`);
    seen.add(id);
  }
  if (from !== undefined && !nodeIds.has(from)) {
    report(join(path, "from"), "dangling_reference", `no node with id "${from}"`);
  }
  if (to !== undefined && !nodeIds.has(to)) {
    report(join(path, "to"), "dangling_reference", `no node with id "${to}"`);
  }
  if (from !== undefined && from === to) {
    report(path, "self_loop", "an edge may not connect a node to itself");
  }
  if (id !== undefined && from !== undefined && to !== undefined && id !== `${from}__${to}`) {
    report(join(path, "id"), "id_mismatch", `id must be "${from}__${to}"`);
  }

  if (raw["direction"] !== 1 && raw["direction"] !== -1) {
    report(join(path, "direction"), "invalid_direction", "direction must be 1 or -1");
  }
  if (!STRENGTH_TIERS.some((tier) => tier === raw["strength"])) {
    report(
      join(path, "strength"),
      "invalid_strength",
      `strength must be one of ${STRENGTH_TIERS.join(", ")}`,
    );
  }
  const confidence = readEnum(raw, "confidence", CONFIDENCES, path, report);

  const claim = raw["claim"];
  if (typeof claim !== "string") {
    report(join(path, "claim"), "invalid_type", "claim must be a string");
  } else {
    if (claim.trim() === "" || /[\r\n]/.test(claim)) {
      report(join(path, "claim"), "invalid_claim", "claim must be one non-empty line");
    }
    if (FORBIDDEN_WORDS.test(claim)) {
      report(
        join(path, "claim"),
        "forbidden_word",
        'claim may not use "prove", "proves", or "proven"',
      );
    }
  }

  let mode: SourceMode | null = null;
  if (confidence === "empirical") mode = "required";
  else if (confidence === "modeled") mode = "forbidden";
  checkSource(raw, path, mode, report);
  checkKeys(raw, EDGE_KEYS, path, report);
}

export function validateGraph(input: unknown): ValidationError[] {
  const errors: ValidationError[] = [];
  const report: Report = (path, code, message) => {
    errors.push({ path, code, message });
  };

  if (!isRecord(input)) {
    report("", "invalid_type", "graph must be an object with nodes and edges");
    return errors;
  }

  const nodeIds = new Set<string>();
  const nodes = input["nodes"];
  if (Array.isArray(nodes)) {
    nodes.forEach((node: unknown, index) => {
      validateNode(node, index, nodeIds, report);
    });
  } else {
    report("nodes", "invalid_type", "nodes must be an array");
  }

  const edgeIds = new Set<string>();
  const edges = input["edges"];
  if (Array.isArray(edges)) {
    edges.forEach((edge: unknown, index) => {
      validateEdge(edge, index, nodeIds, edgeIds, report);
    });
  } else {
    report("edges", "invalid_type", "edges must be an array");
  }

  checkKeys(input, TOP_KEYS, "", report);
  return errors;
}

/** Throws with every failing path and code when the input is not a valid graph. */
export function parseGraph(input: unknown): Graph {
  const errors = validateGraph(input);
  if (errors.length > 0) {
    const lines = errors.map((e) => `  ${e.path} [${e.code}] ${e.message}`);
    throw new Error(`Invalid graph (${String(errors.length)} errors):\n${lines.join("\n")}`);
  }
  return input as Graph;
}
