// Which articles of our acts a judgment paragraph cites (18 Nov 2026, scripts/law-index/build-caselaw.mjs). The Court
// writes "Article 46(2)(c) of the GDPR", "Articles 2(1), 3 and 7 of Directive 2003/88", "Article 6(1) of Regulation
// (EU) 2016/679", "Article 101 TFEU", "Article 47 of the Charter", and, once an act has been named, "Article 7 of that
// directive". Each becomes { short, num }: the act's short name in eu-law-acts.json and the article number.
// Also parseJudgment: a judgment's numbered paragraphs and its ruling.
import { plain } from "./parse.mjs";

/**
 * How each act is cited: its number as the Court writes it. Directives are always year/number ("2003/88"); regulations
 * from 2015 on are year/number ("2016/679"), earlier ones "No number/year" ("No 1/2003"). The Treaties and the Charter
 * by name.
 */
export function actCitationForms(acts) {
  const forms = [];
  for (const a of acts) {
    const m = /^3(\d{4})([RL])(\d{4})$/.exec(a.celex);
    if (m) {
      const [, year, type, numRaw] = m;
      const num = String(Number(numRaw));
      const id = type === "L" || Number(year) >= 2015 ? `${year}/${num}` : `${num}/${year}`;
      forms.push({ short: a.short, type: type === "L" ? "directive" : "regulation", re: new RegExp(`(?:Directive|Regulation)[^.;:]{0,40}?(?:No\\s+)?${id.replace("/", "\\/")}(?![\\d/])`, "i") });
    }
  }
  forms.push({ short: "GDPR", type: "regulation", re: /\bthe GDPR\b|\bGDPR\b/ });
  forms.push({ short: "Charter", type: "charter", re: /\bthe Charter\b|Charter of Fundamental Rights/i });
  forms.push({ short: "TFEU", type: "treaty", re: /\bTFEU\b|Treaty on the Functioning of the European Union/ });
  forms.push({ short: "TEU", type: "treaty", re: /\bTEU\b|Treaty on European Union/ });
  return forms;
}

/** "2(1), 3 and 7(2)" -> ["2", "3", "7"]: article numbers without paragraphs and points. */
export function articleNumbers(list) {
  return [...new Set((list.replace(/\([^)]*\)/g, " ").match(/\b\d+[a-z]?\b/g) ?? []))].filter((n) => Number.parseInt(n, 10) < 1000);
}

const ARTICLE_LIST = String.raw`Articles?\s+((?:\d+[a-z]?(?:\s*\([^)]{1,6}\))*(?:\s*(?:,|and|or|to)\s*)?)+?)`;

/**
 * Links in one paragraph. `interprets` = short names of the acts CELLAR says the judgment interprets (for "that directive"
 * when no act has been named yet); `state` carries the last directive and regulation named across the judgment's
 * paragraphs.
 */
export function articleLinks(text, forms, interprets, acts, state = {}) {
  const links = [];
  const byShort = new Map(acts.map((a) => [a.short, a]));
  const typeOf = (short) => forms.find((f) => f.short === short)?.type;
  // "Article 101 TFEU", "Article 4(3) TEU": the Treaty right after the number.
  for (const m of text.matchAll(new RegExp(`${ARTICLE_LIST}\\s+(TFEU|TEU)\\b`, "g"))) {
    for (const num of articleNumbers(m[1])) if (byShort.has(m[2])) links.push({ short: m[2], num });
  }
  // "Article N of <act>": the act named within the next 90 characters, before any full stop.
  for (const m of text.matchAll(new RegExp(`${ARTICLE_LIST}\\s+(?:of|in)\\s+([^.;]{1,90})`, "g"))) {
    const tail = m[2];
    let short = null;
    // The earliest act form in the tail wins (the one the words "of …" refer to).
    let best = Infinity;
    for (const f of forms) {
      const hit = f.re.exec(tail);
      if (hit && hit.index < best && hit.index < 12) { best = hit.index; short = f.short; }
    }
    if (!short) {
      const ana = /^(?:that|the said|the same|this)\s+(directive|regulation)\b/i.exec(tail) ?? /^the\s+(directive|regulation)\b/i.exec(tail);
      if (ana) {
        const kind = ana[1].toLowerCase();
        short = kind === "directive" ? state.lastDirective : state.lastRegulation;
        if (!short) {
          const only = interprets.filter((s) => typeOf(s) === kind);
          if (only.length === 1) short = only[0];
        }
      }
    }
    if (!short || !byShort.has(short)) continue;
    for (const num of articleNumbers(m[1])) links.push({ short, num });
  }
  // Remember the acts this paragraph names, for "that directive" in later paragraphs.
  for (const f of forms) {
    if (f.type !== "directive" && f.type !== "regulation") continue;
    const hit = f.re.exec(text);
    if (hit) state[f.type === "directive" ? "lastDirective" : "lastRegulation"] = f.short;
  }
  // Article 267 TFEU (the reference procedure itself) is cited by nearly every preliminary ruling: not a link.
  return links.filter((l) => !(l.short === "TFEU" && l.num === "267"));
}

/**
 * Numbered paragraphs and the ruling of one judgment. Current layout: <p class="coj-count" id="pointN">N</p> before
 * each paragraph. Older texts: a line holding only the number, or a line starting "N " in the grounds. The ruling is
 * the text after "On those grounds, the Court … hereby rules:" up to the signatures.
 */
export function parseJudgment(html) {
  const paras = [];
  const marks = [...html.matchAll(/<p[^>]*class="coj-count"[^>]*id="point(\d+)"[^>]*>/g)];
  if (marks.length) {
    for (let i = 0; i < marks.length; i++) {
      const seg = html.slice(marks[i].index, i + 1 < marks.length ? marks[i + 1].index : html.length);
      const text = plain(seg.replace(/<p[^>]*class="coj-count"[^>]*>[\s\S]*?<\/p>/, "")).replace(/\n+/g, " ").trim();
      paras.push({ para: marks[i][1], text });
    }
  } else {
    const lines = plain(html).split("\n");
    let cur = null, expect = 1;
    for (const l of lines) {
      const solo = /^(\d{1,3})$/.exec(l), lead = /^(\d{1,3})\s+(\S.*)$/.exec(l);
      const m = solo ?? lead;
      if (m && Number(m[1]) === expect) { if (cur) paras.push(cur); cur = { para: m[1], text: lead ? lead[2] : "" }; expect++; continue; }
      if (cur) cur.text = cur.text ? `${cur.text} ${l}` : l;
    }
    if (cur) paras.push(cur);
  }
  // The last paragraph runs on into costs, the ruling and the signatures: cut it there and keep the ruling apart.
  let ruling = null;
  if (paras.length) {
    const last = paras[paras.length - 1];
    const at = last.text.search(/On those grounds, the Court/i);
    if (at >= 0) {
      ruling = last.text.slice(at).replace(/\[Signatures\][\s\S]*$/, "").replace(/(Delivered in open court|Signatures)[\s\S]*$/, "").trim().slice(0, 6000);
      last.text = last.text.slice(0, at).trim();
    }
    const costs = paras.findIndex((p) => /^Costs\b/.test(p.text));
    if (costs >= 0) paras.splice(costs);
    for (const p of paras) p.text = p.text.replace(/\s*Costs\s+Since these proceedings are[\s\S]*$/, "").slice(0, 6000);
  }
  return { paras: paras.filter((p) => p.text.length > 20), ruling };
}

