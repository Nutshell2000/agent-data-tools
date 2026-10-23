// Calculators, converters and generators computed locally: no outside services and no data licences, so they answer
// in milliseconds and nearly never fail. Bazaar search on 22 Oct 2026 showed each task with a #1 of 1-6 payers and no
// listing of ours (qr code, loan and mortgage calculator, compound interest, age calculator, bmi calculator, tip
// calculator, lorem ipsum, morse code, caesar cipher, xml to json, json schema).
import qrcode from "qrcode-generator";
import { SaxesParser } from "saxes";
import { entry, flag, need, num, opt, pick, type Entry, type Input } from "../family";
import { HttpError } from "../lib/env";

const U = ["utility", "data"];
const T = (example: string, description: string) => ({ type: "string" as const, description, required: true, example });
const cents = (n: number) => Math.round(n * 100) / 100;

// ---------- QR codes ----------
/** A QR code as SVG for text or a URL. UTF-8 is sent as bytes (the library's own encoder keeps only Latin-1). */
export function qrSvg(text: string, ecc: "L" | "M" | "Q" | "H", cell: number, margin: number) {
  const qr = qrcode(0, ecc);
  qr.addData(String.fromCharCode(...new TextEncoder().encode(text)), "Byte");
  try { qr.make(); } catch { throw new HttpError(400, `text is too long for a QR code at error correction ${ecc}; shorten it or use ecc=L`); }
  const svg = qr.createSvgTag({ cellSize: cell, margin, scalable: true });
  return { modules: qr.getModuleCount(), version: (qr.getModuleCount() - 17) / 4, svg };
}

// ---------- Money ----------
/** Monthly payment on an amortised loan; a 0% rate divides the principal evenly. */
export function loanPayment(principal: number, annualRatePct: number, months: number) {
  const r = annualRatePct / 1200;
  return r === 0 ? principal / months : (principal * r) / (1 - (1 + r) ** -months);
}

export function loanSchedule(principal: number, annualRatePct: number, months: number, rows: number) {
  const pay = loanPayment(principal, annualRatePct, months), r = annualRatePct / 1200;
  const schedule = [];
  let balance = principal;
  for (let m = 1; m <= Math.min(rows, months); m++) {
    const interest = balance * r, principalPart = Math.min(balance, pay - interest);
    balance -= principalPart;
    schedule.push({ month: m, payment: cents(principalPart + interest), principal: cents(principalPart), interest: cents(interest), balance: cents(Math.max(0, balance)) });
  }
  return { monthlyPayment: cents(pay), payments: months, totalPaid: cents(pay * months), totalInterest: cents(pay * months - principal), schedule };
}

/** Future value with compounding `perYear` times a year plus a contribution at the end of every month. */
export function compound(principal: number, ratePct: number, years: number, perYear: number, monthly: number) {
  const r = ratePct / 100;
  const monthlyRate = (1 + r / perYear) ** (perYear / 12) - 1;
  const at = (t: number) => {
    const fromPrincipal = principal * (1 + r / perYear) ** (perYear * t);
    const n = Math.round(12 * t);
    const fromContrib = monthlyRate === 0 ? monthly * n : monthly * (((1 + monthlyRate) ** n - 1) / monthlyRate);
    return fromPrincipal + fromContrib;
  };
  const future = at(years), contributed = principal + monthly * Math.round(12 * years);
  const byYear = Array.from({ length: Math.min(Math.floor(years), 100) }, (_, i) => ({ year: i + 1, balance: cents(at(i + 1)) }));
  return { futureValue: cents(future), totalContributions: cents(contributed), interestEarned: cents(future - contributed), byYear };
}

// ---------- Dates and health ----------
const isoDay = (q: Input, name: string, fallbackToday = false) => {
  const raw = opt(q, name, 40);
  if (!raw) { if (fallbackToday) { const d = new Date(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); } throw new HttpError(400, `${name} is required (YYYY-MM-DD)`); }
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  const d = m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null;
  if (!d || d.getUTCMonth() !== +m![2] - 1) throw new HttpError(400, `${name} must be a date as YYYY-MM-DD`);
  return d;
};
const ymd = (d: Date) => d.toISOString().slice(0, 10);

