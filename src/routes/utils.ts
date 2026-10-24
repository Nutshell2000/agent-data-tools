// Text and data utilities computed locally: no outside services, so fast and nearly never failing.
// Inputs are size-capped to stay well inside a Worker's CPU budget.
import { entry, flag, need, num, opt, pick, type Entry, type Input } from "../family";
import { HttpError } from "../lib/env";

const MAX = 20_000;

// ---------- JSON / CSV ----------
function parseJson(text: string) {
  try {
    return { ok: true as const, value: JSON.parse(text) };
  } catch (e) {
    const m = /position (\d+)/.exec(String((e as Error).message));
    const pos = m ? Number(m[1]) : null;
    let line = null, column = null;
    if (pos !== null) {
      const before = text.slice(0, pos).split("\n");
      line = before.length;
      column = before[before.length - 1].length + 1;
    }
    return { ok: false as const, error: String((e as Error).message), position: pos, line, column };
  }
}

/** Best-effort repair of JSON as LLMs write it: code fences, comments, trailing commas, single quotes, unquoted keys, Python literals. */
export function repairJson(input: string): string {
  try { JSON.parse(input); return input; } catch { /* Repair only invalid input. */ }
  let s = input.trim();
  const fence = /```(?:json|JSON)?\s*([\s\S]*?)```/.exec(s);
  if (fence) s = fence[1].trim();
  // Keep only the outermost object or array if there is surrounding prose.
  const start = s.search(/[[{]/);
  if (start > 0) s = s.slice(start);
  const lastClose = Math.max(s.lastIndexOf("}"), s.lastIndexOf("]"));
  if (lastClose >= 0 && lastClose < s.length - 1) s = s.slice(0, lastClose + 1);
  let out = "";
  let inStr: string | null = null;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (ch === "\\") { out += inStr === "'" && s[i + 1] === "'" ? "'" : ch + (s[i + 1] ?? ""); i++; continue; }
      if (ch === inStr) { out += '"'; inStr = null; continue; }
      if (ch === '"' && inStr === "'") { out += '\\"'; continue; }
      if (ch === "\n") { out += "\\n"; continue; }
      out += ch;
      continue;
    }
    if (ch === '"' || ch === "'") { inStr = ch; out += '"'; continue; }
    if (ch === "/" && s[i + 1] === "/") { while (i < s.length && s[i] !== "\n") i++; continue; }
    if (ch === "/" && s[i + 1] === "*") { i = s.indexOf("*/", i + 2); if (i < 0) break; i++; continue; }
    out += ch;
  }
  if (inStr) out += '"';
  // Syntax corrections must never rewrite literal data inside quoted strings.
  const syntax = (v: string) => v
    .replace(/\b(True|False|None)\b(?!\s*:)/g, word => word === "True" ? "true" : word === "False" ? "false" : "null")
    .replace(/([{,]\s*)([A-Za-z_$][\w$]*)(\s*:)/g, '$1"$2"$3')
    .replace(/,\s*([}\]])/g, "$1");
  let corrected = "", outside = "";
  for (let i = 0; i < out.length; i++) {
    if (out[i] !== '"') { outside += out[i]; continue; }
    corrected += syntax(outside); outside = "";
    const start = i++;
    while (i < out.length && out[i] !== '"') { if (out[i] === "\\") i++; i++; }
    corrected += out.slice(start, i + 1);
  }
  out = corrected + syntax(outside);
  // Close brackets left open.
  const stack: string[] = [];
  let q = false;
  for (let i = 0; i < out.length; i++) {
    const ch = out[i];
    if (q) { if (ch === "\\") i++; else if (ch === '"') q = false; continue; }
    if (ch === '"') q = true;
    else if (ch === "{" || ch === "[") stack.push(ch === "{" ? "}" : "]");
    else if (ch === "}" || ch === "]") stack.pop();
  }
  return out.replace(/,\s*$/, "") + stack.reverse().join("");
}

export function parseCsv(text: string, delimiter?: string): string[][] {
  const first = text.split(/\r?\n/, 1)[0] ?? "";
  const d = delimiter ?? [",", ";", "\t", "|"].sort((a, b) => first.split(b).length - first.split(a).length)[0];
  const rows: string[][] = [];
  let row: string[] = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"' && field === "") quoted = true;
    else if (ch === d) { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((v) => v !== "")) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((v) => v !== "")) rows.push(row);
  return rows;
}
const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

// ---------- Encoding / hashing ----------
const b64encode = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));
function b64decode(s: string) {
  const clean = s.trim().replace(/-/g, "+").replace(/_/g, "/").replace(/\s+/g, "");
  try {
    const bin = atob(clean + "=".repeat((4 - (clean.length % 4)) % 4));
    return new TextDecoder("utf-8").decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
  } catch {
    throw new HttpError(400, "text is not valid base64");
  }
}
const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
const ALGOS = { sha1: "SHA-1", sha256: "SHA-256", sha384: "SHA-384", sha512: "SHA-512" } as const;

// ---------- Text ----------
const words = (t: string) => t.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? [];
function syllables(word: string) {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (w.length <= 3) return 1;
  const m = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "").replace(/^y/, "").match(/[aeiouy]{1,2}/g);
  return Math.max(1, m?.length ?? 1);
}
function splitWords(t: string) {
  return t.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_\-./]+/g, " ").trim().split(/\s+/).filter(Boolean);
}
export function convertCase(t: string, to: string) {
  const w = splitWords(t);
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
  switch (to) {
    case "camel": return w.map((x, i) => (i ? cap(x) : x.toLowerCase())).join("");
    case "pascal": return w.map(cap).join("");
    case "snake": return w.map((x) => x.toLowerCase()).join("_");
    case "kebab": return w.map((x) => x.toLowerCase()).join("-");
    case "constant": return w.map((x) => x.toUpperCase()).join("_");
    case "title": return t.toLowerCase().replace(/(^|\s)(\p{L})/gu, (m, s, c) => s + c.toUpperCase());
    case "upper": return t.toUpperCase();
    case "lower": return t.toLowerCase();
    case "sentence": return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
    default: throw new HttpError(400, "unknown case");
  }
}
export function slugify(t: string, sep = "-") {
  return t.normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/ß/g, "ss").replace(/[æÆ]/g, "ae").replace(/[øØ]/g, "o")
    .toLowerCase().replace(/[^a-z0-9]+/g, sep).replace(new RegExp(`^\\${sep}+|\\${sep}+$`, "g"), "");
}

