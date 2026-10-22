const assert = require('node:assert/strict');
const { test, afterEach } = require('node:test');
const { build } = require('esbuild');

// /btc-price with both sources faked: mempool.space first, Coinbase spot when it fails, 30 s snapshot between calls.
async function load() {
  const b = await build({ entryPoints: ['src/routes/rates.ts'], bundle: true, format: 'cjs', platform: 'node', write: false, logLevel: 'silent' });
  const m = { exports: {} };
  new Function('module', 'exports', 'require', b.outputFiles[0].text)(m, m.exports, require);
  return m.exports;
}
const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
function fake(map) {
  const calls = [];
  globalThis.fetch = async (url) => { const u = String(url); calls.push(u); const a = map.find(([k]) => u.includes(k)); return a ? a[1]() : new Response('no', { status: 500 }); };
  return calls;
}

test('mempool.space answers: every currency, sats per dollar and the price time', async () => {
  const { bitcoinPrice } = await load();
  fake([['mempool.space', () => json({ time: 1_760_000_000, USD: 100000, EUR: 90000, GBP: 80000, CAD: 1, CHF: 1, AUD: 1, JPY: 1 })]]);
  const r = await bitcoinPrice();
  assert.equal(r.prices.USD, 100000);
  assert.equal(r.satsPerUsd, 1000);
  assert.equal(r.priceTime, new Date(1_760_000_000 * 1000).toISOString());
  assert.match(r.source, /mempool/);
});

test('when mempool.space fails, Coinbase spot gives the USD price and the source says so', async () => {
  const { bitcoinPrice } = await load();
  const calls = fake([['mempool.space', () => new Response('rate limited', { status: 429 })], ['api.coinbase.com', () => json({ data: { base: 'BTC', currency: 'USD', amount: '101234.5' } })]]);
  const r = await bitcoinPrice({ fresh: true });
  assert.equal(r.prices.USD, 101234.5);
  assert.equal(Object.keys(r.prices).length, 1);
  assert.match(r.source, /Coinbase/);
  assert.ok(calls.some((u) => u.includes('api.coinbase.com')));
});

test('a malformed mempool answer never becomes a 500: it falls through to Coinbase, and both failing is 502', async () => {
  const { bitcoinPrice } = await load();
  fake([['mempool.space', () => json({ USD: 'not a number', time: 'x' })], ['api.coinbase.com', () => json({ data: { amount: '99000' } })]]);
  const r = await bitcoinPrice({ fresh: true });
  assert.equal(r.prices.USD, 99000);
  fake([['mempool.space', () => new Response('down', { status: 503 })], ['api.coinbase.com', () => new Response('down', { status: 503 })]]);
  await assert.rejects(bitcoinPrice({ fresh: true }), (e) => e.status === 502);
});

test('a second call within 30 s is served from the snapshot without fetching', async () => {
  const { bitcoinPrice } = await load();
  const calls = fake([['mempool.space', () => json({ time: 1_760_000_000, USD: 100000 })]]);
  await bitcoinPrice({ fresh: true });
  const n = calls.length;
  await bitcoinPrice();
  assert.equal(calls.length, n);
});
