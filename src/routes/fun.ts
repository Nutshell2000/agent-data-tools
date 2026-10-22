// Small "fun" endpoints. All randomness comes from crypto.getRandomValues; nothing is presented as fact.
import { entry, need, num, opt, type Entry } from "../family";
import { HttpError } from "../lib/env";

/** Unbiased random integer in [0, n). */
export function randInt(n: number): number {
  if (n <= 0) return 0;
  const limit = Math.floor(0x100000000 / n) * n;
  const buf = new Uint32Array(1);
  do crypto.getRandomValues(buf); while (buf[0] >= limit);
  return buf[0] % n;
}
const list = (raw: string) => raw.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);

const EIGHT_BALL = [
  "It is certain.", "It is decidedly so.", "Without a doubt.", "Yes, definitely.", "You may rely on it.", "As I see it, yes.", "Most likely.", "Outlook good.", "Yes.", "Signs point to yes.",
  "Reply hazy, try again.", "Ask again later.", "Better not tell you now.", "Cannot predict now.", "Concentrate and ask again.",
  "Don't count on it.", "My reply is no.", "My sources say no.", "Outlook not so good.", "Very doubtful.",
];
const F = ["fun", "random"];

export const FUN: Entry[] = [
  entry("/coin", "Flip a coin", "Flip one or more fair coins using a cryptographic random source. Returns each result and the totals. Use for fair decisions and games.",
    ["coin", ...F], { count: { type: "integer", description: "How many coins (1-100, default 1)", example: 1 } }, { flips: ["heads"], heads: 1, tails: 0 },
    (_e, q) => { const flips = Array.from({ length: num(q, "count", { min: 1, max: 100, fallback: 1, integer: true }) }, () => (randInt(2) ? "heads" : "tails")); return { flips, heads: flips.filter((f) => f === "heads").length, tails: flips.filter((f) => f === "tails").length }; }),
  entry("/dice", "Roll dice", "Roll dice in standard notation such as 2d6+3 or 1d20, up to 100 dice of up to 1000 sides, with a cryptographic random source. Returns every roll, the modifier and the total. Use for tabletop games and simulations.",
    ["dice", "games", ...F], { roll: { type: "string", description: "Dice notation, e.g. 2d6+3 (default 1d6)", example: "2d6+3" } }, { roll: "2d6+3", rolls: [4, 6], modifier: 3, total: 13 },
    (_e, q) => { const r = (opt(q, "roll", 20) ?? "1d6").replace(/\s/g, "").toLowerCase(); const m = /^(\d{0,3})d(\d{1,4})([+-]\d{1,5})?$/.exec(r); if (!m) throw new HttpError(400, "roll must look like 1d20 or 2d6+3"); const n = Number(m[1] || 1), sides = Number(m[2]), mod = Number(m[3] ?? 0); if (n < 1 || n > 100 || sides < 2 || sides > 1000) throw new HttpError(400, "1-100 dice with 2-1000 sides"); const rolls = Array.from({ length: n }, () => randInt(sides) + 1); return { roll: r, rolls, modifier: mod, total: rolls.reduce((a, b) => a + b, 0) + mod }; }),
  entry("/random/number", "Random number", "One or more random whole numbers in a range (inclusive), optionally all different, from a cryptographic random source. Use for draws, sampling and games.",
    ["number", ...F], { min: { type: "integer", description: "Lowest value (default 1)", example: 1 }, max: { type: "integer", description: "Highest value (default 100)", example: 100 }, count: { type: "integer", description: "How many (1-1000, default 1)", example: 3 }, unique: { type: "string", description: "true for no repeats", example: "true" } }, { numbers: [42, 7, 93] },
    (_e, q) => { const min = num(q, "min", { min: -1e12, max: 1e12, fallback: 1, integer: true }), max = num(q, "max", { min: -1e12, max: 1e12, fallback: 100, integer: true }); if (max < min) throw new HttpError(400, "max must be at least min"); const count = num(q, "count", { min: 1, max: 1000, fallback: 1, integer: true }); const span = max - min + 1; if (span > 2 ** 32) throw new HttpError(400, "range is too wide (at most 4,294,967,296 values)"); const unique = q("unique") === "true"; if (unique && count > span) throw new HttpError(400, "not enough distinct values in the range"); const out: number[] = []; const seen = new Set<number>(); while (out.length < count) { const v = min + randInt(span); if (unique && seen.has(v)) continue; seen.add(v); out.push(v); } return { numbers: out }; }),
  entry("/random/pick", "Pick at random from a list", "Pick one or more items at random (without repeats) from a comma- or line-separated list. Use for raffles, choosing who goes first, or breaking ties fairly.",
    ["pick", "raffle", ...F], { items: { type: "string", description: "Comma-separated items", required: true, example: "Ada,Alan,Grace,Linus" }, count: { type: "integer", description: "How many to pick (default 1)", example: 1 } }, { picked: ["Grace"], from: 4 },
    (_e, q) => { const items = list(need(q, "items", 20_000)); const n = num(q, "count", { min: 1, max: items.length || 1, fallback: 1, integer: true }); const pool = [...items]; const picked: string[] = []; while (picked.length < n && pool.length) picked.push(pool.splice(randInt(pool.length), 1)[0]); return { picked, from: items.length }; }),
  entry("/random/shuffle", "Shuffle a list", "Shuffle a comma- or line-separated list into a random order (Fisher-Yates with a cryptographic random source). Use for draw orders, seating and playlists.",
    ["shuffle", ...F], { items: { type: "string", description: "Comma-separated items", required: true, example: "1,2,3,4,5" } }, { shuffled: ["3", "5", "1", "4", "2"] },
    (_e, q) => { const a = list(need(q, "items", 20_000)); for (let i = a.length - 1; i > 0; i--) { const j = randInt(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return { shuffled: a }; }),
  entry("/random/teams", "Split people into teams", "Split a list of names into a given number of random, evenly sized teams. Use for games, workshops and classrooms.",
    ["teams", ...F], { items: { type: "string", description: "Comma-separated names", required: true, example: "Ada,Alan,Grace,Linus,Margaret,Tim" }, teams: { type: "integer", description: "Number of teams (default 2)", example: 2 } }, { teams: [["Grace", "Tim", "Ada"], ["Linus", "Alan", "Margaret"]] },
    (_e, q) => { const a = list(need(q, "items", 20_000)); const t = num(q, "teams", { min: 2, max: Math.max(2, a.length), fallback: 2, integer: true }); for (let i = a.length - 1; i > 0; i--) { const j = randInt(i + 1); [a[i], a[j]] = [a[j], a[i]]; } const out: string[][] = Array.from({ length: t }, () => []); a.forEach((x, i) => out[i % t].push(x)); return { teams: out }; }),
  entry("/magic-8-ball", "Magic 8-ball", "Ask a yes-or-no question and get one of the 20 classic Magic 8-Ball answers, chosen at random. For fun only. Use for games and chat bots.",
    ["8ball", "games", ...F], { question: { type: "string", description: "Your question (optional, not stored)", example: "Will it ship today?" } }, { question: "Will it ship today?", answer: "Signs point to yes.", kind: "positive" },
    (_e, q) => { const i = randInt(EIGHT_BALL.length); return { question: opt(q, "question", 500) ?? null, answer: EIGHT_BALL[i], kind: i < 10 ? "positive" : i < 15 ? "non-committal" : "negative" }; }),
  entry("/random/password", "Password generator", "Generate strong random passwords or passphrase-style strings: choose length and character sets, from a cryptographic random source. Generated on demand; nothing is stored or logged. Use when creating accounts or secrets.",
    ["password", "security", ...F], { length: { type: "integer", description: "8-128 characters (default 20)", example: 20 }, symbols: { type: "string", description: "false to leave out symbols", example: "true" }, count: { type: "integer", description: "How many (1-20, default 1)", example: 1 } }, { passwords: ["q7#Lx9v!Tz2@pW4m$Rk8"], entropyBits: 130 },
    (_e, q) => { const len = num(q, "length", { min: 8, max: 128, fallback: 20, integer: true }); const sets = ["abcdefghijkmnopqrstuvwxyz", "ABCDEFGHJKLMNPQRSTUVWXYZ", "23456789", ...(q("symbols") === "false" ? [] : ["!@#$%^&*-_=+?"])]; const all = sets.join(""); const make = () => { const chars = sets.map((s) => s[randInt(s.length)]); while (chars.length < len) chars.push(all[randInt(all.length)]); for (let i = chars.length - 1; i > 0; i--) { const j = randInt(i + 1); [chars[i], chars[j]] = [chars[j], chars[i]]; } return chars.join(""); }; return { passwords: Array.from({ length: num(q, "count", { min: 1, max: 20, fallback: 1, integer: true }) }, make), entropyBits: Math.floor(len * Math.log2(all.length)) }; }),
  entry("/random/color", "Random colour", "One or more random colours in hex, RGB and HSL, optionally limited to pastel or dark tones. Use for placeholders, avatars and design ideas.",
    ["color", "design", ...F], { count: { type: "integer", description: "How many (1-50, default 1)", example: 3 }, tone: { type: "string", description: "any (default), pastel or dark", example: "pastel" } }, { colors: [{ hex: "#a7c7e7", rgb: "rgb(167, 199, 231)", hsl: "hsl(210, 60%, 78%)" }] },
    (_e, q) => { const tone = (opt(q, "tone", 10) ?? "any").toLowerCase(); const make = () => { const h = randInt(360); const s = tone === "pastel" ? 45 + randInt(30) : 40 + randInt(60); const l = tone === "pastel" ? 75 + randInt(12) : tone === "dark" ? 15 + randInt(20) : 25 + randInt(55); const k = (n: number) => (n + h / 30) % 12; const a = (s / 100) * Math.min(l / 100, 1 - l / 100); const f = (n: number) => Math.round(255 * (l / 100 - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1)))); const rgb = [f(0), f(8), f(4)]; return { hex: `#${rgb.map((v) => v.toString(16).padStart(2, "0")).join("")}`, rgb: `rgb(${rgb.join(", ")})`, hsl: `hsl(${h}, ${s}%, ${l}%)` }; }; return { colors: Array.from({ length: num(q, "count", { min: 1, max: 50, fallback: 1, integer: true }) }, make) }; }),
  entry("/yes-no", "Yes or no", "A fair random yes or no, with a cryptographic random source. For quick decisions when the options are equally good. Use to break ties.",
    ["decision", ...F], {}, { answer: "yes" },
    () => ({ answer: randInt(2) ? "yes" : "no" })),
];
