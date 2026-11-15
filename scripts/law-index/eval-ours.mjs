// Runs the EU law evaluation questions (eval-questions.json) through the production /law/search ranking code
// (lawSearch in src/routes/law-search.ts), with Cloudflare's REST API standing in for the Worker bindings: Workers AI
// (bge-m3 embeddings, bge-reranker-base), Vectorize index eu-law and D1 database eu-law. A hit is a result whose
// citation is exactly an expected article ("GDPR, Article 6"). Questions marked heldOut are reported separately: they
// were written and checked against the article headings before any search was run (15 Nov 2026).
//   CF_ACCOUNT_ID=… CF_API_TOKEN=… node scripts/law-index/eval-ours.mjs [out.json]
// (CF_API_TOKEN can be the output of `npx wrangler auth token`.) Cost: two Workers AI calls per question.
import { build } from "esbuild";
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const { CF_ACCOUNT_ID: account, CF_API_TOKEN: token } = process.env;
if (!account || !token) throw new Error("set CF_ACCOUNT_ID and CF_API_TOKEN");
const D1 = "287b65ee-e792-4b26-aeac-74212865007c";
const api = async (path, body) => {
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}${path}`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (r.ok && j.success !== false) return j.result;
    if (attempt >= 2) throw new Error(`${path}: HTTP ${r.status} ${JSON.stringify(j.errors ?? j).slice(0, 200)}`);
    await new Promise((res) => setTimeout(res, 1500 * (attempt + 1)));
  }
};
const sql = async (query, params) => (await api(`/d1/database/${D1}/query`, { sql: query, params }))[0].results;

const out = join(here, "../../.law-eval-build.cjs");
const bundled = await build({ entryPoints: [join(here, "../../src/routes/law-search.ts")], bundle: true, platform: "node", format: "cjs", write: false });
writeFileSync(out, bundled.outputFiles[0].text);
const { lawSearch, EMBED_MODEL } = createRequire(import.meta.url)(out);
rmSync(out);
const { RERANK_MODEL } = { RERANK_MODEL: "@cf/baai/bge-reranker-base" };

const where = (f) => [f.short ? "p.short = ?" : "", f.kind ? "p.kind = ?" : ""].filter(Boolean);
const deps = {
  async embed(q) { return (await api(`/ai/run/${EMBED_MODEL}`, { text: [q.slice(0, 2000)] })).data[0]; },
  async vectors(v, topK, f) {
    const filter = { ...(f.short ? { short: f.short } : {}), ...(f.kind ? { kind: f.kind } : {}) };
    const r = await api("/vectorize/v2/indexes/eu-law/query", { vector: v, topK, returnMetadata: "none", ...(Object.keys(filter).length ? { filter } : {}) });
    return r.matches.map((m) => m.id);
  },
  async keywords(match, limit, f) {
    const c = where(f);
    return (await sql(`SELECT f.id AS id FROM passages_fts f JOIN passages p ON p.id = f.id WHERE passages_fts MATCH ?${c.length ? ` AND ${c.join(" AND ")}` : ""} ORDER BY bm25(passages_fts, 0, 1.0, 4.0, 3.0, 1.0) LIMIT ?`, [match, ...(f.short ? [f.short] : []), ...(f.kind ? [f.kind] : []), limit])).map((x) => x.id);
  },
  async rows(ids) { return sql(`SELECT * FROM passages WHERE id IN (${ids.map(() => "?").join(",")})`, ids); },
  async rerank(q, docs) {
    const r = await api(`/ai/run/${RERANK_MODEL}`, { query: q.slice(0, 1000), contexts: docs.map((text) => ({ text })), top_k: docs.length });
    return (r.response ?? []).map((x) => ({ index: x.id, score: x.score }));
  },
};

const set = JSON.parse(readFileSync(join(here, "eval-questions.json"), "utf8"));
const rows = [];
for (const { q, expect, heldOut } of set) {
  const t = Date.now();
  const found = await lawSearch(q, { count: 5 }, deps);
  const cites = found.candidates.slice(0, 5).map((r) => `${r.short}, ${r.label}`);
  const i = cites.findIndex((c) => expect.includes(c));
  rows.push({ q, expect, heldOut: !!heldOut, rank: i >= 0 ? i + 1 : null, ms: Date.now() - t, top: cites.slice(0, 3) });
  console.log(`${i === 0 ? "1 " : i > 0 ? `${i + 1} ` : "- "} ${heldOut ? "H" : " "} ${q}  -> ${cites.slice(0, 3).join(" | ")}`);
}
const sum = (rs) => ({ n: rs.length, h1: rs.filter((r) => r.rank === 1).length, h5: rs.filter((r) => r.rank !== null).length, ms: Math.round(rs.reduce((s, r) => s + r.ms, 0) / Math.max(1, rs.length)) });
const all = sum(rows), held = sum(rows.filter((r) => r.heldOut)), tuned = sum(rows.filter((r) => !r.heldOut));
console.log(`\nours: all ${all.h1}/${all.n} @1, ${all.h5}/${all.n} @5 | held-out ${held.h1}/${held.n} @1, ${held.h5}/${held.n} @5 | tuning set ${tuned.h1}/${tuned.n} @1, ${tuned.h5}/${tuned.n} @5 | avg ${all.ms} ms`);
if (process.argv[2]) writeFileSync(process.argv[2], JSON.stringify({ engine: "ours /law/search", date: new Date().toISOString(), all, held, tuned, rows }, null, 1));
