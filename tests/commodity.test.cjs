// Commodity prices (10 Nov 2026): front-month futures through the stock tools' quote source. No network: the quote is passed in.
const assert = require("node:assert/strict");
const { before, test } = require("node:test");
const esbuild = require("esbuild");
const Module = require("node:module");

async function load(entry) {
  const built = await esbuild.build({ entryPoints: [entry], bundle: true, platform: "node", format: "cjs", write: false, external: ["cloudflare:workers"] });
  const mod = new Module(entry, null);
  mod.filename = entry;
  mod.paths = Module._nodeModulePaths(process.cwd());
  mod._compile(built.outputFiles[0].text, entry);
  return mod.exports;
}

let S, endpoints;
before(async () => {
  S = await load(require.resolve("../src/routes/stocks.ts"));
  endpoints = await load(require.resolve("../src/endpoints.ts"));
});

test("a commodity as agents name it: plain names, tickers, currency codes and spacing", () => {
  const cases = {
    gold: "gold", Gold: "gold", " GOLD ": "gold", XAU: "gold", xauusd: "gold", "GC=F": "gold", "gold price": "gold", "gold futures": "gold",
    silver: "silver", XAG: "silver", oil: "crude-oil", "crude oil": "crude-oil", "Crude Oil": "crude-oil", crude_oil: "crude-oil", WTI: "crude-oil", "crude-oil": "crude-oil",
    brent: "brent", "Brent crude": "brent", "natural gas": "natural-gas", natgas: "natural-gas", "natural-gas": "natural-gas",
    "heating oil": "heating-oil", soybean: "soybeans", maize: "corn", copper: "copper", cocoa: "cocoa",
  };
  for (const [raw, key] of Object.entries(cases)) assert.equal(S.commodityKey(raw), key, raw);
  // Names of Object.prototype members and things we do not quote are refused, never looked up.
  for (const raw of ["constructor", "toString", "__proto__", "uranium", "bitcoin", "", "AAPL"]) assert.equal(S.commodityKey(raw), undefined, raw);
});

test("every commodity names a futures ticker the quote source accepts and a unit", () => {
  const symbols = Object.values(S.COMMODITIES).map((c) => c.symbol);
  assert.equal(new Set(symbols).size, symbols.length);
  for (const [key, c] of Object.entries(S.COMMODITIES)) {
    assert.match(c.symbol, /^[A-Z]{2}=F$/, key);
    assert.match(c.unit, /^(USD|US cents) per /, key);
    assert.match(key, /^[a-z-]+$/);
  }
});

test("the answer is the futures quote with the commodity's own name and unit; an unknown commodity lists the choices", async () => {
  const asked = [];
  const quote = async (symbol) => { asked.push(symbol); return { symbol, name: "Gold Dec 26", exchange: "COMEX", type: "FUTURE", currency: "USD", price: 4105.3, previousClose: 4088.1, change: 17.2, changePercent: 0.4207, dayHigh: 4121.8, dayLow: 4079.5, volume: 1234, fiftyTwoWeekHigh: 4398, fiftyTwoWeekLow: 2567.4, marketTime: "2026-11-10T21:59:00.000Z", timezone: "America/New_York", note: "n" }; };
  const out = await S.commodityPrice("XAU", quote);
  assert.deepEqual(asked, ["GC=F"]);
  assert.equal(out.commodity, "gold");
  assert.equal(out.name, "Gold");
  assert.equal(out.unit, "USD per troy ounce");
  assert.equal(out.price, 4105.3);
  assert.equal(out.changePercent, 0.4207);
  const e = endpoints.ENDPOINTS.find((x) => x.path === "/commodity/price");
  assert.ok(e, "/commodity/price is listed");
  assert.equal(e.summary.split(":")[0], "Commodity prices");
  assert.deepEqual(Object.keys(out).sort(), Object.keys(e.outputExample).sort());
  assert.equal(e.outputExample.commodity, e.params.commodity.example);
  await assert.rejects(S.commodityPrice("uranium", quote), (err) => err.status === 400 && /gold, silver/.test(err.message));
  assert.equal(asked.length, 1, "nothing is fetched for a commodity we do not quote");
});
