// Our own polite docs crawler (owner's go-ahead 15 Nov 2026: "Yes, build it"), replacing Common Crawl for coverage:
// the v1 index from Common Crawl held the right page for only 28 of 89 benchmark questions.
//
// Rules, in code below:
// - robots.txt is read first and obeyed (Allow/Disallow with * and $, longest match wins, Allow on a tie; Crawl-delay).
//   A site whose robots.txt cannot be read (5xx) is skipped; a 4xx robots.txt allows all (RFC 9309).
// - Pages come from the site's own sitemaps (robots Sitemap: lines, else /sitemap.xml and /sitemap_index.xml; .gz too;
//   sitemap indexes followed two levels), limited to the docs prefix. No link-following beyond that.
// - One request at a time per site, at least 1 s apart (or the Crawl-delay); a named user agent with a contact URL.
// - Old-version paths (v1.6.x, /enterprise-server@3.15/, /en/5.1/ when a newer one exists…) are dropped; shorter paths
//   first, so core pages come before deep ones when a site is capped.
// - Kept per page: URL (the page's own canonical when it names one on the same host), title, description, headings and
//   the first 4,000 characters of text, for ranking and snippets. Pages are never republished.
//
//   node scripts/web-index/crawl.mjs <sites.json> <outDir> [--per-site 3000] [--sites-at-once 16]
// Output: the same schema.sql + site-NNN-<site>.sql + done.txt as build.mjs, so load.ps1 loads it.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { extract } from "./extract.mjs";

export const UA_TOKEN = "GlyphcallDocsBot";
const UA = `${UA_TOKEN}/1.0 (+https://tools.funwords.eu/support; indexes public developer documentation, obeys robots.txt)`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => new Date().toISOString().slice(11, 19);

/** robots.txt -> the rules for our token, else for "*": { allow(path), delayMs, sitemaps }. */
export function parseRobots(txt) {
  const groups = [];
  let current = null, lastWasAgent = false;
  const sitemaps = [];
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1].toLowerCase(), value = m[2].trim();
    if (key === "sitemap") { sitemaps.push(value); continue; }
    if (key === "user-agent") {
      if (!lastWasAgent || !current) { current = { agents: [], rules: [], delay: null }; groups.push(current); }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) continue;
    if (key === "allow" || key === "disallow") { if (value || key === "allow") current.rules.push({ allow: key === "allow", path: value }); }
    else if (key === "crawl-delay") { const d = Number(value); if (Number.isFinite(d) && d >= 0) current.delay = d; }
  }
  const mine = groups.filter((g) => g.agents.some((a) => a !== "*" && UA_TOKEN.toLowerCase().includes(a)));
  const chosen = mine.length ? mine : groups.filter((g) => g.agents.includes("*"));
  const rules = chosen.flatMap((g) => g.rules);
  const delays = chosen.map((g) => g.delay).filter((d) => d !== null);
  const toRe = (p) => new RegExp(`^${p.replace(/[.+?^{}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\\\$$|\$$/, "$")}`);
  const compiled = rules.filter((r) => r.path).map((r) => ({ ...r, re: toRe(r.path), len: r.path.length }));
  return {
    sitemaps,
    delayMs: delays.length ? Math.min(Math.max(...delays), 30) * 1000 : 0,
    allow(path) {
      let best = null;
      for (const r of compiled) if (r.re.test(path) && (!best || r.len > best.len || (r.len === best.len && r.allow))) best = r;
      return !best || best.allow;
    },
  };
}