// ---------- Numbers ----------
const ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
const SCALES = ["", "thousand", "million", "billion", "trillion"];
export function numberToWords(n: number): string {
  if (n < 0) return `minus ${numberToWords(-n)}`;
  if (n < 20) return ONES[n];
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? `-${ONES[n % 10]}` : "");
  if (n < 1000) return `${ONES[Math.floor(n / 100)]} hundred${n % 100 ? ` ${numberToWords(n % 100)}` : ""}`;
  const parts: string[] = [];
  let i = 0;
  while (n > 0) {
    const chunk = n % 1000;
    if (chunk) parts.unshift(`${numberToWords(chunk)}${SCALES[i] ? ` ${SCALES[i]}` : ""}`);
    n = Math.floor(n / 1000);
    i++;
  }
  return parts.join(" ");
}
const ROMAN: [number, string][] = [[1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"], [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]];
export function toRoman(n: number) { let out = ""; for (const [v, s] of ROMAN) while (n >= v) { out += s; n -= v; } return out; }
export function fromRoman(s: string) {
  const r = s.toUpperCase();
  if (!/^M{0,3}(CM|CD|D?C{0,3})(XC|XL|L?X{0,3})(IX|IV|V?I{0,3})$/.test(r) || !r) throw new HttpError(400, "not a valid Roman numeral (1-3999)");
  let i = 0, n = 0;
  for (const [v, sym] of ROMAN) while (r.startsWith(sym, i)) { n += v; i += sym.length; }
  return n;
}

// ---------- Validators ----------
export function luhn(digits: string) {
  let sum = 0, dbl = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = Number(digits[i]);
    if (dbl) { d *= 2; if (d > 9) d -= 9; }
    sum += d; dbl = !dbl;
  }
  return sum % 10 === 0;
}
const IBAN_LENGTHS: Record<string, number> = { AD: 24, AE: 23, AT: 20, BE: 16, BG: 22, BH: 22, BR: 29, CH: 21, CY: 28, CZ: 24, DE: 22, DK: 18, EE: 20, ES: 24, FI: 18, FO: 18, FR: 27, GB: 22, GI: 23, GL: 18, GR: 27, HR: 21, HU: 28, IE: 22, IL: 23, IS: 26, IT: 27, KW: 30, KZ: 20, LB: 28, LI: 21, LT: 20, LU: 20, LV: 21, MC: 27, ME: 22, MK: 19, MT: 31, MU: 30, NL: 18, NO: 15, PL: 28, PT: 25, QA: 29, RO: 24, RS: 22, SA: 24, SE: 24, SI: 19, SK: 24, SM: 27, TN: 24, TR: 26, UA: 29 };
export function ibanCheck(raw: string) {
  const iban = raw.replace(/\s+/g, "").toUpperCase();
  const country = iban.slice(0, 2);
  const reasons: string[] = [];
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(iban)) reasons.push("format must be 2 letters, 2 check digits, then letters and digits");
  const expected = IBAN_LENGTHS[country];
  if (!expected) reasons.push(`country ${country} is not in the IBAN registry list used here`);
  else if (iban.length !== expected) reasons.push(`${country} IBANs have ${expected} characters, this has ${iban.length}`);
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  const digits = rearranged.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let rem = 0;
  for (const d of digits) rem = (rem * 10 + Number(d)) % 97;
  if (rem !== 1) reasons.push("check digits do not match");
  return { iban, country, valid: reasons.length === 0, reasons, formatted: iban.replace(/(.{4})/g, "$1 ").trim() };
}
export function isbnCheck(raw: string) {
  const s = raw.replace(/[\s-]/g, "").toUpperCase();
  if (/^\d{9}[\dX]$/.test(s)) {
    const sum = [...s].reduce((acc, ch, i) => acc + (ch === "X" ? 10 : Number(ch)) * (10 - i), 0);
    const valid = sum % 11 === 0;
    const isbn13 = valid ? (() => { const b = `978${s.slice(0, 9)}`; const c = (10 - ([...b].reduce((a, d, i) => a + Number(d) * (i % 2 ? 3 : 1), 0) % 10)) % 10; return b + c; })() : null;
    return { isbn: s, type: "ISBN-10", valid, isbn13 };
  }
  if (/^\d{13}$/.test(s)) {
    const sum = [...s].reduce((acc, d, i) => acc + Number(d) * (i % 2 ? 3 : 1), 0);
    return { isbn: s, type: "ISBN-13", valid: sum % 10 === 0, isbn13: s };
  }
  return { isbn: s, type: null, valid: false, isbn13: null };
}

// ---------- Dates ----------
function date(q: Input, name: string, fallbackNow = false): Date {
  const v = q(name)?.trim();
  if (!v) { if (fallbackNow) return new Date(); throw new HttpError(400, `${name} is required (ISO date like 2026-10-18)`); }
  const d = /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T00:00:00Z`) : new Date(v);
  if (Number.isNaN(d.getTime())) throw new HttpError(400, `${name} is not a valid date`);
  return d;
}
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const isWeekend = (d: Date) => d.getUTCDay() === 0 || d.getUTCDay() === 6;
function isoWeek(d: Date) {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return { year: t.getUTCFullYear(), week: Math.ceil(((t.getTime() - y.getTime()) / 864e5 + 1) / 7) };
}

/** Next run times of a 5-field cron expression (minute hour day month weekday), in UTC. */
export function cronNext(expr: string, from: Date, count: number): string[] {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) throw new HttpError(400, "cron must have 5 fields: minute hour day-of-month month day-of-week");
  const ranges: [number, number][] = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 6]];
  const names = [null, null, null, ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"], ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"]];
  const sets = fields.map((f, idx) => {
    const [lo, hi] = ranges[idx];
    const set = new Set<number>();
    for (const part of f.toUpperCase().split(",")) {
      const [rangePart, stepPart] = part.split("/");
      const step = stepPart ? Number(stepPart) : 1;
      if (!Number.isInteger(step) || step < 1) throw new HttpError(400, `bad step in "${part}"`);
      const val = (s: string) => { const nm = names[idx]?.indexOf(s); const n = nm !== undefined && nm >= 0 ? nm + (idx === 3 ? 1 : 0) : Number(s); if (!Number.isInteger(n)) throw new HttpError(400, `bad value "${s}"`); return idx === 4 && n === 7 ? 0 : n; };
      let a = lo, b = hi;
      if (rangePart !== "*") { const [x, y] = rangePart.split("-"); a = val(x); b = y !== undefined ? val(y) : stepPart ? hi : a; }
      if (a < lo || b > hi || a > b) throw new HttpError(400, `value out of range in "${part}"`);
      for (let v = a; v <= b; v += step) set.add(v);
    }
    return set;
  });
  const [min, hr, dom, mon, dow] = sets;
  const domAll = fields[2] === "*", dowAll = fields[4] === "*";
  const out: string[] = [];
  const t = new Date(from.getTime());
  t.setUTCSeconds(0, 0);
  t.setUTCMinutes(t.getUTCMinutes() + 1);
  for (let guard = 0; guard < 600_000 && out.length < count; guard++) {
    if (!mon.has(t.getUTCMonth() + 1)) { t.setUTCMonth(t.getUTCMonth() + 1, 1); t.setUTCHours(0, 0); continue; }
    const dayOk = domAll && dowAll ? true : domAll ? dow.has(t.getUTCDay()) : dowAll ? dom.has(t.getUTCDate()) : dom.has(t.getUTCDate()) || dow.has(t.getUTCDay());
    if (!dayOk) { t.setUTCDate(t.getUTCDate() + 1); t.setUTCHours(0, 0); continue; }
    if (!hr.has(t.getUTCHours())) { t.setUTCHours(t.getUTCHours() + 1, 0); continue; }
    if (!min.has(t.getUTCMinutes())) { t.setUTCMinutes(t.getUTCMinutes() + 1); continue; }
    out.push(t.toISOString());
    t.setUTCMinutes(t.getUTCMinutes() + 1);
  }
  return out;
}

// ---------- Units ----------
const UNITS: Record<string, Record<string, number>> = {
  length: { mm: 0.001, cm: 0.01, m: 1, km: 1000, in: 0.0254, ft: 0.3048, yd: 0.9144, mi: 1609.344, nmi: 1852 },
  mass: { mg: 1e-6, g: 0.001, kg: 1, t: 1000, oz: 0.028349523125, lb: 0.45359237, st: 6.35029318 },
  volume: { ml: 0.001, l: 1, m3: 1000, tsp: 0.00492892159375, tbsp: 0.01478676478125, floz: 0.0295735295625, cup: 0.2365882365, pt: 0.473176473, qt: 0.946352946, gal: 3.785411784 },
  speed: { "m/s": 1, "km/h": 1 / 3.6, mph: 0.44704, kn: 0.514444444, "ft/s": 0.3048 },
  area: { mm2: 1e-6, cm2: 1e-4, m2: 1, ha: 1e4, km2: 1e6, in2: 0.00064516, ft2: 0.09290304, yd2: 0.83612736, acre: 4046.8564224, mi2: 2589988.110336 },
  data: { b: 1, kb: 1e3, mb: 1e6, gb: 1e9, tb: 1e12, kib: 1024, mib: 1024 ** 2, gib: 1024 ** 3, tib: 1024 ** 4 },
  time: { ms: 0.001, s: 1, min: 60, h: 3600, d: 86400, wk: 604800 },
  energy: { j: 1, kj: 1e3, cal: 4.184, kcal: 4184, wh: 3600, kwh: 3.6e6 },
  pressure: { pa: 1, kpa: 1e3, bar: 1e5, psi: 6894.757293168, atm: 101325, mmhg: 133.322387415 },
};
function temperature(v: number, from: string, to: string) {
  const c = from === "c" ? v : from === "f" ? (v - 32) * (5 / 9) : v - 273.15;
  return to === "c" ? c : to === "f" ? c * (9 / 5) + 32 : c + 273.15;
}
export function convertUnit(value: number, fromRaw: string, toRaw: string) {
  const from = fromRaw.toLowerCase(), to = toRaw.toLowerCase();
  if (["c", "f", "k"].includes(from) && ["c", "f", "k"].includes(to)) return { kind: "temperature", result: temperature(value, from, to) };
  for (const [kind, table] of Object.entries(UNITS)) {
    if (from in table && to in table) return { kind, result: (value * table[from]) / table[to] };
  }
  throw new HttpError(400, `cannot convert ${fromRaw} to ${toRaw}; units must be of the same kind`);
}

// ---------- Colours ----------
function parseColour(s: string) {
  const t = s.trim().toLowerCase();
  let m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/.exec(t);
  if (m) { const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join("") : m[1]; return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)); }
  m = /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/.exec(t);
  if (m) return m.slice(1, 4).map(Number).map((v) => Math.min(255, v));
  m = /^hsl\(\s*(\d{1,3}(?:\.\d+)?)\s*,\s*(\d{1,3}(?:\.\d+)?)%\s*,\s*(\d{1,3}(?:\.\d+)?)%\s*\)$/.exec(t);
  if (m) {
    const h = Number(m[1]) / 360, sat = Number(m[2]) / 100, l = Number(m[3]) / 100;
    const f = (n: number) => { const k = (n + h * 12) % 12; const a = sat * Math.min(l, 1 - l); return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))); };
    return [f(0), f(8), f(4)];
  }
  throw new HttpError(400, "colour must be #rgb, #rrggbb, rgb(r,g,b) or hsl(h,s%,l%)");
}
function colourInfo(rgb: number[]) {
  const [r, g, b] = rgb.map((v) => v / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  let h = 0, s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h *= 60;
  }
  return { hex: `#${rgb.map((v) => v.toString(16).padStart(2, "0")).join("")}`, rgb: `rgb(${rgb.join(", ")})`, hsl: `hsl(${Math.round(h)}, ${Math.round(s * 100)}%, ${Math.round(l * 100)}%)`, r: rgb[0], g: rgb[1], b: rgb[2] };
}
const luminance = (rgb: number[]) => { const [r, g, b] = rgb.map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };

