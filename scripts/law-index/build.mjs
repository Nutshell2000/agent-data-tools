// Builds the EU law search index (14 Nov 2026; Swedish text, practice areas and paragraph starts 18 Nov 2026): for every
// act in src/data/eu-law-acts.json, the latest consolidated text in force today (or the Official Journal text when the
// act was never consolidated) from the EU Publications Office's CELLAR repository, in English and in the other
// languages asked for, split into article and recital passages. English passages are embedded with Workers AI bge-m3
// (1,024 dims) and searched; the other languages are the same provisions in the reader's language, shown and quoted
// instead of the English when the question is in that language.
//
//   node scripts/law-index/build.mjs <outDir> [--only=GDPR,DSA] [--langs=en,sv] [--no-embed]
//
// Writes <outDir>/passages.jsonl, passages-<n>.sql (D1: table passages + FTS5 table passages_fts; the first file drops
// and recreates them) and vectors.ndjson (Vectorize). Load them with scripts/law-index/load.ps1. Re-run monthly:
// consolidations change when acts are amended.
//
// Source and licence: EUR-Lex / CELLAR, reuse authorised by Commission Decision 2011/833/EU, attribution
// "© European Union, https://eur-lex.europa.eu". Only the Official Journal text is authentic; every answer says so.
// EUR-Lex's own pages answer scripts with a bot challenge, so CELLAR (content negotiation) is the source.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseAct, chunksWithParagraph } from "./parse.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const ACTS = JSON.parse(readFileSync(join(here, "../../src/data/eu-law-acts.json"), "utf8"));
const out = process.argv[2];
if (!out) throw new Error("usage: build.mjs <outDir> [--only=A,B] [--langs=en,sv] [--no-embed]");
const only = process.argv.find((a) => a.startsWith("--only="))?.slice(7).split(",").map((s) => s.trim().toLowerCase());
const LANGS = (process.argv.find((a) => a.startsWith("--langs="))?.slice(8) ?? "en,sv").split(",").map((s) => s.trim().toLowerCase());
if (LANGS[0] !== "en") throw new Error("English must come first: it decides the version and is the searched text");
const embed = !process.argv.includes("--no-embed");
mkdirSync(out, { recursive: true });

const ACCOUNT = "a71d95cc01c3cac8962c09cc2195eb88";
const UA = "LexGlyph EU law index builder (https://lex.glyphcall.com)";
/** CELLAR's language codes (accept-language) and EUR-Lex's (in the page address) for the languages we build. */
const LANG = { en: { cellar: "eng", eurlex: "EN" }, sv: { cellar: "swe", eurlex: "SV" }, de: { cellar: "deu", eurlex: "DE" }, fr: { cellar: "fra", eurlex: "FR" }, fi: { cellar: "fin", eurlex: "FI" }, da: { cellar: "dan", eurlex: "DA" } };
for (const l of LANGS) if (!LANG[l]) throw new Error(`unknown language ${l}`);
const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Consolidated CELEX numbers (0YYYYXNNNN-YYYYMMDD) dated today or earlier, newest first. */
async function consolidations(celex) {
  if (celex.includes("/")) return []; // the Treaties: the 2016 consolidated versions are themselves the act
  const prefix = `0${celex.slice(1)}-`;
  const q = `PREFIX cdm: <http://publications.europa.eu/ontology/cdm#> SELECT DISTINCT ?celex WHERE { ?c cdm:resource_legal_id_celex ?celex . FILTER(STRSTARTS(STR(?celex), "${prefix}")) }`;
  const r = await fetch(`https://publications.europa.eu/webapi/rdf/sparql?query=${encodeURIComponent(q)}`, { headers: { accept: "application/sparql-results+json", "user-agent": UA } });
  if (!r.ok) throw new Error(`sparql ${r.status} for ${celex}`);
  const rows = (await r.json()).results.bindings.map((b) => b.celex.value).filter((c) => /-\d{8}$/.test(c) && c.slice(-8) <= today);
  return [...new Set(rows)].sort().reverse();
}

