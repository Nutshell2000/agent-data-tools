// Builds the EU law search index (14 Nov 2026): for every act in src/data/eu-law-acts.json, the latest consolidated
// English text in force today (or the Official Journal text when the act was never consolidated) from the EU Publications
// Office's CELLAR repository, split into article and recital passages, embedded with Workers AI bge-m3 (1,024 dims).
//
//   node scripts/law-index/build.mjs <outDir> [--only GDPR,DSA] [--no-embed]
//
// Writes <outDir>/passages.jsonl, passages.sql (D1: table passages + FTS5 table passages_fts) and vectors.ndjson
// (Vectorize). Load them with scripts/law-index/load.ps1. Re-run monthly: consolidations change when acts are amended.
//
// Source and licence: EUR-Lex / CELLAR, reuse authorised by Commission Decision 2011/833/EU, attribution
// "© European Union, https://eur-lex.europa.eu". Only the Official Journal text is authentic; every answer says so.
// EUR-Lex's own pages answer scripts with a bot challenge, so CELLAR (content negotiation) is the source.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseAct, chunks } from "./parse.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const ACTS = JSON.parse(readFileSync(join(here, "../../src/data/eu-law-acts.json"), "utf8"));
const out = process.argv[2];
if (!out) throw new Error("usage: build.mjs <outDir> [--only A,B] [--no-embed]");
const only = process.argv.find((a) => a.startsWith("--only="))?.slice(7).split(",").map((s) => s.trim().toLowerCase());
const embed = !process.argv.includes("--no-embed");
mkdirSync(out, { recursive: true });

const ACCOUNT = "a71d95cc01c3cac8962c09cc2195eb88";
const UA = "agent-data-tools EU law index builder (https://tools.funwords.eu)";
const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Consolidated CELEX numbers (0YYYYXNNNN-YYYYMMDD) dated today or earlier, newest first. */
async function consolidations(celex) {
  const prefix = `0${celex.slice(1)}-`;
  const q = `PREFIX cdm: <http://publications.europa.eu/ontology/cdm#> SELECT DISTINCT ?celex WHERE { ?c cdm:resource_legal_id_celex ?celex . FILTER(STRSTARTS(STR(?celex), "${prefix}")) }`;
  const r = await fetch(`https://publications.europa.eu/webapi/rdf/sparql?query=${encodeURIComponent(q)}`, { headers: { accept: "application/sparql-results+json", "user-agent": UA } });
  if (!r.ok) throw new Error(`sparql ${r.status} for ${celex}`);
  const rows = (await r.json()).results.bindings.map((b) => b.celex.value).filter((c) => /-\d{8}$/.test(c) && c.slice(-8) <= today);
  return [...new Set(rows)].sort().reverse();
}

async function xhtml(celex) {
  for (let i = 0; i < 3; i++) {
    const r = await fetch(`https://publications.europa.eu/resource/celex/${celex}`, { headers: { accept: "application/xhtml+xml", "accept-language": "eng", "user-agent": UA }, redirect: "follow" });
    if (r.ok) return r.text();
    if (r.status === 404) return null;
    await sleep(2000 * (i + 1));
  }
  throw new Error(`could not fetch ${celex}`);
}

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const sql = (v) => (v === null || v === undefined ? "NULL" : typeof v === "number" ? String(v) : `'${String(v).replace(/'/g, "''")}'`);

