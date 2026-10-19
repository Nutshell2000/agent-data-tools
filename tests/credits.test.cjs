const assert = require('node:assert/strict');
const Module = require('node:module');
const { before, test } = require('node:test');
const esbuild = require('esbuild');
async function load(entry) {
  const result = await esbuild.build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'cjs', write: false });
  const m = new Module(entry, module); m.filename = entry; m.paths = Module._nodeModulePaths(process.cwd());
  m._compile(result.outputFiles[0].text, entry); return m.exports;
}
let credits, routes, Hono;
before(async () => {
  credits = await load(require.resolve('../src/lib/credits.ts'));
  routes = await load(require.resolve('../src/lib/credit-routes.ts'));
  ({ Hono } = require('hono'));
});

function storage(records = new Map()) {
  let pending = Promise.resolve();
  return { records, transaction(callback) {
    const next = pending.then(async () => {
      const draft = new Map([...records].map(([k, v]) => [k, structuredClone(v)]));
      const result = await callback({ get: async (k) => structuredClone(draft.get(k)), put: async (k, v) => draft.set(k, structuredClone(v)) });
      records.clear(); for (const [k, v] of draft) records.set(k, v); return result;
    });
    pending = next.catch(() => {}); return next;
  } };
}
/** A METRICS namespace whose "credits" instance runs the real ledger functions on in-memory storage. */
function metricsFor(store) {
  const stub = {
    issueCredits: (g) => credits.issueCredits(store, g),
    spendCredits: (h, m) => credits.spendCredits(store, h, m),
    refundCredits: (h, m) => credits.refundCredits(store, h, m),
    creditBalance: (h) => credits.creditBalance(store, h),
  };
  return { idFromName: (name) => { assert.equal(name, 'credits'); return name; }, get: () => stub };
}

test('prices convert to micros exactly', () => {
  assert.equal(credits.priceMicros('$0.001'), 1000);
  assert.equal(credits.priceMicros('$0.0002'), 200);
  assert.equal(credits.priceMicros('$0.25'), 250000);
  assert.equal(credits.priceMicros('$2'), 2000000);
  assert.throws(() => credits.priceMicros('0.001'));
  assert.equal(credits.creditsFromMicros(200), 0.2);
});

test('keys are read from Bearer or X-API-Key and must have our shape', () => {
  const key = credits.newCreditKey();
  assert.match(key, /^adt_[A-Za-z0-9_-]{43}$/);
  assert.equal(credits.apiKeyFrom((n) => ({ authorization: `Bearer ${key}` })[n]), key);
  assert.equal(credits.apiKeyFrom((n) => ({ 'x-api-key': key })[n]), key);
  assert.equal(credits.apiKeyFrom((n) => ({ authorization: key })[n]), key);
  assert.equal(credits.apiKeyFrom((n) => ({ authorization: 'Bearer sk_live_x' })[n]), undefined);
  assert.equal(credits.apiKeyFrom(() => undefined), undefined);
});

test('a checkout session grants credits once; a repeat claim returns the same key', async () => {
  const s = storage();
  const first = await credits.issueCredits(s, { sessionId: 'cs_live_a', credits: 5000, key: 'adt_one', keyHash: 'h1' });
  const again = await credits.issueCredits(s, { sessionId: 'cs_live_a', credits: 5000, key: 'adt_two', keyHash: 'h2' });
  assert.equal(first.balanceMicros, 5_000_000);
  assert.equal(again.key, 'adt_one');
  assert.equal(again.repeated, true);
  assert.equal(again.balanceMicros, 5_000_000);
  assert.equal(await credits.creditBalance(s, 'h2'), null);
});

test('spend refuses unknown keys and overdrafts; refund restores the balance', async () => {
  const s = storage();
  await credits.issueCredits(s, { sessionId: 'cs_live_b', credits: 2, key: 'adt_k', keyHash: 'h' });
  assert.deepEqual(await credits.spendCredits(s, 'nope', 1000), { ok: false, reason: 'unknown_key', balanceMicros: 0 });
  assert.deepEqual(await credits.spendCredits(s, 'h', 1500), { ok: true, balanceMicros: 500 });
  assert.deepEqual(await credits.spendCredits(s, 'h', 1000), { ok: false, reason: 'insufficient', balanceMicros: 500 });
  assert.equal(await credits.refundCredits(s, 'h', 1500), 2000);
  const bal = await credits.creditBalance(s, 'h');
  assert.equal(bal.calls, 0);
  assert.equal(bal.spentMicros, 0);
});