/** Age in years, months and days, and the next birthday (29 February birthdays fall on 28 February in other years). */
export function age(birth: Date, on: Date) {
  if (birth > on) throw new HttpError(400, "birthdate is after the date to measure on");
  let y = on.getUTCFullYear() - birth.getUTCFullYear(), m = on.getUTCMonth() - birth.getUTCMonth(), d = on.getUTCDate() - birth.getUTCDate();
  if (d < 0) { m--; d += new Date(Date.UTC(on.getUTCFullYear(), on.getUTCMonth(), 0)).getUTCDate(); }
  if (m < 0) { y--; m += 12; }
  const birthdayIn = (year: number) => { const last = new Date(Date.UTC(year, birth.getUTCMonth() + 1, 0)).getUTCDate(); return new Date(Date.UTC(year, birth.getUTCMonth(), Math.min(birth.getUTCDate(), last))); };
  let next = birthdayIn(on.getUTCFullYear());
  if (next < on) next = birthdayIn(on.getUTCFullYear() + 1);
  return {
    years: y, months: m, days: d, totalDays: Math.round((on.getTime() - birth.getTime()) / 864e5),
    nextBirthday: ymd(next), daysUntilNextBirthday: Math.round((next.getTime() - on.getTime()) / 864e5),
    bornOn: birth.toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" }),
  };
}

/** WHO adult BMI categories. */
export function bmiCategory(bmi: number) {
  return bmi < 18.5 ? "underweight" : bmi < 25 ? "normal weight" : bmi < 30 ? "overweight" : bmi < 35 ? "obesity class I" : bmi < 40 ? "obesity class II" : "obesity class III";
}

// ---------- Text ----------
const LOREM = ("lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua ut enim ad minim veniam quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur excepteur sint occaecat cupidatat non proident sunt in culpa qui officia deserunt mollit anim id est laborum").split(" ");

/** Lorem ipsum text, reproducible for a given seed; the first sentence is the classic opening. */
export function lorem(paragraphs: number, sentencesPer: number, seed: number) {
  let s = seed >>> 0 || 1;
  const rand = () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 2 ** 32; };
  const sentence = () => {
    const n = 6 + Math.floor(rand() * 9);
    const w = Array.from({ length: n }, () => LOREM[Math.floor(rand() * LOREM.length)]);
    return w[0][0].toUpperCase() + w[0].slice(1) + " " + w.slice(1).join(" ") + ".";
  };
  const out = Array.from({ length: paragraphs }, () => Array.from({ length: sentencesPer }, sentence).join(" "));
  out[0] = "Lorem ipsum dolor sit amet, consectetur adipiscing elit. " + out[0];
  return out;
}

const MORSE: Record<string, string> = {
  a: ".-", b: "-...", c: "-.-.", d: "-..", e: ".", f: "..-.", g: "--.", h: "....", i: "..", j: ".---", k: "-.-", l: ".-..", m: "--",
  n: "-.", o: "---", p: ".--.", q: "--.-", r: ".-.", s: "...", t: "-", u: "..-", v: "...-", w: ".--", x: "-..-", y: "-.--", z: "--..",
  "0": "-----", "1": ".----", "2": "..---", "3": "...--", "4": "....-", "5": ".....", "6": "-....", "7": "--...", "8": "---..", "9": "----.",
  ".": ".-.-.-", ",": "--..--", "?": "..--..", "'": ".----.", "!": "-.-.--", "/": "-..-.", "(": "-.--.", ")": "-.--.-", "&": ".-...",
  ":": "---...", ";": "-.-.-.", "=": "-...-", "+": ".-.-.", "-": "-....-", "_": "..--.-", '"': ".-..-.", "$": "...-..-", "@": ".--.-.",
};
const FROM_MORSE = Object.fromEntries(Object.entries(MORSE).map(([k, v]) => [v, k]));

