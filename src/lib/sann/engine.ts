// @ts-nocheck
// GENERATED from C:\SpellzCode\02-Affarsomraden\G-Sann\sann-engine (scripts/copy-to-api.mjs). Edit there, not here.
// Sann claim engine v1. Pure functions, no dependencies, runs in browsers, Workers and Node.
// check(text, { lang, langs, now }) -> { version, ruleset, languages, findings, counts }
import { RULES, RULESET_VERSION, SEVERITY_ORDER } from "./rules";
import {
  LEX, TYPE1, ORGANIC_SCHEMES, SCHEMES, ENERGY_A, OFFSET_WORD, ENV_SPEC, PERCENT,
  FUTURE_ENV, FUTURE_PHRASE, STOPWORDS,
} from "./lexicon";

export const ENGINE_VERSION = "1.0.0";
export const MAX_CHARS = 50000;
export const LANGS = ["en", "sv", "de", "fr", "es"];

const B = "(?<![\\p{L}\\p{N}])";
const E = "(?![\\p{L}\\p{N}])";
// Phrases never cross a line break: "green\n\nDelivery" is a colour and a heading, not "green delivery".
const sameLine = (src) => src.replaceAll("[\\s-]", "[ \\t-]").replaceAll("\\s", "[ \\t]");
const wrap = (src) => new RegExp(B + "(?:" + sameLine(src) + ")" + E, "giu");
const test = (src) => new RegExp(B + "(?:" + sameLine(src) + ")" + E, "iu");

// Short scheme acronyms count only in capitals: "KRAV" is the label, "krav" is Swedish for "requirements".
function realScheme(match) {
  const head = match.split(/[\s-]/)[0];
  return !(head.length <= 4 && /^[\p{L}\d]+$/u.test(head) && head !== head.toUpperCase());
}
function hasScheme(rx, s) {
  const g = new RegExp(rx.source, "giu");
  let m;
  while ((m = g.exec(s)) !== null) if (realScheme(m[0])) return true;
  return false;
}

// Swedish "hållbar" and French "durable" also mean long-lasting; in a durability context they are a durability claim.
const DURABLE_CONTEXT = test(String.raw`slitstark\p{L}*|tålig\p{L}*|tål|håll(?:a|er|it)|robust\p{L}*|rostfri\p{L}*|korrosion\p{L}*|stöttålig\p{L}*|kraftig\p{L}*|stark|starka|starkt|stadig\p{L}*|gedigen\p{L}*|livslängd\p{L}*|byggd\s+för|högkvalitativ\p{L}*|kvalitet\p{L}*|solide\p{L}*|résistant\p{L}*|robuste\p{L}*|longue\s+durée|conçu\p{L}*\s+pour\s+durer|inoxydable\p{L}*|qualité`);
const SUSTAIN_CONTEXT = test(String.raw`miljö\p{L}*|klimat\p{L}*|natur\p{L}*|planet\p{L}*|återvunn\p{L}*|ekologisk\p{L}*|mode|kollektion\p{L}*|produ\p{L}*|odla\p{L}*|framtid\p{L}*|konsumtion\p{L}*|environnement|planète|écolog\p{L}*|recycl\p{L}*|biolog\p{L}*|développement|responsable\p{L}*|éthique\p{L}*`);
// A negation just before a durability claim ("No toy is indestructible") reverses it.
const NEGATION_BEFORE = new RegExp(B + "(?:no|not|never|none|isn't|ingen|inget|inga|inte|aldrig|kein\\p{L}*|nicht|nie|aucun\\p{L}*|pas|jamais|ningún|ninguna|nunca)" + E + "[^.!?\\n]{0,30}$", "iu");

// Compile once.
const COMPILED = {};
for (const lang of Object.keys(LEX)) {
  COMPILED[lang] = [];
  for (const [rule, entries] of Object.entries(LEX[lang])) {
    if (!RULES[rule]) throw new Error(`lexicon ${lang}: unknown rule ${rule}`);
    for (const e of entries) {
      const entry = typeof e === "string" ? { re: e } : e;
      COMPILED[lang].push({ rule, lang, re: wrap(entry.re), sev: entry.sev, tags: entry.tags || [] });
    }
  }
}
const RX = {
  type1: test(TYPE1),
  organicScheme: test(ORGANIC_SCHEMES),
  scheme: wrap(SCHEMES),
  schemeTest: test(SCHEMES),
  energyA: test(ENERGY_A),
  offsetWord: test(OFFSET_WORD),
  envSpec: test(ENV_SPEC),
  percent: test(PERCENT),
  futureEnv: test(FUTURE_ENV),
  futurePhrase: wrap(FUTURE_PHRASE),
};