test('concurrent spends never overdraw', async () => {
  const s = storage();
  await credits.issueCredits(s, { sessionId: 'cs_live_c', credits: 5, key: 'adt_k', keyHash: 'h' });
  const results = await Promise.all(Array.from({ length: 20 }, () => credits.spendCredits(s, 'h', 1000)));
  assert.equal(results.filter((r) => r.ok).length, 5);
  assert.equal((await credits.creditBalance(s, 'h')).balanceMicros, 0);
});

function stripeFetch(session, status = 200) {
  return async (url, init) => {
    assert.match(url, /^https:\/\/api\.stripe\.com\/v1\/checkout\/sessions\/cs_/);
    assert.equal(init.headers.authorization, 'Bearer rk_test_key');
    return new Response(JSON.stringify(session), { status });
  };
}
const paid = { mode: 'payment', status: 'complete', payment_status: 'paid', currency: 'usd', amount_total: 2000, metadata: { adt_credits: '22000' } };

test('only a paid, complete credits checkout with matching amount and pack is accepted', async () => {
  const id = 'cs_live_a1B2c3D4e5F6g7';
  assert.equal((await credits.verifyCheckout('rk_test_key', id, stripeFetch(paid))).credits, 22000);
  const reject = async (session, status, code) => {
    await assert.rejects(credits.verifyCheckout('rk_test_key', id, stripeFetch(session, status)), (e) => e.status === code);
  };
  await reject({ ...paid, payment_status: 'unpaid' }, 200, 402);
  await reject({ ...paid, status: 'open' }, 200, 402);
  await reject({ ...paid, amount_total: 500 }, 200, 400);
  await reject({ ...paid, metadata: {} }, 200, 400);
  await reject({ ...paid, currency: 'sek' }, 200, 400);
  await reject({}, 404, 404);
  await assert.rejects(credits.verifyCheckout(undefined, id), (e) => e.status === 503);
  await assert.rejects(credits.verifyCheckout('rk_test_key', '../../v1/charges'), (e) => e.status === 400);
});

function app(env) {
  const a = new Hono();
  a.use('/tool', async (c, next) => {
    const key = credits.apiKeyFrom((n) => c.req.header(n));
    if (key) return routes.chargeCredits(c, '$0.002', key, next);
    return c.json({}, 402);
  });
  a.get('/tool', (c) => (c.req.query('fail') ? c.json({ error: 'bad input' }, 400) : c.json({ ok: true })));
  a.route('/', routes.credits);
  return { fetch: (path, headers = {}) => a.fetch(new Request(`https://x.test${path}`, { headers }), env, { waitUntil() {} }) };
}

test('paywall charges a key per successful call and refunds failed calls', async () => {
  const s = storage();
  const env = { METRICS: metricsFor(s), STRIPE_READ_KEY: 'rk_test_key' };
  const key = credits.newCreditKey();
  await credits.issueCredits(s, { sessionId: 'cs_live_d', credits: 5, key, keyHash: await credits.hashCreditKey(key) });
  const { fetch } = app(env);
  const auth = { authorization: `Bearer ${key}` };

  let res = await fetch('/tool', auth);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('X-Credits-Charged'), '2');
  assert.equal(res.headers.get('X-Credits-Remaining'), '3');

  res = await fetch('/tool?fail=1', { 'x-api-key': key });
  assert.equal(res.status, 400);
  assert.equal(res.headers.get('X-Credits-Charged'), '0');
  assert.equal(res.headers.get('X-Credits-Remaining'), '3');

  assert.equal((await fetch('/tool', auth)).status, 200);
  res = await fetch('/tool', auth);
  assert.equal(res.status, 402);
  assert.match((await res.json()).error, /not enough credits/);

  res = await fetch('/tool', { authorization: `Bearer ${credits.newCreditKey()}` });
  assert.equal(res.status, 401);

  res = await fetch('/credits/balance', auth);
  assert.deepEqual(await res.json().then(({ since, ...rest }) => rest), { balanceCredits: 1, purchasedCredits: 5, spentCredits: 4, calls: 2 });

  assert.equal((await fetch('/tool')).status, 402);
});

test('/credits lists the three packs as JSON for agents', async () => {
  const res = await app({}).fetch('/credits', { accept: 'application/json' });
  const body = await res.json();
  assert.deepEqual(body.packs.map((p) => [p.price, p.credits]), [['$5', 5000], ['$20', 22000], ['$100', 125000]]);
  for (const p of body.packs) assert.match(p.buy, /^https:\/\/buy\.stripe\.com\//);
});

test('/credits/claim waits for the Stripe key instead of issuing anything', async () => {
  const s = storage();
  const res = await app({ METRICS: metricsFor(s) }).fetch('/credits/claim?session_id=cs_live_a1B2c3D4e5F6g7', { accept: 'application/json' });
  assert.equal(res.status, 503);
  assert.equal(res.headers.get('Cache-Control'), 'no-store');
  assert.equal(s.records.size, 0);
});
