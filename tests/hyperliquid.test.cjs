const assert = require('node:assert/strict');
const { test, before, after } = require('node:test');
const { build } = require('esbuild');

let HL;
const realFetch = globalThis.fetch;
const seen = [];
const META = [{ universe: [{ name: 'BTC', maxLeverage: 40 }, { name: 'ETH', maxLeverage: 25 }, { name: 'kPEPE', maxLeverage: 10 }, { name: 'OLD', maxLeverage: 3, isDelisted: true }] },
  [0, 1, 2, 3].map(() => ({ funding: '0.0000125', openInterest: '10', prevDayPx: '100', dayNtlVlm: '1000', premium: '0', oraclePx: '100', markPx: '100', midPx: '100' }))];
const now = Date.now();
const ANSWERS = {
  metaAndAssetCtxs: META,
  l2Book: { coin: 'BTC', time: now, levels: [[{ px: '100.0', sz: '2', n: 3 }, { px: '99.5', sz: '1', n: 1 }], [{ px: '100.5', sz: '4', n: 2 }]] },
  candleSnapshot: Array.from({ length: 60 }, (_, i) => ({ t: now - (60 - i) * 3600e3, o: '1', h: '2', l: '0.5', c: '1.5', v: '10', n: i })),
  fundingHistory: [{ coin: 'ETH', fundingRate: '0.00001', premium: '-0.0001', time: now - 7200e3 }, { coin: 'ETH', fundingRate: '0.00003', premium: '0.0001', time: now - 3600e3 }],
  allMids: { BTC: '81870.5', ETH: '2406.05', kPEPE: '0.0123', '@107': '42', '#114910': '0.5' },
};

before(async () => {
  const b = await build({ entryPoints: ['src/routes/hyperliquid.ts'], bundle: true, format: 'cjs', platform: 'node', write: false, logLevel: 'silent' });
  const m = { exports: {} };
  new Function('module', 'exports', 'require', b.outputFiles[0].text)(m, m.exports, require);
  HL = m.exports.HYPERLIQUID;
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    seen.push(body);
    return new Response(JSON.stringify(ANSWERS[body.type]), { status: 200, headers: { 'content-type': 'application/json' } });
  };
});
after(() => { globalThis.fetch = realFetch; });

const run = (path, params = {}) => HL.find((f) => f.endpoint.path === path).run({}, (n) => params[n]);

test('order book: levels, mid, spread in bps and depth per side; the coin keeps its listed spelling', async () => {
  const ob = await run('/hyperliquid/orderbook', { coin: 'btc', levels: '1' });
  assert.deepEqual(ob.bids, [{ px: 100, sz: 2, n: 3 }]);
  assert.equal(ob.mid, 100.25);
  assert.equal(ob.spread, 0.5);
  assert.equal(ob.spreadBps, 49.88);
  assert.equal(ob.bidDepthUsd, 200);
  assert.equal(ob.askDepth, 4);
  await run('/hyperliquid/orderbook', { coin: 'KPEPE' });
  assert.equal(seen.at(-1).coin, 'kPEPE');
  await assert.rejects(run('/hyperliquid/orderbook', { coin: 'NOPE' }), (e) => e.status === 404);
  await assert.rejects(run('/hyperliquid/orderbook', { coin: 'OLD' }), (e) => e.status === 404);
  await assert.rejects(run('/hyperliquid/orderbook', { coin: 'b-t-c' }), (e) => e.status === 400);
});

test('candles: newest last, capped to the bars asked, interval checked', async () => {
  const c = await run('/hyperliquid/candles', { coin: 'BTC', interval: '1h', bars: '5' });
  assert.equal(c.count, 5);
  assert.equal(c.candles.at(-1).trades, 59);
  assert.deepEqual(Object.keys(c.candles[0]), ['time', 'open', 'high', 'low', 'close', 'volume', 'trades']);
  assert.equal(seen.at(-1).req.interval, '1h');
  await assert.rejects(run('/hyperliquid/candles', { interval: '7m' }), (e) => e.status === 400);
  await assert.rejects(run('/hyperliquid/candles', { interval: 'constructor' }), (e) => e.status === 400);
  await assert.rejects(run('/hyperliquid/candles', { bars: '501' }), (e) => e.status === 400);
});

