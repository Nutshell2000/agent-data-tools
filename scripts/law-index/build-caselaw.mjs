// Builds LexGlyph's case-law layer (18 Nov 2026, Phase B of business/lexglyph/lexglyph-law-firm-plan-2026-11-18.md): every
// judgment of the Court of Justice that CELLAR records as interpreting one of the acts in src/data/eu-law-acts.json,
// split into its numbered paragraphs (plus the operative part, "the ruling"), and the links from each paragraph to the
// articles it cites ("Article 46(2)(c) of the GDPR" links the paragraph to GDPR Article 46).
//
//   node scripts/law-index/build-caselaw.mjs <outDir> [--limit=N] [--only=62018CJ0311,…]
//
// Writes <outDir>/cases.jsonl, case-paras.jsonl, case-links.jsonl and caselaw-<n>.sql (tables cases, case_paras,
// case_paras_fts, case_links; the first file recreates them). Load with:
//   npx wrangler d1 execute eu-law-v2 --remote --yes --file <outDir>/caselaw-<n>.sql   (in order)
//
// CELLAR records which ACT a judgment interprets, not which article (checked 18 Nov 2026: no article annotations in the
// SPARQL endpoint), so article links come from the judgment's own words. Source and licence: EUR-Lex / CELLAR, reuse
// authorised by Commission Decision 2011/833/EU; "© European Union, https://eur-lex.europa.eu". Only the European Court
// Reports are authentic.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { articleLinks, actCitationForms, parseJudgment } from "./caselaw-links.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const ACTS = JSON.parse(readFileSync(join(here, "../../src/data/eu-law-acts.json"), "utf8"));
const out = process.argv[2];
if (!out) throw new Error("usage: build-caselaw.mjs <outDir> [--limit=N] [--only=CELEX,…]");
const limit = Number(process.argv.find((a) => a.startsWith("--limit="))?.slice(8) ?? Infinity);
const only = process.argv.find((a) => a.startsWith("--only="))?.slice(7).split(",");
mkdirSync(out, { recursive: true });
const UA = "LexGlyph EU law index builder (https://lex.glyphcall.com)";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const STR = "^^<http://www.w3.org/2001/XMLSchema#string>";

