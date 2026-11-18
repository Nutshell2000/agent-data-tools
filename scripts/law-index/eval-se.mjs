// Swedish-law search quality (18 Nov 2026): runs eval-se.json through the production seSearch (src/routes/law-layers.ts)
// over Cloudflare's REST API (D1 se_sections_fts, Vectorize se-law). A hit is an expected section id in the top 3.
//   CF_ACCOUNT_ID=… CF_API_TOKEN=… node scripts/law-index/eval-se.mjs [out.json]
import { build } from "esbuild";
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { api, D1 } from "./rest-deps.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const tmp = join(here, `../../.law-eval-se-${process.pid}.cjs`);
const b = await build({ entryPoints: [join(here, "../../src/routes/law-layers.ts")], bundle: true, platform: "node", format: "cjs", write: false });
writeFileSync(tmp, b.outputFiles[0].text);
const { seSearch } = createRequire(import.meta.url)(tmp);
rmSync(tmp);
const sql = async (query, params) => (await api(`/d1/database/${D1}/query`, { sql: query, params }))[0].results;
const deps = {
  async embed(q) { return (await api("/ai/run/@cf/baai/bge-m3", { text: [q] })).data[0]; },
  async vectors(v, topK) { return (await api("/vectorize/v2/indexes/se-law/query", { vector: v, topK, returnMetadata: "none" })).matches.map((m) => m.id); },
  async keywords(match, limit) { return (await sql("SELECT id FROM se_sections_fts WHERE se_sections_fts MATCH ? ORDER BY bm25(se_sections_fts, 0, 2.0, 3.0, 1.0) LIMIT ?", [match, limit])).map((x) => x.id); },
  async rows(ids) { return sql(`SELECT * FROM se_sections WHERE id IN (${ids.map(() => "?").join(",")})`, ids); },
};
const set = JSON.parse(readFileSync(join(here, "eval-se.json"), "utf8"));
const rows = [];
for (const { q, expect } of set) {
  const got = await seSearch(q, deps, 3).catch((e) => { console.warn(String(e)); return []; });
  const ids = got.map((s) => s.id);
  const rank = ids.findIndex((id) => expect.includes(id));
  rows.push({ q, expect, rank: rank >= 0 ? rank + 1 : null, top: got.map((s) => `${s.chapter ? `${s.chapter} kap. ` : ""}${s.section} § ${s.name}`) });
  console.log(`${rank === 0 ? "1" : rank > 0 ? rank + 1 : "-"}  ${q} -> ${rows.at(-1).top.join(" | ")}`);
}
const h1 = rows.filter((r) => r.rank === 1).length, h3 = rows.filter((r) => r.rank).length;
console.log(`\nSwedish law: ${h1}/${rows.length} first, ${h3}/${rows.length} in the top 3`);
if (process.argv[2]) writeFileSync(process.argv[2], JSON.stringify({ date: new Date().toISOString(), h1, h3, n: rows.length, rows }, null, 1));
