const assert = require('node:assert/strict');
const { before, after, test } = require('node:test');
const { build } = require('esbuild');
const { Miniflare, convertV4MiniflareOptions } = require('miniflare');

// The Worker with MPP switched on, Stripe mocked: no network, no real card, no real charge.
let mf, mfOff;
const intents = [];
async function worker(bindings) {
  const b = await build({ entryPoints: ['src/index.ts'], bundle: true, format: 'esm', platform: 'browser', write: false, external: ['cloudflare:workers', 'node:*'],
    plugins: [{ name: 'url', setup(b) { b.onResolve({ filter: /^url$/ }, () => ({ path: 'node:url', external: true })); } }] });
  return new Miniflare(convertV4MiniflareOptions({ modules: true, script: b.outputFiles[0].text, compatibilityDate: '2026-09-01', compatibilityFlags: ['nodejs_compat'],
    durableObjects: { METRICS: { className: 'Metrics', useSQLite: true } },
    bindings: { PAY_TO: '0x2074c40346ae2a90e0e4a391bcee6f16bf5277f5', NETWORK: 'eip155:8453', PAYWALL: 'on', TRIALS_ENABLED: 'off', FACILITATOR_URL: 'https://fixture.invalid', BASE_RPC_URL: 'https://fixture.invalid', ...bindings },
    outboundService: async (r) => {
      const url = new URL(r.url);
      if (url.hostname === 'api.stripe.com' && url.pathname === '/v1/payment_intents') {
        assert.equal(r.headers.get('authorization'), 'Basic ' + Buffer.from('rk_test_mpp_fixture:').toString('base64'));
        const form = new URLSearchParams(await r.text());
        intents.push(Object.fromEntries(form));
        return Response.json({ id: `pi_test_${intents.length}`, object: 'payment_intent', status: 'succeeded', amount: Number(form.get('amount')), currency: form.get('currency') });
      }
      return new Response('unexpected outbound request', { status: 599 });
    } }));
}
before(async () => {
  mf = await worker({ STRIPE_MPP_KEY: 'rk_test_mpp_fixture', STRIPE_PROFILE_ID: 'profile_test_fixture' });
  mfOff = await worker({});
});
after(async () => { await mf?.dispose(); await mfOff?.dispose(); });

test('MPP credit packs stay off without the Stripe settings and charge nothing', async () => {
  const r = await mfOff.dispatchFetch('https://api.test/credits/buy/5');
  assert.equal(r.status, 503);
  assert.match((await r.json()).error, /not switched on yet.*\/credits/);
  assert.equal((await mfOff.dispatchFetch('https://api.test/credits/buy/7')).status, 404);
});

test('an agent pays a $5 pack over MPP with a card token and gets a working key', async () => {
  const challenge = await mf.dispatchFetch('https://api.test/credits/buy/5');
  assert.equal(challenge.status, 402);
  await challenge.arrayBuffer();

  const { Mppx, stripe } = await import('mppx/client');
  const seen = [];
  const client = Mppx.create({
    polyfill: false,
    fetch: (u, i) => mf.dispatchFetch(u, i),
    methods: [stripe.charge({ paymentMethod: 'pm_card_visa', createToken: async (p) => { seen.push(p); return 'spt_test_fixture'; } })],
  });
  const paid = await client.fetch('https://api.test/credits/buy/5');
  assert.equal(paid.status, 200);
  const body = await paid.json();
  assert.match(body.apiKey, /^adt_/);
  assert.equal(body.creditsAdded, 5000);
  assert.equal(seen[0].amount, '500');
  assert.equal(seen[0].networkId, 'profile_test_fixture');
  assert.equal(intents.length, 1);
  assert.equal(intents[0].amount, '500');
  assert.equal(intents[0].currency, 'usd');
  assert.equal(intents[0].shared_payment_granted_token, 'spt_test_fixture');
  assert.equal(intents[0]['metadata[adt_credits]'], '5000');

  const balance = await (await mf.dispatchFetch('https://api.test/credits/balance', { headers: { authorization: `Bearer ${body.apiKey}` } })).json();
  assert.equal(balance.balanceCredits, 5000);

  // Topping up: the agent names its key in X-API-Key; the pack lands on that key, no new key.
  const topUp = await client.fetch('https://api.test/credits/buy/5', { headers: { 'x-api-key': body.apiKey } });
  assert.equal(topUp.status, 200);
  const topped = await topUp.json();
  assert.equal(topped.toppedUp, true);
  assert.equal(topped.apiKey, undefined);
  assert.equal(topped.balanceCredits, 10000);
  assert.equal(intents.length, 2);

  // An unknown key is refused before any charge.
  const unknown = await mf.dispatchFetch('https://api.test/credits/buy/5', { headers: { 'x-api-key': 'adt_' + 'z'.repeat(43) } });
  assert.equal(unknown.status, 401);
  await unknown.arrayBuffer();
  assert.equal(intents.length, 2);
});

test('/credits tells agents about MPP purchase only when it is switched on', async () => {
  const on = await (await mf.dispatchFetch('https://api.test/credits', { headers: { accept: 'application/json' } })).json();
  assert.match(on.agentPurchase, /\/credits\/buy\/5/);
  const off = await (await mfOff.dispatchFetch('https://api.test/credits', { headers: { accept: 'application/json' } })).json();
  assert.equal(off.agentPurchase, undefined);
});