async function xhtml(celex, lang = "en", accept = "application/xhtml+xml") {
  for (let i = 0; i < 3; i++) {
    // A CELEX with a slash (12016E/TXT) must be sent encoded, or CELLAR answers 404.
    const r = await fetch(`https://publications.europa.eu/resource/celex/${encodeURIComponent(celex)}`, { headers: { accept, "accept-language": LANG[lang].cellar, "user-agent": UA }, redirect: "follow" }).catch(() => null);
    if (r?.ok) return r.text();
    if (r?.status === 404) {
      // Older acts that were never consolidated have no XHTML rendition, only plain HTML (parsePlainLayout).
      return accept === "text/html" ? null : xhtml(celex, lang, "text/html");
    }
    await sleep(2000 * (i + 1));
  }
  throw new Error(`could not fetch ${celex} (${lang})`);
}

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const sql = (v) => (v === null || v === undefined ? "NULL" : typeof v === "number" ? String(v) : `'${String(v).replace(/'/g, "''")}'`);

let token = null;
async function embedBatch(texts) {
  token ??= execSync("npx wrangler auth token", { encoding: "utf8", cwd: join(here, "../..") }).trim().split(/\r?\n/).pop();
  for (let i = 0; i < 5; i++) {
    const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/ai/run/@cf/baai/bge-m3`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ text: texts }) }).catch(() => null);
    const j = r ? await r.json().catch(() => null) : null;
    if (r?.ok && Array.isArray(j?.result?.data) && j.result.data.length === texts.length) return j.result.data;
    if (r?.status === 401) token = null;
    await sleep(2000 * (i + 1));
  }
  throw new Error("embedding failed");
}

/** Passages of one act's text in one language. */
function passagesOf(act, parsed, lang, celex, recitalCelex, consolidated) {
  const version = consolidated ? `consolidated text of ${consolidated.slice(-8, -4)}-${consolidated.slice(-4, -2)}-${consolidated.slice(-2)}` : "text as published in the Official Journal";
  const code = LANG[lang].eurlex;
  const rows = [];
  for (const it of parsed.items) {
    const parts = chunksWithParagraph(it.text);
    parts.forEach(({ text, para }, k) => {
      const label = it.kind === "article" ? `Article ${it.num}` : `Recital ${it.num}`;
      const doc = it.kind === "article" ? celex : recitalCelex;
      const anchor = parsed.anchors === false ? "" : `#${it.kind === "article" ? "art" : "rct"}_${it.num}`;
      rows.push({
        id: `${slug(act.short)}:${it.kind === "article" ? "a" : "r"}${it.num}:${k + 1}${lang === "en" ? "" : `:${lang}`}`.slice(0, 72),
        celex: act.celex, version_celex: celex, short: act.short, act: act.name, area: act.area ?? null, lang,
        kind: it.kind, label, num: it.num, heading: it.heading, part: k + 1, parts: parts.length, para, text,
        url: `https://eur-lex.europa.eu/legal-content/${code}/TXT/HTML/?uri=CELEX:${doc}${anchor}`,
        version: it.kind === "article" ? version : "recital as published in the Official Journal",
      });
    });
  }
  return rows;
}