test('funding history: average rate and APR over the window', async () => {
  const f = await run('/hyperliquid/funding-history', { hours: '2' });
  assert.equal(f.coin, 'ETH');
  assert.equal(f.count, 2);
  assert.equal(f.averageRateHourly, 0.00002);
  assert.equal(f.averageAprPct, 17.52);
});

test('prices: perpetuals only, named coins, unknown coins listed', async () => {
  const all = await run('/hyperliquid/prices');
  assert.deepEqual(Object.keys(all.prices).sort(), ['BTC', 'ETH', 'kPEPE']);
  const some = await run('/hyperliquid/prices', { coins: 'btc, eth ,zzz' });
  assert.deepEqual(some.prices, { BTC: 81870.5, ETH: 2406.05 });
  assert.deepEqual(some.notFound, ['ZZZ']);
  await assert.rejects(run('/hyperliquid/prices', { coins: 'ZZZ' }), (e) => e.status === 404);
});

test('listing names stay within 32 characters', () => {
  for (const { endpoint: e } of HL.filter((f) => f.endpoint.path !== '/hyperliquid/market')) assert.ok(e.summary.split(':')[0].length <= 32, e.summary);
});

test('indicator math: StockCharts RSI example, flat and rising series, EMA seed, Bollinger, ATR, volatility', async () => {
  const b = await build({ entryPoints: ['src/routes/hyperliquid.ts'], bundle: true, format: 'cjs', platform: 'node', write: false, logLevel: 'silent' });
  const m = { exports: {} };
  new Function('module', 'exports', 'require', b.outputFiles[0].text)(m, m.exports, require);
  const { rsi, sma, emaSeries, macd, bollinger, atr, realizedVol } = m.exports;
  const classic = [44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.10, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28];
  assert.ok(Math.abs(rsi(classic) - 70.53) < 0.1, `RSI ${rsi(classic)}`);
  assert.equal(rsi(Array(20).fill(5)), 50);
  assert.equal(rsi(Array.from({ length: 20 }, (_, i) => i + 1)), 100);
  assert.equal(rsi([1, 2, 3]), null);
  assert.equal(sma([1, 2, 3, 4], 2), 3.5);
  assert.equal(sma([1], 2), null);
  const e = emaSeries([1, 2, 3, 4, 5], 3);
  assert.deepEqual(e, [2, 3, 4]);
  assert.equal(macd(Array(40).fill(10)).histogram, 0);
  assert.equal(macd(Array(20).fill(10)), null);
  const bb = bollinger(Array(25).fill(7));
  assert.deepEqual([bb.upper, bb.middle, bb.lower, bb.percentB, bb.bandwidth], [7, 7, 7, null, 0]);
  assert.equal(atr(Array.from({ length: 20 }, () => ({ high: 11, low: 9, close: 10 }))), 2);
  assert.equal(realizedVol(Array(10).fill(3), 3600e3), 0);
});

test('indicators tool: closed bars only, readings, and too little history is an uncharged 404', async () => {
  const out = await run('/hyperliquid/indicators', { coin: 'BTC', interval: '1h' });
  assert.equal(out.bars, 60);
  assert.equal(out.close, 1.5);
  assert.ok(Array.isArray(out.readings) && out.readings[0].startsWith('RSI'));
  assert.equal(out.sma['200'], null);
  const saved = ANSWERS.candleSnapshot;
  ANSWERS.candleSnapshot = saved.slice(0, 10);
  await assert.rejects(run('/hyperliquid/indicators', { interval: '1h' }), (e) => e.status === 404);
  ANSWERS.candleSnapshot = saved;
  await assert.rejects(run('/hyperliquid/indicators', { interval: '2w' }), (e) => e.status === 400);
});