// ---------- Network ----------
function ipv4ToInt(ip: string) {
  const p = ip.split(".");
  if (p.length !== 4 || p.some((x) => !/^\d{1,3}$/.test(x) || Number(x) > 255)) throw new HttpError(400, `${ip} is not an IPv4 address`);
  return p.reduce((a, x) => a * 256 + Number(x), 0);
}
const intToIpv4 = (n: number) => [24, 16, 8, 0].map((s) => Math.floor(n / 2 ** s) % 256).join(".");
function cidr(raw: string) {
  const [ip, bitsRaw] = raw.trim().split("/");
  const bits = Number(bitsRaw ?? 32);
  if (!Number.isInteger(bits) || bits < 0 || bits > 32) throw new HttpError(400, "prefix must be /0 to /32");
  const size = 2 ** (32 - bits);
  const base = Math.floor(ipv4ToInt(ip) / size) * size;
  return { network: intToIpv4(base), broadcast: intToIpv4(base + size - 1), first: intToIpv4(bits >= 31 ? base : base + 1), last: intToIpv4(bits >= 31 ? base + size - 1 : base + size - 2), prefix: bits, netmask: intToIpv4(size === 2 ** 32 ? 0 : 2 ** 32 - size), addresses: size, usableHosts: bits >= 31 ? size : size - 2, base };
}
const PRIVATE = [["10.0.0.0", 8], ["172.16.0.0", 12], ["192.168.0.0", 16], ["127.0.0.0", 8], ["169.254.0.0", 16], ["100.64.0.0", 10]] as const;

// ---------- Semver ----------
function semver(v: string) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(v.trim());
  if (!m) throw new HttpError(400, `${v} is not a semantic version (like 1.2.3)`);
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]), pre: m[4] ? m[4].split(".") : [] };
}
function semverCompare(a: string, b: string) {
  const x = semver(a), y = semver(b);
  for (const k of ["major", "minor", "patch"] as const) if (x[k] !== y[k]) return x[k] > y[k] ? 1 : -1;
  if (!x.pre.length && y.pre.length) return 1;
  if (x.pre.length && !y.pre.length) return -1;
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i], r = y.pre[i];
    if (p === undefined) return -1;
    if (r === undefined) return 1;
    if (p === r) continue;
    const pn = /^\d+$/.test(p), rn = /^\d+$/.test(r);
    if (pn && rn) return Number(p) > Number(r) ? 1 : -1;
    if (pn) return -1;
    if (rn) return 1;
    return p > r ? 1 : -1;
  }
  return 0;
}

// ---------- Diff ----------
export function lineDiff(a: string, b: string) {
  const A = a.split("\n"), B = b.split("\n");
  if (A.length * B.length > 250_000) throw new HttpError(400, "texts are too long to compare (about 500 lines each at most)");
  const dp = Array.from({ length: A.length + 1 }, () => new Uint16Array(B.length + 1));
  for (let i = A.length - 1; i >= 0; i--) for (let j = B.length - 1; j >= 0; j--) dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: { op: "=" | "-" | "+"; line: string }[] = [];
  let i = 0, j = 0;
  while (i < A.length && j < B.length) {
    if (A[i] === B[j]) { out.push({ op: "=", line: A[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) out.push({ op: "-", line: A[i++] });
    else out.push({ op: "+", line: B[j++] });
  }
  while (i < A.length) out.push({ op: "-", line: A[i++] });
  while (j < B.length) out.push({ op: "+", line: B[j++] });
  return out;
}

// ---------- Markdown (common subset) ----------
const escHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
function inlineMd(s: string) {
  return escHtml(s)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, '<img alt="$1" src="$2">')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, t, u) => (/^(https?:|mailto:|\/|#)/i.test(u) ? `<a href="${u}">${t}</a>` : t))
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>")
    .replace(/~~([^~]+)~~/g, "<del>$1</del>");
}
export function markdownToHtml(md: string) {
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^```/.test(line)) {
      const lang = line.slice(3).trim();
      const code: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) code.push(lines[i++]);
      i++;
      out.push(`<pre><code${lang ? ` class="language-${escHtml(lang)}"` : ""}>${escHtml(code.join("\n"))}</code></pre>`);
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) { out.push(`<h${h[1].length}>${inlineMd(h[2])}</h${h[1].length}>`); i++; continue; }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { out.push("<hr>"); i++; continue; }
    if (/^\s*[-*+]\s+/.test(line) || /^\s*\d+[.)]\s+/.test(line)) {
      const ordered = /^\s*\d/.test(line);
      const items: string[] = [];
      while (i < lines.length && (ordered ? /^\s*\d+[.)]\s+/ : /^\s*[-*+]\s+/).test(lines[i])) items.push(`<li>${inlineMd(lines[i++].replace(/^\s*(?:[-*+]|\d+[.)])\s+/, ""))}</li>`);
      out.push(`<${ordered ? "ol" : "ul"}>${items.join("")}</${ordered ? "ol" : "ul"}>`);
      continue;
    }
    if (/^>\s?/.test(line)) {
      const q: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) q.push(lines[i++].replace(/^>\s?/, ""));
      out.push(`<blockquote><p>${inlineMd(q.join(" "))}</p></blockquote>`);
      continue;
    }
    if (!line.trim()) { i++; continue; }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|```|>|\s*[-*+]\s|\s*\d+[.)]\s)/.test(lines[i])) para.push(lines[i++]);
    out.push(`<p>${inlineMd(para.join(" "))}</p>`);
  }
  return out.join("\n");
}
export function htmlToText(html: string) {
  return html
    .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|h[1-6]|li|tr|blockquote|pre|section|article)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ").replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (m, d) => String.fromCodePoint(Number(d)))
    .replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