let token = null;
async function embedBatch(texts) {
  token ??= execSync("npx wrangler auth token", { encoding: "utf8", cwd: join(here, "../..") }).trim().split(/\r?\n/).pop();
  for (let i = 0; i < 4; i++) {
    const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/ai/run/@cf/baai/bge-m3`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ text: texts }) });
    const j = await r.json().catch(() => null);
    if (r.ok && Array.isArray(j?.result?.data) && j.result.data.length === texts.length) return j.result.data;
    if (r.status === 401) token = null;
    await sleep(1500 * (i + 1));
  }
  throw new Error("embedding failed");
}

const passages = [];
const report = [];
for (const act of ACTS) {
  if (only && !only.includes(act.short.toLowerCase())) continue;
  // The newest consolidation that has an English XHTML rendition; some (often the first, "initial" consolidation) have
  // none and answer 404. Then the Official Journal text.
  const versions = await consolidations(act.celex).catch((e) => { console.warn(String(e)); return []; });
  let consolidated = null, html = null;
  for (const c of versions.slice(0, 4)) { html = await xhtml(c); if (html) { consolidated = c; break; } }
  if (!html) html = await xhtml(act.celex);
  const celex = consolidated ?? act.celex;
  if (!html) { report.push(`${act.short}: NOT FOUND (tried ${[...versions.slice(0, 4), act.celex].join(", ")})`); continue; }
  const parsed = parseAct(html);
  const { title } = parsed;
  let items = parsed.items;
  // Consolidated texts carry no recitals; the act's own recitals (which amendments do not change) come from the
  // Official Journal text, linked there.
  let recitalCelex = celex;
  if (consolidated && !items.some((i) => i.kind === "recital")) {
    const oj = await xhtml(act.celex).catch(() => null);
    if (oj) { items = [...items, ...parseAct(oj).items.filter((i) => i.kind === "recital")]; recitalCelex = act.celex; }
  }
  const version = consolidated ? `consolidated text of ${consolidated.slice(-8, -4)}-${consolidated.slice(-4, -2)}-${consolidated.slice(-2)}` : "text as published in the Official Journal";
  let n = 0;
  for (const it of items) {
    const parts = chunks(it.text);
    parts.forEach((text, k) => {
      const label = it.kind === "article" ? `Article ${it.num}` : `Recital ${it.num}`;
      passages.push({
        id: `${slug(act.short)}:${it.kind === "article" ? "a" : "r"}${it.num}:${k + 1}`.slice(0, 64),
        celex: act.celex, version_celex: celex, short: act.short, act: act.name, title,
        kind: it.kind, label, num: it.num, heading: it.heading, part: k + 1, parts: parts.length, text,
        url: `https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:${it.kind === "article" ? celex : recitalCelex}#${it.kind === "article" ? "art" : "rct"}_${it.num}`,
        version: it.kind === "article" ? version : "recital as published in the Official Journal",
      });
      n++;
    });
  }
  report.push(`${act.short}: ${celex} ${items.filter((i) => i.kind === "article").length} articles, ${items.filter((i) => i.kind === "recital").length} recitals, ${n} passages (${version})`);
  console.log(report.at(-1));
  await sleep(800);
}

writeFileSync(join(out, "passages.jsonl"), passages.map((p) => JSON.stringify(p)).join("\n"));
writeFileSync(join(out, "report.txt"), report.join("\n"));

const ddl = [
  "DROP TABLE IF EXISTS passages;",
  "DROP TABLE IF EXISTS passages_fts;",
  "CREATE TABLE passages (id TEXT PRIMARY KEY, celex TEXT, version_celex TEXT, short TEXT, act TEXT, kind TEXT, label TEXT, num TEXT, heading TEXT, part INTEGER, parts INTEGER, text TEXT, url TEXT, version TEXT);",
  "CREATE INDEX passages_short ON passages(short);",
  "CREATE VIRTUAL TABLE passages_fts USING fts5(id UNINDEXED, short, label, heading, text, tokenize='porter unicode61');",
];
const rows = passages.flatMap((p) => [
  `INSERT INTO passages VALUES (${[p.id, p.celex, p.version_celex, p.short, p.act, p.kind, p.label, p.num, p.heading, p.part, p.parts, p.text, p.url, p.version].map(sql).join(",")});`,
  `INSERT INTO passages_fts (id, short, label, heading, text) VALUES (${[p.id, p.short, p.label, p.heading ?? "", p.text].map(sql).join(",")});`,
]);
writeFileSync(join(out, "passages.sql"), [...ddl, ...rows].join("\n"));
console.log(`${passages.length} passages from ${report.length} acts`);

if (embed) {
  const lines = [];
  for (let i = 0; i < passages.length; i += 25) {
    const batch = passages.slice(i, i + 25);
    const vectors = await embedBatch(batch.map((p) => `${p.short} ${p.label}${p.heading ? `: ${p.heading}` : ""}\n${p.text}`.slice(0, 2500)));
    batch.forEach((p, k) => lines.push(JSON.stringify({ id: p.id, values: vectors[k], metadata: { short: p.short, kind: p.kind } })));
    if (i % 500 === 0) console.log(`embedded ${i + batch.length}/${passages.length}`);
  }
  writeFileSync(join(out, "vectors.ndjson"), lines.join("\n"));
  console.log(`vectors.ndjson: ${lines.length}`);
}
