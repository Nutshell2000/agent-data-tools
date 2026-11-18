// Builds LexGlyph's Swedish-law layer (18 Nov 2026, Phase B of business/lexglyph/lexglyph-law-firm-plan-2026-11-18.md):
// the Swedish statutes that implement the directives in src/data/eu-law-acts.json (CELLAR's national implementing
// measures for Sweden name the statute they amend, "Lag om ändring i arbetstidslagen (1982:673)"), plus core statutes a
// Swedish firm needs that implement no directive (CORE below), in their current consolidated wording from the Riksdag's
// open data (Regeringskansliet's SFS text, "Ändrad: t.o.m. SFS …"), split into sections (§).
//
//   node scripts/law-index/build-se.mjs <outDir> [--only=1977:480,2005:551]
//
// Writes se-laws.jsonl, se-sections.jsonl, se-<n>.sql (tables se_laws, se_sections, se_sections_fts, se_transpositions)
// and, through embed-se.mjs, se-vectors-<n>.ndjson for the Vectorize index se-law.
// Licence: Swedish statutes are not protected by copyright (9 § upphovsrättslagen); the Riksdag's open data may be
// reused freely. The authentic text is the printed SFS.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const ACTS = JSON.parse(readFileSync(join(here, "../../src/data/eu-law-acts.json"), "utf8"));
const UA = "LexGlyph Swedish law index builder (https://lex.glyphcall.com)";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const STR = "^^<http://www.w3.org/2001/XMLSchema#string>";

/** Core statutes that implement no indexed directive but that firms look up every day. Checked by title at build time. */
const CORE = [
  "1915:218", // avtalslagen
  "1990:931", // köplagen
  "2022:260", // konsumentköplagen
  "1982:80", // anställningsskydd (LAS)
  "1976:580", // medbestämmandelagen (MBL)
  "1977:480", // semesterlagen
  "1982:673", // arbetstidslagen
  "1995:584", // föräldraledighetslagen
  "2008:567", // diskrimineringslagen
  "1977:1160", // arbetsmiljölagen
  "2005:551", // aktiebolagslagen
  "1995:1554", // årsredovisningslagen
  "1999:1078", // bokföringslagen
  "1987:672", // konkurslagen
  "2022:964", // lagen om företagsrekonstruktion
  "2008:579", // konkurrenslagen
  "2016:1145", // LOU
  "2016:1146", // LUF
  "2016:1147", // LUK
  "2018:218", // dataskyddslagen
  "2008:486", // marknadsföringslagen
  "1994:1512", // avtalsvillkor i konsumentförhållanden
  "2005:59", // distansavtalslagen
  "2010:1846", // konsumentkreditlagen
  "2007:528", // lagen om värdepappersmarknaden
  "2004:297", // lagen om bank- och finansieringsrörelse
  "2017:630", // penningtvättslagen
  "1960:729", // upphovsrättslagen
  "2010:1877", // varumärkeslagen
  "2018:558", // lagen om företagshemligheter
  "2023:200", // mervärdesskattelagen
  "2011:1244", // skatteförfarandelagen
  "2017:900", // förvaltningslagen
  "2009:400", // offentlighets- och sekretesslagen
  "1942:740", // rättegångsbalken
  "1998:808", // miljöbalken
  "2021:890", // visselblåsarlagen
  "2022:482", // lagen om elektronisk kommunikation
  "2012:854", // uthyrning av arbetstagare
  "1999:678", // utstationering av arbetstagare
];

