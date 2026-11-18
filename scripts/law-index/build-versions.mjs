// Every consolidated version of every indexed act, with the date it applies from (18 Nov 2026, point-in-time reading,
// Phase B): table act_versions(short, version_celex, date). The text itself is fetched from CELLAR when someone asks
// for an article as it read on a date (src/lib/law-versions.ts), so only this list is stored.
//   node scripts/law-index/build-versions.mjs <outDir>   then   npx wrangler d1 execute eu-law-v2 --remote --yes --file <outDir>/versions.sql
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const ACTS = JSON.parse(readFileSync(join(here, "../../src/data/eu-law-acts.json"), "utf8"));
const out = process.argv[2];
if (!out) throw new Error("usage: build-versions.mjs <outDir>");
mkdirSync(out, { recursive: true });
const UA = "LexGlyph EU law index builder (https://lex.glyphcall.com)";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sql = (v) => (v === null ? "NULL" : `'${String(v).replace(/'/g, "''")}'`);
const rows = [];
for (const act of ACTS) {
  if (act.celex.includes("/")) continue; // the 2016 Treaties are one version
  const q = `PREFIX cdm: <http://publications.europa.eu/ontology/cdm#> SELECT DISTINCT ?celex WHERE { ?c cdm:resource_legal_id_celex ?celex . FILTER(STRSTARTS(STR(?celex), "0${act.celex.slice(1)}-")) }`;
  let got = [];
  for (let i = 0; i < 4; i++) {
    const r = await fetch(`https://publications.europa.eu/webapi/rdf/sparql?query=${encodeURIComponent(q)}`, { headers: { accept: "application/sparql-results+json", "user-agent": UA } }).catch(() => null);
    if (r?.ok) { got = (await r.json()).results.bindings.map((b) => b.celex.value).filter((c) => /-\d{8}$/.test(c)); break; }
    await sleep(3000 * (i + 1));
  }
  for (const c of [...new Set(got)].sort()) rows.push({ short: act.short, celex: c, date: `${c.slice(-8, -4)}-${c.slice(-4, -2)}-${c.slice(-2)}` });
  console.log(`${act.short}: ${got.length} versions`);
  await sleep(300);
}
writeFileSync(join(out, "versions.sql"), [
  "DROP TABLE IF EXISTS act_versions;",
  "CREATE TABLE act_versions (short TEXT, version_celex TEXT, date TEXT);",
  "CREATE INDEX act_versions_short ON act_versions(short, date);",
  ...rows.map((r) => `INSERT INTO act_versions VALUES (${[r.short, r.celex, r.date].map(sql).join(",")});`),
].join("\n"));
console.log(`${rows.length} versions`);
