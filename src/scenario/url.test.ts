/**
 * Tests for url.ts, written before it exists.
 *
 * A scenario is a set of lever settings that can be shared as a link, with no backend. The link is
 * the first thing a stranger's malformed input reaches, so decoding is written as if every link were
 * hostile:
 *
 *   ?v=1&d=<8 hex digits>&l=fed_rate:100,worker_bargaining_power:-50
 *
 * v is the format version, d is the data stamp of the data the link was made with, and l lists the
 * levers as indicator:percent, where percent is a whole number from -100 to 100. Zero means unset.
 *
 * Decoding never throws, whatever the string. It reads nothing it cannot fully validate, reports
 * everything it ignores, with a sanitized token and never with raw input, and caps its own work.
 */
import { describe, expect, it } from "vitest";
import graphJson from "../data/graph.json";
import { parseGraph } from "../lib/validate";
import {
  MAX_ENTRIES,
  MAX_PROBLEMS,
  MAX_QUERY_LENGTH,
  MAX_TOKEN_LENGTH,
  SCENARIO_VERSION,
  decodeScenario,
  encodeScenario,
} from "./url";
import type { DecodedScenario, ProblemCode, StampStatus } from "./url";

const real = parseGraph(graphJson);
const IDS = real.nodes.map((n) => n.id);
const STAMP = "0a1b2c3d";

function decode(
  search: string,
  graph: { nodes: readonly { id: string }[] } = real,
): DecodedScenario {
  return decodeScenario(search, graph, STAMP);
}

function levers(values: Record<string, number>): Map<string, number> {
  return new Map(Object.entries(values));
}

function codes(result: DecodedScenario): ProblemCode[] {
  return result.problems.map((p) => p.code);
}

function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("the constants", () => {
  it("are pinned", () => {
    expect([
      SCENARIO_VERSION,
      MAX_QUERY_LENGTH,
      MAX_ENTRIES,
      MAX_PROBLEMS,
      MAX_TOKEN_LENGTH,
    ]).toEqual([1, 2048, 100, 10, 24]);
  });
});

