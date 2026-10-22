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
      const result = await callback({ get: async (k) => structuredClone(draft.get(k)), put: async (k, v) => draft.set(k, structuredClone(v)), delete: async (k) => draft.delete(k) });
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
    rotateKey: (o, k, n) => credits.rotateKey(store, o, k, n),
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
  const short = await res.json();
  assert.match(short.error, /not enough credits.*Top up this key/);
  assert.match(short.topUp[0].buy, /^https:\/\/buy\.stripe\.com\/.+\?client_reference_id=topup_[0-9a-f]{64}$/);

  res = await fetch('/tool', { authorization: `Bearer ${credits.newCreditKey()}` });
  assert.equal(res.status, 401);

  res = await fetch('/credits/balance', auth);
  const balance = await res.json();
  const { since, topUp, ...rest } = balance;
  assert.deepEqual(rest, { balanceCredits: 1, purchasedCredits: 5, spentCredits: 4, calls: 2 });
  assert.equal(topUp.length, 3);
  for (const l of topUp) assert.ok(l.buy.endsWith(`?client_reference_id=topup_${await credits.hashCreditKey(key)}`));

  assert.equal((await fetch('/tool')).status, 402);
});

test('/credits offers no pack while claims cannot issue keys (STRIPE_READ_KEY unset)', async () => {
  const body = await (await app({}).fetch('/credits', { accept: 'application/json' })).json();
  assert.equal(body.cardReady, false);
  assert.deepEqual(body.packs, []);
  assert.match(body.what, /not available yet/);
  const html = await (await app({}).fetch('/credits', { accept: 'text/html' })).text();
  assert.doesNotMatch(html, /buy\.stripe\.com/);
});

