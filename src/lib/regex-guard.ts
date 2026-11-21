// Safety check for a caller's regular expression before it is run (21 Nov 2026).
//
// JavaScript's regex engine backtracks, and there is no way to stop a running match: a pattern that can match the same
// text in many ways runs until the platform kills the request. The first guard was one regex that refused "a
// quantified group that contains a quantifier". It missed groups nested one level deeper (((a+))+), alternatives that
// overlap ((a|aa)+$), and plain runs of repeats that overlap (a*a*a*a*b is slow at 5,000 characters without any
// group), and it refused every quantified (?:...) group by mistake, reading the "?" of "(?:" as a quantifier.
//
// This reads the pattern into a small tree and answers three questions:
//   1. Does a repeated group hold another repeat, at any depth? Refused: that shape is exponential.
//   2. Does a repeated group hold alternatives that can start with the same character? Refused for the same reason.
//      Alternatives that each start with a different character are kept: the next character decides the branch, so
//      there is one way to match and (foo|bar)+ stays usable.
//   3. How many repeats in a row can match the same characters with nothing between them that forces a different
//      character? Each such repeat multiplies the work by the text length (or by its own range when it is bounded),
//      and the search starts at every position. The answer is the longest text for which that product stays inside a
//      fixed budget of steps; a longer text is refused with that number in the message.
// Every doubt is resolved towards "can overlap": the check may refuse a harmless pattern on a long text, never the
// reverse (the tests time the worst patterns it lets through).

export type RegexVerdict =
  | { ok: true }
  | { ok: false; reason: "nested" | "backreference" | "alternation" | "unreadable" }
  | { ok: false; reason: "overlap"; maxText: number };

interface Quant { min: number; max: number }
type Node =
  | { t: "atom"; src: string; q: Quant | null }
  | { t: "assert" }
  | { t: "group"; look: boolean; body: Node[][]; q: Quant | null };

class Unreadable extends Error {}
class Backreference extends Error {}

/**
 * Backtracking steps a single call may cost at worst. One plain repeat on the full 5,000 characters is 25 million
 * (5,000 start positions times 5,000), and one optional part beside it doubles that, so both stay allowed; the
 * slowest pattern found under this budget took about a third of a second (tests/input-hardening.test.cjs times them).
 */
const STEP_BUDGET = 6e7;
/** Above this many variable repeats the pairwise check is skipped and all of them count as overlapping. */
const MAX_REPEATS_COMPARED = 40;

function parse(pattern: string, unicode: boolean): Node[][] {
  let i = 0;
  const quantifier = (): Quant | null => {
    const c = pattern[i];
    let q: Quant | null = null;
    if (c === "*") { q = { min: 0, max: Infinity }; i++; }
    else if (c === "+") { q = { min: 1, max: Infinity }; i++; }
    else if (c === "?") { q = { min: 0, max: 1 }; i++; }
    else if (c === "{") {
      const m = /^\{(\d+)(?:(,)(\d*))?\}/.exec(pattern.slice(i, i + 24));
      if (!m) return null; // a brace that is not a quantifier is an ordinary character
      const min = Number(m[1]);
      q = { min, max: m[2] ? (m[3] ? Number(m[3]) : Infinity) : min };
      i += m[0].length;
    }
    if (q && pattern[i] === "?") i++; // lazy: the same number of ways to match
    return q;
  };
  const alternation = (depth: number): Node[][] => {
    const branches: Node[][] = [[]];
    for (;;) {
      if (i >= pattern.length) { if (depth > 0) throw new Unreadable(); return branches; }
      const c = pattern[i];
      if (c === ")") { if (depth === 0) throw new Unreadable(); return branches; }
      if (c === "|") { branches.push([]); i++; continue; }
      const seq = branches[branches.length - 1];
      if (c === "(") {
        i++;
        let look = false;
        if (pattern[i] === "?") {
          const head = /^\?(?:(:)|([=!]|<[=!])|<[^>=!][^>]*>|[a-z]*(?:-[a-z]+)?:)/.exec(pattern.slice(i, i + 80));
          if (!head) throw new Unreadable();
          look = Boolean(head[2]);
          i += head[0].length;
        }
        const body = alternation(depth + 1);
        i++; // the closing parenthesis
        seq.push({ t: "group", look, body, q: quantifier() });
        continue;
      }
      if (c === "*" || c === "+" || c === "?") throw new Unreadable();
      if (c === "^" || c === "$") { i++; quantifier(); seq.push({ t: "assert" }); continue; }
      const from = i;
      if (c === "[") {
        i++;
        while (i < pattern.length && pattern[i] !== "]") i += pattern[i] === "\\" ? 2 : 1;
        if (i >= pattern.length) throw new Unreadable();
        i++;
      } else if (c === "\\") {
        const e = pattern[i + 1];
        if (e === undefined) throw new Unreadable();
        if (e === "b" || e === "B") { i += 2; quantifier(); seq.push({ t: "assert" }); continue; }
        if (/[1-9]/.test(e) || (e === "k" && pattern[i + 2] === "<")) throw new Backreference();
        i += 2;
        if ((e === "p" || e === "P" || e === "u") && pattern[i] === "{") { const end = pattern.indexOf("}", i); if (end === -1) throw new Unreadable(); i = end + 1; }
        else if (e === "u") i += 4;
        else if (e === "x") i += 2;
        else if (e === "c") i += 1;
      } else {
        const code = pattern.codePointAt(i)!;
        i += unicode && code > 0xffff ? 2 : 1;
      }
      seq.push({ t: "atom", src: pattern.slice(from, i), q: quantifier() });
    }
  };
  return alternation(0);
}

