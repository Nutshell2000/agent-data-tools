// Currency pairs, thousands separators and tickers on other networks (10 Nov 2026 probe).
const assert = require("node:assert/strict");
const { before, test } = require("node:test");
const esbuild = require("esbuild");
const Module = require("node:module");
async function load(entry) { const built = await esbuild.build({ entryPoints: [entry], bundle: true, platform: "node", format: "cjs", write: false, external: ["cloudflare:workers"] }); const mod = new Module(entry, null); mod.filename = entry; mod.paths = Module._nodeModulePaths(process.cwd()); mod._compile(built.outputFiles[0].text, entry); return mod.exports; }
let R, K;
before(async () => { R = await load(require.resolve("../src/routes/rates.ts")); K = await load(require.resolve("../src/lib/tickers.ts")); });

test("fx: a pair in one field and an amount with thousands separators", async () => {
  const realFetch = globalThis.fetch; const asked = [];
  globalThis.fetch = async (url) => { asked.push(new URL(String(url))); return new Response(JSON.stringify({ base: "EUR", date: "2026-11-10", rates: { USD: 1.1, SEK: 11 } }), { headers: { "content-type": "application/json" } }); };
  try {
    for (const pair of ["EURUSD", "EUR/USD", "eur-usd", "eur_usd"]) { asked.length = 0; await R.exchangeRates(pair); const sent = asked[0].searchParams; assert.equal(sent.get("base") ?? sent.get("from"), "EUR", pair); assert.match(asked[0].search, /USD/, pair); }
    asked.length = 0; const out = await R.exchangeRates("EUR", "USD", "1,000");
    assert.equal(out.amount, 1000);
    // A currency name of six letters is a name, not a pair; an explicit target is never overridden.
    asked.length = 0; await R.exchangeRates("dollar"); assert.equal(asked[0].searchParams.get("base") ?? asked[0].searchParams.get("from"), "USD");
    asked.length = 0; await R.exchangeRates("EURUSD", "SEK").catch(() => {}); assert.ok(!asked.length || !/base=EUR&/.test(asked[0].search) || /SEK/.test(asked[0].search));
    await assert.rejects(R.exchangeRates("EUR", "USD", "abc"), (e) => e.status === 400);
  } finally { globalThis.fetch = realFetch; }
});

test("a ticker the default network does not list is priced on one that does; addresses and explicit chains are left alone", () => {
  const slugs = ["base", "eth", "arb", "op"];
  assert.equal(K.knowsTicker("ETH", "base"), true);
  assert.equal(K.tickerNetwork("ETH", "base", slugs), "base");
  const link = K.tickerNetwork("LINK", "base", slugs);
  assert.ok(K.knowsTicker("LINK", link), `LINK resolves on ${link}`);
  assert.equal(K.tickerNetwork("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", "base", slugs), "base");
  assert.equal(K.tickerNetwork("NOSUCHTICKER", "base", slugs), "base");
  assert.equal(K.knowsTicker("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", "base"), false);
});
