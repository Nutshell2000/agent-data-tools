// Listing-quality survey of the public Coinbase Bazaar, scored with the same analyze() that /x402/check sells.
// It fetches a sample of listed resources unpaid (a plain GET answers 402 with the terms; nothing is signed or
// paid) and aggregates the checks. The numbers feed docs/bazaar-quality-post.md, the data post that sells
// /x402/check to sellers debugging their own listings. Run it on the PC; this cloud container cannot reach
// the Bazaar or the sellers.
//   node scripts/bazaar-quality-report.mjs [--sample 300] [--json out.json]
import { build } from "esbuild";
import { createRequire } from "node:module";
import { writeFile } from "node:fs/promises";

const argv = process.argv.slice(2);
const option = (name, fallback) => { const i = argv.indexOf(name); return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : fallback; };
const sample = Math.min(2000, Math.max(10, Number(option("--sample", "300")) || 300));
const jsonOut = option("--json", "");
const DISCOVERY = "https://api.cdp.coinbase.com/platform/v2/x402/discovery/resources";
const UA = "agent-data-tools-survey/1.0 (+https://agent-data-tools.revmesh2074.workers.dev)";

const bundled = await build({ entryPoints: ["src/routes/x402-check.ts"], bundle: true, platform: "node", format: "cjs", write: false,
  plugins: [{ name: "url", setup(b) { b.onResolve({ filter: /^url$/ }, () => ({ path: "node:url", external: true })); } }] });
const mod = { exports: {} };
new Function("module", "exports", "require", bundled.outputFiles[0].text)(mod, mod.exports, createRequire(import.meta.url));
const { analyze } = mod.exports;

// 1. Every listed resource (GET only: the survey never sends a body).
const items = [];
for (let offset = 0, total = Infinity; offset < total; offset += 500) {
  const res = await fetch(`${DISCOVERY}?limit=500&offset=${offset}`, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`Bazaar listing HTTP ${res.status}`);
  const body = await res.json();
  total = body.pagination?.total ?? 0;
  for (const it of body.items ?? []) if (typeof it.resource === "string" && it.resource.startsWith("http")) items.push(it);
  if (!body.items?.length) break;
}

// 2. An even sample across the listing, one resource per host so a big catalog cannot dominate.
const byHost = new Map();
for (const it of items) { try { const h = new URL(it.resource).host; if (!byHost.has(h)) byHost.set(h, it); } catch { /* skip */ } }
const hosts = [...byHost.values()];
const step = Math.max(1, Math.floor(hosts.length / sample));
const picked = hosts.filter((_, i) => i % step === 0).slice(0, sample);

// 3. Score each one unpaid.
const results = [];
for (const it of picked) {
  try {
    const res = await fetch(it.resource, { headers: { accept: "application/json", "user-agent": UA }, redirect: "follow", signal: AbortSignal.timeout(15_000) });
    const text = (await res.text()).slice(0, 262_144);
    results.push(analyze(it.resource, res.status, res.headers.get("payment-required"), text));
  } catch (error) {
    results.push({ url: it.resource, status: 0, error: String(error?.message ?? error).slice(0, 120) });
  }
}

// 4. Aggregate.
const answered = results.filter((r) => r.status === 402 && r.checks?.length);
const share = (n, of) => (of ? Math.round((n / of) * 1000) / 10 : 0);
const checkNames = [...new Set(answered.flatMap((r) => r.checks.map((c) => c.check)))];
const perCheck = Object.fromEntries(checkNames.map((name) => [name, share(answered.filter((r) => r.checks.find((c) => c.check === name)?.pass).length, answered.length)]));
const prices = answered.flatMap((r) => r.accepts.filter((a) => a.priceUsd !== null).map((a) => a.priceUsd)).sort((a, b) => a - b);
const summary = {
  surveyedAt: new Date().toISOString(),
  listedResources: items.length, listedHosts: byHost.size, sampled: picked.length,
  answered402: answered.length, notPaywalled: results.filter((r) => r.status && r.status !== 402).length, unreachable: results.filter((r) => !r.status).length,
  passRatePercentByCheck: perCheck,
  perfectScorePercent: share(answered.filter((r) => r.score === 1).length, answered.length),
  medianPriceUsd: prices.length ? prices[Math.floor(prices.length / 2)] : null,
  x402Versions: answered.reduce((m, r) => ({ ...m, [r.x402Version ?? "unknown"]: (m[r.x402Version ?? "unknown"] ?? 0) + 1 }), {}),
};
console.log(JSON.stringify(summary, null, 2));
if (jsonOut) await writeFile(jsonOut, JSON.stringify({ summary, results }, null, 2));
