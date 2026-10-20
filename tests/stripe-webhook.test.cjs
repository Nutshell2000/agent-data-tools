const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const Module = require('node:module');
const { before, test } = require('node:test');
const esbuild = require('esbuild');
const { Hono } = require('hono');

async function load(entry) {
  const result = await esbuild.build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'cjs', write: false });
  const m = new Module(entry, module); m.filename = entry; m.paths = Module._nodeModulePaths(process.cwd());
  m._compile(result.outputFiles[0].text, entry); return m.exports;
}
let hooks, store, catalog;
before(async () => {
  hooks = await load(require.resolve('../src/lib/stripe-webhook.ts'));
  store = await load(require.resolve('../src/store/routes.ts'));
  catalog = await load(require.resolve('../src/store/catalog.ts'));
});

const SECRET = 'whsec_test_' + 'a'.repeat(32);
const SESSION = 'cs_test_' + 'b'.repeat(24);
const sign = (body, t = Math.floor(Date.now() / 1000), secret = SECRET) =>
  `t=${t},v1=${crypto.createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`;
const event = (id = SESSION, type = 'checkout.session.completed') =>
  JSON.stringify({ id: 'evt_test_1', type, data: { object: { id, object: 'checkout.session', customer_details: { email: 'buyer@example.com', name: 'Ada Buyer' } } } });

/** A Checkout Session as Stripe returns it with expanded line items; buyer details included to prove we drop them. */
function session(lines, extra = {}) {
  return {
    id: SESSION, object: 'checkout.session', mode: 'payment', status: 'complete', payment_status: 'paid', currency: 'usd',
    amount_total: lines.reduce((n, l) => n + l.amount_subtotal, 0),
    customer_details: { email: 'buyer@example.com', name: 'Ada Buyer', address: { country: 'US' } },
    line_items: { data: lines },
    payment_intent: { id: 'pi_test_1', latest_charge: { id: 'ch_test_1', receipt_number: '1234-5678' } },
    ...extra,
  };
}
const line = (externalReference, amount, metadata = {}) =>
  ({ quantity: 1, amount_subtotal: amount, currency: 'usd', price: { external_reference: externalReference, unit_amount: amount, product: { id: 'prod_x', metadata } } });