/** Same-length normalisation so offsets stay valid: dashes, non-breaking spaces, curly quotes. */
export function normalise(text) {
  return String(text)
    .replace(/[‐-―−]/g, "-")
    .replace(/[   ]/g, " ")
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"');
}

/** Guess the text's languages from stopwords. English is always checked as well. */
export function detectLanguages(text) {
  const words = normalise(text).toLowerCase().match(/[\p{L}]+/gu) || [];
  const scores = {};
  for (const lang of LANGS) scores[lang] = 0;
  for (const w of words) for (const lang of LANGS) if (STOPWORDS[lang].includes(w)) scores[lang]++;
  const ranked = LANGS.filter((l) => scores[l] > 0).sort((a, b) => scores[b] - scores[a]);
  if (ranked.length === 0) return { primary: null, scores };
  return { primary: ranked[0], scores, ranked };
}

/** Sentence spans: split at . ! ? followed by whitespace or end, at line breaks, bullets and semicolons. */
export function sentences(text) {
  const out = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const next = text[i + 1];
    const endsHere =
      c === "\n" || c === "•" || c === ";" ||
      ((c === "." || c === "!" || c === "?") && (next === undefined || /\s/.test(next)));
    if (endsHere) {
      if (i + 1 > start) out.push({ start, end: i + 1 });
      start = i + 1;
    }
  }
  if (start < text.length) out.push({ start, end: text.length });
  return out;
}

function sentenceOf(spans, pos) {
  for (const s of spans) if (pos >= s.start && pos < s.end) return s;
  return spans[spans.length - 1] || { start: 0, end: 0 };
}

function maxSev(a, b) {
  return SEVERITY_ORDER[a] >= SEVERITY_ORDER[b] ? a : b;
}

