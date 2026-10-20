const assert = require('node:assert/strict');
const { test } = require('node:test');
const { build } = require('esbuild');

// The Durable Object behind credits, replay and receipts can be out of its daily quota: every call throws. Payment
// paths must then refuse before charging or running anything, with a retryable 503, never a 500 or a lost payment.
async function load(entry) {
  const b = await build({ entryPoints: [entry], bundle: true, format: 'cjs', platform: 'node', write: false, logLevel: 'silent', external: ['cloudflare:workers'] });
  const m = { exports: {} };
  new Function('module', 'exports', 'require', b.outputFiles[0].text)(m, m.exports, require);
  return m.exports;
}
const down = () => { throw new Error('Exceeded allowed rows written in Durable Objects free tier.'); };
const deadStore = new Proxy({}, { get: () => async () => down() });
const env = { METRICS: { idFromName: () => 'id', get: () => deadStore } };

test('MCP credit calls: not charged and told to retry when the credit store is down', async () => {
  const { creditCharger } = await load('src/lib/credit-routes.ts');
  let ran = false;
  const out = await creditCharger(env, 'adt_' + 'k'.repeat(43), '$0.003', 'https://api.test')(async () => { ran = true; return { content: [] }; });
  assert.equal(out.isError, true);
  assert.match(out.content[0].text, /cannot be checked right now; not charged/);
  assert.equal(ran, false, 'the tool does not run');
});

test('MPP credit packs: no card charge is taken while the credit store is down', async () => {
  const { buyCreditsWithMpp } = await load('src/lib/mpp-credits.ts');
  const { Hono } = require('hono');
  const app = new Hono().get('/credits/buy/:usd', buyCreditsWithMpp);
  const realFetch = globalThis.fetch;
  const outbound = [];
  globalThis.fetch = async (u) => { outbound.push(String(u)); return new Response('no', { status: 599 }); };
  try {
    const res = await app.fetch(new Request('https://api.test/credits/buy/5', { headers: { authorization: 'Payment eyJmYWtlIjp0cnVlfQ' } }),
      { ...env, STRIPE_MPP_KEY: 'rk_test_x', STRIPE_PROFILE_ID: 'profile_test', MPP_SECRET_KEY: 's' });
    assert.equal(res.status, 503);
    assert.equal(res.headers.get('retry-after'), '300');
    assert.match((await res.json()).error, /Not charged/);
    assert.equal(outbound.filter((u) => u.includes('stripe')).length, 0, 'Stripe is never called');
  } finally { globalThis.fetch = realFetch; }
});

test('Tempo: an unreachable replay store is reported, so the call stops before the tool runs', async () => {
  const { alreadySettled } = await load('src/lib/mpp-tempo.ts');
  const { Credential } = await import('mppx');
  const credential = Credential.serialize({ challenge: { id: 'x', realm: 'api.test', method: 'tempo', intent: 'charge', request: {} }, payload: { signature: '0x' + 'ab'.repeat(40) } });
  assert.equal(await alreadySettled(env, credential), null);
  assert.equal(await alreadySettled({}, credential), false, 'no store configured: broadcast still guards replays');
});
