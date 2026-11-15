// Our own web index, first vertical: developer documentation (Beat-Exa plan 4c, owner 15 Nov 2026: "own index + ask
// Mojeek"). Pages come from Common Crawl (its terms: a limited licence for any lawful use; the pages stay their
// publishers'), never from a search API. We keep an index entry per page: URL, title, description, headings and the
// first part of the text for ranking and a snippet. We never republish whole pages: results link to the source.
//
//   node scripts/web-index/build.mjs <sites.json> <outDir> [--crawl CC-MAIN-2026-43] [--per-site 400]
//
// sites.json: [{ "site": "react.dev", "prefix": "react.dev/reference/", "name": "React" }, …]
// Writes <outDir>/pages.jsonl and pages.sql (D1: table pages + FTS5 table pages_fts). Load with load.ps1.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";

const [sitesFile, out] = process.argv.slice(2);
if (!sitesFile || !out) throw new Error("usage: build.mjs <sites.json> <outDir> [--crawl id] [--per-site n]");
const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : fallback; };
const CRAWL = arg("--crawl", "CC-MAIN-2026-43");
const PER_SITE = Number(arg("--per-site", "400"));
const UA = "AgentDataTools-index/1.0 (+https://agent-data-tools.revmesh2074.workers.dev)";
const sites = JSON.parse(readFileSync(sitesFile, "utf8"));
mkdirSync(out, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function get(url, init = {}, tries = 4) {
  for (let i = 0; ; i++) {
    try {
      const r = await fetch(url, { ...init, headers: { "user-agent": UA, ...(init.headers ?? {}) }, signal: AbortSignal.timeout(60_000) });
      if (r.ok || r.status === 206) return r;
      // 404: nothing captured; 400 from the index server: a result page past the last one.
      if (r.status === 404 || (r.status === 400 && url.includes("index.commoncrawl.org"))) return null;
      if (i >= tries - 1) throw new Error(`${url} HTTP ${r.status}`);
    } catch (e) { if (i >= tries - 1) throw e; }
    await sleep(2000 * 2 ** i); // Common Crawl asks clients to back off on 503s
  }
}

/** Every captured HTML page under the prefix, newest capture per URL (collapse on the URL key). */
async function listPages(prefix) {
  const rows = [];
  for (let page = 0; rows.length < PER_SITE * 2 && page < 20; page++) {
    const q = new URLSearchParams({ url: `${prefix}*`, output: "json", page: String(page), collapse: "urlkey" });
    q.append("filter", "status:200"); q.append("filter", "mime:text/html");
    const r = await get(`https://index.commoncrawl.org/${CRAWL}-index?${q}`);
    if (!r) break;
    const text = await r.text();
    const lines = text.split("\n").filter(Boolean);
    if (!lines.length) break;
    for (const l of lines) { try { rows.push(JSON.parse(l)); } catch { /* skip */ } }
    if (lines.length < 5) break;
  }
  // Skip obvious non-pages (assets, query strings) and URLs seen on an earlier result page (collapse works per page).
  const seen = new Set();
  return rows.filter((r) => {
    const key = r.url.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "");
    if (seen.has(key) || /[?#]|\.(png|jpe?g|gif|svg|css|js|json|xml|pdf|zip)$/i.test(r.url)) return false;
    seen.add(key);
    return true;
  }).slice(0, PER_SITE);
}

const decode = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (m, e) => {
  const k = e.toLowerCase();
  if (k[0] === "#") return String.fromCodePoint(k[1] === "x" ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10));
  return { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " }[k] ?? m;
});
const clean = (s) => decode(s.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

/** Title, description, h1-h3 and the main text of one HTML page; navigation, scripts and footers removed. */
export function extract(html) {
  const title = clean(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "");
  const description = clean(html.match(/<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["']/i)?.[1] ?? html.match(/<meta[^>]+content=["']([^"']*)["'][^>]*name=["']description["']/i)?.[1] ?? "");
  const lang = html.match(/<html[^>]*\blang=["']([a-z]{2})/i)?.[1]?.toLowerCase() ?? null;
  let body = html.replace(/<(script|style|noscript|svg|nav|header|footer|aside|form)\b[\s\S]*?<\/\1>/gi, " ");
  const main = body.match(/<(main|article)\b[\s\S]*?<\/\1>/i)?.[0];
  if (main && main.length > 500) body = main;
  const headings = [...body.matchAll(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi)].map((m) => clean(m[1])).filter(Boolean).slice(0, 30);
  return { title, description, lang, headings, text: clean(body) };
}

async function fetchRecord(r) {
  const end = Number(r.offset) + Number(r.length) - 1;
  const res = await get(`https://data.commoncrawl.org/${r.filename}`, { headers: { range: `bytes=${r.offset}-${end}` } });
  if (!res) return null;
  const raw = gunzipSync(Buffer.from(await res.arrayBuffer())).toString("utf8");
  const i = raw.search(/<html|<!doctype html/i);
  return i >= 0 ? raw.slice(i) : null;
}

const sqlStr = (v) => (v === null || v === undefined ? "NULL" : `'${String(v).replace(/'/g, "''")}'`);
const pagesFile = join(out, "pages.jsonl");
writeFileSync(pagesFile, "");
let total = 0;
for (const s of sites) {
  const list = await listPages(s.prefix);
  let kept = 0;
  for (let i = 0; i < list.length; i += 6) {
    const batch = await Promise.all(list.slice(i, i + 6).map(async (r) => {
      try {
        const html = await fetchRecord(r);
        if (!html) return null;
        const p = extract(html);
        if (p.text.length < 200 || (p.lang && p.lang !== "en")) return null;
        return {
          id: createHash("sha256").update(r.url).digest("hex").slice(0, 24), url: r.url, site: s.site, source: s.name,
          title: p.title.slice(0, 300), description: p.description.slice(0, 500), headings: p.headings.join(" | ").slice(0, 1500),
          text: p.text.slice(0, 6000), crawled: `${r.timestamp.slice(0, 4)}-${r.timestamp.slice(4, 6)}-${r.timestamp.slice(6, 8)}`,
        };
      } catch { return null; }
    }));
    for (const p of batch.filter(Boolean)) { appendFileSync(pagesFile, `${JSON.stringify(p)}\n`); kept++; }
  }
  total += kept;
  console.log(`${s.site}: ${list.length} captures, ${kept} pages kept`);
}

const byId = new Map(readFileSync(pagesFile, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).map((p) => [p.id, p]));
const pages = [...byId.values()];
const ddl = [
  "DROP TABLE IF EXISTS pages_fts;", "DROP TABLE IF EXISTS pages;",
  "CREATE TABLE pages (id TEXT PRIMARY KEY, url TEXT, site TEXT, source TEXT, title TEXT, description TEXT, headings TEXT, text TEXT, crawled TEXT);",
  "CREATE VIRTUAL TABLE pages_fts USING fts5(id UNINDEXED, title, headings, description, text, tokenize='porter unicode61');",
];
const rows = pages.flatMap((p) => [
  `INSERT INTO pages VALUES (${[p.id, p.url, p.site, p.source, p.title, p.description, p.headings, p.text, p.crawled].map(sqlStr).join(",")});`,
  `INSERT INTO pages_fts VALUES (${[p.id, p.title, p.headings, p.description, p.text].map(sqlStr).join(",")});`,
]);
writeFileSync(join(out, "pages.sql"), [...ddl, ...rows].join("\n"));
console.log(`total ${total} pages from ${sites.length} sites (${CRAWL}) -> ${out}`);