export function check(input, opts = {}) {
  const raw = String(input ?? "");
  const truncated = raw.length > MAX_CHARS;
  const text = normalise(truncated ? raw.slice(0, MAX_CHARS) : raw);
  const now = opts.now ? new Date(opts.now) : new Date();
  const thisYear = now.getUTCFullYear();

  let languages;
  if (Array.isArray(opts.langs) && opts.langs.length) {
    languages = opts.langs.filter((l) => LANGS.includes(l));
  } else {
    const det = detectLanguages(text);
    const primary = det.primary || (LANGS.includes(opts.lang) ? opts.lang : "en");
    languages = [primary];
    // A close second language (mixed copy) is checked too.
    if (det.ranked && det.ranked[1] && det.scores[det.ranked[1]] >= Math.max(2, det.scores[primary] * 0.6)) {
      languages.push(det.ranked[1]);
    }
  }
  if (!languages.includes("en")) languages.push("en");

  const spans = sentences(text);
  const sentenceText = (s) => text.slice(s.start, s.end);
  const hits = [];
  const add = (start, end, rule, severity, notes = []) => hits.push({ start, end, rule, severity, notes });

  // 1. Lexicon hits.
  for (const lang of languages) {
    for (const entry of COMPILED[lang]) {
      entry.re.lastIndex = 0;
      let m;
      while ((m = entry.re.exec(text)) !== null) {
        if (m[0].length === 0) { entry.re.lastIndex++; continue; }
        const start = m.index;
        const end = start + m[0].length;
        const s = sentenceOf(spans, start);
        const st = sentenceText(s);
        let rule = entry.rule;
        let sev = entry.sev || RULES[rule].severity;
        const notes = [];

        if (rule === "DURABILITY" && NEGATION_BEFORE.test(text.slice(s.start, start))) continue;
        if (rule === "GENERIC" && entry.tags.includes("both") && DURABLE_CONTEXT.test(st) && !SUSTAIN_CONTEXT.test(st)) {
          rule = "DURABILITY"; sev = "medium"; notes.push("bothMeanings");
        } else if (rule === "GENERIC") {
          const social = entry.tags.includes("social");
          if (entry.tags.includes("both")) notes.push("bothMeanings");
          if (entry.tags.includes("energy") && RX.energyA.test(st)) { sev = "medium"; notes.push("classA"); }
          else if (hasScheme(RX.type1, st)) {
            if (social) notes.push("social");
            else { sev = "medium"; notes.push("type1"); }
          } else if (RX.envSpec.test(st)) {
            notes.push("specified");
            if (!social) sev = "medium";
          }
        } else if (rule === "OFFSET") {
          if (sev !== "high" && RX.offsetWord.test(st)) { sev = "high"; notes.push("offsetWord"); }
        } else if (rule === "LABEL") {
          if (hasScheme(RX.schemeTest, st)) { rule = "CERTIFIED"; sev = "info"; }
        } else if (rule === "ORGANIC") {
          if (hasScheme(RX.organicScheme, st)) { rule = "CERTIFIED"; sev = "info"; }
        } else if (rule === "PART") {
          if (RX.percent.test(st)) continue; // quantified: says how much
          if (hasScheme(RX.schemeTest, st)) { rule = "CERTIFIED"; sev = "info"; }
        } else if (rule === "COMPARISON") {
          // With figures in the sentence it is a specific comparison (must be accurate); without, a generic claim.
          sev = /\d/.test(m[0]) || RX.percent.test(st) ? "medium" : "high";
        }
        add(start, end, rule, sev, notes);
      }
    }
  }

  // 2. Promises about future environmental performance (sentence level).
  for (const s of spans) {
    const st = sentenceText(s);
    if (!RX.futureEnv.test(st)) continue;
    RX.futurePhrase.lastIndex = 0;
    let m, first = -1, last = -1;
    while ((m = RX.futurePhrase.exec(st)) !== null) {
      const year = m.slice(1).find((g) => g !== undefined);
      if (year && Number(year) < thisYear) continue; // a past year is not a promise
      if (first < 0) first = m.index;
      last = m.index + m[0].length;
    }
    // One finding from the first commitment phrase to the last (e.g. "We aim to ... by 2030").
    if (first >= 0) add(s.start + first, s.start + last, "FUTURE", RULES.FUTURE.severity);
  }

  // 3. Certification names, as info, when nothing else covers that text.
  RX.scheme.lastIndex = 0;
  let sm;
  while ((sm = RX.scheme.exec(text)) !== null) {
    if (realScheme(sm[0])) add(sm.index, sm.index + sm[0].length, "CERTIFIED", "info");
  }

  // 4. Merge overlapping hits into findings.
  hits.sort((a, b) => a.start - b.start || b.end - a.end);
  const findings = [];
  for (const h of hits) {
    const last = findings[findings.length - 1];
    if (last && h.start < last.end) {
      last.end = Math.max(last.end, h.end);
      last.hits.push(h);
    } else {
      findings.push({ start: h.start, end: h.end, hits: [h] });
    }
  }

  const out = [];
  for (const f of findings) {
    const byRule = new Map();
    for (const h of f.hits) {
      const prev = byRule.get(h.rule);
      if (prev) {
        prev.severity = maxSev(prev.severity, h.severity);
        for (const n of h.notes) if (!prev.notes.includes(n)) prev.notes.push(n);
      } else {
        byRule.set(h.rule, { id: h.rule, severity: h.severity, notes: [...h.notes] });
      }
    }
    // A certification name inside a real claim adds nothing on its own.
    if (byRule.size > 1 && byRule.has("CERTIFIED") && byRule.get("CERTIFIED").severity === "info") byRule.delete("CERTIFIED");
    const rules = [...byRule.values()].sort((a, b) => SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity]);
    const severity = rules.reduce((acc, r) => maxSev(acc, r.severity), "info");
    const s = sentenceOf(spans, f.start);
    out.push({
      start: f.start,
      end: f.end,
      text: text.slice(f.start, f.end),
      severity,
      rules,
      sentence: { start: s.start, end: Math.max(s.end, f.end), text: text.slice(s.start, Math.max(s.end, f.end)).trim() },
    });
  }

  const counts = { high: 0, medium: 0, info: 0 };
  for (const f of out) counts[f.severity]++;

  return {
    engine: ENGINE_VERSION,
    ruleset: RULESET_VERSION,
    languages,
    truncated,
    chars: text.length,
    counts,
    findings: out,
  };
}
