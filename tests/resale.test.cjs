// Resold LinkedIn and X data (1.180.0): the guards that decide whether an upstream call is bought. No network, no keys.
const assert = require('node:assert/strict');
const { before, test } = require('node:test');
const { build } = require('esbuild');

async function load(entry) {
  const b = await build({ entryPoints: [entry], bundle: true, format: 'cjs', platform: 'node', write: false, logLevel: 'silent', external: ['@cloudflare/puppeteer', 'cloudflare:workers'] });
  const m = { exports: {} };
  const req = (id) => (id === '@cloudflare/puppeteer' ? { default: {} } : id === 'cloudflare:workers' ? { DurableObject: class {} } : require(id));
  new Function('module', 'exports', 'require', b.outputFiles[0].text)(m, m.exports, req);
  return m.exports;
}

let resale, endpoints, capacity, routes;
before(async () => {
  resale = await load('src/lib/resale.ts');
  endpoints = await load('src/endpoints.ts');
  capacity = await load('src/lib/capacity.ts');
  routes = await load('src/routes/resale.ts');
});

const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const req = (over = {}) => ({ scheme: 'exact', network: 'eip155:8453', asset: USDC, amount: '7000', payTo: '0x5d07Cc2a0FB4Eb123A525CA0b51cf6fB485014fc', ...over });

test('only the pinned wallet, Base USDC, exact scheme and a price at or under the ceiling are paid', () => {
  const up = resale.RESALE_UPSTREAMS.linkedinPerson;
  assert.equal(resale.acceptable(up, [req()]).length, 1);
  assert.equal(resale.acceptable(up, [req({ amount: '7001' })]).length, 0, 'price raised');
  assert.equal(resale.acceptable(up, [req({ payTo: '0x0000000000000000000000000000000000000001' })]).length, 0, 'wallet swapped');
  assert.equal(resale.acceptable(up, [req({ scheme: 'upto' })]).length, 0, 'upto scheme');
  assert.equal(resale.acceptable(up, [req({ network: 'eip155:137' })]).length, 0, 'other network');
  assert.equal(resale.acceptable(up, [req({ asset: '0x0000000000000000000000000000000000000002' })]).length, 0, 'other token');
  assert.equal(resale.acceptable(up, [req({ amount: 'abc' })]).length, 0, 'unreadable amount');
  assert.equal(resale.acceptable(up, [req({ amount: '0' })]).length, 0, 'zero');
});

test('without the wallet secret nothing is bought and the caller is not charged', async () => {
  let called = false;
  const fetcher = async () => { called = true; return new Response('{}'); };
  await assert.rejects(resale.buyUpstream({}, resale.RESALE_UPSTREAMS.xPosts, { query: 'x' }, fetcher), (e) => e.status === 503 && /not switched on/.test(e.message));
  await assert.rejects(resale.buyUpstream({ RESALE_WALLET_KEY: 'not-a-key' }, resale.RESALE_UPSTREAMS.xPosts, { query: 'x' }, fetcher), (e) => e.status === 503);
  assert.equal(called, false);
});

test('without KV to count purchases nothing is bought', async () => {
  const key = '0x' + '1'.repeat(64);
  await assert.rejects(resale.buyUpstream({ RESALE_WALLET_KEY: key }, resale.RESALE_UPSTREAMS.xPosts, { query: 'x' }, async () => new Response('{}')), (e) => e.status === 503);
});

test('the daily cap refuses before paying', async () => {
  const key = '0x' + '1'.repeat(64);
  const kv = new Map([[`cap:resale:${new Date().toISOString().slice(0, 10)}`, '5']]);
  const TRIALS = { get: async (k) => kv.get(k) ?? null, put: async (k, v) => { kv.set(k, v); } };
  let called = false;
  await assert.rejects(resale.buyUpstream({ RESALE_WALLET_KEY: key, RESALE_DAILY_CAP: '5', TRIALS }, resale.RESALE_UPSTREAMS.xPosts, { query: 'x' }, async () => { called = true; return new Response('{}'); }), (e) => e.status === 503 && e.code === 'DAILY_CAPACITY');
  assert.equal(called, false);
});

test('the resold tools are paused, never free, carry the data terms and cost more than the upstream', () => {
  for (const { endpoint: e } of routes.RESALE) {
    assert.ok(Object.hasOwn(endpoints.PAUSED_FAMILY_TOOLS, e.path), `${e.path} paused until funded`);
    assert.ok(!endpoints.ENDPOINTS.some((x) => x.path === e.path), `${e.path} not advertised`);
    assert.ok(capacity.CAPACITY_LIMITED.has(e.path), `${e.path} never a free call`);
    assert.ok(Number(e.price.slice(1)) > 0.008, e.path);
    assert.match(JSON.stringify(e.outputExample), /lawful basis/);
  }
});