async function sparql(q) {
  for (let i = 0; i < 4; i++) {
    const r = await fetch(`https://publications.europa.eu/webapi/rdf/sparql?query=${encodeURIComponent(`PREFIX cdm: <http://publications.europa.eu/ontology/cdm#> ${q}`)}`, { headers: { accept: "application/sparql-results+json", "user-agent": UA } }).catch(() => null);
    if (r?.ok) return (await r.json()).results.bindings;
    await sleep(3000 * (i + 1));
  }
  throw new Error("sparql failed");
}

/** Judgments (CELEX 6YYYYCJNNNN) interpreting our acts: celex -> set of act short names. */
async function judgments() {
  const map = new Map();
  for (let i = 0; i < ACTS.length; i += 25) {
    const vals = ACTS.slice(i, i + 25).map((a) => `"${a.celex}"${STR}`).join(" ");
    const rows = await sparql(`SELECT ?a ?c WHERE { VALUES ?a { ${vals} } ?w cdm:resource_legal_id_celex ?a . ?j cdm:case-law_interpretes_resource_legal ?w . ?j cdm:resource_legal_id_celex ?c . FILTER(REGEX(STR(?c), "^6[0-9]{4}CJ[0-9]{4}$")) }`);
    for (const b of rows) {
      const act = ACTS.find((x) => x.celex === b.a.value);
      if (!map.has(b.c.value)) map.set(b.c.value, new Set());
      map.get(b.c.value).add(act.short);
    }
  }
  return map;
}

/** Case number, ECLI, date and parties, in English. */
async function metadata(celexes) {
  const meta = new Map();
  for (let i = 0; i < celexes.length; i += 40) {
    const vals = celexes.slice(i, i + 40).map((c) => `"${c}"${STR}`).join(" ");
    const rows = await sparql(`SELECT ?c ?ecli ?d ?id ?parties WHERE { VALUES ?c { ${vals} } ?w cdm:resource_legal_id_celex ?c . OPTIONAL { ?w cdm:case-law_ecli ?ecli } OPTIONAL { ?w cdm:work_date_document ?d } ?e cdm:expression_belongs_to_work ?w ; cdm:expression_uses_language <http://publications.europa.eu/resource/authority/language/ENG> . OPTIONAL { ?e cdm:expression_case-law_identifier_case ?id } OPTIONAL { ?e cdm:expression_case-law_parties ?parties } }`);
    for (const b of rows) {
      const m = meta.get(b.c.value) ?? {};
      meta.set(b.c.value, { ecli: m.ecli ?? b.ecli?.value ?? null, date: m.date ?? b.d?.value ?? null, number: m.number ?? b.id?.value?.replace(/^Cases? /, "") ?? null, parties: m.parties ?? b.parties?.value?.slice(0, 300) ?? null });
    }
  }
  return meta;
}

async function fetchText(celex) {
  for (let i = 0; i < 3; i++) {
    for (const accept of ["application/xhtml+xml", "text/html"]) {
      const r = await fetch(`https://publications.europa.eu/resource/celex/${celex}`, { headers: { accept, "accept-language": "eng", "user-agent": UA }, redirect: "follow" }).catch(() => null);
      if (r?.ok) return r.text();
      if (r && r.status !== 404) break;
    }
    await sleep(2000 * (i + 1));
  }
  return null;
}

const sql = (v) => (v === null || v === undefined ? "NULL" : typeof v === "number" ? String(v) : `'${String(v).replace(/'/g, "''")}'`);

const all = await judgments();
let list = [...all.keys()].sort().reverse();
if (only) list = list.filter((c) => only.includes(c));
list = list.slice(0, limit);
console.log(`${list.length} judgments`);
const meta = await metadata(list);
const forms = actCitationForms(ACTS);
const cases = [], paras = [], links = [];
let done = 0, failed = 0;
async function work(celex) {
  const html = await fetchText(celex);
  if (!html) { failed++; return; }
  const { paras: ps, ruling } = parseJudgment(html);
  if (!ps.length) { failed++; return; }
  const m = meta.get(celex) ?? {};
  const interprets = [...all.get(celex)];
  cases.push({ celex, ecli: m.ecli, number: m.number, parties: m.parties, date: m.date, interprets: interprets.join("|"), paras: ps.length,
    url: `https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:${celex}` });
  const state = { lastDirective: null, lastRegulation: null };
  for (const p of [...ps, ...(ruling ? [{ para: "ruling", text: ruling }] : [])]) {
    paras.push({ id: `${celex}:${p.para}`, celex, para: p.para, text: p.text });
    for (const l of articleLinks(p.text, forms, interprets, ACTS, state)) links.push({ short: l.short, num: l.num, celex, para: p.para });
  }
  done++;
  if (done % 100 === 0) console.log(`${done}/${list.length} judgments, ${paras.length} paragraphs, ${links.length} links`);
}
// Four at a time: CELLAR answers each judgment in about a second.
for (let i = 0; i < list.length; i += 4) { await Promise.all(list.slice(i, i + 4).map((c) => work(c).catch(() => { failed++; }))); await sleep(200); }

writeFileSync(join(out, "cases.jsonl"), cases.map((c) => JSON.stringify(c)).join("\n"));
writeFileSync(join(out, "case-paras.jsonl"), paras.map((c) => JSON.stringify(c)).join("\n"));
// One link per paragraph and article.
const seen = new Set();
const uniq = links.filter((l) => { const k = `${l.short}|${l.num}|${l.celex}|${l.para}`; if (seen.has(k)) return false; seen.add(k); return true; });
writeFileSync(join(out, "case-links.jsonl"), uniq.map((c) => JSON.stringify(c)).join("\n"));

const ddl = [
  "DROP TABLE IF EXISTS cases;", "DROP TABLE IF EXISTS case_paras;", "DROP TABLE IF EXISTS case_paras_fts;", "DROP TABLE IF EXISTS case_links;",
  "CREATE TABLE cases (celex TEXT PRIMARY KEY, ecli TEXT, number TEXT, parties TEXT, date TEXT, interprets TEXT, paras INTEGER, url TEXT);",
  "CREATE TABLE case_paras (id TEXT PRIMARY KEY, celex TEXT, para TEXT, text TEXT);",
  "CREATE VIRTUAL TABLE case_paras_fts USING fts5(id UNINDEXED, text, tokenize='porter unicode61');",
  "CREATE TABLE case_links (short TEXT, num TEXT, celex TEXT, para TEXT);",
  "CREATE INDEX case_links_article ON case_links(short, num);",
  "CREATE INDEX case_paras_celex ON case_paras(celex);",
];
const statements = [
  ...cases.map((c) => `INSERT OR IGNORE INTO cases VALUES (${[c.celex, c.ecli, c.number, c.parties, c.date, c.interprets, c.paras, c.url].map(sql).join(",")});`),
  ...paras.flatMap((p) => [`INSERT OR IGNORE INTO case_paras VALUES (${[p.id, p.celex, p.para, p.text].map(sql).join(",")});`, `INSERT INTO case_paras_fts (id, text) VALUES (${[p.id, p.text].map(sql).join(",")});`]),
  ...uniq.map((l) => `INSERT INTO case_links VALUES (${[l.short, l.num, l.celex, l.para].map(sql).join(",")});`),
];
const files = [];
let cur = [...ddl], size = 0;
for (const s of statements) { if (size > 15_000_000) { files.push(cur); cur = []; size = 0; } cur.push(s); size += s.length; }
files.push(cur);
files.forEach((f, i) => writeFileSync(join(out, `caselaw-${i + 1}.sql`), f.join("\n")));
console.log(`${cases.length} judgments (${failed} failed), ${paras.length} paragraphs, ${uniq.length} article links; ${files.length} SQL files`);