const HTTP_STATUS: Record<number, [string, string]> = {
  200: ["OK", "The request succeeded."], 201: ["Created", "A new resource was created."], 202: ["Accepted", "Accepted for processing, not finished yet."], 204: ["No Content", "Succeeded with no body."],
  301: ["Moved Permanently", "Use the URL in the Location header from now on."], 302: ["Found", "Temporarily at the URL in the Location header."], 304: ["Not Modified", "Your cached copy is still valid."], 307: ["Temporary Redirect", "Repeat the same request at the Location URL."], 308: ["Permanent Redirect", "Repeat the same request at the Location URL from now on."],
  400: ["Bad Request", "The request was malformed or had invalid input."], 401: ["Unauthorized", "Authentication is missing or invalid."], 402: ["Payment Required", "Payment is needed; with x402 the body or headers say how to pay."], 403: ["Forbidden", "Authenticated but not allowed."], 404: ["Not Found", "Nothing exists at this URL."], 405: ["Method Not Allowed", "This URL does not accept that HTTP method."], 408: ["Request Timeout", "The server gave up waiting for the request."], 409: ["Conflict", "Conflicts with the current state of the resource."], 410: ["Gone", "Removed permanently."], 413: ["Content Too Large", "The request body is too big."], 415: ["Unsupported Media Type", "The body's content type is not accepted."], 422: ["Unprocessable Content", "Well-formed but semantically invalid."], 429: ["Too Many Requests", "Rate limited; wait (see Retry-After) and retry."],
  500: ["Internal Server Error", "The server failed unexpectedly."], 501: ["Not Implemented", "The server does not support this."], 502: ["Bad Gateway", "An upstream server sent a bad answer."], 503: ["Service Unavailable", "Temporarily overloaded or down; retry later."], 504: ["Gateway Timeout", "An upstream server did not answer in time."],
};
const MIME: Record<string, string> = { html: "text/html", htm: "text/html", css: "text/css", js: "text/javascript", mjs: "text/javascript", json: "application/json", xml: "application/xml", txt: "text/plain", csv: "text/csv", md: "text/markdown", pdf: "application/pdf", zip: "application/zip", gz: "application/gzip", tar: "application/x-tar", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", avif: "image/avif", svg: "image/svg+xml", ico: "image/vnd.microsoft.icon", mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", mp4: "video/mp4", webm: "video/webm", woff: "font/woff", woff2: "font/woff2", ttf: "font/ttf", otf: "font/otf", doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ppt: "application/vnd.ms-powerpoint", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation", wasm: "application/wasm", yaml: "application/yaml", yml: "application/yaml" };

// ---------- Catalog ----------
const T = (t: string, d: string) => ({ type: "string" as const, description: d, required: true, example: t });
const U = ["utility", "text"];

export const UTILS: Entry[] = [
  entry("/json/validate", "Validate JSON", "Check whether text is valid JSON. Returns valid true/false, the parsed value's type and size, and for invalid input the error message with line and column. Use before parsing an LLM's or an API's output.",
    ["json", ...U], { text: T('{"a":1}', "The JSON text to check (up to 20,000 characters)") }, { valid: true, type: "object", keys: 1 },
    (_e, q) => { const t = need(q, "text", MAX); const r = parseJson(t); return r.ok ? { valid: true, type: Array.isArray(r.value) ? "array" : r.value === null ? "null" : typeof r.value, keys: r.value && typeof r.value === "object" ? Object.keys(r.value).length : null } : { valid: false, error: r.error, line: r.line, column: r.column }; }),
  entry("/json/format", "Pretty-print JSON", "Format JSON with indentation (2 or 4 spaces, or tabs) and optionally sorted keys. Returns the formatted text. Use to make machine JSON readable or to normalise it for diffs.",
    ["json", ...U], { text: T('{"b":2,"a":1}', "The JSON text"), indent: { type: "string", description: "2 (default), 4 or tab", example: "2" }, sortKeys: { type: "string", description: "true to sort object keys", example: "true" } }, { formatted: '{\n  "a": 1,\n  "b": 2\n}' },
    (_e, q) => { const r = parseJson(need(q, "text", MAX)); if (!r.ok) throw new HttpError(422, `not valid JSON: ${r.error}`); const ind = q("indent") === "tab" ? "\t" : Number(q("indent") ?? 2) === 4 ? 4 : 2; const sort = (v: unknown): unknown => Array.isArray(v) ? v.map(sort) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sort((v as Record<string, unknown>)[k])])) : v; return { formatted: JSON.stringify(flag(q, "sortKeys") ? sort(r.value) : r.value, null, ind) }; }),
  entry("/json/minify", "Minify JSON", "Remove all unnecessary whitespace from JSON and report the size before and after. Use to shrink payloads or prompts.",
    ["json", ...U], { text: T('{ "a" : 1 }', "The JSON text") }, { minified: '{"a":1}', before: 11, after: 7 },
    (_e, q) => { const t = need(q, "text", MAX); const r = parseJson(t); if (!r.ok) throw new HttpError(422, `not valid JSON: ${r.error}`); const m = JSON.stringify(r.value); return { minified: m, before: t.length, after: m.length }; }),
  entry("/json/repair", "JSON repair: fix broken JSON", "Fix JSON as LLMs often write it: removes ```json fences and surrounding prose, comments and trailing commas, converts single quotes, quotes bare keys, maps True/False/None, and closes unclosed brackets. Returns the repaired JSON and whether it now parses. Use when an LLM's JSON output fails to parse.",
    ["json", "llm", ...U], { text: T("```json\n{name: 'Ada', tags: ['x',],}\n```", "The broken JSON text") }, { repaired: '{"name":"Ada","tags":["x"]}', valid: true },
    (_e, q) => { const fixed = repairJson(need(q, "text", MAX)); const r = parseJson(fixed); return { repaired: r.ok ? JSON.stringify(r.value) : fixed, valid: r.ok, error: r.ok ? null : r.error }; }),
  entry("/json/to-csv", "JSON array to CSV", "Convert a JSON array of objects to CSV with a header row built from all keys. Nested values are written as JSON. Use to export API results to a spreadsheet.",
    ["json", "csv", ...U], { text: T('[{"name":"Ada","age":36},{"name":"Alan","age":41}]', "A JSON array of objects") }, { csv: "name,age\nAda,36\nAlan,41", rows: 2, columns: 2 },
    (_e, q) => { const r = parseJson(need(q, "text", MAX)); if (!r.ok || !Array.isArray(r.value)) throw new HttpError(422, "text must be a JSON array of objects"); const rows = r.value as Record<string, unknown>[]; const cols = [...new Set(rows.flatMap((x) => (x && typeof x === "object" ? Object.keys(x) : [])))]; const csv = [cols.map(csvCell).join(","), ...rows.map((x) => cols.map((c) => csvCell(x?.[c])).join(","))].join("\n"); return { csv, rows: rows.length, columns: cols.length }; }),
  entry("/csv/to-json", "CSV to JSON", "Convert CSV (comma, semicolon, tab or pipe; delimiter detected automatically; quoted fields supported) to a JSON array of objects using the first row as keys. Numbers stay as text unless numbers=true. Use to load spreadsheet exports into an agent.",
    ["csv", "json", ...U], { text: T("name,age\nAda,36", "The CSV text, first row is the header"), numbers: { type: "string", description: "true to turn numeric cells into numbers", example: "true" } }, { rows: [{ name: "Ada", age: 36 }], count: 1, columns: ["name", "age"] },
    (_e, q) => { const rows = parseCsv(need(q, "text", MAX)); if (rows.length < 1) throw new HttpError(422, "no rows found"); const [h, ...body] = rows; const asNum = flag(q, "numbers"); return { rows: body.map((r) => Object.fromEntries(h.map((k, i) => { const v = r[i] ?? ""; return [k, asNum && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : v]; }))), count: body.length, columns: h }; }),
  entry("/base64/encode", "Base64 encode", "Encode UTF-8 text as standard base64, and also return the URL-safe variant. Use for data URLs, headers and basic auth strings.",
    ["base64", "encoding", ...U], { text: T("hello world", "The text to encode") }, { base64: "aGVsbG8gd29ybGQ=", base64url: "aGVsbG8gd29ybGQ" },
    (_e, q) => { const b = b64encode(need(q, "text", MAX)); return { base64: b, base64url: b.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "") }; }),
  entry("/base64/decode", "Base64 decode", "Decode standard or URL-safe base64 to UTF-8 text. Missing padding is tolerated. Use to read encoded headers, tokens and data URLs.",
    ["base64", "encoding", ...U], { text: T("aGVsbG8gd29ybGQ=", "The base64 text") }, { text: "hello world" },
    (_e, q) => ({ text: b64decode(need(q, "text", MAX)) })),
  entry("/url/encode", "URL encode", "Percent-encode text for use in a URL query value (encodeURIComponent) and as a full URL (encodeURI). Use when building query strings.",
    ["url", "encoding", ...U], { text: T("a b&c=d/é", "The text to encode") }, { component: "a%20b%26c%3Dd%2F%C3%A9", uri: "a%20b&c=d/%C3%A9" },
    (_e, q) => { const t = need(q, "text", MAX); return { component: encodeURIComponent(t), uri: encodeURI(t) }; }),
  entry("/url/decode", "URL decode", "Decode percent-encoded text, treating + as a space when plus=true (form encoding). Use to read encoded links and form data.",
    ["url", "encoding", ...U], { text: T("a%20b%26c", "The encoded text"), plus: { type: "string", description: "true to read + as space", example: "false" } }, { text: "a b&c" },
    (_e, q) => { const t = need(q, "text", MAX); try { return { text: decodeURIComponent(flag(q, "plus") ? t.replace(/\+/g, " ") : t) }; } catch { throw new HttpError(400, "text contains an invalid percent sequence"); } }),
  entry("/url/parse", "Parse a URL", "Split a URL into protocol, host, port, path, query parameters (as an object), hash and origin, and report whether the host is an IP address. Use to read query parameters or check a link's host.",
    ["url", ...U], { url: T("https://example.com:8080/a/b?x=1&y=2#top", "The URL to parse") }, { protocol: "https:", host: "example.com", port: "8080", path: "/a/b", query: { x: "1", y: "2" }, hash: "#top", origin: "https://example.com:8080", isIp: false },
    (_e, q) => { let u: URL; try { u = new URL(need(q, "url", 4000)); } catch { throw new HttpError(400, "url is not a valid absolute URL"); } const query: Record<string, string | string[]> = {}; u.searchParams.forEach((v, k) => { query[k] = k in query ? [...[query[k]].flat(), v] : v; }); return { protocol: u.protocol, host: u.hostname, port: u.port || null, path: u.pathname, query, hash: u.hash || null, origin: u.origin, isIp: /^\d+\.\d+\.\d+\.\d+$|^\[/.test(u.hostname) }; }),
  entry("/hash", "Hash text, SHA-256 hash", "Hash UTF-8 text with SHA-256 (default), SHA-1, SHA-384 or SHA-512 and return the digest in hex and base64. Use for checksums, cache keys and deduplication.",
    ["hash", "crypto", ...U], { text: T("hello", "The text to hash"), algorithm: { type: "string", description: "sha256 (default), sha1, sha384 or sha512", example: "sha256" } }, { algorithm: "sha256", hex: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824", base64: "LPJNul+wow4m6DsqxbninhsWHlwfp0JecwQzYpOLmCQ=" },
    async (_e, q) => { const algo = pick(q, "algorithm", ["sha256", "sha1", "sha384", "sha512"] as const, "sha256"); const d = await crypto.subtle.digest(ALGOS[algo], new TextEncoder().encode(need(q, "text", MAX))); return { algorithm: algo, hex: hex(d), base64: btoa(String.fromCharCode(...new Uint8Array(d))) }; }),
  entry("/hmac", "HMAC signature", "Compute an HMAC of a message with a key using SHA-256 (default), SHA-1, SHA-384 or SHA-512, in hex and base64. Use to check webhook signatures. The key is used only for this call and is not stored.",
    ["hmac", "crypto", "webhook", ...U], { message: T("hello", "The message"), key: T("secret", "The key"), algorithm: { type: "string", description: "sha256 (default), sha1, sha384 or sha512", example: "sha256" } }, { algorithm: "sha256", hex: "88aab3ede8d3adf94d26ab90d3bafd4a2083070c3bcce9c014ee04a443847c0b" },
    async (_e, q) => { const algo = pick(q, "algorithm", ["sha256", "sha1", "sha384", "sha512"] as const, "sha256"); const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(need(q, "key", 1000)), { name: "HMAC", hash: ALGOS[algo] }, false, ["sign"]); const s = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(need(q, "message", MAX))); return { algorithm: algo, hex: hex(s), base64: btoa(String.fromCharCode(...new Uint8Array(s))) }; }),
  entry("/uuid", "UUID generator", "Generate 1 to 100 random version-4 UUIDs from a cryptographic random source. Use for IDs, idempotency keys and test data.",
    ["uuid", "random", ...U], { count: { type: "integer", description: "How many (1-100, default 1)", example: 3 } }, { uuids: ["3b241101-e2bb-4255-8caf-4136c566a962"] },
    (_e, q) => ({ uuids: Array.from({ length: num(q, "count", { min: 1, max: 100, fallback: 1, integer: true }) }, () => crypto.randomUUID()) })),
  entry("/slug", "Slugify, make a URL slug", "Turn any text into a URL-friendly slug: accents removed (é→e, ß→ss), lower case, non-alphanumerics replaced by a separator (- by default). Use for file names, URLs and IDs.",
    ["slug", "url", ...U], { text: T("Crème Brûlée & Straße!", "The text"), separator: { type: "string", description: "- (default) or _", example: "-" } }, { slug: "creme-brulee-strasse" },
    (_e, q) => ({ slug: slugify(need(q, "text", 2000), q("separator") === "_" ? "_" : "-") })),
  entry("/case", "Case converter: camelCase, snake_case, kebab-case and more", "Convert text or identifiers between camelCase, PascalCase, snake_case, kebab-case, CONSTANT_CASE, Title Case, Sentence case, UPPER and lower. Handles mixed input like 'userID_value'. Use when renaming fields or generating code identifiers.",
    ["case", ...U], { text: T("user profile id", "The text"), to: T("camel", "camel, pascal, snake, kebab, constant, title, sentence, upper or lower") }, { result: "userProfileId" },
    (_e, q) => ({ result: convertCase(need(q, "text", MAX), pick(q, "to", ["camel", "pascal", "snake", "kebab", "constant", "title", "sentence", "upper", "lower"] as const)) })),
  entry("/text/stats", "Word count and readability", "Count characters, words, sentences and paragraphs, estimate reading and speaking time, and compute the Flesch reading-ease score and grade level for English text. Use to check the length and readability of a draft.",
    ["text", "readability", ...U], { text: T("The quick brown fox jumps over the lazy dog. It was not amused.", "The text") }, { characters: 63, words: 13, sentences: 2, paragraphs: 1, readingSeconds: 3, speakingSeconds: 6, fleschReadingEase: 94.3, fleschKincaidGrade: 2.3 },
    (_e, q) => { const t = need(q, "text", 50_000); const w = words(t); const sentences = Math.max(1, (t.match(/[.!?]+(\s|$)/g) ?? []).length); const syl = w.reduce((a, x) => a + syllables(x), 0); const wc = Math.max(1, w.length); return { characters: t.length, charactersNoSpaces: t.replace(/\s/g, "").length, words: w.length, sentences, paragraphs: t.split(/\n\s*\n/).filter((p) => p.trim()).length, readingSeconds: Math.round((w.length / 238) * 60), speakingSeconds: Math.round((w.length / 140) * 60), fleschReadingEase: Math.round((206.835 - 1.015 * (wc / sentences) - 84.6 * (syl / wc)) * 10) / 10, fleschKincaidGrade: Math.round((0.39 * (wc / sentences) + 11.8 * (syl / wc) - 15.59) * 10) / 10 }; }),
  entry("/text/extract", "Extract emails, URLs and more", "Find all email addresses, URLs, phone-number-like strings, hashtags, @mentions and numbers in a text, each list de-duplicated. Use to pull contacts and links out of scraped pages or messages.",
    ["text", "extract", "email", "url", ...U], { text: T("Mail ada@example.com or see https://example.com #news @ada +46 70 123 45 67", "The text") }, { emails: ["ada@example.com"], urls: ["https://example.com"], phones: ["+46 70 123 45 67"], hashtags: ["#news"], mentions: ["@ada"] },
    (_e, q) => { const t = need(q, "text", 50_000); const u = (re: RegExp) => [...new Set(t.match(re) ?? [])]; return { emails: u(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g), urls: u(/https?:\/\/[^\s<>"')\]]+/g).map((x) => x.replace(/[.,;:!?]+$/, "")), phones: u(/\+?\d[\d ()-]{7,}\d/g).map((x) => x.trim()), hashtags: u(/(?<![\w#])#[\p{L}\p{N}_]+/gu), mentions: u(/(?<![\w@])@[A-Za-z0-9_]{2,}/g), numbers: u(/-?\d+(?:[.,]\d+)?/g).slice(0, 200) }; }),
  entry("/text/diff", "Text diff, compare two texts", "Line-by-line difference between two texts: each line marked as unchanged, removed or added, with counts. Use to see what changed between two versions of a document, config or prompt.",
    ["text", "diff", ...U], { a: T("one\ntwo\nthree", "The original text"), b: T("one\n2\nthree\nfour", "The new text") }, { added: 2, removed: 1, unchanged: 2, lines: [{ op: "=", line: "one" }, { op: "-", line: "two" }, { op: "+", line: "2" }] },
    (_e, q) => { const d = lineDiff(need(q, "a", MAX), need(q, "b", MAX)); return { added: d.filter((x) => x.op === "+").length, removed: d.filter((x) => x.op === "-").length, unchanged: d.filter((x) => x.op === "=").length, lines: d }; }),
  entry("/regex/test", "Test a regular expression", "Run a JavaScript regular expression against a text and return every match with its index and capture groups (named groups included). Inputs are size-limited. Use to check a pattern before using it in code.",
    ["regex", ...U], { pattern: T("(\\d{4})-(\\d{2})", "The pattern without slashes"), text: T("2026-10 and 2027-01", "The text to search"), flags: { type: "string", description: "Flags such as g, i, m, s, u (g is always added)", example: "i" } }, { valid: true, count: 2, matches: [{ match: "2026-10", index: 0, groups: ["2026", "10"] }] },
    (_e, q) => { const pattern = need(q, "pattern", 300); const text = need(q, "text", 5000); const flags = (q("flags") ?? "").replace(/[^imsuy]/g, ""); let re: RegExp; try { re = new RegExp(pattern, `${flags}g`); } catch (e) { return { valid: false, error: String((e as Error).message) }; } const matches = [...text.matchAll(re)].slice(0, 200).map((m) => ({ match: m[0], index: m.index, groups: m.slice(1), named: m.groups ?? null })); return { valid: true, count: matches.length, matches }; }),
  entry("/cron/next", "Cron expression next run times", "Next run times (in UTC) of a standard 5-field cron expression (minute hour day month weekday; ranges, lists, steps and names like MON or JAN supported). Use to check a schedule before deploying it.",
    ["cron", "schedule", "date", ...U], { expr: T("*/15 9-17 * * MON-FRI", "The cron expression"), count: { type: "integer", description: "How many runs (1-50, default 5)", example: 5 }, from: { type: "string", description: "Start time, ISO (default now)", example: "2026-10-19T08:00:00Z" } }, { expr: "*/15 9-17 * * MON-FRI", next: ["2026-10-19T09:00:00.000Z", "2026-10-19T09:15:00.000Z"] },
    (_e, q) => { const expr = need(q, "expr", 200); return { expr, timezone: "UTC", next: cronNext(expr, date(q, "from", true), num(q, "count", { min: 1, max: 50, fallback: 5, integer: true })) }; }),
  entry("/date/diff", "Date difference between dates", "Time between two dates or timestamps: total days, weeks, hours, minutes and seconds, a years-months-days breakdown, and the number of weekdays (Monday-Friday) in between. Use for deadlines, ages and durations.",
    ["date", "time", ...U], { from: T("2026-01-01", "Start date or ISO timestamp"), to: T("2026-10-18", "End date or ISO timestamp") }, { days: 290, weeks: 41.43, years: 0, months: 9, remainingDays: 17, weekdays: 207 },
    (_e, q) => { const a = date(q, "from"), b = date(q, "to"); const ms = b.getTime() - a.getTime(); let y = b.getUTCFullYear() - a.getUTCFullYear(), m = b.getUTCMonth() - a.getUTCMonth(), d = b.getUTCDate() - a.getUTCDate(); if (d < 0) { m--; d += new Date(Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), 0)).getUTCDate(); } if (m < 0) { y--; m += 12; } let wd = 0; const days = Math.floor(Math.abs(ms) / 864e5); if (days <= 36600) { const s = new Date(Math.min(a.getTime(), b.getTime())); for (let i = 0; i < days; i++) { if (!isWeekend(s)) wd++; s.setUTCDate(s.getUTCDate() + 1); } } return { days: Math.round((ms / 864e5) * 100) / 100, weeks: Math.round((ms / 6048e5) * 100) / 100, hours: Math.round(ms / 36e5), minutes: Math.round(ms / 6e4), seconds: Math.round(ms / 1000), years: y, months: m, remainingDays: d, weekdays: days <= 36600 ? wd : null }; }),
  entry("/date/add", "Add time to a date", "Add (or subtract, with negative numbers) years, months, weeks, days, hours and minutes to a date, or add business days (skipping Saturdays and Sundays). Month ends are clamped (31 Jan + 1 month = 28/29 Feb). Use to compute due dates and expiries.",
    ["date", "time", ...U], { date: T("2026-01-31", "Start date or ISO timestamp"), years: { type: "integer", description: "Years to add (negative subtracts)", example: 0 }, months: { type: "integer", description: "Months to add", example: 1 }, weeks: { type: "integer", description: "Weeks to add", example: 0 }, days: { type: "integer", description: "Days to add", example: 0 }, hours: { type: "integer", description: "Hours to add", example: 0 }, minutes: { type: "integer", description: "Minutes to add", example: 0 }, businessDays: { type: "integer", description: "Weekdays to add (skips weekends)", example: 0 } }, { result: "2026-02-28T00:00:00.000Z", date: "2026-02-28", weekday: "Saturday" },
    (_e, q) => { const d = date(q, "date"); const n = (k: string) => num(q, k, { min: -100000, max: 100000, fallback: 0, integer: true }); const day = d.getUTCDate(); d.setUTCDate(1); d.setUTCFullYear(d.getUTCFullYear() + n("years")); d.setUTCMonth(d.getUTCMonth() + n("months")); d.setUTCDate(Math.min(day, new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate())); d.setUTCDate(d.getUTCDate() + n("weeks") * 7 + n("days")); d.setUTCHours(d.getUTCHours() + n("hours"), d.getUTCMinutes() + n("minutes")); let bd = n("businessDays"); const step = bd < 0 ? -1 : 1; if (Math.abs(bd) > 3650) throw new HttpError(400, "businessDays must be at most 3650"); while (bd !== 0) { d.setUTCDate(d.getUTCDate() + step); if (!isWeekend(d)) bd -= step; } return { result: d.toISOString(), date: ymd(d), weekday: d.toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" }) }; }),
  entry("/date/info", "Week number and date facts: ISO week, weekday, day of year, quarter", "Weekday, ISO week number and week-year, day of the year, quarter, days in the month, leap year, Unix timestamp and whether it is a weekend, for any date. Use for calendar and reporting logic.",
    ["date", "calendar", ...U], { date: { type: "string", description: "Date or ISO timestamp (default today)", example: "2026-10-18" } }, { date: "2026-10-18", weekday: "Sunday", isoWeek: 42, isoWeekYear: 2026, dayOfYear: 291, quarter: 4, daysInMonth: 31, leapYear: false, weekend: true, unix: 1792281600 },
    (_e, q) => { const d = date(q, "date", true); const y = d.getUTCFullYear(); const w = isoWeek(d); return { date: ymd(d), weekday: d.toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" }), isoWeek: w.week, isoWeekYear: w.year, dayOfYear: Math.floor((Date.UTC(y, d.getUTCMonth(), d.getUTCDate()) - Date.UTC(y, 0, 0)) / 864e5), quarter: Math.floor(d.getUTCMonth() / 3) + 1, daysInMonth: new Date(Date.UTC(y, d.getUTCMonth() + 1, 0)).getUTCDate(), leapYear: (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0, weekend: isWeekend(d), unix: Math.floor(d.getTime() / 1000) }; }),
  entry("/unix", "Unix timestamp converter", "Convert a Unix timestamp (seconds or milliseconds, detected automatically) to ISO date and time, or an ISO date to a Unix timestamp. Without input, returns the current time in both forms. Use to read timestamps in logs and APIs.",
    ["date", "unix", "timestamp", ...U], { value: { type: "string", description: "Unix seconds/milliseconds or an ISO date (default now)", example: "1792281600" } }, { unix: 1792281600, unixMs: 1792281600000, iso: "2026-10-18T00:00:00.000Z" },
    (_e, q) => { const v = q("value")?.trim(); let d: Date; if (!v) d = new Date(); else if (/^-?\d+(\.\d+)?$/.test(v)) { const n = Number(v); d = new Date(Math.abs(n) > 1e11 ? n : n * 1000); } else d = new Date(v); if (Number.isNaN(d.getTime())) throw new HttpError(400, "value is not a timestamp or date"); return { unix: Math.floor(d.getTime() / 1000), unixMs: d.getTime(), iso: d.toISOString() }; }),
  entry("/units/convert", "Unit conversion", "Convert between units of length, mass, volume (incl. US cups and gallons), temperature (c, f, k), speed, area, data size (kB vs KiB), time, energy and pressure. Example units: km, mi, lb, kg, floz, ml, mph, kn, acre, gib, kwh, psi. Use when exact conversions matter.",
    ["units", "convert", "math", ...U], { value: { type: "number", description: "The amount", required: true, example: 10 }, from: T("km", "Unit to convert from"), to: T("mi", "Unit to convert to") }, { value: 10, from: "km", to: "mi", kind: "length", result: 6.2137119224 },
    (_e, q) => { const v = num(q, "value"); const from = need(q, "from", 10), to = need(q, "to", 10); const r = convertUnit(v, from, to); return { value: v, from, to, kind: r.kind, result: Math.round(r.result * 1e10) / 1e10 }; }),
  entry("/number/words", "Number to English words", "Write a whole number (up to trillions, negatives allowed) out in English words, e.g. for cheques and invoices. Also returns the cheque form with 'and' cents when given a decimal amount. Use when amounts must be written out in full.",
    ["number", "words", "invoice", ...U], { number: { type: "number", description: "The number, decimals allowed", required: true, example: 1234.5 } }, { words: "one thousand two hundred thirty-four", cheque: "one thousand two hundred thirty-four and 50/100" },
    (_e, q) => { const n = num(q, "number", { min: -1e15, max: 1e15 }); const whole = Math.trunc(n); const cents = Math.round(Math.abs(n - whole) * 100); return { words: numberToWords(whole), cheque: `${numberToWords(whole)} and ${String(cents).padStart(2, "0")}/100` }; }),
  entry("/number/roman", "Roman numerals", "Convert a number (1-3999) to Roman numerals, or Roman numerals back to a number. Give either number or roman. Use for dates, outlines and puzzles.",
    ["number", "roman", ...U], { number: { type: "integer", description: "1 to 3999", example: 2026 }, roman: { type: "string", description: "Roman numerals to read", example: "MMXXVI" } }, { number: 2026, roman: "MMXXVI" },
    (_e, q) => { const r = q("roman")?.trim(); if (r) return { number: fromRoman(r), roman: r.toUpperCase() }; const n = num(q, "number", { min: 1, max: 3999, integer: true }); return { number: n, roman: toRoman(n) }; }),
  entry("/validate/iban", "IBAN validation: validate an IBAN", "Check an IBAN's format, its country-specific length and its mod-97 check digits, and return it formatted in groups of four. Use before saving bank details or paying out.",
    ["iban", "banking", "validation", ...U], { iban: T("SE45 5000 0000 0583 9825 7466", "The IBAN, spaces allowed") }, { iban: "SE4550000000058398257466", country: "SE", valid: true, reasons: [], formatted: "SE45 5000 0000 0583 9825 7466" },
    (_e, q) => ibanCheck(need(q, "iban", 64))),
  entry("/validate/isbn", "ISBN check, validate an ISBN", "Check an ISBN-10 or ISBN-13 check digit and convert valid ISBN-10s to ISBN-13. Hyphens and spaces are ignored. Use before cataloguing or ordering books.",
    ["isbn", "books", "validation", ...U], { isbn: T("0-306-40615-2", "The ISBN") }, { isbn: "0306406152", type: "ISBN-10", valid: true, isbn13: "9780306406157" },
    (_e, q) => isbnCheck(need(q, "isbn", 40))),
  entry("/validate/luhn", "Credit card validation (Luhn)", "Check whether a card number or other ID passes the Luhn (mod 10) algorithm used by card numbers, IMEI numbers and many IDs, and compute the check digit to append. Only the format is checked; nothing is looked up. Use to catch typos in card or ID numbers.",
    ["luhn", "validation", ...U], { number: T("79927398713", "Digits, spaces and hyphens allowed") }, { digits: "79927398713", valid: true, checkDigitForPrefix: 3 },
    (_e, q) => { const d = need(q, "number", 64).replace(/[\s-]/g, ""); if (!/^\d+$/.test(d)) throw new HttpError(400, "number must contain only digits"); const prefix = d.slice(0, -1); const check = [...Array(10).keys()].find((c) => luhn(prefix + c)); return { digits: d, valid: luhn(d), checkDigitForPrefix: check }; }),
  entry("/color", "Color converter, hex to RGB", "Convert a colour between hex, RGB and HSL, and give its relative luminance and whether black or white text reads better on it. Accepts #rgb, #rrggbb, rgb(r,g,b) and hsl(h,s%,l%). Use for theming and design checks.",
    ["color", "design", ...U], { color: T("#0f6cbd", "The colour") }, { hex: "#0f6cbd", rgb: "rgb(15, 108, 189)", hsl: "hsl(208, 85%, 40%)", luminance: 0.141, bestTextColor: "#ffffff" },
    (_e, q) => { const rgb = parseColour(need(q, "color", 64)); const L = luminance(rgb); return { ...colourInfo(rgb), luminance: Math.round(L * 1000) / 1000, bestTextColor: (1.05 / (L + 0.05)) >= ((L + 0.05) / 0.05) ? "#ffffff" : "#000000" }; }),
  entry("/color/contrast", "Color contrast check (WCAG)", "WCAG 2 contrast ratio between a text colour and a background colour, with pass/fail for AA and AAA at normal and large text sizes. Use to check that a design is readable.",
    ["color", "accessibility", "wcag", ...U], { fg: T("#767676", "Text colour"), bg: T("#ffffff", "Background colour") }, { ratio: 4.54, aaNormal: true, aaLarge: true, aaaNormal: false, aaaLarge: true },
    (_e, q) => { const a = luminance(parseColour(need(q, "fg", 64))), b = luminance(parseColour(need(q, "bg", 64))); const r = Math.round(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)) * 100) / 100; return { ratio: r, aaNormal: r >= 4.5, aaLarge: r >= 3, aaaNormal: r >= 7, aaaLarge: r >= 4.5 }; }),
  entry("/ip/cidr", "CIDR calculator", "Details of an IPv4 network in CIDR notation: network and broadcast address, first and last usable host, netmask, number of addresses, and whether a given IP falls inside. Use for firewall rules and allowlists.",
    ["ip", "network", "cidr", ...U], { cidr: T("192.168.1.0/24", "IPv4 network in CIDR notation"), ip: { type: "string", description: "Optional IPv4 address to test for membership", example: "192.168.1.77" } }, { network: "192.168.1.0", broadcast: "192.168.1.255", first: "192.168.1.1", last: "192.168.1.254", prefix: 24, netmask: "255.255.255.0", addresses: 256, usableHosts: 254, contains: true },
    (_e, q) => { const c = cidr(need(q, "cidr", 64)); const ip = q("ip")?.trim(); const { base, ...rest } = c; const contains = ip ? (() => { const n = ipv4ToInt(ip); return n >= base && n < base + c.addresses; })() : null; return { ...rest, contains }; }),
  entry("/ip/info", "IP address facts", "Classify an IPv4 or IPv6 address without any lookup: version, whether it is private, loopback, link-local, carrier-grade NAT or public, and its integer and reverse-DNS forms (IPv4). Use to triage IPs in logs or allowlists.",
    ["ip", "network", ...U], { ip: T("10.1.2.3", "The IP address") }, { ip: "10.1.2.3", version: 4, private: true, loopback: false, linkLocal: false, public: false, integer: 167838211, reverseDns: "3.2.1.10.in-addr.arpa" },
    (_e, q) => { const ip = need(q, "ip", 64).trim(); if (ip.includes(":")) { if (!/^[0-9a-f:.]+$/i.test(ip)) throw new HttpError(400, "not an IP address"); const l = ip.toLowerCase(); return { ip, version: 6, loopback: l === "::1", linkLocal: l.startsWith("fe8") || l.startsWith("fe9") || l.startsWith("fea") || l.startsWith("feb"), private: l.startsWith("fc") || l.startsWith("fd"), public: !(l === "::1" || /^f[cd]/.test(l) || /^fe[89ab]/.test(l)) }; } const n = ipv4ToInt(ip); const inNet = (b: string, bits: number) => Math.floor(n / 2 ** (32 - bits)) === Math.floor(ipv4ToInt(b) / 2 ** (32 - bits)); const priv = PRIVATE.slice(0, 3).some(([b, bits]) => inNet(b, bits)); const loop = inNet("127.0.0.0", 8), ll = inNet("169.254.0.0", 16), cgn = inNet("100.64.0.0", 10); return { ip, version: 4, private: priv, loopback: loop, linkLocal: ll, carrierGradeNat: cgn, public: !(priv || loop || ll || cgn), integer: n, reverseDns: `${ip.split(".").reverse().join(".")}.in-addr.arpa` }; }),
  entry("/semver", "Compare semantic versions", "Compare two semantic versions (1.2.3, pre-releases like 2.0.0-rc.1 handled by the SemVer rules) and get which is newer, plus the next major, minor and patch versions of the first. Use to decide whether an upgrade is a major change.",
    ["semver", "version", "dev", ...U], { a: T("1.10.0", "First version"), b: T("1.9.3", "Second version") }, { a: "1.10.0", b: "1.9.3", comparison: 1, newer: "1.10.0", nextMajor: "2.0.0", nextMinor: "1.11.0", nextPatch: "1.10.1" },
    (_e, q) => { const a = need(q, "a", 100), b = need(q, "b", 100); const c = semverCompare(a, b); const v = semver(a); return { a, b, comparison: c, newer: c >= 0 ? a : b, nextMajor: `${v.major + 1}.0.0`, nextMinor: `${v.major}.${v.minor + 1}.0`, nextPatch: `${v.major}.${v.minor}.${v.patch + 1}` }; }),
  entry("/jwt/decode", "JWT decode", "Decode a JSON Web Token's header and payload without verifying the signature, and report issued-at, not-before and expiry as dates and whether it has expired. The token is not stored. Do not use the result to trust a token. Use to debug auth flows.",
    ["jwt", "auth", "dev", ...U], { token: T("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjMiLCJleHAiOjE3OTIyODE2MDB9.sig", "The JWT") }, { header: { alg: "HS256", typ: "JWT" }, payload: { sub: "123", exp: 1792281600 }, expiresAt: "2026-10-18T00:00:00.000Z", expired: true, signatureVerified: false },
    (_e, q) => { const parts = need(q, "token", 10_000).trim().split("."); if (parts.length < 2) throw new HttpError(400, "token must have header.payload.signature"); const dec = (s: string) => { try { return JSON.parse(b64decode(s)); } catch { throw new HttpError(400, "token parts are not base64url JSON"); } }; const payload = dec(parts[1]); const t = (k: string) => (typeof payload?.[k] === "number" ? new Date(payload[k] * 1000).toISOString() : null); return { header: dec(parts[0]), payload, issuedAt: t("iat"), notBefore: t("nbf"), expiresAt: t("exp"), expired: typeof payload?.exp === "number" ? payload.exp * 1000 < Date.now() : null, signatureVerified: false }; }),
  entry("/markdown/to-html", "Markdown to HTML", "Convert Markdown (headings, paragraphs, bold, italic, strikethrough, links, images, inline and fenced code, lists, quotes, rules) to HTML. Raw HTML in the input is escaped, so the output is safe to embed. Use to publish agent-written Markdown on a web page.",
    ["markdown", "html", ...U], { markdown: T("# Title\nSome **bold** text and a [link](https://example.com).", "The Markdown") }, { html: '<h1>Title</h1>\n<p>Some <strong>bold</strong> text and a <a href="https://example.com">link</a>.</p>' },
    (_e, q) => ({ html: markdownToHtml(need(q, "markdown", MAX)) })),
  entry("/html/to-text", "HTML to plain text", "Strip HTML to readable plain text: scripts and styles removed, block elements become line breaks, list items get bullets, entities decoded. Use to feed web content or emails to an LLM.",
    ["html", "text", "llm", ...U], { html: T("<h1>Hi</h1><p>A &amp; B</p><ul><li>one</li></ul>", "The HTML") }, { text: "Hi\nA & B\n• one" },
    (_e, q) => ({ text: htmlToText(need(q, "html", 50_000)) })),
  entry("/http/status", "HTTP status code meaning", "Name and plain-language meaning of an HTTP status code (1xx-5xx, including 402 Payment Required and 429 Too Many Requests), and whether to retry. Use when handling API errors.",
    ["http", "dev", ...U], { code: { type: "integer", description: "Status code", required: true, example: 429 } }, { code: 429, name: "Too Many Requests", meaning: "Rate limited; wait (see Retry-After) and retry.", class: "client error", retry: true },
    (_e, q) => { const c = num(q, "code", { min: 100, max: 599, integer: true }); const known = HTTP_STATUS[c]; const cls = ["", "informational", "success", "redirect", "client error", "server error"][Math.floor(c / 100)]; return { code: c, name: known?.[0] ?? null, meaning: known?.[1] ?? `An unlisted ${cls} code.`, class: cls, retry: c === 408 || c === 429 || c >= 500 }; }),
  entry("/mime", "MIME type for a file", "MIME (content) type for a file name or extension, e.g. report.pdf → application/pdf, and whether browsers usually display it inline. Use when uploading or serving files.",
    ["mime", "files", "dev", ...U], { file: T("report.xlsx", "File name or extension") }, { extension: "xlsx", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", inline: false },
    (_e, q) => { const ext = need(q, "file", 300).toLowerCase().split(".").pop()!.trim(); const mime = MIME[ext]; if (!mime) throw new HttpError(404, `unknown extension .${ext}`); return { extension: ext, mime, inline: /^(text|image|audio|video)\/|application\/(pdf|json)/.test(mime) }; }),
];
