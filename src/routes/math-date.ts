// Business days, statistics, expressions and zodiac signs, computed locally (1.58.0). Bazaar search on 24 Oct 2026, summed
// 30-day payers over the top 20, no listing of ours: business days 57, working days 38, statistics 37, math expression 24,
// zodiac 22. No outside service; holidays come from the same rules as /holidays.
import { entry, need, num, opt, type Entry } from "../family";
import { HttpError } from "../lib/env";
import { COUNTRIES, holidaysFor } from "./holidays";

const U = ["utility", "data"];

// ---------- business days ----------
const DAY = 86_400_000;
const parseDay = (s: string, name: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
  const t = m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : NaN;
  if (!m || Number.isNaN(t) || new Date(t).getUTCDate() !== +m[3]) throw new HttpError(400, `${name} must be a date as YYYY-MM-DD`);
  return t;
};
const ymd = (t: number) => new Date(t).toISOString().slice(0, 10);
export function businessDays(from: number, to: number, country: string | null) {
  if (to < from) throw new HttpError(400, "to must be on or after from");
  if ((to - from) / DAY > 3_660) throw new HttpError(400, "the range is limited to 10 years");
  const holidays = new Map<string, string>();
  if (country) {
    for (let y = new Date(from).getUTCFullYear(); y <= new Date(to).getUTCFullYear(); y++) {
      for (const h of holidaysFor(country, y)?.holidays ?? []) holidays.set(h.date, h.name);
    }
  }
  let business = 0, weekend = 0;
  const skipped: { date: string; name: string }[] = [];
  for (let t = from; t <= to; t += DAY) {
    const wd = new Date(t).getUTCDay();
    if (wd === 0 || wd === 6) { weekend++; continue; }
    const h = holidays.get(ymd(t));
    if (h) { skipped.push({ date: ymd(t), name: h }); continue; }
    business++;
  }
  return { calendarDays: Math.round((to - from) / DAY) + 1, businessDays: business, weekendDays: weekend, holidays: skipped };
}
/** The date `n` business days after (or before, if negative) `from`. */
export function addBusinessDays(from: number, n: number, country: string | null) {
  const step = n < 0 ? -DAY : DAY;
  let t = from, left = Math.abs(n);
  const years = new Set<number>(), holidays = new Set<string>();
  const isHoliday = (x: number) => {
    const y = new Date(x).getUTCFullYear();
    if (country && !years.has(y)) { years.add(y); for (const h of holidaysFor(country, y)?.holidays ?? []) holidays.add(h.date); }
    return holidays.has(ymd(x));
  };
  while (left > 0) { t += step; const wd = new Date(t).getUTCDay(); if (wd !== 0 && wd !== 6 && !isHoliday(t)) left--; }
  return ymd(t);
}

// ---------- statistics ----------
export function stats(values: number[]) {
  const n = values.length;
  const s = [...values].sort((a, b) => a - b);
  const sum = s.reduce((a, b) => a + b, 0), mean = sum / n;
  const q = (p: number) => { const i = (n - 1) * p, lo = Math.floor(i), hi = Math.ceil(i); return s[lo] + (s[hi] - s[lo]) * (i - lo); };
  const sq = s.reduce((a, b) => a + (b - mean) ** 2, 0);
  const counts = new Map<number, number>();
  for (const v of s) counts.set(v, (counts.get(v) ?? 0) + 1);
  const top = Math.max(...counts.values());
  const r = (v: number) => Math.round(v * 1e10) / 1e10;
  return {
    count: n, sum: r(sum), mean: r(mean), median: r(q(0.5)), mode: top > 1 ? [...counts].filter(([, c]) => c === top).map(([v]) => v).slice(0, 10) : [],
    min: s[0], max: s[n - 1], range: r(s[n - 1] - s[0]), variance: r(sq / n), stdDev: r(Math.sqrt(sq / n)),
    sampleVariance: n > 1 ? r(sq / (n - 1)) : null, sampleStdDev: n > 1 ? r(Math.sqrt(sq / (n - 1))) : null,
    q1: r(q(0.25)), q3: r(q(0.75)), iqr: r(q(0.75) - q(0.25)), p90: r(q(0.9)), p95: r(q(0.95)), p99: r(q(0.99)),
  };
}