function fixture(stripeSession) {
  const kv = new Map(); let writes = 0; const stripeCalls = [];
  const env = {
    STRIPE_WEBHOOK_SECRET: SECRET, STRIPE_READ_KEY: 'rk_test_x', PAYWALL: 'on',
    TRIALS: {
      get: async (k, type) => { const v = kv.get(k); return v === undefined ? null : type === 'json' ? JSON.parse(v) : v; },
      put: async (k, v) => { writes++; kv.set(k, v); },
    },
    ASSETS: { fetch: async (u) => String(u).includes('/_files/seo-audit-workbook.xlsx') ? new Response('xlsx-bytes') : new Response('missing', { status: 404 }) },
  };
  const fakeFetch = async (url, init) => {
    stripeCalls.push({ url: String(url), headers: init.headers });
    if (!stripeSession) return new Response('{}', { status: 404 });
    return new Response(JSON.stringify(stripeSession), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const app = new Hono();
  app.route('/', store.store);
  app.route('/', hooks.stripeKits(fakeFetch));
  const call = (path, init) => app.fetch(new Request('https://example.test' + path, init), env);
  const post = (body, signature) => call('/stripe/webhook', { method: 'POST', body, headers: { 'content-type': 'application/json', ...(signature && { 'stripe-signature': signature }) } });
  return { env, kv, call, post, stripeCalls, writes: () => writes };
}

test('a validly signed checkout.session.completed fulfils the kit, stores no buyer data and yields a signed download', async () => {
  const f = fixture(session([line('SCKITSEOAUDIT', 900)]));
  const body = event();
  const r = await f.post(body, sign(body));
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { received: true, fulfilled: 1, repeated: false });
  // The session is read back from Stripe with the preview version that carries the feed id.
  assert.equal(f.stripeCalls.length, 1);
  assert.match(f.stripeCalls[0].url, new RegExp(`/v1/checkout/sessions/${SESSION}\\?expand`));
  assert.equal(f.stripeCalls[0].headers['stripe-version'], hooks.AGENTIC_STRIPE_VERSION);
  // Only the order, the session record and the receipt hash are written; none holds buyer details.
  assert.equal(f.writes(), 3);
  const stored = [...f.kv.entries()].map(([k, v]) => k + v).join('\n');
  assert.doesNotMatch(stored, /buyer@example\.com|Ada Buyer|1234-5678|"US"/);

  const claim = await f.call(`/kits/claim?session_id=${SESSION}`, { headers: { accept: 'application/json' } });
  assert.equal(claim.status, 200);
  const { downloads } = await claim.json();
  assert.equal(downloads.length, 1);
  assert.match(downloads[0].kit, /SEO Audit Workbook/);
  const link = new URL(downloads[0].downloadUrl);
  assert.match(link.pathname, /^\/order\/[0-9a-f]{32}\/download$/);
  const file = await f.call(link.pathname + link.search);
  assert.equal(file.status, 200);
  assert.equal(await file.text(), 'xlsx-bytes');
  assert.equal(file.headers.get('content-type'), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  // The bare order URL, a tampered signature and an expired link do not download.
  for (const search of ['', link.search.replace(/sig=[0-9a-f]/, 'sig=x'), `?exp=${Math.floor(Date.now() / 1000) - 10}&sig=${link.searchParams.get('sig')}`]) {
    const denied = await f.call(link.pathname + search);
    assert.equal(denied.status, 403);
  }
  // The receipt number from Stripe's receipt finds the same order, in any formatting.
  const byReceipt = await f.call('/kits/claim?receipt=1234%205678', { headers: { accept: 'application/json' } });
  assert.equal(byReceipt.status, 200);
  assert.equal(new URL((await byReceipt.json()).downloads[0].downloadUrl).pathname, link.pathname);
  assert.equal(f.stripeCalls.length, 1, 'claims read the stored record, not Stripe');
});

test('a bad, missing or wrong-secret signature is refused before Stripe is called or anything is written', async () => {
  const f = fixture(session([line('SCKITSEOAUDIT', 900)]));
  const body = event();
  for (const signature of [undefined, 't=1,v1=deadbeef', sign(body).replace(/v1=./, 'v1=0'), sign(body, undefined, 'whsec_other'), sign(body + ' ')]) {
    const r = await f.post(body, signature);
    assert.equal(r.status, 400, String(signature));
    await r.body?.cancel();
  }
  assert.equal(f.stripeCalls.length, 0);
  assert.equal(f.writes(), 0);
});

test('a checkout without a kit (unknown product, credit pack, underpaid line) is acknowledged and fulfils nothing', async () => {
  for (const lines of [[line('SOMETHINGELSE', 5000)], [line(null, 500, { adt_credits: '5000' })], [line('SCKITSEOAUDIT', 100)]]) {
    const f = fixture(session(lines));
    const body = event();
    const r = await f.post(body, sign(body));
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { received: true, fulfilled: 0, ignored: 'no spreadsheet kit in this checkout' });
    assert.equal(f.writes(), 0);
    const claim = await f.call(`/kits/claim?session_id=${SESSION}`, { headers: { accept: 'application/json' } });
    assert.equal(claim.status, 400);
    await claim.body?.cancel();
  }
  // Other event types are acknowledged without reading Stripe.
  const f = fixture(session([line('SCKITSEOAUDIT', 900)]));
  const other = event(SESSION, 'payment_intent.succeeded');
  const r = await f.post(other, sign(other));
  assert.deepEqual(await r.json(), { received: true, ignored: 'payment_intent.succeeded' });
  assert.equal(f.stripeCalls.length, 0);
});

test('a replayed event creates no second order, and an old signed event is refused', async () => {
  const f = fixture(session([line('SCKITSEOAUDIT', 900), line('SCKITWEDDING', 600)]));
  const body = event();
  const first = await (await f.post(body, sign(body))).json();
  assert.deepEqual(first, { received: true, fulfilled: 2, repeated: false });
  const writes = f.writes();
  const orders = [...f.kv.keys()].filter((k) => k.startsWith('order:'));
  const again = await f.post(body, sign(body));
  assert.equal(again.status, 200);
  assert.deepEqual(await again.json(), { received: true, fulfilled: 2, repeated: true });
  assert.equal(f.writes(), writes);
  assert.deepEqual([...f.kv.keys()].filter((k) => k.startsWith('order:')), orders);
  // The same body signed ten minutes ago (outside the 5-minute tolerance) is a replay.
  const stale = await f.post(body, sign(body, Math.floor(Date.now() / 1000) - 600));
  assert.equal(stale.status, 400);
  assert.match((await stale.json()).error, /tolerance/);
});

test('a missed webhook is fulfilled from Stripe at claim time; unpaid sessions are not', async () => {
  const f = fixture(session([line('SCKITCANDLE', 600)]));
  const claim = await f.call(`/kits/claim?session_id=${SESSION}`, { headers: { accept: 'application/json' } });
  assert.equal(claim.status, 200);
  assert.equal((await claim.json()).downloads.length, 1);
  const unpaid = fixture(session([line('SCKITCANDLE', 600)], { payment_status: 'unpaid', status: 'open' }));
  const r = await unpaid.call(`/kits/claim?session_id=${SESSION}`, { headers: { accept: 'application/json' } });
  assert.equal(r.status, 402);
  assert.equal(unpaid.writes(), 0);
});

test('without the webhook secret the webhook and claim answer 503 and nothing is fulfilled', async () => {
  const f = fixture(session([line('SCKITSEOAUDIT', 900)]));
  delete f.env.STRIPE_WEBHOOK_SECRET;
  const body = event();
  assert.equal((await f.post(body, sign(body))).status, 503);
  assert.equal((await f.call(`/kits/claim?session_id=${SESSION}`, { headers: { accept: 'application/json' } })).status, 503);
  assert.equal(f.writes(), 0);
});

test('kits are sold only by card: the seller kit stays paused and no kit is an x402 product', () => {
  assert.equal(catalog.NEW_PRODUCT_SALES_ENABLED, false);
  assert.deepEqual(catalog.PRODUCTS.map((p) => p.slug), ['x402-seller-kit']);
  assert.deepEqual(store.BUY_PATHS, ['/buy/x402-seller-kit']);
  assert.deepEqual(store.buyOpenApiPaths(), {});
  for (const slug of ['seo-audit-workbook', 'wedding-budget-payment-planner']) assert.ok(catalog.findOrderProduct(slug));
});
