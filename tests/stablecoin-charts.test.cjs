const assert = require("node:assert/strict");
const { test, afterEach } = require("node:test");
const { build } = require("esbuild");

// /stablecoin/charts: DefiLlama's stablecoin series per chain; fetch is a fake, no network.
async function load() {
  const b = await build({ entryPoints: ["src/routes/stablecoin-charts.ts"], bundle: true, format: "cjs", platform: "node", write: false, logLevel: "silent" });
  const m = { exports: {} };
  new Function("module", "exports", "require", b.outputFiles[0].text)(m, m.exports, require);
  return m.exports;
}
const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });
const day = (n) => String(1794614400 - (40 - n) * 86400);
const points = Array.from({ length: 41 }, (_, i) => ({ date: day(i), totalCirculatingUSD: { peggedUSD: 1000 + i * 10, peggedEUR: 5 } }));
const chains = [{ name: "Base", totalCirculatingUSD: { peggedUSD: 5000 } }, { name: "OP Mainnet", totalCirculatingUSD: { peggedUSD: 400 } }, { name: "Ethereum", totalCirculatingUSD: { peggedUSD: 90000, peggedEUR: 100 } }, { name: "Dead", totalCirculatingUSD: { peggedUSD: 0 } }];
let asked;
function fake() {
  asked = [];
  globalThis.fetch = async (url) => { asked.push(String(url)); return new Response(JSON.stringify(String(url).endsWith("/stablecoinchains") ? chains : points), { status: 200, headers: { "content-type": "application/json" } }); };
}
const q = (o) => (n) => o[n];

test("one chain: latest figure, changes over 1, 7 and 30 days, and the last days of history", async () => {
  const { STABLECOIN_CHARTS } = await load();
  fake();
  const out = await STABLECOIN_CHARTS[0].run({}, q({ chain: "base", days: "7" }));
  assert.equal(out.chain, "Base");
  assert.equal(out.circulatingUsd, 1405);
  assert.equal(out.history.length, 7);
  assert.equal(out.history.at(-1).date, out.asOf);
  assert.equal(out.changePercent.d1, Math.round(((1405 - 1395) / 1395) * 10000) / 100);
  assert.equal(out.changePercent.d30, Math.round(((1405 - 1105) / 1105) * 10000) / 100);
  assert.ok(asked.some((u) => u.endsWith("/stablecoincharts/Base")));
  assert.equal(out.topChains, undefined);
});

test("no chain: all chains together with the ten largest, empty chains left out", async () => {
  const { STABLECOIN_CHARTS } = await load();
  fake();
  const out = await STABLECOIN_CHARTS[0].run({}, q({}));
  assert.equal(out.chain, "all");
  assert.equal(out.days, 30);
  assert.deepEqual(out.topChains.map((c) => c.name), ["Ethereum", "Base", "OP Mainnet"]);
  assert.equal(out.topChains[0].circulatingUsd, 90100);
});

test("chain names as agents write them, and an unknown chain is a 404", async () => {
  const { STABLECOIN_CHARTS, chainKey } = await load();
  assert.equal(chainKey("Optimism"), "opmainnet");
  assert.equal(chainKey("constructor"), "constructor");
  fake();
  assert.equal((await STABLECOIN_CHARTS[0].run({}, q({ chain: "optimism" }))).chain, "OP Mainnet");
  await assert.rejects(STABLECOIN_CHARTS[0].run({}, q({ chain: "atlantis" })), (e) => e.status === 404 && /nothing was charged/.test(e.message));
  await assert.rejects(STABLECOIN_CHARTS[0].run({}, q({ chain: "__proto__" })), (e) => e.status === 404);
});

test("the listing: named for the search, DefiLlama stated, an example that matches its input", async () => {
  const { STABLECOIN_CHARTS } = await load();
  const e = STABLECOIN_CHARTS[0].endpoint;
  assert.ok(e.summary.toLowerCase().startsWith("stablecoin charts"));
  assert.match(e.description, /DefiLlama/);
  assert.ok(e.description.length <= 450, String(e.description.length));
  assert.equal(e.outputExample.chain, e.params.chain.example);
  assert.ok(e.tags.length >= 5);
});