// ---------- expressions (recursive descent, no eval) ----------
const FUNCS: Record<string, (...a: number[]) => number> = {
  sqrt: Math.sqrt, cbrt: Math.cbrt, abs: Math.abs, round: Math.round, floor: Math.floor, ceil: Math.ceil, exp: Math.exp,
  ln: Math.log, log: Math.log10, log2: Math.log2, sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan,
  min: Math.min, max: Math.max, pow: Math.pow,
};
const CONSTS: Record<string, number> = { pi: Math.PI, e: Math.E, tau: Math.PI * 2 };
export function evaluate(src: string): number {
  const tokens = src.match(/\d+(?:\.\d+)?(?:e[+-]?\d+)?|\.\d+|[a-z_][a-z0-9_]*|\*\*|[-+*/%^(),!]|\S/gi) ?? [];
  let i = 0, steps = 0;
  const peek = () => tokens[i], take = () => tokens[i++];
  const fail = (m: string): never => { throw new HttpError(400, m); };
  const expect = (t: string) => { if (take() !== t) fail(`expected "${t}"`); };
  const expr = (): number => { let v = term(); while (peek() === "+" || peek() === "-") v = take() === "+" ? v + term() : v - term(); return v; };
  const term = (): number => { let v = unary(); while (peek() === "*" || peek() === "/" || peek() === "%") { const op = take(); const r = unary(); v = op === "*" ? v * r : op === "/" ? v / r : v % r; } return v; };
  // Signs bind looser than powers (-2^2 = -4) but an exponent may carry its own sign (2^-1 = 0.5).
  const unary = (): number => { if (peek() === "-") { take(); return -unary(); } if (peek() === "+") { take(); return unary(); } return power(); };
  const power = (): number => { const b = postfix(); if (peek() === "^" || peek() === "**") { take(); return b ** unary(); } return b; };
  const postfix = (): number => {
    let v = atom();
    while (peek() === "!") { take(); if (!Number.isInteger(v) || v < 0 || v > 170) fail("factorial needs a whole number from 0 to 170"); let f = 1; for (let k = 2; k <= v; k++) f *= k; v = f; }
    return v;
  };
  const atom = (): number => {
    if (++steps > 2_000) fail("expression is too complex");
    const t = take();
    if (t === undefined) return fail("unexpected end of expression");
    if (/^(\d|\.\d)/.test(t)) return Number(t);
    if (t === "(") { const v = expr(); expect(")"); return v; }
    const name = t.toLowerCase();
    // Own properties only: `in` would also match inherited names such as constructor or toString.
    if (Object.hasOwn(CONSTS, name)) return CONSTS[name];
    if (Object.hasOwn(FUNCS, name)) {
      expect("(");
      const args = [expr()];
      while (peek() === ",") { take(); args.push(expr()); }
      expect(")");
      return FUNCS[name](...args);
    }
    return fail(`unknown token "${t}"`);
  };
  if (tokens.length === 0) fail("expression is empty");
  const value = expr();
  if (i < tokens.length) fail(`unexpected "${tokens[i]}"`);
  return value;
}

// ---------- zodiac ----------
const SIGNS: [string, number, number][] = [ // sign, start month, start day (tropical, western)
  ["Capricorn", 12, 22], ["Aquarius", 1, 20], ["Pisces", 2, 19], ["Aries", 3, 21], ["Taurus", 4, 20], ["Gemini", 5, 21],
  ["Cancer", 6, 21], ["Leo", 7, 23], ["Virgo", 8, 23], ["Libra", 9, 23], ["Scorpio", 10, 23], ["Sagittarius", 11, 22],
];
const ELEMENT: Record<string, string> = { Aries: "fire", Leo: "fire", Sagittarius: "fire", Taurus: "earth", Virgo: "earth", Capricorn: "earth", Gemini: "air", Libra: "air", Aquarius: "air", Cancer: "water", Scorpio: "water", Pisces: "water" };
const ANIMALS = ["Rat", "Ox", "Tiger", "Rabbit", "Dragon", "Snake", "Horse", "Goat", "Monkey", "Rooster", "Dog", "Pig"];
const ELEMENTS5 = ["Wood", "Fire", "Earth", "Metal", "Water"];
export function westernSign(month: number, day: number) {
  let sign = "Capricorn";
  for (const [name, m, d] of SIGNS) if (month > m || (month === m && day >= d)) sign = name;
  if (month === 12 && day >= 22) sign = "Capricorn";
  return sign;
}

