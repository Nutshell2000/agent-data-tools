// Developer-docs benchmark (15 Nov 2026): eval-docs.json (103 questions, each with the official page(s) that answer it,
// written and checked against the live sites before any search ran) through our /docs/search code or Exa's /search.
// Both are scored the same, strictly: a hit when a result URL is an expected page, or the page an expected URL redirects
// to today (scheme, www, trailing slash, query and fragment ignored).
//   node scripts/web-index/eval-docs.mjs ours out.json   (needs CF_ACCOUNT_ID and CF_API_TOKEN, like law-index/eval-ours.mjs)
//   node scripts/web-index/eval-docs.mjs exa  out.json <exa key file>
import { build } from "esbuild";
import { createRequire } from "node:module";
import { existsSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const [engine, outFile, keyFile] = process.argv.slice(2);
if (!["ours", "exa"].includes(engine)) throw new Error("usage: eval-docs.mjs ours|exa out.json [exa key file]");
const set = JSON.parse(readFileSync(join(here, "eval-docs.json"), "utf8"));
const norm = (u) => String(u).replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/[?#].*$/, "").replace(/\/+$/, "").replace(/\.html$/, "").toLowerCase();

// Where each expected URL redirects today, cached next to the questions so both engines are scored on the same targets.
const cacheFile = join(here, "eval-docs-targets.json");
let targets = existsSync(cacheFile) ? JSON.parse(readFileSync(cacheFile, "utf8")) : null;
if (!targets) {
  targets = {};
  for (const u of new Set(set.flatMap((x) => x.expect))) {
    try { const r = await fetch(`https://${u}`, { redirect: "follow", headers: { "user-agent": "Mozilla/5.0 (docs benchmark)" }, signal: AbortSignal.timeout(20_000) }); targets[u] = r.url; }
    catch { targets[u] = null; }
  }
  writeFileSync(cacheFile, JSON.stringify(targets, null, 1));
}
const accepted = (x) => new Set(x.expect.flatMap((u) => [norm(u), targets[u] ? norm(targets[u]) : null]).filter(Boolean));

let search;
if (engine === "exa") {
  const key = readFileSync(keyFile, "utf8").trim();
  search = async (q) => {
    const r = await fetch("https://api.exa.ai/search", { method: "POST", headers: { "x-api-key": key, "content-type": "application/json" }, body: JSON.stringify({ query: q, type: "auto", numResults: 5 }) });
    const j = await r.json();
    return { urls: (j.results ?? []).map((x) => x.url), cost: j.costDollars?.total ?? 0 };
  };
} else {
  const { CF_ACCOUNT_ID: account, CF_API_TOKEN: token } = process.env;
  if (!account || !token) throw new Error("set CF_ACCOUNT_ID and CF_API_TOKEN");
  const api = async (path, body) => {
    for (let i = 0; ; i++) {
      const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}${path}`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (r.ok && j.success !== false) return j.result;
      if (i >= 2) throw new Error(`${path}: HTTP ${r.status}`);
      await new Promise((res) => setTimeout(res, 1500 * (i + 1)));
    }
  };
  const out = join(here, "../../.docs-eval-build.cjs");
  writeFileSync(out, (await build({ entryPoints: [join(here, "../../src/routes/docs-search.ts")], bundle: true, platform: "node", format: "cjs", write: false })).outputFiles[0].text);
  const { docsSearch } = createRequire(import.meta.url)(out);
  rmSync(out);
  const DB = "62e28b2e-9b59-4109-a6e1-764a6643951b";
  const deps = {
    async keywords(match, limit, site) {
      return (await api(`/d1/database/${DB}/query`, { sql: `SELECT p.* FROM pages_fts f JOIN pages p ON p.id = f.id WHERE pages_fts MATCH ?${site ? " AND p.url LIKE ?" : ""} ORDER BY bm25(pages_fts, 0, 10.0, 5.0, 3.0, 1.0) LIMIT ?`, params: [match, ...(site ? [`%${site}%`] : []), limit] }))[0].results;
    },
    async rerank(q, docs) {
      const r = await api("/ai/run/@cf/baai/bge-reranker-base", { query: q.slice(0, 1000), contexts: docs.map((text) => ({ text })), top_k: docs.length });
      return (r.response ?? []).map((x) => ({ index: x.id, score: x.score }));
    },
  };
  search = async (q) => ({ urls: (await docsSearch(q, { count: 5, site: null }, deps)).candidates.slice(0, 5).map((r) => r.url), cost: 0 });
}

const rows = [];
for (const x of set) {
  const t = Date.now();
  let urls = [], cost = 0;
  try { ({ urls, cost } = await search(x.q)); } catch (e) { console.log(`ERR ${x.q}: ${e.message}`); }
  const ok = accepted(x);
  const i = urls.slice(0, 5).findIndex((u) => ok.has(norm(u)));
  rows.push({ q: x.q, rank: i >= 0 ? i + 1 : null, ms: Date.now() - t, cost, top: urls.slice(0, 3) });
  console.log(`${i === 0 ? "1 " : i > 0 ? `${i + 1} ` : "- "} ${x.q}  -> ${urls.slice(0, 2).join(" | ")}`);
}
const h1 = rows.filter((r) => r.rank === 1).length, h5 = rows.filter((r) => r.rank !== null).length;
const ms = Math.round(rows.reduce((s, r) => s + r.ms, 0) / rows.length), cost = rows.reduce((s, r) => s + r.cost, 0);
console.log(`\n${engine}: right page first ${h1}/${rows.length}, in top 5 ${h5}/${rows.length}, avg ${ms} ms${cost ? `, cost $${cost.toFixed(3)}` : ""}`);
if (outFile) writeFileSync(outFile, JSON.stringify({ engine, date: new Date().toISOString(), h1, h5, n: rows.length, ms, cost, rows }, null, 1));