describe("encodeScenario", () => {
  it("writes only the version and the stamp when nothing is set", () => {
    expect(encodeScenario(new Map(), STAMP)).toBe(`?v=1&d=${STAMP}`);
  });

  it("writes levers as indicator:percent, sorted by id, whatever order they were set in", () => {
    const expected = `?v=1&d=${STAMP}&l=fed_rate:100,worker_bargaining_power:-50`;
    expect(encodeScenario(levers({ worker_bargaining_power: -0.5, fed_rate: 1 }), STAMP)).toBe(
      expected,
    );
    expect(encodeScenario(levers({ fed_rate: 1, worker_bargaining_power: -0.5 }), STAMP)).toBe(
      expected,
    );
  });

  it("leaves out levers that are zero, negative zero, or round to zero", () => {
    const set = levers({ fed_rate: 0, inflation: -0, productivity: 0.004, media_trust: -0.004 });
    expect(encodeScenario(set, STAMP)).toBe(`?v=1&d=${STAMP}`);
  });

  /* percent = sign * round(|x| * 100), computed independently: every integer percent survives. */
  it.each([
    [0.3, 30],
    [0.07, 7],
    [0.555, 56],
    [-0.555, -56],
    [0.005, 1],
    [-0.005, -1],
    [0.125, 13],
    [0.995, 100],
    [0.994, 99],
    [1, 100],
    [-1, -100],
  ])("rounds %s to %s percent, symmetrically", (value, percent) => {
    expect(encodeScenario(levers({ fed_rate: value }), STAMP)).toBe(
      `?v=1&d=${STAMP}&l=fed_rate:${String(percent)}`,
    );
  });

  it("writes only characters that never need percent-encoding", () => {
    const text = encodeScenario(levers({ fed_rate: 1, inflation: -0.3 }), STAMP);
    expect(text).toMatch(/^[a-z0-9_:,=&?-]+$/);
  });

  it("fits every lever of the real graph at an extreme inside the length cap, with room to spare", () => {
    const all = new Map(IDS.map((id, i) => [id, i % 2 === 0 ? -1 : 1]));
    expect(encodeScenario(all, STAMP).length).toBeLessThan(MAX_QUERY_LENGTH / 2);
  });

  it.each(["", "Fed_Rate", "a:b", "a,b", "a b", "_a", "a_", "a__b", "é", "1a", "a&b", "a=b"])(
    "rejects the indicator id %j, which would break the format",
    (id) => {
      expect(() => encodeScenario(levers({ [id]: 0.5 }), STAMP)).toThrow(RangeError);
    },
  );

  it.each([1.0000001, -1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects a lever of %s",
    (value) => {
      expect(() => encodeScenario(levers({ fed_rate: value }), STAMP)).toThrow(RangeError);
    },
  );

  it.each(["", "0a1b2c3", "0a1b2c3d4", "0A1B2C3D", "0a1b2c3g", "zzzzzzzz"])(
    "rejects the stamp %j",
    (stamp) => {
      expect(() => encodeScenario(new Map(), stamp)).toThrow(RangeError);
    },
  );
});

describe("decodeScenario: valid links", () => {
  it("reads a full link with a current stamp", () => {
    const result = decode(`?v=1&d=${STAMP}&l=fed_rate:100,inflation:-50`);
    expect(result.levers).toEqual(levers({ fed_rate: 1, inflation: -0.5 }));
    expect(result.problems).toEqual([]);
    expect(result.problemsOmitted).toBe(0);
    expect(result.stamp).toBe("current");
  });

  it("reads a hand-written link with no version or stamp, and says the stamp is missing", () => {
    const result = decode("?l=fed_rate:100");
    expect(result.levers).toEqual(levers({ fed_rate: 1 }));
    expect(codes(result)).toEqual([]);
    expect(result.stamp).toBe("missing");
  });

  it("accepts a search string without its leading question mark", () => {
    expect(decode("l=fed_rate:10").levers).toEqual(levers({ fed_rate: 0.1 }));
  });

  it("accepts percent-encoded separators, as some tools produce", () => {
    expect(decode("?l=fed_rate%3A100%2Cinflation%3A-50").levers).toEqual(
      levers({ fed_rate: 1, inflation: -0.5 }),
    );
  });

  it("ignores parameters it does not know, such as tracking parameters, without complaint", () => {
    const result = decode("?utm_source=x&fbclid=y&l=fed_rate:10&ref=z");
    expect(result.levers).toEqual(levers({ fed_rate: 0.1 }));
    expect(result.problems).toEqual([]);
  });

  it.each([
    ["", {}, "missing"],
    ["?", {}, "missing"],
    ["?l=", {}, "missing"],
    ["?v=1", {}, "missing"],
  ] as [string, Record<string, number>, StampStatus][])(
    "treats %j as an empty scenario with no problems",
    (search, expected, stamp) => {
      const result = decode(search);
      expect([result.levers, result.problems, result.stamp]).toEqual([levers(expected), [], stamp]);
    },
  );

  it("treats a lever set to 0 as unset, so it is neither stored nor reported", () => {
    const result = decode("?l=fed_rate:0,inflation:50");
    expect(result.levers).toEqual(levers({ inflation: 0.5 }));
    expect(result.problems).toEqual([]);
  });

  it("still counts a zero setting as the first one, so a later duplicate is reported", () => {
    const result = decode("?l=fed_rate:0,fed_rate:5");
    expect(result.levers).toEqual(new Map());
    expect(codes(result)).toEqual(["duplicate_node"]);
  });
});

describe("decodeScenario: the data stamp", () => {
  it.each([
    [`?d=${STAMP}`, "current", []],
    ["?d=00000000", "stale", []],
    ["?d=ffffffff", "stale", []],
    ["?d=zzzzzzzz", "invalid", ["malformed_stamp"]],
    ["?d=0A1B2C3D", "invalid", ["malformed_stamp"]],
    ["?d=abc", "invalid", ["malformed_stamp"]],
    [`?d=${STAMP}0`, "invalid", ["malformed_stamp"]],
    ["?d=", "invalid", ["malformed_stamp"]],
  ] as [string, StampStatus, ProblemCode[]][])("%s is %s", (search, stamp, expected) => {
    const result = decode(search);
    expect(result.stamp).toBe(stamp);
    expect(codes(result)).toEqual(expected);
  });

  it("still applies the levers of a stale link, and leaves the warning to the interface", () => {
    expect(decode("?d=00000000&l=fed_rate:100").levers).toEqual(levers({ fed_rate: 1 }));
  });

  it("uses the first stamp when it is repeated, and says so", () => {
    const result = decode(`?d=${STAMP}&d=00000000`);
    expect(result.stamp).toBe("current");
    expect(codes(result)).toEqual(["repeated_parameter"]);
  });
});

describe("decodeScenario: a version it does not understand", () => {
  it.each([
    "?v=2&l=fed_rate:100",
    "?v=&l=fed_rate:100",
    "?v=one&l=fed_rate:100",
    "?v=01&l=fed_rate:100",
    "?v=1.0&l=fed_rate:100",
  ])("%s applies nothing and reports the version", (search) => {
    const result = decode(search);
    expect(result.levers).toEqual(new Map());
    expect(codes(result)).toEqual(["unsupported_version"]);
    expect(result.stamp).toBe("missing");
  });

  it("accepts version 1 and no other spelling of it", () => {
    expect(decode("?v=1&l=fed_rate:100").levers.size).toBe(1);
  });
});

describe("decodeScenario: hostile and malformed levers", () => {
  it.each<[string, string, Record<string, number>, ProblemCode[]]>([
    ["a repeated version", "?v=1&v=1&l=fed_rate:100", { fed_rate: 1 }, ["repeated_parameter"]],
    [
      "a repeated lever list, of which only the first counts",
      "?l=fed_rate:100&l=inflation:50",
      { fed_rate: 1 },
      ["repeated_parameter"],
    ],
    [
      "a duplicated indicator, of which only the first counts",
      "?l=fed_rate:100,fed_rate:50",
      { fed_rate: 1 },
      ["duplicate_node"],
    ],
    ["an unknown indicator", "?l=nope:50", {}, ["unknown_node"]],
    ["a wrong-case indicator", "?l=Fed_Rate:50", {}, ["unknown_node"]],
    ["an indicator with a leading space", "?l=%20fed_rate:50", {}, ["unknown_node"]],
    ["an entry with no colon", "?l=fed_rate", {}, ["malformed_entry"]],
    ["an entry with no indicator", "?l=:50", {}, ["malformed_entry"]],
    ["an entry with no value", "?l=fed_rate:", {}, ["invalid_value"]],
    ["a trailing comma", "?l=fed_rate:100,", { fed_rate: 1 }, ["malformed_entry"]],
    ["a leading comma", "?l=,fed_rate:100", { fed_rate: 1 }, ["malformed_entry"]],
    ["only commas", "?l=,,", {}, ["malformed_entry", "malformed_entry", "malformed_entry"]],
    ["a valid entry after a bad one", "?l=nope:1,fed_rate:100", { fed_rate: 1 }, ["unknown_node"]],
    [
      "a bad value after a good entry",
      "?l=inflation:50,fed_rate:x",
      { inflation: 0.5 },
      ["invalid_value"],
    ],
    [
      "an unknown indicator with a bad value, reported once as unknown",
      "?l=nope:abc",
      {},
      ["unknown_node"],
    ],
    ["a stray percent sequence", "?l=fed_rate%3A100%ZZ", {}, ["invalid_value"]],
    ["a NUL byte in the indicator", "?l=%00:5", {}, ["unknown_node"]],
  ])("%s", (_name, search, expected, expectedCodes) => {
    const result = decode(search);
    expect(result.levers).toEqual(levers(expected));
    expect(codes(result)).toEqual(expectedCodes);
  });

  it.each([
    "abc",
    "1.5",
    "1.0",
    "+50",
    "05",
    "-0",
    "--5",
    "1e2",
    "0x10",
    "5%",
    "5:5",
    " 50",
    "50 ",
    "٥٠", // Arabic-Indic digits
    "５０", // fullwidth digits
    "\u{1F680}",
    "\ud83d", // a lone surrogate
    "NaN",
    "Infinity",
    "1000000000000000000000000000000000000000",
  ])("rejects the value %j as not a whole number of percent", (value) => {
    const result = decode(`?l=fed_rate:${value}`);
    expect(result.levers).toEqual(new Map());
    expect(codes(result)).toEqual([value.length > 30 ? "out_of_range" : "invalid_value"]);
  });

  it("rejects a plus sign that arrives percent-encoded, which is not the canonical form", () => {
    // A raw "+" is decoded to a space by the URL parser, and "%2B" is decoded to a real plus.
    const result = decode("?l=fed_rate:%2B50");
    expect(result.levers).toEqual(new Map());
    expect(codes(result)).toEqual(["invalid_value"]);
    expect(result.problems[0]?.token).toBe("fed_rate:?50");
  });

  it("rejects a raw plus sign too, because the parser turns it into a space", () => {
    expect(codes(decode("?l=fed_rate:+50"))).toEqual(["invalid_value"]);
  });

  it.each(["101", "-101", "150", "999", "9999999999", "99999999999999999999"])(
    "rejects %s as outside -100 to 100",
    (value) => {
      const result = decode(`?l=fed_rate:${value}`);
      expect(result.levers).toEqual(new Map());
      expect(codes(result)).toEqual(["out_of_range"]);
    },
  );

  it("treats a run of hundreds of digits as out of range and does not hang", () => {
    const result = decode(`?l=fed_rate:${"9".repeat(400)}`);
    expect(codes(result)).toEqual(["out_of_range"]);
  });

  it("accepts the extremes 100 and -100 exactly", () => {
    expect(decode("?l=fed_rate:100,inflation:-100").levers).toEqual(
      levers({ fed_rate: 1, inflation: -1 }),
    );
  });
});

describe("decodeScenario: prototype pollution and injection", () => {
  it("never treats Object property names as indicators, and never touches Object.prototype", () => {
    const before = Object.getOwnPropertyNames(Object.prototype).sort();
    const result = decode(
      "?l=__proto__:50,constructor:50,toString:50,hasOwnProperty:50,prototype:5",
    );
    expect(result.levers).toEqual(new Map());
    expect(codes(result)).toEqual([
      "unknown_node",
      "unknown_node",
      "unknown_node",
      "unknown_node",
      "unknown_node",
    ]);
    expect(Object.getOwnPropertyNames(Object.prototype).sort()).toEqual(before);
    const probe: Record<string, unknown> = {};
    expect(probe["polluted"]).toBeUndefined();
  });

  it("accepts such names as ordinary keys when the graph really has them, because it uses a Map", () => {
    const odd = { nodes: [{ id: "constructor" }, { id: "toString" }, { id: "__proto__" }] };
    const result = decode("?l=constructor:50,toString:-25,__proto__:10", odd);
    expect(result.levers).toEqual(
      levers({ constructor: 0.5, toString: -0.25 }).set("__proto__", 0.1),
    );
    expect(result.levers.get("__proto__")).toBe(0.1);
    expect(codes(result)).toEqual([]);
    expect(Object.getOwnPropertyNames(Object.prototype)).not.toContain("polluted");
  });

  it("puts markup only ever in a sanitized token, never in a message as typed", () => {
    const result = decode("?l=<script>alert(1)</script>:5");
    const problem = result.problems[0];
    expect(problem?.code).toBe("unknown_node");
    expect(problem?.token).not.toMatch(/[<>()/"'&]/);
    expect(problem?.message).not.toMatch(/[<>()/&]/);
  });

  it("keeps markup out of a duplicate-setting message even when the graph itself has an odd id", () => {
    // Ids are snake_case in the real graph, but decodeScenario accepts any graph and promises safe text.
    const odd = { nodes: [{ id: "a<b>" }, { id: "x" }] };
    const result = decode("?l=a<b>:5,a<b>:6", odd);
    const problem = result.problems[0];
    expect(problem?.code).toBe("duplicate_node");
    expect(problem?.token).toBe("a?b?");
    expect(problem?.message).toBe(
      'The link sets "a?b?" more than once. Kept "a?b?:5"; ignored "a?b?:6".',
    );
    expect(problem?.message).not.toMatch(/[<>]/);
  });

  it("replaces control characters and non-ASCII in a token with a question mark", () => {
    const result = decode("?l=%00%1b日:5");
    expect(result.problems[0]?.token).toBe("???");
  });
});

describe("decodeScenario: problem messages and tokens", () => {
  const cases: [ProblemCode, string, string, string][] = [
    [
      "unsupported_version",
      "?v=2",
      "2",
      'This link uses version "2" of the scenario format, which this page does not understand, so its lever settings were not used.',
    ],
    ["repeated_parameter", "?v=1&v=1", "v", 'The link repeats "v". Used "v=1"; ignored "v=1".'],
    [
      "malformed_stamp",
      "?d=zzz",
      "zzz",
      'The data stamp "zzz" in the link is not valid and was ignored.',
    ],
    [
      "malformed_entry",
      "?l=fed_rate",
      "fed_rate",
      'The lever setting "fed_rate" is not in the form indicator:percent and was ignored.',
    ],
    [
      "unknown_node",
      "?l=nope:5",
      "nope",
      'The link names an indicator "nope" that does not exist, so it was ignored.',
    ],
    [
      "invalid_value",
      "?l=fed_rate:abc",
      "fed_rate:abc",
      'The value in "fed_rate:abc" is not a whole number of percent, so it was ignored.',
    ],
    [
      "out_of_range",
      "?l=fed_rate:101",
      "fed_rate:101",
      'The value in "fed_rate:101" is outside -100 to 100, so it was ignored.',
    ],
    [
      "duplicate_node",
      "?l=fed_rate:1,fed_rate:2",
      "fed_rate",
      'The link sets "fed_rate" more than once. Kept "fed_rate:1"; ignored "fed_rate:2".',
    ],
  ];

  it.each(cases)("%s", (code, search, token, message) => {
    const problem = decode(search).problems[0];
    expect(problem).toEqual({ code, token, message });
  });

  describe("a repeated parameter names the value it used and the values it ignored", () => {
    const message = (search: string): string | undefined => decode(search).problems[0]?.message;

    it("one ignored value", () => {
      expect(message("?l=fed_rate:100&l=inflation:50")).toBe(
        'The link repeats "l". Used "l=fed_rate:100"; ignored "l=inflation:50".',
      );
    });

    it("two ignored values are both named", () => {
      expect(message("?v=1&v=2&v=3")).toBe(
        'The link repeats "v". Used "v=1"; ignored "v=2" and "v=3".',
      );
    });

    it("three or more ignored values name two and count the rest", () => {
      expect(message("?l=a:1&l=b:2&l=c:3&l=d:4")).toBe(
        'The link repeats "l". Used "l=a:1"; ignored "l=b:2", "l=c:3" and 1 more.',
      );
      expect(message("?l=a:1&l=b:2&l=c:3&l=d:4&l=e:5&l=f:6")).toBe(
        'The link repeats "l". Used "l=a:1"; ignored "l=b:2", "l=c:3" and 3 more.',
      );
    });

    it("still uses the first value: the lever list that counts is the first one", () => {
      const result = decode("?l=fed_rate:100&l=inflation:50");
      expect(result.levers).toEqual(levers({ fed_rate: 1 }));
    });

    it("sanitizes and truncates the values it quotes, so markup never appears", () => {
      expect(message("?l=fed_rate:1&l=<b>x</b>:1")).toBe(
        'The link repeats "l". Used "l=fed_rate:1"; ignored "l=?b?x??b?:1".',
      );
      expect(message(`?l=fed_rate:1&l=${"a".repeat(40)}`)).toBe(
        `The link repeats "l". Used "l=fed_rate:1"; ignored "l=${"a".repeat(24)}...".`,
      );
    });

    it("quotes a stamp too", () => {
      expect(message(`?d=${STAMP}&d=00000000`)).toBe(
        `The link repeats "d". Used "d=${STAMP}"; ignored "d=00000000".`,
      );
    });
  });

  describe("a duplicated indicator names the setting it kept and the one it ignored", () => {
    it("keeps the first and names both", () => {
      expect(decode("?l=fed_rate:100,fed_rate:50").problems[0]?.message).toBe(
        'The link sets "fed_rate" more than once. Kept "fed_rate:100"; ignored "fed_rate:50".',
      );
    });

    it("names a zero setting as the one it kept", () => {
      expect(decode("?l=fed_rate:0,fed_rate:5").problems[0]?.message).toBe(
        'The link sets "fed_rate" more than once. Kept "fed_rate:0"; ignored "fed_rate:5".',
      );
    });

    it("reports each further copy on its own, always against the first", () => {
      const result = decode("?l=fed_rate:10,fed_rate:20,fed_rate:30");
      expect(result.problems.map((p) => p.message)).toEqual([
        'The link sets "fed_rate" more than once. Kept "fed_rate:10"; ignored "fed_rate:20".',
        'The link sets "fed_rate" more than once. Kept "fed_rate:10"; ignored "fed_rate:30".',
      ]);
      expect(result.levers).toEqual(levers({ fed_rate: 0.1 }));
    });

    it("does not call an invalid earlier entry the one it kept", () => {
      const result = decode("?l=fed_rate:x,fed_rate:20,fed_rate:30");
      expect(codes(result)).toEqual(["invalid_value", "duplicate_node"]);
      expect(result.problems[1]?.message).toBe(
        'The link sets "fed_rate" more than once. Kept "fed_rate:20"; ignored "fed_rate:30".',
      );
    });
  });

  it("truncates a long token to 24 characters and marks the cut", () => {
    const result = decode(`?l=${"a".repeat(100)}:5`);
    expect(result.problems[0]?.token).toBe(`${"a".repeat(24)}...`);
  });

  it("keeps a token of exactly 24 characters whole", () => {
    const result = decode(`?l=${"a".repeat(24)}:5`);
    expect(result.problems[0]?.token).toBe("a".repeat(24));
  });
});

describe("decodeScenario: caps on its own work", () => {
  it("reads a link of exactly 2048 characters and rejects one of 2049", () => {
    const stem = "?l=fed_rate:100&pad=";
    const ok = stem + "x".repeat(MAX_QUERY_LENGTH - stem.length);
    const tooLong = ok + "x";
    expect(ok.length).toBe(2048);
    expect(decode(ok).levers).toEqual(levers({ fed_rate: 1 }));
    expect(codes(decode(ok))).toEqual([]);
    const rejected = decode(tooLong);
    expect(rejected.levers).toEqual(new Map());
    expect(codes(rejected)).toEqual(["too_long"]);
    expect(rejected.problems[0]?.message).toBe(
      "The link is longer than 2048 characters, so none of it was used.",
    );
    expect(rejected.stamp).toBe("missing");
  });

  it("reads at most 100 lever settings, and says so first", () => {
    const search = `?l=${Array.from({ length: 150 }, () => "x:1").join(",")}`;
    const result = decode(search);
    expect(result.problems[0]).toEqual({
      code: "too_many_entries",
      token: "",
      message: "The link has more than 100 lever settings; only the first 100 were read.",
    });
    // one too_many_entries, then 100 unknown indicators; ten are listed and the rest are counted
    expect(result.problems).toHaveLength(MAX_PROBLEMS);
    expect(result.problemsOmitted).toBe(101 - MAX_PROBLEMS);
  });

  it("reads exactly 100 settings without complaint about their number", () => {
    const search = `?l=${Array.from({ length: 100 }, () => "x:1").join(",")}`;
    expect(codes(decode(search))).not.toContain("too_many_entries");
  });

  it("lists at most ten problems and counts the rest", () => {
    const result = decode(`?l=${Array.from({ length: 30 }, () => "x:1").join(",")}`);
    expect(result.problems).toHaveLength(10);
    expect(result.problemsOmitted).toBe(20);
  });

  it("does not list an omitted count when there are ten problems or fewer", () => {
    const result = decode(`?l=${Array.from({ length: 10 }, () => "x:1").join(",")}`);
    expect(result.problems).toHaveLength(10);
    expect(result.problemsOmitted).toBe(0);
  });
});

describe("decodeScenario: the programmer's own mistakes are loud", () => {
  it.each(["", "0a1b2c3", "0A1B2C3D", "zzzzzzzz"])("rejects the current stamp %j", (stamp) => {
    expect(() => decodeScenario("?l=fed_rate:1", real, stamp)).toThrow(RangeError);
  });
});

describe("encode and decode together", () => {
  it("round-trips every integer percent from -100 to 100 exactly", () => {
    for (let percent = -100; percent <= 100; percent++) {
      const value = percent / 100;
      const result = decode(encodeScenario(levers({ fed_rate: value }), STAMP));
      if (percent === 0) expect(result.levers).toEqual(new Map());
      else expect(result.levers.get("fed_rate")).toBe(value);
      expect(result.problems).toEqual([]);
      expect(result.stamp).toBe("current");
    }
  });

  it("round-trips 300 seeded random scenarios, and encoding is a fixed point of decode then encode", () => {
    const rand = mulberry32(2026);
    for (let round = 0; round < 300; round++) {
      const set = new Map<string, number>();
      const count = Math.floor(rand() * 8);
      for (let k = 0; k < count; k++) {
        const id = IDS[Math.floor(rand() * IDS.length)] ?? "fed_rate";
        set.set(id, (Math.floor(rand() * 201) - 100) / 100);
      }
      const encoded = encodeScenario(set, STAMP);
      const decoded = decode(encoded);
      const expected = new Map([...set].filter(([, v]) => v !== 0));
      expect(decoded.levers).toEqual(expected);
      expect(decoded.problems).toEqual([]);
      expect(encodeScenario(decoded.levers, STAMP)).toBe(encoded);
    }
  });
});

describe("decodeScenario never throws, whatever it is given", () => {
  const ALPHABET = [
    ...IDS,
    "0",
    "1",
    "5",
    "9",
    "-",
    "+",
    ":",
    ",",
    "&",
    "=",
    "?",
    "#",
    "%",
    "%3A",
    "%2C",
    "%00",
    "%ZZ",
    "l",
    "v",
    "d",
    "l=",
    "v=1",
    "d=",
    " ",
    "_",
    ".",
    "e",
    "x",
    "é",
    "日",
    "\u{1F680}",
    "\ud83d",
    "\u0000",
    "<",
    ">",
    '"',
    "'",
    "\\",
    "/",
  ];

  function randomSearch(rand: () => number): string {
    const parts = 1 + Math.floor(rand() * 30);
    let text = rand() < 0.7 ? "?" : "";
    for (let i = 0; i < parts; i++) text += ALPHABET[Math.floor(rand() * ALPHABET.length)] ?? "";
    return text;
  }

  function mutate(valid: string, rand: () => number): string {
    const chars = Array.from(valid);
    for (let k = 0; k < 1 + Math.floor(rand() * 4); k++) {
      const at = Math.floor(rand() * (chars.length + 1));
      const kind = Math.floor(rand() * 3);
      const piece = ALPHABET[Math.floor(rand() * ALPHABET.length)] ?? "";
      if (kind === 0) chars.splice(at, 0, piece);
      else if (kind === 1) chars.splice(at, 1);
      else chars.splice(at, 1, piece);
    }
    return chars.join("");
  }

  function checkInvariants(result: DecodedScenario): void {
    for (const [id, value] of result.levers) {
      expect(IDS).toContain(id);
      expect(value).not.toBe(0);
      expect(Math.abs(value)).toBeLessThanOrEqual(1);
      expect(Math.abs(value * 100 - Math.round(value * 100))).toBeLessThan(1e-9);
    }
    expect(result.problems.length).toBeLessThanOrEqual(MAX_PROBLEMS);
    expect(Number.isInteger(result.problemsOmitted)).toBe(true);
    expect(result.problemsOmitted).toBeGreaterThanOrEqual(0);
    for (const problem of result.problems) {
      expect(problem.token).toMatch(/^[A-Za-z0-9_.:?-]*(\.\.\.)?$/);
      expect(problem.token.length).toBeLessThanOrEqual(MAX_TOKEN_LENGTH + 3);
      expect(problem.message.length).toBeGreaterThan(0);
    }
    expect(["current", "stale", "missing", "invalid"]).toContain(result.stamp);
  }

  it("on 4000 random strings and 2000 corrupted valid links, and always returns a valid result", () => {
    const rand = mulberry32(7);
    const valid = [
      `?v=1&d=${STAMP}&l=fed_rate:100,worker_bargaining_power:-50`,
      "?l=inflation:10,productivity:-20,media_trust:5",
      `?v=1&d=${STAMP}`,
    ];
    for (let i = 0; i < 4000; i++) {
      expect(() => {
        checkInvariants(decode(randomSearch(rand)));
      }).not.toThrow();
    }
    for (let i = 0; i < 2000; i++) {
      const base = valid[Math.floor(rand() * valid.length)] ?? "";
      expect(() => {
        checkInvariants(decode(mutate(base, rand)));
      }).not.toThrow();
    }
  });

  it("re-encodes whatever it accepted into a link that decodes to the same levers", () => {
    const rand = mulberry32(11);
    for (let i = 0; i < 1500; i++) {
      const first = decode(randomSearch(rand));
      const again = decode(encodeScenario(first.levers, STAMP));
      expect(again.levers).toEqual(first.levers);
      expect(again.problems).toEqual([]);
    }
  });

  it("gives the same answer for the same input, every time", () => {
    const search = `?v=1&d=${STAMP}&l=fed_rate:100,nope:5,inflation:x`;
    expect(decode(search)).toEqual(decode(search));
  });
});
