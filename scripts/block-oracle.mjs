/** Independent exact-rational arithmetic for the stored directed simple-path model. */
function gcd(a, b) {
  a = a < 0n ? -a : a;
  while (b !== 0n) [a, b] = [b, a % b];
  return a;
}
function fraction(n, d = 1n) {
  if (d === 0n) throw new RangeError("Zero denominator");
  if (d < 0n) {
    n = -n;
    d = -d;
  }
  const g = gcd(n, d);
  return { n: n / g, d: d / g };
}
function scalar(value) {
  if (!Number.isFinite(value)) throw new RangeError("Non-finite oracle input");
  const match = /^(-?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/.exec(String(value));
  if (!match) throw new RangeError("Unsupported decimal input");
  const digits = match[3] ?? "",
    exponent = Number(match[4] ?? "0") - digits.length;
  const n = BigInt(match[2] + digits) * (match[1] ? -1n : 1n);
  return exponent >= 0
    ? fraction(n * 10n ** BigInt(exponent))
    : fraction(n, 10n ** BigInt(-exponent));
}
const plus = (a, b) => fraction(a.n * b.d + b.n * a.d, a.d * b.d);
const times = (a, b) => fraction(a.n * b.n, a.d * b.d);
const number = (a) => Number(a.n) / Number(a.d);
const zero = () => fraction(0n);
const one = () => fraction(1n);

/** Enumerate paths breadth-by-depth, independently of the production DFS. */
export function exactOracle(graph, maxHops = 3, decay = 0.7) {
  const ids = graph.nodes.map((n) => n.id);
  const outgoing = new Map(ids.map((id) => [id, []]));
  for (const edge of graph.edges) {
    if (!outgoing.has(edge.from) || !outgoing.has(edge.to)) throw new Error("Invalid oracle edge");
    outgoing.get(edge.from).push(edge);
  }
  const coefficients = new Map();
  for (const source of ids) {
    const row = new Map(ids.map((id) => [id, id === source ? one() : zero()]));
    let frontier = [{ id: source, visited: [source], weight: one() }],
      attenuation = one();
    for (let depth = 1; depth <= maxHops; depth++) {
      const next = [];
      for (const path of frontier) {
        for (const edge of outgoing.get(path.id)) {
          if (path.visited.includes(edge.to)) continue;
          const weight = times(path.weight, scalar(edge.direction * edge.strength));
          row.set(edge.to, plus(row.get(edge.to), times(weight, attenuation)));
          next.push({ id: edge.to, visited: [...path.visited, edge.to], weight });
        }
      }
      frontier = next;
      attenuation = times(attenuation, scalar(decay));
    }
    coefficients.set(source, row);
  }
  return (entries) => {
    const levers = new Map(entries),
      result = {};
    for (const [id, value] of levers) {
      if (!coefficients.has(id) || !Number.isFinite(value) || Math.abs(value) > 1)
        throw new RangeError("Invalid scenario input");
    }
    for (const target of ids) {
      let total = zero();
      for (const [id, value] of levers)
        total = plus(total, times(scalar(value), coefficients.get(id).get(target)));
      const delta = total.n > total.d ? one() : total.n < -total.d ? fraction(-1n) : total;
      const magnitude = delta.n < 0n ? -delta.n : delta.n;
      const rounded = (100n * magnitude + delta.d) / (2n * delta.d);
      const own = levers.get(target) ?? 0;
      result[target] = {
        idle:
          own === 0 &&
          ![...levers].some(
            ([source, value]) =>
              source !== target && value !== 0 && coefficients.get(source).get(target).n !== 0n,
          ),
        own,
        total: number(total),
        propagated: number(plus(total, scalar(-own))),
        delta: number(delta),
        position: number(plus(fraction(50n), times(fraction(50n), delta))),
        filled: 50 + (delta.n > 0n ? 1 : delta.n < 0n ? -1 : 0) * Number(rounded),
      };
    }
    return result;
  };
}
export function oracle(graph, entries, maxHops = 3, decay = 0.7) {
  return exactOracle(graph, maxHops, decay)(entries);
}