/** International Morse code: letters split by spaces, words by " / ". Characters without a code are left out and reported. */
export function morse(text: string, mode: "encode" | "decode" | "auto") {
  const decode = mode === "decode" || (mode === "auto" && /^[.\-\s/]+$/.test(text.trim()));
  if (decode) {
    const unknown: string[] = [];
    const result = text.trim().split(/\s*\/\s*|\s{3,}/).map((w) => w.split(/\s+/).filter(Boolean).map((c) => FROM_MORSE[c] ?? (unknown.push(c), "")).join("")).join(" ");
    return { mode: "decode", result: result.toUpperCase(), unknown: [...new Set(unknown)] };
  }
  const skipped = new Set<string>();
  const result = text.trim().toLowerCase().split(/\s+/).map((w) => [...w].map((c) => MORSE[c] ?? (skipped.add(c), "")).filter(Boolean).join(" ")).filter(Boolean).join(" / ");
  return { mode: "encode", result, skipped: [...skipped] };
}

/** Caesar shift of A-Z and a-z; everything else is kept. A shift of 13 is ROT13, its own inverse. */
export function caesar(text: string, shift: number) {
  const k = ((shift % 26) + 26) % 26;
  return text.replace(/[a-z]/gi, (c) => { const base = c <= "Z" ? 65 : 97; return String.fromCharCode(((c.charCodeAt(0) - base + k) % 26) + base); });
}

// ---------- XML and JSON ----------
type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

/**
 * XML to JSON: an element becomes an object with "@name" attributes, "#text" text and one key per child name (an array
 * when the name repeats); an element with only text becomes that text. No DTD or external entity is ever loaded.
 */
export function xmlToJson(xml: string, maxDepth = 100) {
  const parser = new SaxesParser({ xmlns: false });
  type Node = { name: string; attrs: Record<string, string>; text: string; children: [string, Json][] };
  const stack: Node[] = [];
  let root: { name: string; value: Json } | null = null;
  let error: string | null = null;
  parser.on("error", (e) => { error ??= e.message; });
  parser.on("doctype", () => { error ??= "DOCTYPE declarations are not accepted"; });
  parser.on("opentag", (tag) => {
    if (stack.length >= maxDepth) { error ??= `XML nested deeper than ${maxDepth} levels`; return; }
    stack.push({ name: tag.name, attrs: Object.fromEntries(Object.entries(tag.attributes).map(([k, v]) => [k, String(v)])), text: "", children: [] });
  });
  const addText = (t: string) => { if (stack.length) stack[stack.length - 1].text += t; };
  parser.on("text", addText);
  parser.on("cdata", addText);
  parser.on("closetag", () => {
    const n = stack.pop();
    if (!n) return;
    const text = n.text.trim();
    let value: Json;
    if (!n.children.length && !Object.keys(n.attrs).length) value = text;
    else {
      const o: Record<string, Json> = {};
      for (const [k, v] of Object.entries(n.attrs)) o[`@${k}`] = v;
      const byName = new Map<string, Json[]>();
      for (const [k, v] of n.children) byName.set(k, [...(byName.get(k) ?? []), v]);
      for (const [k, list] of byName) o[k] = list.length === 1 ? list[0] : list;
      if (text) o["#text"] = text;
      value = o;
    }
    if (stack.length) stack[stack.length - 1].children.push([n.name, value]);
    else root = { name: n.name, value };
  });
  try { parser.write(xml).close(); } catch (e) { error ??= (e as Error).message; }
  if (error || !root) throw new HttpError(400, `not well-formed XML: ${error ?? "no root element"}`);
  const r = root as { name: string; value: Json };
  return { root: r.name, json: { [r.name]: r.value } };
}

const FORMATS: [string, RegExp][] = [
  ["date-time", /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/], ["date", /^\d{4}-\d{2}-\d{2}$/],
  ["email", /^[^\s@]+@[^\s@]+\.[^\s@]+$/], ["uri", /^https?:\/\/\S+$/], ["uuid", /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i],
];
type Schema = Record<string, unknown>;