/** A repeat with a choice in it: *, +, ?, {2,5}. An exact count such as {3} has one way to match and does not count. */
const varies = (q: Quant | null): q is Quant => q !== null && q.max > q.min;
const hasRepeat = (body: Node[][]): boolean => body.some((seq) => seq.some((n) => n.t !== "assert" && (varies(n.q) || (n.t === "group" && hasRepeat(n.body)))));

/** Which of the sample characters each piece of the pattern can match, as a bit set. */
function sampler(pattern: string, flags: string) {
  // All of ASCII, one of each kind of other character the classes \d \w \s and "." tell apart, and every non-ASCII
  // character the pattern itself names (two ranges that overlap always share an end point of one of them).
  const samples = Array.from({ length: 128 }, (_, n) => String.fromCharCode(n));
  samples.push(" ", "é", "ſ", "K", " ", "中", "\ud83d", "\ude00", "\u{1f600}");
  for (const ch of new Set(pattern)) if (ch.codePointAt(0)! > 127 && !samples.includes(ch)) samples.push(ch);
  const all = (1n << BigInt(samples.length)) - 1n;
  const fl = flags.replace(/[^isu]/g, "");
  const seen = new Map<string, bigint>();
  return {
    all,
    of(src: string): bigint {
      const known = seen.get(src);
      if (known !== undefined) return known;
      let set = all;
      // Escapes that name characters by number or property are not sampled: they count as "any character".
      if (!/\\[pPuxc0]/.test(src)) {
        try {
          const re = new RegExp(`^(?:${src})$`, fl);
          set = 0n;
          samples.forEach((ch, n) => { if (re.test(ch)) set |= 1n << BigInt(n); });
        } catch { set = all; }
      }
      seen.set(src, set);
      return set;
    },
  };
}

interface Item { repeat: boolean; set: bigint; range: number; soft: boolean; path: Map<number, number>; last: boolean }

