#!/usr/bin/env node
// Tell IndexNow search engines (Bing, Yandex, Seznam, Naver) which pages of the live sitemap changed.
// Run after a deploy, from the owner's computer:
//   node scripts/indexnow.mjs [origin] [--dry] [--changed-since <git ref | ISO date>]
//   --dry             only GETs the key file and the sitemap, then prints what would be sent
//   --changed-since   only pages whose sitemap <lastmod> is on or after that day (a git ref means its commit day, UTC)
// The key file must already be live at <origin>/<key>.txt (src/index.ts INDEXNOW_KEY).
//
// With no origin it submits ONE host: the public home of the human pages (PUBLIC_SITE_ORIGIN in wrangler.jsonc,
// https://glyphcall.com since 15 Nov 2026). Every page names that host as canonical, so its URLs are the ones a search
// engine should hold. Until 16 Nov 2026 the workers.dev copies were submitted as well: duplicates of the same pages.
// An origin given by hand is still submitted as before (for example once for an old host, after its pages redirect).
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ENDPOINT = "https://api.indexnow.org/indexnow";
/** The protocol takes at most 10,000 URLs in one POST. */
export const MAX_URLS = 10_000;
const FALLBACK_ORIGIN = "https://agent-data-tools.revmesh2074.workers.dev";

/** <url> entries of a sitemap: the address and, where the sitemap gives one, its lastmod. */
export function parseSitemap(xml) {
  const unescape = (s) => s.trim().replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&quot;", '"').replaceAll("&apos;", "'").replaceAll("&amp;", "&");
  return [...xml.matchAll(/<url>([\s\S]*?)<\/url>/g)].flatMap(([, body]) => {
    const loc = /<loc>([^<]+)<\/loc>/.exec(body)?.[1];
    const lastmod = /<lastmod>([^<]+)<\/lastmod>/.exec(body)?.[1]?.trim();
    return loc ? [{ loc: unescape(loc), ...(lastmod ? { lastmod } : {}) }] : [];
  });
}

/**
 * The URLs to submit for `origin`: https URLs on exactly that host (IndexNow answers 422 to anything else), each once.
 * With `since` (a YYYY-MM-DD day) only pages whose lastmod is on or after it: a lastmod has no time of day, so the
 * day itself counts. A page without lastmod is left out then, because nothing says it changed. A sitemap with no
 * lastmod at all cannot answer the question, so everything is submitted, as before lastmod existed (`all` is true).
 */
export function selectUrls(entries, origin, since) {
  const host = new URL(origin).host;
  const seen = new Set();
  const own = entries.filter((e) => {
    let url;
    try { url = new URL(e.loc); } catch { return false; }
    if (url.protocol !== "https:" || url.host !== host || seen.has(e.loc)) return false;
    seen.add(e.loc);
    return true;
  });
  const otherHost = new Set(entries.map((e) => e.loc)).size - own.length;
  const dated = own.filter((e) => e.lastmod);
  if (!since || dated.length === 0) return { urls: own.map((e) => e.loc), otherHost, undated: own.length - dated.length, unchanged: 0, all: true };
  const changed = dated.filter((e) => e.lastmod.slice(0, 10) >= since);
  return { urls: changed.map((e) => e.loc), otherHost, undated: own.length - dated.length, unchanged: dated.length - changed.length, all: false };
}

export function batches(urls, size = MAX_URLS) {
  const out = [];
  for (let i = 0; i < urls.length; i += size) out.push(urls.slice(i, i + size));
  return out;
}

/** The POST body. host and keyLocation are the origin's own, so they always match the URLs `selectUrls` kept. */
export function payload(origin, key, urlList) {
  const o = origin.replace(/\/+$/, "");
  return { host: new URL(o).host, key, keyLocation: `${o}/${key}.txt`, urlList };
}

/** What an IndexNow answer means. Only 200 and 202 are success; `retry` marks the one case worth a second try. */
export function verdict(status) {
  if (status === 200) return { ok: true, meaning: "received" };
  if (status === 202) return { ok: true, meaning: "accepted; the key file is still to be checked by the engine" };
  if (status === 400) return { ok: false, meaning: "bad request: the body is not in the IndexNow format" };
  if (status === 403) return { ok: false, meaning: "the key is not valid: the key file was not found on the host or holds another key" };
  if (status === 422) return { ok: false, meaning: "a URL does not belong to the host, or the key does not match the protocol" };
  if (status === 429) return { ok: false, meaning: "too many requests: IndexNow treats this as possible spam; wait before another run" };
  if (status >= 500) return { ok: false, retry: true, meaning: "the IndexNow server failed" };
  return { ok: false, meaning: "an answer the protocol does not name" };
}

/** `--changed-since` as a UTC day: an ISO date or date-time as given, anything else as a git ref (its commit day). */
export function sinceDay(value, commitSeconds) {
  if (/^\d{4}-\d{2}-\d{2}([T ].*)?$/.test(value)) {
    const at = Date.parse(value.length === 10 ? `${value}T00:00:00Z` : value);
    if (Number.isNaN(at)) throw new Error(`--changed-since ${value} is not a date`);
    return new Date(at).toISOString().slice(0, 10);
  }
  const seconds = Number(commitSeconds(value));
  if (!Number.isFinite(seconds) || seconds <= 0) throw new Error(`--changed-since ${value} is neither an ISO date nor a git ref of this clone`);
  return new Date(seconds * 1000).toISOString().slice(0, 10);
}

