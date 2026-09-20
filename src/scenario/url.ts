/**
 * Scenario links: lever settings that can be shared as a URL, with no backend.
 *
 *   ?v=1&d=<8 hex digits>&l=fed_rate:100,worker_bargaining_power:-50
 *
 * v is the format version. d is the data stamp of the data the link was made with (see stamp.ts). l
 * lists the levers as indicator:percent, where percent is a whole number from -100 to 100 and means
 * that fraction of the indicator's display range. Zero means unset.
 *
 * A link is untrusted input, so decodeScenario is written for hostile strings. It never throws. It
 * reads no setting it cannot fully validate. It reports everything it ignores as a problem, and a
 * problem carries a sanitized, truncated token and never the raw text. It caps the length of the
 * link, the number of settings it reads, and the number of problems it lists. It keys everything on
 * a Map or a Set, so an indicator id such as "constructor" is an ordinary key. Nothing decoded is ever
 * used as markup: labels come only from the graph, and a token holds only letters, digits, "_", ".",
 * ":", "-" and "?".
 *
 * encodeScenario writes only characters that never need percent-encoding. Decoding what it wrote gives
 * the same levers back, and encoding what decoding returned gives the same link back.
 */

export const SCENARIO_VERSION = 1;
export const MAX_QUERY_LENGTH = 2048;
export const MAX_ENTRIES = 100;
export const MAX_PROBLEMS = 10;
export const MAX_TOKEN_LENGTH = 24;

const ID_PATTERN = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;
const STAMP_PATTERN = /^[0-9a-f]{8}$/;
/** A whole number with no sign but "-", no leading zero, and no other characters. */
const VALUE_PATTERN = /^(?:0|-?[1-9][0-9]*)$/;

export type ProblemCode =
  | "too_long"
  | "unsupported_version"
  | "repeated_parameter"
  | "malformed_stamp"
  | "malformed_entry"
  | "unknown_node"
  | "invalid_value"
  | "out_of_range"
  | "duplicate_node"
  | "too_many_entries";

/** current: same data. stale: another build's data. missing: no stamp. invalid: not a stamp. */
export type StampStatus = "current" | "stale" | "missing" | "invalid";

export interface ScenarioProblem {
  readonly code: ProblemCode;
  /** The part of the link concerned, sanitized and truncated. Safe to show as text. */
  readonly token: string;
  /** A sentence for the person who opened the link. */
  readonly message: string;
}

export interface DecodedScenario {
  /** Nonzero settings only, as fractions in [-1, 1] that are whole percents. */
  readonly levers: Map<string, number>;
  /** At most MAX_PROBLEMS problems, in the order they were found. */
  readonly problems: ScenarioProblem[];
  /** How many further problems were found and not listed. */
  readonly problemsOmitted: number;
  readonly stamp: StampStatus;
}

/** Problems whose message is built from the token alone. The other two name values, and are built where they arise. */
type SimpleCode = Exclude<ProblemCode, "repeated_parameter" | "duplicate_node">;

const MESSAGES: Record<SimpleCode, (token: string) => string> = {
  too_long: () =>
    `The link is longer than ${String(MAX_QUERY_LENGTH)} characters, so none of it was used.`,
  unsupported_version: (token) =>
    `This link uses version "${token}" of the scenario format, which this page does not understand, so its lever settings were not used.`,
  malformed_stamp: (token) => `The data stamp "${token}" in the link is not valid and was ignored.`,
  malformed_entry: (token) =>
    `The lever setting "${token}" is not in the form indicator:percent and was ignored.`,
  unknown_node: (token) =>
    `The link names an indicator "${token}" that does not exist, so it was ignored.`,
  invalid_value: (token) =>
    `The value in "${token}" is not a whole number of percent, so it was ignored.`,
  out_of_range: (token) => `The value in "${token}" is outside -100 to 100, so it was ignored.`,
  too_many_entries: () =>
    `The link has more than ${String(MAX_ENTRIES)} lever settings; only the first ${String(MAX_ENTRIES)} were read.`,
};

/** Keeps letters, digits and "_.:-", replaces everything else with "?", and cuts the length. */
function sanitize(text: string): string {
  const safe = text.replace(/[^A-Za-z0-9_.:-]/g, "?");
  return safe.length > MAX_TOKEN_LENGTH ? `${safe.slice(0, MAX_TOKEN_LENGTH)}...` : safe;
}

function assertStamp(stamp: string): void {
  if (!STAMP_PATTERN.test(stamp)) {
    throw new RangeError(`stamp must be eight lowercase hexadecimal digits, got "${stamp}"`);
  }
}

/**
 * The query string for a set of levers. Levers that are zero, or round to zero, are left out.
 * Throws RangeError for an id the format cannot carry, a lever outside [-1, 1], or a malformed stamp.
 */