export const MATH_DATE: Entry[] = [
  entry("/date/business-days", "Business days between dates, working days calculator",
    "Count business (working) days between two dates, skipping weekends and public holidays for the US, UK, Sweden, Germany, France, Norway, Denmark or Finland, and list the holidays skipped; or give add=N to get the date N business days after (or before) a date. Other countries count weekends only, and the answer says so. Use for delivery estimates, SLAs, payment terms and payroll dates.",
    ["business-days", "working-days", "calendar", "date", ...U], {
      from: { type: "string", description: "Start date, YYYY-MM-DD", required: true, example: "2026-12-01" },
      to: { type: "string", description: "End date, YYYY-MM-DD (inclusive; default: the last day of the start month); or use add", example: "2026-12-31" },
      add: { type: "integer", description: "Business days to add to from (negative to go back), instead of to", example: 10 },
      country: { type: "string", description: "Holiday calendar: US, GB, SE, DE, FR, NO, DK or FI (default: weekends only)", example: "SE" },
    },
    { from: "2026-12-01", to: "2026-12-31", country: "SE", holidayRules: true, calendarDays: 31, businessDays: 20, weekendDays: 8, holidays: [{ date: "2026-12-24", name: "Christmas Eve" }] },
    (_e, q) => {
      const from = parseDay(need(q, "from", 20), "from");
      const raw = opt(q, "country", 40)?.toUpperCase().replace(/^UK$/, "GB") ?? null;
      const country = raw && raw in COUNTRIES ? raw : null;
      const note = raw && !country ? `no holiday rules for ${raw}; weekends only (supported: ${Object.keys(COUNTRIES).join(", ")})` : undefined;
      if (q("add")?.trim()) {
        const n = num(q, "add", { min: -2_500, max: 2_500, integer: true });
        return { from: ymd(from), add: n, country, holidayRules: !!country, date: addBusinessDays(from, n, country), ...(note ? { note } : {}) };
      }
      // Without to or add, count to the end of the start month, so the published example (required inputs only) works.
      const toRaw = opt(q, "to", 20);
      const to = toRaw ? parseDay(toRaw, "to") : Date.UTC(new Date(from).getUTCFullYear(), new Date(from).getUTCMonth() + 1, 0);
      return { from: ymd(from), to: ymd(to), country, holidayRules: !!country, ...businessDays(from, to, country), ...(note ? { note } : {}) };
    }),

  entry("/math/stats", "Statistics of numbers: mean, median, standard deviation, percentiles",
    "Descriptive statistics for a list of numbers: count, sum, mean, median, mode, min, max, range, population and sample variance and standard deviation, quartiles with IQR, and the 90th, 95th and 99th percentiles (linear interpolation). Up to 10,000 numbers, comma or space separated. Use to summarise measurements, latencies, prices or scores without a spreadsheet.",
    ["statistics", "math", "mean", "median", "percentile", ...U], { values: { type: "string", description: "Numbers separated by commas, spaces or new lines", required: true, example: "12, 15, 15, 18, 21, 24, 30, 45" } },
    { count: 8, sum: 180, mean: 22.5, median: 19.5, mode: [15], min: 12, max: 45, range: 33, variance: 101.25, stdDev: 10.0623058987, sampleVariance: 115.7142857143, sampleStdDev: 10.757057484, q1: 15, q3: 25.5, iqr: 10.5, p90: 34.5, p95: 39.75, p99: 43.95 },
    (_e, q) => {
      const parts = need(q, "values", 200_000).split(/[\s,;]+/).filter(Boolean);
      if (parts.length > 10_000) throw new HttpError(400, "at most 10,000 numbers");
      const values = parts.map((p) => { const v = Number(p); if (!Number.isFinite(v)) throw new HttpError(400, `not a number: ${p.slice(0, 30)}`); return v; });
      return stats(values);
    }),

  entry("/math/evaluate", "Math expression calculator: evaluate a formula safely",
    "Evaluate an arithmetic expression safely (parsed, never executed as code): + - * / % ^ and **, parentheses, factorial !, constants pi, e and tau, and functions sqrt, cbrt, abs, round, floor, ceil, exp, ln, log (base 10), log2, sin, cos, tan, asin, acos, atan (radians), min, max and pow. Up to 500 characters. Use when an agent needs exact arithmetic instead of guessing, for prices, unit maths or formulas.",
    ["math-expression", "calculator", "math", "evaluate", ...U], { expression: { type: "string", description: "The expression, such as (2+3)*4^2/sqrt(16)", required: true, example: "(1500 * 0.045 / 12) + sqrt(144) - 2^3" } },
    { expression: "(1500 * 0.045 / 12) + sqrt(144) - 2^3", value: 9.625, finite: true },
    (_e, q) => {
      const expression = need(q, "expression", 500);
      const value = evaluate(expression);
      return { expression, value: Number.isFinite(value) ? Math.round(value * 1e12) / 1e12 : null, finite: Number.isFinite(value), ...(Number.isFinite(value) ? {} : { note: Number.isNaN(value) ? "not a number (for example sqrt of a negative)" : "infinite (for example division by zero)" }) };
    }),

  entry("/date/zodiac", "Zodiac sign from a birth date: western and Chinese",
    "Western (tropical) zodiac sign with its element, and the Chinese zodiac animal and element of a birth date. The Chinese year is counted from the Gregorian year, so dates in January and early February before Chinese New Year are flagged as possibly the previous animal. Use for profile enrichment, greeting cards, games or horoscope-style content.",
    ["zodiac", "astrology", "chinese-zodiac", "birthday", "fun", ...U], { date: { type: "string", description: "Birth date, YYYY-MM-DD", required: true, example: "1990-08-15" } },
    { date: "1990-08-15", western: { sign: "Leo", element: "fire" }, chinese: { animal: "Horse", element: "Metal", year: 1990, nearNewYear: false } },
    (_e, q) => {
      const t = parseDay(need(q, "date", 20), "date");
      const d = new Date(t), y = d.getUTCFullYear(), m = d.getUTCMonth() + 1, day = d.getUTCDate();
      const sign = westernSign(m, day);
      return { date: ymd(t), western: { sign, element: ELEMENT[sign] }, chinese: { animal: ANIMALS[(((y - 4) % 12) + 12) % 12], element: ELEMENTS5[Math.floor((((y - 4) % 10) + 10) % 10 / 2)], year: y, nearNewYear: m === 1 || (m === 2 && day <= 20) } };
    }),
];