export function parseArgs(args) {
  const at = args.indexOf("--changed-since");
  if (at >= 0 && (args[at + 1] === undefined || args[at + 1].startsWith("--"))) throw new Error("--changed-since needs a git ref or an ISO date");
  const rest = args.filter((_, i) => at < 0 || (i !== at && i !== at + 1));
  const unknown = rest.find((a) => a.startsWith("--") && a !== "--dry");
  if (unknown) throw new Error(`unknown option ${unknown}`);
  return { dry: rest.includes("--dry"), origin: rest.find((a) => !a.startsWith("--"))?.replace(/\/+$/, ""), changedSince: at >= 0 ? args[at + 1] : undefined };
}

/** The host submitted when none is given: the public site, or the Worker's own address where no public site is set. */
export const defaultOrigin = (wranglerText) => /"PUBLIC_SITE_ORIGIN":\s*"(https:\/\/[^"/]+)\/?"/.exec(wranglerText)?.[1] ?? FALLBACK_ORIGIN;

/** Runs one submission; false when IndexNow refused it. `io` lets the test stand in for the network. */
export async function main(argv, { fetch = globalThis.fetch, retryWaitMs = 5000 } = {}) {
  const root = new URL("../", import.meta.url);
  const { dry, origin: given, changedSince } = parseArgs(argv);
  const origin = given ?? defaultOrigin(readFileSync(new URL("wrangler.jsonc", root), "utf8"));
  const key = /INDEXNOW_KEY = "([0-9a-f]{32})"/.exec(readFileSync(new URL("src/index.ts", root), "utf8"))?.[1];
  if (!key) throw new Error("INDEXNOW_KEY not found in src/index.ts");
  const since = changedSince === undefined ? undefined : sinceDay(changedSince, (ref) => {
    try { return execFileSync("git", ["log", "-1", "--format=%ct", ref, "--"], { cwd: fileURLToPath(root), encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { return ""; }
  });
  const host = new URL(origin).host;

  const keyFile = await fetch(`${origin}/${key}.txt`);
  const keyServed = keyFile.ok && (await keyFile.text()).trim() === key;
  if (!keyServed && !dry) throw new Error(`${origin}/${key}.txt does not serve the key yet; deploy first`);
  const sitemapRes = await fetch(`${origin}/sitemap.xml`);
  if (!sitemapRes.ok) throw new Error(`${origin}/sitemap.xml answered HTTP ${sitemapRes.status}`);
  const entries = parseSitemap(await sitemapRes.text());
  const picked = selectUrls(entries, origin, since);
  console.log(`${entries.length} URLs in ${origin}/sitemap.xml; ${picked.urls.length} to submit for ${host}` +
    (since ? (picked.all ? ` (the sitemap has no lastmod, so --changed-since ${since} cannot choose: all of them)` : ` (lastmod on or after ${since}; ${picked.unchanged} older, ${picked.undated} without lastmod)`) : "") +
    (picked.otherHost ? `; ${picked.otherHost} on another host left out` : ""));
  if (entries.length > 0 && picked.urls.length === 0 && picked.otherHost === entries.length) throw new Error(`no URL in the sitemap is on ${host}: the host answers with another host's sitemap (it redirects), so there is nothing to submit for it`);
  if (picked.urls.length === 0) { console.log(`IndexNow ${host}: nothing changed${since ? ` since ${since}` : ""}; no request sent`); return true; }

  const parts = batches(picked.urls);
  if (dry) {
    console.log(`IndexNow ${host}: dry run, nothing sent. Key file ${keyServed ? "is served" : "is NOT served yet (a real run stops here)"}.`);
    parts.forEach((urlList, i) => {
      const body = payload(origin, key, urlList);
      console.log(`POST ${ENDPOINT} (${i + 1} of ${parts.length}) host=${body.host} keyLocation=${body.keyLocation} urlList=${urlList.length} URLs:`);
      for (const u of urlList) console.log(`  ${u}`);
    });
    return true;
  }
  for (const [i, urlList] of parts.entries()) {
    const send = () => fetch(ENDPOINT, { method: "POST", headers: { "content-type": "application/json; charset=utf-8" }, body: JSON.stringify(payload(origin, key, urlList)) })
      .then(async (res) => ({ status: res.status, text: (await res.text()).slice(0, 300), retryAfter: res.headers.get("retry-after") }), (e) => ({ status: 599, text: String(e?.message ?? e), retryAfter: null }));
    let res = await send();
    if (verdict(res.status).retry) { await new Promise((r) => setTimeout(r, retryWaitMs)); res = await send(); }
    const v = verdict(res.status);
    console.log(`IndexNow ${host}: HTTP ${res.status} ${v.meaning} (${urlList.length} URLs, batch ${i + 1} of ${parts.length})${res.retryAfter ? ` retry-after ${res.retryAfter}` : ""}${res.text ? ` ${res.text}` : ""}`);
    if (!v.ok) return false;
  }
  return true;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((ok) => { if (!ok) process.exitCode = 1; }, (e) => { console.error(`IndexNow: ${e.message}`); process.exitCode = 1; });
}