/** A JSON Schema (draft 2020-12) that the example validates against; arrays merge their items' shapes. */
export function inferSchema(v: Json): Schema {
  if (v === null) return { type: "null" };
  if (Array.isArray(v)) return v.length ? { type: "array", items: mergeSchemas(v.map(inferSchema)) } : { type: "array" };
  if (typeof v === "object") {
    const properties = Object.fromEntries(Object.entries(v).map(([k, x]) => [k, inferSchema(x)]));
    return { type: "object", properties, required: Object.keys(v) };
  }
  if (typeof v === "number") return { type: Number.isInteger(v) ? "integer" : "number" };
  if (typeof v === "string") { const f = FORMATS.find(([, re]) => re.test(v)); return f ? { type: "string", format: f[0] } : { type: "string" }; }
  return { type: "boolean" };
}

export function mergeSchemas(list: Schema[]): Schema {
  const same = (a: Schema, b: Schema) => JSON.stringify(a) === JSON.stringify(b);
  const objects = list.filter((s) => s.type === "object");
  const rest = list.filter((s) => s.type !== "object");
  const merged: Schema[] = [];
  if (objects.length) {
    const keys = [...new Set(objects.flatMap((o) => Object.keys(o.properties as object)))];
    const properties = Object.fromEntries(keys.map((k) => [k, mergeSchemas(objects.map((o) => (o.properties as Record<string, Schema>)[k]).filter(Boolean))]));
    merged.push({ type: "object", properties, required: keys.filter((k) => objects.every((o) => (o.required as string[]).includes(k))) });
  }
  for (const s of rest) {
    if (s.type === "number" && merged.some((m) => m.type === "integer")) { merged.splice(merged.findIndex((m) => m.type === "integer"), 1, { type: "number" }); continue; }
    if (s.type === "integer" && merged.some((m) => m.type === "number")) continue;
    const sameType = merged.findIndex((m) => m.type === s.type);
    if (sameType >= 0) { if (!same(merged[sameType], s)) merged[sameType] = s.type === "array" ? { type: "array", items: mergeSchemas([merged[sameType].items, s.items].filter(Boolean) as Schema[]) } : { type: s.type }; continue; }
    merged.push(s);
  }
  return merged.length === 1 ? merged[0] : { anyOf: merged };
}