export function regexRisk(pattern: string, flags: string, textLength: number): RegexVerdict {
  let tree: Node[][];
  try { tree = parse(pattern, flags.includes("u")); }
  catch (e) { return { ok: false, reason: e instanceof Backreference ? "backreference" : "unreadable" }; }
  const sets = sampler(pattern, flags);

  // 1 and 2: what a repeated group may hold.
  let refusal: "nested" | "alternation" | null = null;
  const distinctStarts = (body: Node[][]) => {
    if (body.length > 1) {
      const starts: bigint[] = [];
      for (const seq of body) {
        const first = seq[0];
        if (!first || first.t !== "atom") { refusal ??= "alternation"; return; }
        const set = sets.of(first.src);
        if (starts.some((s) => (s & set) !== 0n)) { refusal ??= "alternation"; return; }
        starts.push(set);
      }
    }
    for (const seq of body) for (const n of seq) if (n.t === "group") distinctStarts(n.body);
  };
  const structure = (body: Node[][]) => {
    for (const seq of body) for (const n of seq) {
      if (n.t !== "group") continue;
      // An optional group, (...)? , runs its body at most once: what it holds is weighed below like any other
      // sequence, so \d+(\.\d+)? stays usable. A group that can run twice or more is where the two refusals apply.
      if (n.q && n.q.max > 1) {
        if (hasRepeat(n.body)) refusal ??= "nested";
        else distinctStarts(n.body);
      }
      structure(n.body);
    }
  };
  structure(tree);
  if (refusal) return { ok: false, reason: refusal };

  // 3: the pattern as one line of items, each knowing which alternation branches it sits in.
  const items: Item[] = [];
  const terminal = new Set<Node>();
  const markLast = (body: Node[][]) => {
    for (const seq of body) {
      const last = seq[seq.length - 1];
      if (!last || last.t === "assert") continue;
      if (varies(last.q)) terminal.add(last);
      if (last.t === "group" && !last.look && (!last.q || last.q.max <= 1)) markLast(last.body);
    }
  };
  markLast(tree);
  let nextAlt = 0;
  const union = (body: Node[][]): bigint => { let s = 0n; for (const seq of body) for (const n of seq) { if (n.t === "atom") s |= sets.of(n.src); else if (n.t === "group") s |= union(n.body); } return s; };
  const flatten = (body: Node[][], path: Map<number, number>, soft: boolean) => {
    const alt = body.length > 1 ? nextAlt++ : -1;
    body.forEach((seq, branch) => {
      const here = alt === -1 ? path : new Map(path).set(alt, branch);
      for (const n of seq) {
        if (n.t === "assert") continue;
        const q = n.q;
        if (n.t === "atom") {
          const set = sets.of(n.src);
          if (!q || q.min >= 1) items.push({ repeat: false, set, range: 0, soft, path: here, last: false });
          if (varies(q)) items.push({ repeat: true, set, range: q.max - q.min, soft, path: here, last: terminal.has(n) });
          continue;
        }
        // A lookaround consumes nothing, so what it holds never stands between two repeats; its own repeats count.
        if (n.look) { flatten(n.body, here, true); continue; }
        if (!q) { flatten(n.body, here, soft); continue; }
        // An optional group is a choice between its body and nothing: its body sits on a branch of its own, so what
        // it requires counts between repeats inside it and not between repeats on either side of it.
        if (q.max <= 1 && q.min === 0) flatten(n.body, new Map(here).set(nextAlt++, 0), soft);
        else if (q.min >= 1) flatten(n.body, here, soft);
        if (varies(q)) items.push({ repeat: true, set: union(n.body), range: q.max - q.min, soft, path: here, last: terminal.has(n) });
      }
    });
  };
  flatten(tree, new Map(), false);

  const repeats = items.map((it, at) => ({ it, at })).filter((x) => x.it.repeat);
  if (!repeats.length) return { ok: true };
  const sameRoad = (a: Item, b: Item) => { for (const [alt, branch] of a.path) { const other = b.path.get(alt); if (other !== undefined && other !== branch) return false; } return true; };
  /** Whether both repeats can be given the same run of characters: they share one, and nothing required between them needs another. */
  const overlap = (a: { it: Item; at: number }, b: { it: Item; at: number }) => {
    if (!sameRoad(a.it, b.it)) return false;
    const shared = a.it.set & b.it.set;
    if (shared === 0n) return false;
    for (let k = a.at + 1; k < b.at; k++) {
      const mid = items[k];
      if (mid.repeat || mid.soft || (mid.set & shared) !== 0n) continue;
      let required = true;
      for (const [alt, branch] of mid.path) if (a.it.path.get(alt) !== branch && b.it.path.get(alt) !== branch) { required = false; break; }
      if (required) return false;
    }
    return true;
  };
  const linked: number[][] = repeats.map(() => []);
  const compare = repeats.length <= MAX_REPEATS_COMPARED;
  for (let j = 0; j < repeats.length; j++) for (let i = 0; i < j; i++) if (!compare || overlap(repeats[i], repeats[j])) linked[j].push(i);

  // Alternatives are tried one after another, so their costs add up: a*b|a*c|a*d... does the work once per branch.
  const branchesWithRepeats = Math.max(1, new Set(repeats.flatMap(({ it }) => [...it.path].map(([alt, branch]) => `${alt}:${branch}`))).size);
  const anchored = !/[my]/.test(flags) ? tree.length === 1 && pattern.startsWith("^") : flags.includes("y");
  /** Worst-case steps on a text of n characters: the heaviest chain of overlapping repeats, times the start positions. */
  const steps = (n: number) => {
    const best: number[] = [];
    let worst = 0;
    repeats.forEach(({ it }, j) => {
      // A repeat that ends the pattern is never taken back: nothing after it can fail.
      // A counted repeat ({0,20}) is weighed double: the engine keeps a counter for it and each step costs many
      // times more than a step of a plain * or + (measured: a{0,20} four times in a row, 35 ns a step against 2 ns).
      const own = it.last ? 0 : Math.log(it.range === Infinity ? Math.max(1, n) : it.range === 1 ? 2 : 2 * (Math.min(n, it.range) + 1));
      let before = 0;
      for (const i of linked[j]) if (best[i] > before) before = best[i];
      best[j] = own + before;
      if (best[j] > worst) worst = best[j];
    });
    return worst + Math.log(branchesWithRepeats) + Math.log(anchored ? 1 : Math.max(1, n));
  };
  const budget = Math.log(STEP_BUDGET);
  if (steps(textLength) <= budget) return { ok: true };
  let lo = 0, hi = textLength;
  while (lo < hi) { const mid = Math.ceil((lo + hi) / 2); if (steps(mid) <= budget) lo = mid; else hi = mid - 1; }
  return { ok: false, reason: "overlap", maxText: lo };
}
