// Stock quote (10 Nov 2026 fix): the day's change is measured from the previous session's close, not from the close
// before the 5-day chart window. Mocked fetch with the shape and numbers Yahoo's chart endpoint really sent that day.
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

let S;
before(async () => { S = await load(require.resolve("../src/routes/stocks.ts")); });

const chart = (meta, closes) => new Response(JSON.stringify({ chart: { result: [{ meta, timestamp: closes.map((_, i) => 1794000000 + i * 86400), indicators: { quote: [{ close: closes }] } }], error: null } }), { status: 200, headers: { "content-type": "application/json" } });
async function withFetch(answer, run) {
  const real = globalThis.fetch;
  globalThis.fetch = async () => answer();
  try { return await run(); } finally { globalThis.fetch = real; }
}

test("the day's change is against the previous session, not the close before the five-day window", async () => {
  // AAPL on 10 Nov 2026: five daily bars, chartPreviousClose 331.9 is the close of the session before the first bar.
  const q = await withFetch(() => chart({ symbol: "AAPL", regularMarketPrice: 348.51, chartPreviousClose: 331.9, currency: "USD", regularMarketTime: 1794344400 }, [349.51, 344.17, 342.37, 350.69, 348.51]), () => S.stockQuote("AAPL"));
  assert.equal(q.previousClose, 350.69);
  assert.equal(q.change, -2.18);
  assert.equal(q.changePercent, -0.6216);
  // Natural gas futures the same day: 3.218 was the previous close (Yahoo's own 1-day chart says so), not 2.947.
  const ng = await withFetch(() => chart({ symbol: "NG=F", regularMarketPrice: 3.294, chartPreviousClose: 2.947, currency: "USD" }, [2.947, 2.998, 3.218, 3.294]), () => S.stockQuote("NG=F"));
  assert.equal(ng.previousClose, 3.218);
  assert.equal(ng.changePercent, 2.3617);
});

test("gaps and short charts: empty bars are skipped, one bar falls back to the chart's own previous close", async () => {
  const gap = await withFetch(() => chart({ symbol: "X", regularMarketPrice: 10.5, chartPreviousClose: 8 }, [9, null, 10, null, 10.5]), () => S.stockQuote("X"));
  assert.equal(gap.previousClose, 10);
  assert.equal(gap.change, 0.5);
  const one = await withFetch(() => chart({ symbol: "X", regularMarketPrice: 10.5, chartPreviousClose: 10.2 }, [10.5]), () => S.stockQuote("X"));
  assert.equal(one.previousClose, 10.2);
  const none = await withFetch(() => chart({ symbol: "X", regularMarketPrice: 10.5 }, []), () => S.stockQuote("X"));
  assert.equal(none.previousClose, null);
  assert.equal(none.change, null);
  assert.equal(none.changePercent, null);
});