export const CALC: Entry[] = [
  entry("/qr", "QR code generator: a QR code as SVG for any text or URL",
    "Generate a QR code for a URL or any text (UTF-8, up to 1,000 characters) as a scalable SVG plus a ready-to-embed data URL, at error correction L, M (default), Q or H. Use to put a link, Wi-Fi string or payment request on a page, label or ticket.",
    ["qr-code", "qr", "barcode", "image", ...U], {
      text: T("https://agent-data-tools.revmesh2074.workers.dev", "The text or URL to encode"),
      ecc: { type: "string", description: "Error correction: L, M (default), Q or H", example: "M" },
      size: { type: "integer", description: "Pixels per module, 1-20 (default 4)", example: 4 },
      margin: { type: "integer", description: "Quiet zone in modules, 0-10 (default 4)", example: 4 },
    },
    { text: "https://agent-data-tools.revmesh2074.workers.dev", ecc: "M", version: 4, modules: 33, svg: '<svg version="1.1" xmlns="http://www.w3.org/2000/svg" …</svg>', dataUrl: "data:image/svg+xml;base64,PHN2ZyB2ZXJzaW9u…" },
    (_e, q) => {
      const text = need(q, "text", 1000);
      const ecc = (pick(q, "ecc", ["l", "m", "q", "h"] as const, "m")).toUpperCase() as "L" | "M" | "Q" | "H";
      const r = qrSvg(text, ecc, num(q, "size", { min: 1, max: 20, fallback: 4, integer: true }), num(q, "margin", { min: 0, max: 10, fallback: 4, integer: true }));
      return { text, ecc, version: r.version, modules: r.modules, svg: r.svg, dataUrl: `data:image/svg+xml;base64,${btoa(r.svg)}` };
    }),
  entry("/calc/loan", "Loan and mortgage calculator: monthly payment, total interest and schedule",
    "Monthly payment of an amortised loan or mortgage from the amount, the annual interest rate and the term, plus the total paid, the total interest and the first months of the repayment schedule (principal, interest and balance). Fixed rate, monthly payments. Use to compare loan offers or plan a mortgage.",
    ["loan-calculator", "mortgage-calculator", "finance", "interest", ...U], {
      principal: { type: "number", description: "Amount borrowed", required: true, example: 300000 },
      rate: { type: "number", description: "Annual interest rate in percent, 0-100", required: true, example: 4.5 },
      years: { type: "number", description: "Term in years (default 30), or give months", example: 30 },
      months: { type: "integer", description: "Term in months, instead of years", example: 360 },
      rows: { type: "integer", description: "Schedule rows to return, 0-60 (default 3)", example: 3 },
    },
    { monthlyPayment: 1520.06, payments: 360, totalPaid: 547220.13, totalInterest: 247220.13, schedule: [{ month: 1, payment: 1520.06, principal: 395.06, interest: 1125, balance: 299604.94 }] },
    (_e, q) => {
      const months = q("months")?.trim() ? num(q, "months", { min: 1, max: 1200, integer: true }) : Math.round(num(q, "years", { min: 1 / 12, max: 100, fallback: 30 }) * 12);
      return loanSchedule(num(q, "principal", { min: 0.01, max: 1e12 }), num(q, "rate", { min: 0, max: 100 }), months, num(q, "rows", { min: 0, max: 60, fallback: 3, integer: true }));
    }),
  entry("/calc/compound-interest", "Compound interest calculator: future value with monthly contributions",
    "Future value of savings or an investment with compound interest: starting amount, annual rate, years, compounding (yearly, quarterly, monthly or daily) and an optional contribution at the end of each month. Returns the final balance, total contributed, interest earned and the balance after each year. Use for savings goals and investment what-ifs; rates are assumed constant.",
    ["compound-interest", "finance", "savings", "investment", ...U], {
      principal: { type: "number", description: "Starting amount (0 or more)", required: true, example: 10000 },
      rate: { type: "number", description: "Annual interest rate in percent, -50 to 100", required: true, example: 7 },
      years: { type: "number", description: "Years, up to 100", required: true, example: 10 },
      compound: { type: "string", description: "yearly, quarterly, monthly (default) or daily", example: "monthly" },
      monthly: { type: "number", description: "Contribution at the end of each month (default 0)", example: 200 },
    },
    { futureValue: 54713.58, totalContributions: 34000, interestEarned: 20713.58, byYear: [{ year: 1, balance: 13201.42 }] },
    (_e, q) => {
      const perYear = { yearly: 1, quarterly: 4, monthly: 12, daily: 365 }[pick(q, "compound", ["yearly", "quarterly", "monthly", "daily"] as const, "monthly")];
      return compound(num(q, "principal", { min: 0, max: 1e12 }), num(q, "rate", { min: -50, max: 100 }), num(q, "years", { min: 0, max: 100 }), perYear, num(q, "monthly", { min: 0, max: 1e9, fallback: 0 }));
    }),
  entry("/calc/age", "Age calculator: exact age from a date of birth and the next birthday",
    "Exact age from a date of birth in years, months and days, total days lived, the weekday of birth, and the date of and days until the next birthday, measured today (UTC) or on any date you give. Use for age checks, forms and anniversaries.",
    ["age-calculator", "date", "birthday", "time", ...U], {
      birthdate: T("1990-05-17", "Date of birth, YYYY-MM-DD"),
      on: { type: "string", description: "Measure on this date, YYYY-MM-DD (default today)", example: "2026-10-23" },
    },
    { years: 36, months: 5, days: 6, totalDays: 13308, nextBirthday: "2027-05-17", daysUntilNextBirthday: 206, bornOn: "Thursday" },
    (_e, q) => age(isoDay(q, "birthdate"), isoDay(q, "on", true))),
  entry("/calc/bmi", "BMI calculator: body mass index and WHO category",
    "Body mass index from weight and height in metric (kg, cm) or imperial (lb, in) units, its WHO adult category (underweight, normal weight, overweight, obesity class I-III) and the weight range that counts as normal for that height. For adults; a screening number, not a diagnosis. Use for health, fitness and nutrition apps.",
    ["bmi-calculator", "health", "fitness", ...U], {
      weight: { type: "number", description: "Weight in kg (or lb with units=imperial)", required: true, example: 70 },
      height: { type: "number", description: "Height in cm (or inches with units=imperial)", required: true, example: 175 },
      units: { type: "string", description: "metric (default) or imperial", example: "metric" },
    },
    { bmi: 22.9, category: "normal weight", normalWeightRange: { min: 56.7, max: 76.3, unit: "kg" }, note: "WHO adult categories; not a diagnosis." },
    (_e, q) => {
      const imperial = pick(q, "units", ["metric", "imperial"] as const, "metric") === "imperial";
      const kg = num(q, "weight", { min: 1, max: 1000 }) * (imperial ? 0.45359237 : 1);
      const m = num(q, "height", { min: 20, max: 300 }) * (imperial ? 0.0254 : 0.01);
      const bmi = Math.round((kg / (m * m)) * 10) / 10;
      const toUnit = (x: number) => Math.round((imperial ? x / 0.45359237 : x) * 10) / 10;
      return { bmi, category: bmiCategory(bmi), normalWeightRange: { min: toUnit(18.5 * m * m), max: toUnit(24.9 * m * m), unit: imperial ? "lb" : "kg" }, note: "WHO adult categories; not a diagnosis." };
    }),
  entry("/calc/tip", "Tip calculator: tip, total and split per person",
    "Tip and total for a bill at a tip percentage, split between any number of people, optionally rounding each share up to the next whole amount. Use for receipts, expense apps and group payments.",
    ["tip-calculator", "finance", "split-bill", ...U], {
      bill: { type: "number", description: "Bill amount before tip", required: true, example: 84.5 },
      percent: { type: "number", description: "Tip percent, 0-100 (default 15)", example: 18 },
      people: { type: "integer", description: "People sharing, 1-100 (default 1)", example: 3 },
      roundUp: { type: "string", description: "true to round each share up to a whole amount", example: "false" },
    },
    { bill: 84.5, percent: 18, tip: 15.21, total: 99.71, people: 3, perPerson: 33.24 },
    (_e, q) => {
      const bill = num(q, "bill", { min: 0, max: 1e9 }), percent = num(q, "percent", { min: 0, max: 100, fallback: 15 }), people = num(q, "people", { min: 1, max: 100, fallback: 1, integer: true });
      const tip = cents((bill * percent) / 100), total = cents(bill + tip);
      const perPerson = flag(q, "roundUp") ? Math.ceil(total / people) : Math.ceil((total / people) * 100) / 100;
      return { bill, percent, tip, total, people, perPerson };
    }),
  entry("/text/lorem", "Lorem ipsum generator: placeholder paragraphs",
    "Lorem ipsum placeholder text: 1-20 paragraphs of 1-10 sentences, starting with the classic \"Lorem ipsum dolor sit amet\". The same seed always gives the same text. Use to fill mock-ups, templates and test data.",
    ["lorem-ipsum", "placeholder", "text", "design", ...U], {
      paragraphs: { type: "integer", description: "Paragraphs, 1-20 (default 1)", example: 1 },
      sentences: { type: "integer", description: "Sentences per paragraph, 1-10 (default 4)", example: 4 },
      seed: { type: "integer", description: "Seed for the word order (default 1)", example: 1 },
    },
    { paragraphs: ["Lorem ipsum dolor sit amet, consectetur adipiscing elit. Ipsum in amet irure tempor eiusmod. Ex cillum in quis eu ipsum. …"], words: 40 },
    (_e, q) => {
      const p = lorem(num(q, "paragraphs", { min: 1, max: 20, fallback: 1, integer: true }), num(q, "sentences", { min: 1, max: 10, fallback: 4, integer: true }), num(q, "seed", { min: 1, max: 2 ** 31, fallback: 1, integer: true }));
      return { paragraphs: p, words: p.join(" ").split(/\s+/).length };
    }),
  entry("/text/morse", "Morse code translator: text to Morse and back",
    "Translate text to international Morse code (letters separated by spaces, words by /) or Morse code back to text; the direction is detected automatically or set with mode. Letters, digits and common punctuation are supported; anything else is reported, not guessed. Use for puzzles, radio practice and fun messages.",
    ["morse-code", "text", "encoding", ...U], {
      text: T("SOS help", "Text, or Morse code made of . - spaces and /"),
      mode: { type: "string", description: "auto (default), encode or decode", example: "auto" },
    },
    { mode: "encode", result: "... --- ... / .... . .-.. .--.", skipped: [] },
    (_e, q) => morse(need(q, "text", 5000), pick(q, "mode", ["auto", "encode", "decode"] as const, "auto"))),
  entry("/text/caesar", "Caesar cipher, ROT13: shift letters by any amount",
    "Encode or decode text with a Caesar cipher: every letter A-Z shifted by 1-25 places (13, the default, is ROT13), case kept, digits and punctuation untouched. decode=true shifts back. Use for puzzles, spoiler hiding and teaching; it is not encryption.",
    ["caesar-cipher", "rot13", "text", "encoding", ...U], {
      text: T("Hello, World!", "The text"),
      shift: { type: "integer", description: "Places to shift, -25 to 25 (default 13 = ROT13)", example: 13 },
      decode: { type: "string", description: "true to shift back", example: "false" },
    },
    { result: "Uryyb, Jbeyq!", shift: 13 },
    (_e, q) => { const s = num(q, "shift", { min: -25, max: 25, fallback: 13, integer: true }) * (flag(q, "decode") ? -1 : 1); return { result: caesar(need(q, "text", 20_000), s), shift: s }; }),
  entry("/xml/to-json", "XML to JSON converter",
    "Convert an XML document to JSON: attributes become \"@name\" keys, text becomes \"#text\" (or the value itself when an element only holds text), and repeated child elements become arrays. DOCTYPEs and external entities are refused, so nothing outside the document is ever loaded. Up to 100,000 characters. Use to read XML feeds, SOAP responses and config files in an agent.",
    ["xml-to-json", "xml", "json", "convert", ...U], { xml: T('<order id="7"><item sku="a1">Pen</item><item sku="b2">Ink</item></order>', "The XML document") },
    { root: "order", json: { order: { "@id": "7", item: [{ "@sku": "a1", "#text": "Pen" }, { "@sku": "b2", "#text": "Ink" }] } } },
    (_e, q) => xmlToJson(need(q, "xml", 100_000))),
  entry("/json/schema", "JSON schema from example: infer a JSON Schema",
    "Infer a JSON Schema (draft 2020-12) from an example JSON value: types, nested object properties, required keys, array item shapes merged across all items, and string formats (date-time, date, email, uri, uuid). Use to document an API response or to validate later data against the same shape.",
    ["json-schema", "json", "schema", "dev", ...U], { json: T('{"id":1,"email":"ada@example.com","tags":["a","b"],"created":"2026-10-23T08:00:00Z"}', "The example JSON") },
    { schema: { $schema: "https://json-schema.org/draft/2020-12/schema", type: "object", properties: { id: { type: "integer" }, email: { type: "string", format: "email" }, tags: { type: "array", items: { type: "string" } }, created: { type: "string", format: "date-time" } }, required: ["id", "email", "tags", "created"] } },
    (_e, q) => {
      let value: Json;
      try { value = JSON.parse(need(q, "json", 50_000)); } catch (e) { throw new HttpError(400, `json is not valid JSON: ${(e as Error).message}`); }
      return { schema: { $schema: "https://json-schema.org/draft/2020-12/schema", ...inferSchema(value) } };
    }),
];
