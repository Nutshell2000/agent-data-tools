const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const { build } = require('esbuild');

let T;
before(async () => {
  const b = await build({ entryPoints: ['src/routes/token-flows.ts'], bundle: true, format: 'cjs', platform: 'node', write: false, logLevel: 'silent' });
  const m = { exports: {} };
  new Function('module', 'exports', 'require', b.outputFiles[0].text)(m, m.exports, require);
  T = m.exports;
});

const POOL = '0x00000000000000000000000000000000000000aa';
const W = (n) => `0x${String(n).padStart(40, '0')}`;
const ZERO = '0x0000000000000000000000000000000000000000';

test('token flows: two paths at one cent, listing names start with the phrase buyers type', () => {
  const paths = T.TOKEN_FLOWS.map((e) => e.endpoint.path);
  assert.deepEqual(paths, ['/token/flow', '/pack/token-flows']);
  for (const e of T.TOKEN_FLOWS) { assert.equal(e.endpoint.price, '$0.01'); assert.ok(e.endpoint.tags.length >= 5); assert.equal(e.endpoint.params.token.required, true); }
  assert.match(T.TOKEN_FLOWS[0].endpoint.summary, /^Token flow:/);
  assert.match(T.TOKEN_FLOWS[1].endpoint.summary, /^Token flows pack:/);
});

test('hubs: a busy address with 3+ peers in 4+ transfers is a candidate, a wallet with one peer is not', () => {
  const edges = [1, 2, 3, 4].map((i) => ({ from: POOL, to: W(i), amount: 1n, block: 1n }));
  edges.push({ from: W(8), to: W(9), amount: 5n, block: 1n });
  assert.deepEqual(T.hubCandidates(edges), [POOL]);
});

test('flow buckets: buys and sells go to the bucket of their block; mints, burns and wallet moves are not trades', () => {
  const hubs = new Set([POOL]);
  const edges = [
    { from: POOL, to: W(1), amount: 100n, block: 10n }, // buy, bucket 0
    { from: POOL, to: W(2), amount: 50n, block: 19n }, // buy, bucket 0
    { from: W(3), to: POOL, amount: 30n, block: 25n }, // sell, bucket 1
    { from: W(1), to: W(4), amount: 999n, block: 26n }, // wallet move: ignored
    { from: ZERO, to: W(5), amount: 7n, block: 27n }, // mint
    { from: W(6), to: ZERO, amount: 3n, block: 28n }, // burn
  ];
  const r = T.flowBuckets(edges, hubs, 10n, 29n, 2);
  assert.equal(r.buckets[0].bought, 150n); assert.equal(r.buckets[0].buys, 2);
  assert.equal(r.buckets[1].sold, 30n); assert.equal(r.buckets[1].sells, 1);
  assert.equal(r.totals.bought, 150n); assert.equal(r.totals.sold, 30n);
  assert.equal(r.totals.minted, 7n); assert.equal(r.totals.burned, 3n);
  assert.equal(r.buyers, 2); assert.equal(r.sellers, 1);
  assert.equal(r.buyerAmounts.get(W(1)), 100n);
  assert.equal(r.buckets[1].toBlock, 29n);
});

test('flow buckets: no trades gives empty buckets', () => {
  const r = T.flowBuckets([], new Set(), 1n, 100n, 6);
  assert.equal(r.buckets.length, 6);
  assert.equal(r.totals.buys + r.totals.sells, 0);
});

test('top wallet share: contracts among the largest buyers are left out; no buying is null', async () => {
  const buyers = new Map([[W(1), 900n], [W(2), 60n], [W(3), 40n]]);
  const contracts = new Set([W(1)]);
  assert.equal(await T.topWalletShare(buyers, 1000n, async (a) => contracts.has(a)), 0.1);
  assert.equal(await T.topWalletShare(buyers, 1000n, async () => false), 1);
  assert.equal(await T.topWalletShare(new Map(), 0n, async () => false), null);
});