/** Old-version and translated copies that crowd out the current page. */
const VERSIONED = /\/v?\d+\.\d+(\.x|\.\d+)?\/|enterprise-server@|\/(\d+\.\d+)\/|\/(previous|archive|archived|legacy|old)-?(versions?)?\//i;
/** Inside the docs prefix and an HTML page (no query, no asset). */
export function inScope(url, prefix) {
  const u = url.replace(/^https?:\/\//, "").replace(/^www\./, "");
  if (!u.startsWith(prefix.replace(/^www\./, ""))) return false;
  return !/[?#]/.test(url) && !/\.(png|jpe?g|gif|svg|css|js|json|xml|pdf|zip|txt|ico|woff2?)$/i.test(url);
}
/** In scope and not an old-version or archived copy. */
export function keepUrl(url, prefix) {
  if (!inScope(url, prefix)) return false;
  const u = url.replace(/^https?:\/\//, "").replace(/^www\./, "");
  return !VERSIONED.test(u.slice(prefix.replace(/^www\./, "").length - 1));
}

async function get(url, { binary = false } = {}) {
  const r = await fetch(url, { headers: { "user-agent": UA, accept: binary ? "*/*" : "text/html,application/xhtml+xml,application/xml;q=0.9" }, redirect: "follow", signal: AbortSignal.timeout(20_000) });
  return r;
}

async function sitemapUrls(site, robots, perSite, pace) {
  const origin = `https://${site.prefix.split("/")[0]}`;
  const queue = robots.sitemaps.length ? [...robots.sitemaps] : [`${origin}/sitemap.xml`, `${origin}/sitemap_index.xml`];
  const seen = new Set(), urls = new Set();
  for (let depth = 0; queue.length && depth < 400; depth++) {
    const sm = queue.shift();
    if (seen.has(sm)) continue;
    seen.add(sm);
    await pace();
    let xml;
    try {
      const r = await get(sm, { binary: true });
      if (!r.ok) continue;
      const buf = Buffer.from(await r.arrayBuffer());
      xml = (sm.endsWith(".gz") || (buf[0] === 0x1f && buf[1] === 0x8b) ? gunzipSync(buf) : buf).toString("utf8");
    } catch { continue; }
    const locs = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1].replace(/&amp;/g, "&"));
    if (/<sitemapindex/i.test(xml)) {
      // Child sitemaps: prefer the ones that look like the docs section or English.
      const lang = locs.filter((l) => !/\/(?!en)[a-z]{2}(-[a-z]{2})?\/|_(?!en)[a-z]{2}\.xml/i.test(l));
      queue.push(...(lang.length ? lang : locs).slice(0, 200));
    } else {
      for (const l of locs) if (inScope(l, site.prefix)) urls.add(l);
    }
    if (urls.size > perSite * 6) break;
  }
  // Versions: drop old-version copies when the site has current unversioned pages; a site whose docs exist only under
  // version paths (Django's /en/5.2/) keeps its newest version.
  const all = [...urls];
  const unversioned = all.filter((u) => keepUrl(u, site.prefix));
  let chosen = unversioned;
  if (unversioned.length < Math.max(20, all.length * 0.1)) {
    const ver = (u) => u.match(/\/v?(\d+(?:\.\d+)+)(?:\.x)?\//)?.[1];
    const newest = [...new Set(all.map(ver).filter(Boolean))].sort((a, b) => b.split(".").map(Number).reduce((d, x, i) => d || x - (Number(a.split(".")[i]) || 0), 0))[0];
    if (newest) chosen = [...unversioned, ...all.filter((u) => ver(u) === newest)];
  }
  // Shorter paths first: overview and reference pages before deep ones.
  return chosen.sort((a, b) => a.split("/").length - b.split("/").length || a.length - b.length).slice(0, perSite);
}

const sqlStr = (v) => (v === null || v === undefined ? "NULL" : `'${String(v).replace(/'/g, "''")}'`);

async function crawlSite(site, n, out, perSite, textChars) {
  const host = site.prefix.split("/")[0];
  let last = 0, delay = 1000;
  const pace = async () => { const wait = last + delay - Date.now(); if (wait > 0) await sleep(wait); last = Date.now(); };
  let robots;
  try {
    await pace();
    const r = await get(`https://${host}/robots.txt`);
    if (r.status >= 500) return { skipped: `robots.txt HTTP ${r.status}` };
    robots = parseRobots(r.ok ? await r.text() : "");
  } catch (e) { return { skipped: `robots.txt unreachable (${e.message})` }; }
  delay = Math.max(1000, robots.delayMs);
  const allowed = (u) => { try { const x = new URL(u); return robots.allow(x.pathname + x.search); } catch { return false; } };
  const fromSitemaps = (await sitemapUrls(site, robots, perSite, pace)).filter(allowed);
  // Too few pages in the sitemaps (none at all for react.dev; Python's lists one): follow links inside the docs prefix
  // from its start page instead, breadth-first, so near pages come before deep ones. Same robots, pace and scope rules.
  const followLinks = fromSitemaps.length < Math.min(50, perSite);
  const urls = followLinks ? [...new Set([`https://${site.prefix}`, ...fromSitemaps])] : fromSitemaps;
  const queued = new Set(urls.map((u) => u.replace(/\/+$/, "")));
  const lines = [], seen = new Set();
  let kept = 0, fetched = 0;
  for (let i = 0; i < urls.length && fetched < perSite; i++) {
    const url = urls[i];
    fetched++;
    await pace();
    try {
      const r = await get(url);
      if (!r.ok || !/html/i.test(r.headers.get("content-type") ?? "")) { await r.body?.cancel().catch(() => {}); continue; }
      const html = await r.text();
      if (followLinks) {
        for (const m of html.matchAll(/<a\b[^>]*\bhref=["']([^"'#]+)/gi)) {
          let next;
          try { next = new URL(m[1], r.url).href; } catch { continue; }
          const key = next.replace(/\/+$/, "");
          if (!queued.has(key) && keepUrl(next, site.prefix) && allowed(next) && urls.length < perSite * 3) { queued.add(key); urls.push(next); }
        }
      }
      const p = extract(html);
      if (p.text.length < 200 || (p.lang && p.lang !== "en")) continue;
      let finalUrl = r.url;
      if (p.canonical) { try { const c = new URL(p.canonical, r.url); if (c.host === new URL(r.url).host) finalUrl = c.href; } catch { /* keep */ } }
      const id = createHash("sha256").update(finalUrl.replace(/\/+$/, "")).digest("hex").slice(0, 24);
      if (seen.has(id)) continue;
      seen.add(id);
      lines.push(`INSERT INTO pages VALUES (${[id, finalUrl, site.site, site.name, p.title.slice(0, 300), p.description.slice(0, 500), p.headings.join(" | ").slice(0, 1500), p.text.slice(0, textChars), new Date().toISOString().slice(0, 10)].map(sqlStr).join(",")});`);
      kept++;
    } catch { /* one page failing does not stop the site */ }
  }
  writeFileSync(join(out, `site-${String(n).padStart(3, "0")}-${site.site.replace(/[^a-z0-9.-]/gi, "_")}.sql`), lines.join("\n"));
  return { urls: urls.length, kept, sitemaps: robots.sitemaps.length };
}

if (process.argv[1]?.endsWith("crawl.mjs")) {
  const [sitesFile, out] = process.argv.slice(2);
  if (!sitesFile || !out) throw new Error("usage: crawl.mjs <sites.json> <outDir> [--per-site 3000] [--sites-at-once 16]");
  const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : fallback; };
  const perSite = Number(arg("--per-site", "3000")), atOnce = Number(arg("--sites-at-once", "16")), textChars = Number(arg("--text", "4000"));
  const sites = JSON.parse(readFileSync(sitesFile, "utf8"));
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "schema.sql"), [
    "DROP TABLE IF EXISTS pages_fts;", "DROP TABLE IF EXISTS pages;",
    "CREATE TABLE pages (id TEXT PRIMARY KEY, url TEXT, site TEXT, source TEXT, title TEXT, description TEXT, headings TEXT, text TEXT, crawled TEXT);",
    "CREATE VIRTUAL TABLE pages_fts USING fts5(id UNINDEXED, title, headings, description, text, tokenize='porter unicode61');",
  ].join("\n"));
  const doneFile = join(out, "done.txt");
  const done = new Set(existsSync(doneFile) ? readFileSync(doneFile, "utf8").split("\n").map((l) => l.split("\t")[0]).filter(Boolean) : []);
  const todo = sites.map((s, i) => ({ s, n: i + 1 })).filter(({ s }) => !done.has(s.site));
  let total = 0;
  // Different hosts in parallel; one host (even with two docs sections in the list) strictly one request at a time.
  const busyHosts = new Set();
  const hostOf = (s) => s.prefix.split("/")[0].replace(/^www\./, "");
  const take = () => { const i = todo.findIndex((j) => !busyHosts.has(hostOf(j.s))); return i < 0 ? null : todo.splice(i, 1)[0]; };
  await Promise.all(Array.from({ length: Math.min(atOnce, todo.length) }, async () => {
    while (todo.length) {
      const job = take();
      if (!job) { await sleep(5000); continue; }
      busyHosts.add(hostOf(job.s));
      const r = await crawlSite(job.s, job.n, out, perSite, textChars).catch((e) => ({ skipped: e.message }));
      busyHosts.delete(hostOf(job.s));
      if (r.skipped) { console.log(`${now()} ${job.s.site}: SKIPPED (${r.skipped})`); continue; }
      appendFileSync(doneFile, `${job.s.site}\t${r.kept}\n`);
      total += r.kept;
      console.log(`${now()} ${job.s.site}: ${r.sitemaps} sitemap(s), ${r.urls} URLs in scope, ${r.kept} pages kept (total ${total})`);
    }
  }));
  console.log(`total ${total} pages -> ${out}`);
}