export function encodeScenario(levers: ReadonlyMap<string, number>, stamp: string): string {
  assertStamp(stamp);
  const entries: string[] = [];
  for (const [id, value] of [...levers].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    if (!ID_PATTERN.test(id)) throw new RangeError(`"${id}" cannot be written in a scenario link`);
    if (!(Math.abs(value) <= 1)) {
      throw new RangeError(`lever on "${id}" must be in [-1, 1], got ${String(value)}`);
    }
    const percent = Math.sign(value) * Math.round(Math.abs(value) * 100);
    if (percent !== 0) entries.push(`${id}:${String(percent)}`);
  }
  const list = entries.length > 0 ? `&l=${entries.join(",")}` : "";
  return `?v=${String(SCENARIO_VERSION)}&d=${stamp}${list}`;
}

/**
 * Says which value of a repeated parameter was used and which were ignored, so that the person who
 * opened the link can see what was dropped and not merely that something was. The name is one of the
 * fixed parameter names, and every value is sanitized and truncated first.
 */
function repeatedMessage(name: string, values: readonly string[]): string {
  const quote = (value: string): string => `"${name}=${sanitize(value)}"`;
  const used = values.slice(0, 1).map(quote).join("");
  const ignored = values.slice(1);
  const shown = ignored.slice(0, 2).map(quote);
  const list =
    ignored.length <= 2
      ? shown.join(" and ")
      : `${shown.join(", ")} and ${String(ignored.length - 2)} more`;
  return `The link repeats "${name}". Used ${used}; ignored ${list}.`;
}

/**
 * Reads a search string, with or without its leading "?". Never throws for any string. Throws
 * RangeError only if currentStamp is not a valid stamp, which is the caller's mistake.
 */
export function decodeScenario(
  search: string,
  graph: { readonly nodes: readonly { readonly id: string }[] },
  currentStamp: string,
): DecodedScenario {
  assertStamp(currentStamp);
  const levers = new Map<string, number>();
  const problems: ScenarioProblem[] = [];
  let omitted = 0;
  const add = (code: ProblemCode, token: string, message: string): void => {
    if (problems.length < MAX_PROBLEMS) {
      problems.push({ code, token, message });
    } else {
      omitted += 1;
    }
  };
  const report = (code: SimpleCode, token: string): void => {
    add(code, token, MESSAGES[code](token));
  };
  const finish = (stamp: StampStatus): DecodedScenario => ({
    levers,
    problems,
    problemsOmitted: omitted,
    stamp,
  });

  if (search.length > MAX_QUERY_LENGTH) {
    report("too_long", "");
    return finish("missing");
  }

  const parameters = new URLSearchParams(search);
  const first = (name: string): string | undefined => {
    const all = parameters.getAll(name);
    if (all.length > 1) add("repeated_parameter", name, repeatedMessage(name, all));
    return all[0];
  };

  const version = first("v");
  if (version !== undefined && version !== String(SCENARIO_VERSION)) {
    report("unsupported_version", sanitize(version));
    return finish("missing");
  }

  let stamp: StampStatus = "missing";
  const stampText = first("d");
  if (stampText !== undefined) {
    if (STAMP_PATTERN.test(stampText)) stamp = stampText === currentStamp ? "current" : "stale";
    else {
      report("malformed_stamp", sanitize(stampText));
      stamp = "invalid";
    }
  }

  const list = first("l");
  if (list !== undefined && list !== "") {
    const nodeIds = new Set(graph.nodes.map((node) => node.id));
    const seen = new Map<string, string>();
    const entries = list.split(",");
    if (entries.length > MAX_ENTRIES) report("too_many_entries", "");
    for (const entry of entries.slice(0, MAX_ENTRIES)) {
      const colon = entry.indexOf(":");
      if (colon < 1) {
        report("malformed_entry", sanitize(entry));
        continue;
      }
      const id = entry.slice(0, colon);
      if (!nodeIds.has(id)) {
        report("unknown_node", sanitize(id));
        continue;
      }
      const valueText = entry.slice(colon + 1);
      if (!VALUE_PATTERN.test(valueText)) {
        report("invalid_value", sanitize(entry));
        continue;
      }
      const percent = Number(valueText);
      if (Math.abs(percent) > 100) {
        report("out_of_range", sanitize(entry));
        continue;
      }
      const kept = seen.get(id);
      if (kept !== undefined) {
        const message = `The link sets "${sanitize(id)}" more than once. Kept "${kept}"; ignored "${sanitize(entry)}".`;
        add("duplicate_node", sanitize(id), message);
        continue;
      }
      seen.set(id, sanitize(entry));
      if (percent !== 0) levers.set(id, percent / 100);
    }
  }
  return finish(stamp);
}
