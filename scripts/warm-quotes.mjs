// Refills the quote front after a production deploy (21 Nov 2026).
//
// Why: the front (src/front) answers a repeated unpaid quote from KV without waking the core, but a stored quote is used
// only while its release fingerprint is the current one. Every deploy of the core therefore retires all of them, and the
// next probe of each listing reaches the 15 MB core, possibly cold, while routers time a probe out at about 1.5 s and
// count the miss against the whole service. This script asks for the quotes right after the deploy, so the front holds
// the new release's quotes within a minute or two instead of whenever a crawler gets round to each URL.
//
// What it sends: plain unpaid GETs from a program (no payment header, no key, no trial, no browser headers), the
// request a router's probe makes. Nothing is bought and nothing is charged. A bare tool URL is stored on its first
// miss; a URL with a query on its second (src/front/index.ts), so the published example URL of the most-bought tools is
// asked for twice. The front caps KV writes per isolate and hour, so the list is ordered: the tools that sell first.
//
//   node scripts/warm-quotes.mjs [origin] [--limit N] [--concurrency N] [--dry]
import { build } from "esbuild";
import { createRequire } from "node:module";

const args = process.argv.slice(2);
const flag = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const valueAt = new Set(["--limit", "--concurrency"].map((f) => args.indexOf(f)).filter((i) => i >= 0).map((i) => i + 1));
const origin = (args.find((a, i) => !a.startsWith("--") && !valueAt.has(i)) ?? "https://agent-data-tools.revmesh2074.workers.dev").replace(/\/+$/, "");
const limit = Number(flag("--limit", "0")) || Infinity;
const concurrency = Math.max(1, Math.min(8, Number(flag("--concurrency", "4")) || 4));
const dry = args.includes("--dry");

const urlShim = { name: "url", setup(b) { b.onResolve({ filter: /^url$/ }, () => ({ path: "node:url", external: true })); } };
const catalog = await build({
  stdin: { contents: 'export { ENDPOINTS, exampleParams } from "./src/endpoints"; export { CATEGORY_HOSTS } from "./src/lib/tts-host";', resolveDir: process.cwd(), sourcefile: "warm-quotes-entry.ts" },
  bundle: true, platform: "node", format: "cjs", write: false, plugins: [urlShim], logLevel: "silent",
});
const mod = { exports: {} };
new Function("module", "exports", "require", catalog.outputFiles[0].text)(mod, mod.exports, createRequire(import.meta.url));
const { ENDPOINTS, exampleParams, CATEGORY_HOSTS } = mod.exports;

// The tools outside buyers paid for in the 30 days to 21 Nov 2026, most income first. Keep it short: it only decides
// which quotes are stored first when the front's write cap cuts the run.
const SOLD_FIRST = ["/pack/url-safety", "/hyperliquid/indicators", "/weather/forecast", "/news", "/pack/news-sentiment", "/pack/web-research", "/describe", "/text-to-speech", "/ai/sentiment", "/weather",
  "/wikipedia", "/image", "/pack/coin-research", "/extract", "/extract/rendered", "/sanctions/check", "/pack/token-analysis", "/search/web", "/merchant/trust", "/btc-price", "/search", "/hyperliquid/orderbook",
  "/pack/domain-intel", "/pack/website-audit", "/audit/website", "/stock/quote", "/phishing/check", "/url/safety-check", "/scrape", "/pdf/text"];
const known = new Map(ENDPOINTS.map((e) => [e.path, e]));
const sold = SOLD_FIRST.filter((p) => known.has(p));
const rest = ENDPOINTS.map((e) => e.path).filter((p) => !sold.includes(p));
const exampleUrl = (base, path) => {
  const query = exampleParams(known.get(path)).map(([k, p]) => `${k}=${encodeURIComponent(String(p.example))}`).join("&");
  return query ? `${base}${path}?${query}` : undefined;
};

/** [url, times]: a bare URL once, an example URL twice (stored on the second miss). */
const plan = [];
for (const path of sold) { plan.push([`${origin}${path}`, 1]); const ex = exampleUrl(origin, path); if (ex) plan.push([ex, 2]); }
// A category host answers only its own tools, each a separate listing with its own probes.
if (/agent-data-tools\.revmesh2074\.workers\.dev$/.test(new URL(origin).hostname)) {
  for (const [host, { paths }] of Object.entries(CATEGORY_HOSTS)) for (const path of paths) if (known.has(path)) plan.push([`https://${host}${path}`, 1]);
}
for (const path of rest) plan.push([`${origin}${path}`, 1]);
const work = plan.slice(0, limit);

if (dry) { console.log(`warm-quotes (dry): ${work.length} URLs, ${work.reduce((n, [, t]) => n + t, 0)} requests, first: ${work.slice(0, 5).map(([u]) => u).join(" ")}`); process.exit(0); }

const HEADERS = { accept: "application/json", "user-agent": "agent-data-tools-release-warm/1" };
const tally = { asked: 0, quoted: 0, fromFront: 0, other: 0, failed: 0 };
const oddities = [];
async function ask(url) {
  try {
    const res = await fetch(url, { headers: HEADERS, redirect: "manual", signal: AbortSignal.timeout(20_000) });
    await res.arrayBuffer();
    tally.asked++;
    if (res.status === 402) { tally.quoted++; if (res.headers.get("x-quote-front") === "hit") tally.fromFront++; }
    else { tally.other++; if (oddities.length < 12) oddities.push(`${res.status} ${url}`); }
  } catch (e) {
    tally.failed++;
    if (oddities.length < 12) oddities.push(`failed ${url}: ${String(e).slice(0, 80)}`);
  }
}
let next = 0;
await Promise.all(Array.from({ length: concurrency }, async () => {
  while (next < work.length) {
    const [url, times] = work[next++];
    for (let i = 0; i < times; i++) await ask(url);
  }
}));

// Proof for the release log: the tools that matter most must now be answered by the front.
const check = sold.slice(0, 10);
let hits = 0;
for (const path of check) {
  try {
    const res = await fetch(`${origin}${path}`, { headers: HEADERS, redirect: "manual", signal: AbortSignal.timeout(20_000) });
    await res.arrayBuffer();
    if (res.headers.get("x-quote-front") === "hit") hits++;
  } catch { /* counted as a miss */ }
}
for (const line of oddities) console.log(`  note: ${line}`);
console.log(`warm-quotes: warmed ${tally.quoted} of ${work.length} URLs (${tally.asked} requests, ${tally.fromFront} already from the front, ${tally.other} not a 402, ${tally.failed} failed); front answers ${hits}/${check.length} of the top tools`);
// Storing is an optimisation: a cold front is slower, not broken, so this step never fails a release.