const passages = [];
const report = [];
for (const act of ACTS) {
  if (only && !only.includes(act.short.toLowerCase())) continue;
  try {
    // The newest consolidation that has an English XHTML rendition; some (often the first, "initial" consolidation) have
    // none and answer 404. Then the Official Journal text.
    const versions = await consolidations(act.celex).catch((e) => { console.warn(String(e)); return []; });
    let consolidated = null, html = null;
    for (const c of versions.slice(0, 4)) { html = await xhtml(c); if (html) { consolidated = c; break; } }
    if (!html) html = await xhtml(act.celex);
    const celex = consolidated ?? act.celex;
    if (!html) { report.push(`${act.short}: NOT FOUND (tried ${[...versions.slice(0, 4), act.celex].join(", ")})`); console.log(report.at(-1)); continue; }
    const counts = [];
    for (const lang of LANGS) {
      const page = lang === "en" ? html : await xhtml(celex, lang);
      if (!page) { counts.push(`${lang}: none`); continue; }
      const parsed = parseAct(page);
      // Consolidated texts carry no recitals; the act's own recitals (which amendments do not change) come from the
      // Official Journal text, linked there.
      let recitalCelex = celex;
      if (consolidated && !parsed.items.some((i) => i.kind === "recital")) {
        const oj = await xhtml(act.celex, lang).catch(() => null);
        if (oj) { parsed.items = [...parsed.items, ...parseAct(oj).items.filter((i) => i.kind === "recital")]; recitalCelex = act.celex; }
      }
      const rows = passagesOf(act, parsed, lang, celex, recitalCelex, consolidated);
      passages.push(...rows);
      counts.push(`${lang}: ${parsed.items.filter((i) => i.kind === "article").length} articles, ${parsed.items.filter((i) => i.kind === "recital").length} recitals, ${rows.length} passages`);
      await sleep(500);
    }
    report.push(`${act.short}: ${celex} ${consolidated ? `(consolidated ${consolidated.slice(-8)})` : "(Official Journal)"} | ${counts.join(" | ")}`);
  } catch (e) {
    report.push(`${act.short}: FAILED ${String(e).slice(0, 200)}`);
  }
  console.log(report.at(-1));
  await sleep(500);
}

writeFileSync(join(out, "passages.jsonl"), passages.map((p) => JSON.stringify(p)).join("\n"));
writeFileSync(join(out, "report.txt"), report.join("\n"));

const ddl = [
  "DROP TABLE IF EXISTS passages;",
  "DROP TABLE IF EXISTS passages_fts;",
  "CREATE TABLE passages (id TEXT PRIMARY KEY, celex TEXT, version_celex TEXT, short TEXT, act TEXT, area TEXT, lang TEXT, kind TEXT, label TEXT, num TEXT, heading TEXT, part INTEGER, parts INTEGER, para TEXT, text TEXT, url TEXT, version TEXT);",
  "CREATE INDEX passages_short ON passages(short);",
  "CREATE INDEX passages_provision ON passages(short, label, lang);",
  "CREATE VIRTUAL TABLE passages_fts USING fts5(id UNINDEXED, short, label, heading, text, tokenize='porter unicode61');",
];
// Only the English passages are searched by keyword (the question is put into English first); the others are read by id.
const statements = passages.flatMap((p) => [
  `INSERT INTO passages VALUES (${[p.id, p.celex, p.version_celex, p.short, p.act, p.area, p.lang, p.kind, p.label, p.num, p.heading, p.part, p.parts, p.para, p.text, p.url, p.version].map(sql).join(",")});`,
  ...(p.lang === "en" ? [`INSERT INTO passages_fts (id, short, label, heading, text) VALUES (${[p.id, p.short, p.label, p.heading ?? "", p.text].map(sql).join(",")});`] : []),
]);
// D1 imports one file at a time; files of about 15 MB load reliably.
const files = [];
let cur = [...ddl], size = 0;
for (const s of statements) {
  if (size > 15_000_000) { files.push(cur); cur = []; size = 0; }
  cur.push(s); size += s.length;
}
files.push(cur);
files.forEach((f, i) => writeFileSync(join(out, `passages-${i + 1}.sql`), f.join("\n")));
console.log(`${passages.length} passages (${passages.filter((p) => p.lang === "en").length} English) from ${report.length} acts; ${files.length} SQL files`);

if (embed) {
  const en = passages.filter((p) => p.lang === "en");
  const lines = [];
  for (let i = 0; i < en.length; i += 25) {
    const batch = en.slice(i, i + 25);
    const vectors = await embedBatch(batch.map((p) => `${p.short} ${p.label}${p.heading ? `: ${p.heading}` : ""}\n${p.text}`.slice(0, 2500)));
    batch.forEach((p, k) => lines.push(JSON.stringify({ id: p.id, values: vectors[k], metadata: { short: p.short, kind: p.kind } })));
    if (i % 1000 === 0) console.log(`embedded ${i + batch.length}/${en.length}`);
  }
  writeFileSync(join(out, "vectors.ndjson"), lines.join("\n"));
  console.log(`vectors.ndjson: ${lines.length}`);
}