async function sparql(q) {
  for (let i = 0; i < 4; i++) {
    const r = await fetch(`https://publications.europa.eu/webapi/rdf/sparql?query=${encodeURIComponent(`PREFIX cdm: <http://publications.europa.eu/ontology/cdm#> ${q}`)}`, { headers: { accept: "application/sparql-results+json", "user-agent": UA } }).catch(() => null);
    if (r?.ok) return (await r.json()).results.bindings;
    await sleep(3000 * (i + 1));
  }
  throw new Error("sparql failed");
}

/** Directive short name -> Swedish statutes (SFS numbers) its Swedish implementing measures name or are. */
async function transpositions() {
  const map = new Map();
  const directives = ACTS.filter((a) => /^3\d{4}L\d{4}$/.test(a.celex));
  for (let i = 0; i < directives.length; i += 20) {
    const vals = directives.slice(i, i + 20).map((a) => `"${a.celex}"${STR}`).join(" ");
    const rows = await sparql(`SELECT ?a ?t ?n ?type WHERE { VALUES ?a { ${vals} } ?d cdm:resource_legal_id_celex ?a . ?m cdm:measure_national_implementing_implements_resource_legal ?d ; cdm:measure_national_implementing_implemented_by_country <http://publications.europa.eu/resource/authority/country/SWE> . OPTIONAL { ?m cdm:work_title ?t } OPTIONAL { ?m cdm:measure_national_implementing_number_official_journal ?n } OPTIONAL { ?m cdm:measure_national_implementing_type_act ?type } }`);
    for (const b of rows) {
      if (!/^lag/i.test(b.type?.value ?? "")) continue; // statutes only, not ordinances or agency rules
      const short = ACTS.find((a) => a.celex === b.a.value).short;
      const title = b.t?.value ?? "";
      // "Lag om ändring i arbetstidslagen (1982:673)" names the statute amended; a new statute is the measure itself.
      const named = [...title.matchAll(/\((\d{4}:\d{1,4})\)/g)].map((m) => m[1]);
      const own = /^(\d{4})\/(\d+)$/.exec(b.n?.value ?? "");
      const sfs = named.length ? named : own && !/ändring/i.test(title) ? [`${own[1]}:${Number(own[2])}`] : [];
      for (const s of sfs) { if (!map.has(s)) map.set(s, new Set()); map.get(s).add(short); }
    }
  }
  return map;
}

/** The statute's consolidated text from the Riksdag, or null (not found, or repealed). */
async function statute(sfs) {
  const id = `sfs-${sfs.replace(":", "-")}`;
  // 18 Nov 2026: a second full run an hour after the first got failures for statutes that exist; back off longer and say why.
  let last = "no answer";
  for (let i = 0; i < 5; i++) {
    const r = await fetch(`https://data.riksdagen.se/dokument/${id}.text`, { headers: { "user-agent": UA } }).catch((e) => { last = String(e).slice(0, 80); return null; });
    if (r?.ok) { const t = await r.text(); if (t.trim()) return t; last = "empty body"; }
    else if (r) { last = `HTTP ${r.status}`; if (r.status === 404 && i >= 1) return null; }
    await sleep(5000 * 2 ** i);
  }
  console.log(`${sfs}: gave up (${last})`);
  return null;
}

const ORD = ["första", "andra", "tredje", "fjärde", "femte", "sjätte", "sjunde", "åttonde", "nionde", "tionde", "elfte", "tolfte"];

/** "Semesterlag (1977:480)" -> "semesterlagen (1977:480)"; "Lag (1982:80) om anställningsskydd" -> "lagen (1982:80) om anställningsskydd". */
export function definiteName(title) {
  const m = /^(\S+)\s+(\(\d{4}:\d+\))(.*)$/.exec(title.trim());
  if (!m) return title;
  const [, word, sfs, rest] = m;
  const w = word.toLowerCase();
  const def = w === "lag" ? "lagen" : w === "förordning" ? "förordningen" : /(lag|balk)$/.test(w) ? `${w}en` : w;
  return `${def} ${sfs}${rest}`.trim();
}

/**
 * Sections of one statute: { chapter, section, heading, text } where text keeps one line per stycke or numbered point.
 * The text arrives hard-wrapped at about 60 characters with blank lines between stycken; headings are short lines
 * before a section; "N kap." opens a chapter; transitional provisions at the end are left out.
 */
export function parseStatute(raw) {
  const header = raw.slice(0, raw.indexOf("Källa:") >= 0 ? raw.indexOf("\n", raw.indexOf("Källa:")) : 0);
  const title = raw.split("\n")[0].trim();
  const amended = /Ändrad:\s*t\.o\.m\.\s*SFS\s*(\d{4}:\d+)/.exec(header)?.[1] ?? null;
  const repealed = /Upphävd:\s*\S/.test(header);
  const body = raw.slice(header.length);
  const blocks = body.split(/\n\s*\n/).map((b) => b.split("\n").map((l) => l.trim()).join(" ").replace(/\s+/g, " ").trim()).filter(Boolean);
  const sections = [];
  let chapter = null, chapterTitle = null, pending = null, cur = null;
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (/^Övergångsbestämmelser/i.test(b)) break;
    const kap = /^(\d+\s?[a-z]?)\s*kap\.\s*(.*)$/i.exec(b);
    if (kap && !b.includes("§")) { chapter = kap[1].trim().replace(/\s+/g, " "); chapterTitle = kap[2] || null; pending = null; continue; }
    const sec = /^(\d+\s?[a-z]?)\s§\s+(.*)$/.exec(b);
    if (sec) {
      if (cur) sections.push(cur);
      cur = { chapter, chapterTitle, section: sec[1].replace(/\s+/g, " "), heading: pending, text: sec[2] };
      pending = null;
      continue;
    }
    const next = blocks[i + 1] ?? "";
    // A short line without a full stop, followed by a section or a chapter, is a heading.
    if (b.length < 100 && !/[.:;]$/.test(b) && (/^\d+\s?[a-z]?\s§\s/.test(next) || /^\d+\s?[a-z]?\s*kap\./i.test(next))) { if (cur) { sections.push(cur); cur = null; } pending = b; continue; }
    if (cur) cur.text += `\n${b}`;
  }
  if (cur) sections.push(cur);
  // Older statutes (avtalslagen, upphovsrättslagen) have chapters but number their sections straight through: "28 §
  // avtalslagen", not "3 kap. 28 §". Chapters count in a citation only when section numbers start again in each chapter.
  const numbers = sections.map((s) => s.section);
  if (new Set(numbers).size === numbers.length) for (const s of sections) s.chapter = null;
  return { title, amended, repealed, sections: sections.filter((s) => s.text.length > 5) };
}