test('/credits lists the three packs as JSON for agents', async () => {
  const res = await app({ STRIPE_READ_KEY: 'rk_test_key' }).fetch('/credits', { accept: 'application/json' });
  const body = await res.json();
  assert.equal(body.cardReady, true);
  assert.deepEqual(body.packs.map((p) => [p.price, p.credits]), [['$5', 5000], ['$20', 22000], ['$100', 125000]]);
  for (const p of body.packs) assert.match(p.buy, /^https:\/\/buy\.stripe\.com\//);
});

test('/credits page for people: packs with calls per pack, app setup, free previews, indexable', async () => {
  const res = await app({ STRIPE_READ_KEY: 'rk_test_key' }).fetch('/credits', { accept: 'text/html' });
  const html = await res.text();
  assert.match(html, /about 500 calls at \$0\.01/);
  assert.match(html, /\/mcp\/account/);
  assert.match(html, /\/check\/counterparty\?sample=1/);
  assert.match(html, /25 calls free/);
  assert.doesNotMatch(html, /noindex/);
});

test('/credits/claim waits for the Stripe key instead of issuing anything', async () => {
  const s = storage();
  const res = await app({ METRICS: metricsFor(s) }).fetch('/credits/claim?session_id=cs_live_a1B2c3D4e5F6g7', { accept: 'application/json' });
  assert.equal(res.status, 503);
  assert.equal(res.headers.get('Cache-Control'), 'no-store');
  assert.equal(s.records.size, 0);
});

test('free calls: 25 per caller, a daily total cap, refunds restore the allowance', async () => {
  const free = await load(require.resolve('../src/lib/free-calls.ts'));
  const s = storage();
  const left = [];
  for (let i = 0; i < 26; i++) left.push(await free.takeFreeCall(s, 'a', '2026-10-19'));
  assert.equal(left[0], 24);
  assert.equal(left[24], 0);
  assert.equal(left[25], null);
  await free.refundFreeCall(s, 'a', '2026-10-19');
  assert.equal(await free.takeFreeCall(s, 'a', '2026-10-19'), 0);
  s.records.set('free:day:2026-10-20', free.FREE_CALLS_PER_DAY);
  assert.equal(await free.takeFreeCall(s, 'b', '2026-10-20'), null);
  assert.equal(await free.takeFreeCall(s, 'b', '2026-10-21'), 24);
  assert.notEqual(await free.callerHash('1.2.3.4'), '1.2.3.4');
  assert.match(await free.callerHash('1.2.3.4'), /^[0-9a-f]{64}$/);
});

test('credit summary totals sales and use without exposing keys', async () => {
  const store = storage();
  const list = async ({ prefix }) => new Map([...store.records].filter(([k]) => k.startsWith(prefix)));
  const keyA = 'adt_' + 'a'.repeat(40), keyB = 'adt_' + 'b'.repeat(40);
  const hashA = await credits.hashCreditKey(keyA), hashB = await credits.hashCreditKey(keyB);
  await credits.issueCredits(store, { sessionId: 'cs_1', credits: 5000, key: keyA, keyHash: hashA });
  await credits.issueCredits(store, { sessionId: 'cs_1', credits: 5000, key: keyA, keyHash: hashA }); // repeat claim
  await credits.issueCredits(store, { sessionId: 'cs_2', credits: 22000, key: keyB, keyHash: hashB });
  await credits.spendCredits(store, hashA, 3000);
  const summary = await credits.creditSummary({ list });
  assert.equal(summary.purchases, 2);
  assert.equal(summary.topUps, 0);
  assert.equal(summary.buyers, 2);
  assert.equal(summary.purchasedUsd, 27);
  assert.equal(summary.spentUsd, 0.003);
  assert.equal(summary.creditCalls, 1);
  assert.equal(summary.activeBuyers, 1);
  assert.equal(Object.values(summary.perDay)[0].credits, 27000);
  assert.ok(!JSON.stringify(summary).includes('adt_') && !JSON.stringify(summary).includes(hashA));
});

test('top-up: a checkout naming an existing key adds credits to it, once; an unknown key gets a new key', async () => {
  const s = storage();
  const env = { METRICS: metricsFor(s), STRIPE_READ_KEY: 'rk_test_key' };
  const key = credits.newCreditKey();
  const keyHash = await credits.hashCreditKey(key);
  await credits.issueCredits(s, { sessionId: 'cs_live_first', credits: 5000, key, keyHash });
  const { fetch } = app(env);
  const realFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({ ...paid, client_reference_id: `topup_${keyHash}` }));
    let res = await fetch('/credits/claim?session_id=cs_live_TopupOne0001', { accept: 'application/json' });
    let body = await res.json();
    assert.equal(body.toppedUp, true);
    assert.equal(body.apiKey, undefined, 'the key is never shown or re-issued on a top-up');
    assert.equal(body.balanceCredits, 27000);
    res = await fetch('/credits/claim?session_id=cs_live_TopupOne0001', { accept: 'application/json' });
    assert.equal((await res.json()).balanceCredits, 27000, 'reloading does not add twice');
    res = await fetch('/credits/claim?session_id=cs_live_TopupOne0001', { accept: 'text/html' });
    assert.match(await res.text(), /added to your existing key/);
    assert.equal((await fetch('/credits/balance', { authorization: `Bearer ${key}` }).then((r) => r.json())).balanceCredits, 27000);

    globalThis.fetch = async () => new Response(JSON.stringify({ ...paid, client_reference_id: `topup_${'0'.repeat(64)}` }));
    body = await (await fetch('/credits/claim?session_id=cs_live_TopupTwo0002', { accept: 'application/json' })).json();
    assert.match(body.apiKey, /^adt_/, 'an unknown top-up target falls back to a new key, so the payment is not lost');
    assert.equal(body.balanceCredits, 22000);

    globalThis.fetch = async () => new Response(JSON.stringify({ ...paid, client_reference_id: 'something-else' }));
    assert.equal((await credits.verifyCheckout('rk_test_key', 'cs_live_a1B2c3D4e5F6g7')).topUpKeyHash, undefined);
  } finally { globalThis.fetch = realFetch; }
});

test('new-key claim page offers top-up links for that same key', async () => {
  const s = storage();
  const realFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(JSON.stringify(paid));
    const html = await (await app({ METRICS: metricsFor(s), STRIPE_READ_KEY: 'rk_test_key' }).fetch('/credits/claim?session_id=cs_live_NewKey000001', { accept: 'text/html' })).text();
    const key = /<pre>(adt_[A-Za-z0-9_-]+)<\/pre>/.exec(html)[1];
    assert.ok(html.includes(`client_reference_id=topup_${await credits.hashCreditKey(key)}`));
  } finally { globalThis.fetch = realFetch; }
});

test('low balance: the call that drops a key below 200 credits says so once, with a top-up link', async () => {
  assert.equal(routes.crossedLow(200_000, 199_999), true);
  assert.equal(routes.crossedLow(199_999, 197_999), false);
  assert.equal(routes.crossedLow(300_000, 250_000), false);
  const s = storage();
  const key = credits.newCreditKey();
  await credits.issueCredits(s, { sessionId: 'cs_live_low', credits: 201, key, keyHash: await credits.hashCreditKey(key) });
  const { fetch } = app({ METRICS: metricsFor(s) });
  const auth = { authorization: `Bearer ${key}` };
  let res = await fetch('/tool', auth);
  assert.equal(res.headers.get('X-Credits-Remaining'), '199');
  assert.match(res.headers.get('X-Credits-Low'), /^199 credits left; top up this key: https:\/\/buy\.stripe\.com\/.+client_reference_id=topup_/);
  res = await fetch('/tool', auth);
  assert.equal(res.headers.get('X-Credits-Low'), null, 'only the crossing call carries the warning');
});

test('low balance over MCP: the crossing call appends one note for the user', async () => {
  const s = storage();
  const key = credits.newCreditKey();
  await credits.issueCredits(s, { sessionId: 'cs_live_lowmcp', credits: 201, key, keyHash: await credits.hashCreditKey(key) });
  const charge = routes.creditCharger({ METRICS: metricsFor(s) }, key, '$0.002', 'https://x.test');
  const ok = { content: [{ type: 'text', text: '{}' }] };
  const first = await charge(async () => ok);
  assert.equal(first.content.length, 2);
  assert.match(first.content[1].text, /^Credits running low: 199 left/);
  const second = await charge(async () => ok);
  assert.equal(second.content.length, 1);
});

test('rotate: the balance moves to a new key, the old key stops working, purchase pages stop showing it', async () => {
  const s = storage();
  const env = { METRICS: metricsFor(s), STRIPE_READ_KEY: 'rk_test_key' };
  const old = credits.newCreditKey();
  await credits.issueCredits(s, { sessionId: 'cs_live_RotateMe0001', credits: 5000, key: old, keyHash: await credits.hashCreditKey(old) });
  const a = new Hono(); a.route('/', routes.credits);
  const call = (path, init = {}) => a.fetch(new Request(`https://x.test${path}`, init), env, { waitUntil() {} });

  assert.equal((await call('/credits/rotate', { method: 'POST' })).status, 401);
  assert.equal((await call('/credits/rotate', { method: 'POST', headers: { authorization: `Bearer ${credits.newCreditKey()}` } })).status, 401);
  const res = await call('/credits/rotate', { method: 'POST', headers: { authorization: `Bearer ${old}` } });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.match(body.apiKey, /^adt_/);
  assert.notEqual(body.apiKey, old);
  assert.equal(body.balanceCredits, 5000);

  assert.equal((await call('/credits/balance', { headers: { authorization: `Bearer ${old}` } })).status, 401, 'old key is dead');
  assert.equal((await (await call('/credits/balance', { headers: { authorization: `Bearer ${body.apiKey}` } })).json()).balanceCredits, 5000);

  const realFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({ mode: 'payment', status: 'complete', payment_status: 'paid', currency: 'usd', amount_total: 500, metadata: { adt_credits: '5000' } }));
    const reload = await call('/credits/claim?session_id=cs_live_RotateMe0001', { headers: { accept: 'application/json' } });
    const text = JSON.stringify(await reload.json());
    assert.ok(!text.includes(old) && !text.includes(body.apiKey), 'the purchase page shows neither key after rotation');
    assert.match(text, /replaced/);
  } finally { globalThis.fetch = realFetch; }
});