/** "3 kap. 5 § första stycket 2" from a section and a position in its text. */
export function sePinpoint(s, at) {
  let stycke = 0, point = null, offset = 0;
  for (const line of s.text.split("\n")) {
    if (offset > at) break;
    const p = /^(\d+)\.\s/.exec(line);
    if (p) point = p[1]; else { stycke++; point = null; }
    offset += line.length + 1;
  }
  const many = s.text.split("\n").filter((l) => !/^\d+\.\s/.test(l)).length > 1;
  return `${s.chapter ? `${s.chapter} kap. ` : ""}${s.section} §${many && stycke ? ` ${ORD[stycke - 1] ?? `${stycke}:e`} stycket` : ""}${point ? ` ${point}` : ""}`;
}

const sql = (v) => (v === null || v === undefined ? "NULL" : typeof v === "number" ? String(v) : `'${String(v).replace(/'/g, "''")}'`);

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const out = process.argv[2];
  if (!out) throw new Error("usage: build-se.mjs <outDir> [--only=SFS,…]");
  const only = process.argv.find((a) => a.startsWith("--only="))?.slice(7).split(",");
  mkdirSync(out, { recursive: true });
  const trans = await transpositions();
  let list = [...new Set([...CORE, ...trans.keys()])];
  if (only) list = list.filter((s) => only.includes(s));
  console.log(`${list.length} statutes (${trans.size} named by implementing measures)`);
  const laws = [], sections = [], links = [];
  for (const sfs of list) {
    const raw = await statute(sfs);
    if (!raw) { console.log(`${sfs}: not found`); continue; }
    const p = parseStatute(raw);
    if (p.repealed) { console.log(`${sfs}: repealed (${p.title})`); continue; }
    if (!p.sections.length) { console.log(`${sfs}: no sections (${p.title})`); continue; }
    const name = definiteName(p.title);
    const url = `https://data.riksdagen.se/dokument/sfs-${sfs.replace(":", "-")}.html`;
    laws.push({ sfs, title: p.title, name, amended: p.amended, sections: p.sections.length, url, implements: [...(trans.get(sfs) ?? [])].join("|") });
    for (const d of trans.get(sfs) ?? []) links.push({ short: d, sfs });
    for (const s of p.sections) {
      const key = `${s.chapter ? `${s.chapter.replace(/\s/g, "")}k` : ""}${s.section.replace(/\s/g, "")}`;
      sections.push({ id: `se:${sfs}:${key}`, sfs, chapter: s.chapter, chapter_title: s.chapterTitle, section: s.section, heading: s.heading, text: s.text, name, url });
    }
    console.log(`${sfs}: ${p.title} | ${p.sections.length} sections | t.o.m. ${p.amended ?? "-"}${trans.get(sfs) ? ` | implements ${[...trans.get(sfs)].join(", ")}` : ""}`);
    await sleep(400);
  }
  // A section id can repeat when a statute has two parts with the same numbering (rare): keep the first.
  const seen = new Set();
  const uniq = sections.filter((s) => (seen.has(s.id) ? false : seen.add(s.id)));
  writeFileSync(join(out, "se-laws.jsonl"), laws.map((x) => JSON.stringify(x)).join("\n"));
  writeFileSync(join(out, "se-sections.jsonl"), uniq.map((x) => JSON.stringify(x)).join("\n"));
  const ddl = [
    "DROP TABLE IF EXISTS se_laws;", "DROP TABLE IF EXISTS se_sections;", "DROP TABLE IF EXISTS se_sections_fts;", "DROP TABLE IF EXISTS se_transpositions;",
    "CREATE TABLE se_laws (sfs TEXT PRIMARY KEY, title TEXT, name TEXT, amended TEXT, sections INTEGER, url TEXT, implements TEXT);",
    "CREATE TABLE se_sections (id TEXT PRIMARY KEY, sfs TEXT, chapter TEXT, chapter_title TEXT, section TEXT, heading TEXT, text TEXT, name TEXT, url TEXT);",
    "CREATE VIRTUAL TABLE se_sections_fts USING fts5(id UNINDEXED, name, heading, text, tokenize='unicode61 remove_diacritics 0');",
    "CREATE TABLE se_transpositions (short TEXT, sfs TEXT);",
    "CREATE INDEX se_transpositions_short ON se_transpositions(short);",
  ];
  const statements = [
    ...laws.map((l) => `INSERT INTO se_laws VALUES (${[l.sfs, l.title, l.name, l.amended, l.sections, l.url, l.implements].map(sql).join(",")});`),
    ...uniq.flatMap((s) => [`INSERT INTO se_sections VALUES (${[s.id, s.sfs, s.chapter, s.chapter_title, s.section, s.heading, s.text, s.name, s.url].map(sql).join(",")});`, `INSERT INTO se_sections_fts (id, name, heading, text) VALUES (${[s.id, s.name, s.heading ?? "", s.text].map(sql).join(",")});`]),
    ...links.filter((l) => laws.some((x) => x.sfs === l.sfs)).map((l) => `INSERT INTO se_transpositions VALUES (${[l.short, l.sfs].map(sql).join(",")});`),
  ];
  const files = [];
  let cur = [...ddl], size = 0;
  for (const s of statements) { if (size > 15_000_000) { files.push(cur); cur = []; size = 0; } cur.push(s); size += s.length; }
  files.push(cur);
  files.forEach((f, i) => writeFileSync(join(out, `se-${i + 1}.sql`), f.join("\n")));
  console.log(`${laws.length} statutes, ${uniq.length} sections, ${links.length} transposition links; ${files.length} SQL files`);
}
