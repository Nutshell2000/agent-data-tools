// The monthly plan (lib/credits.ts CREDIT_PLANS; the owner, 11 Nov 2026: $9 a month for 15,000 credits, $19 for 40,000,
// unused credits kept, no free allowance). A plan is a Stripe subscription whose every paid invoice tops up one key.
// There is no webhook: renewals are read from Stripe when the key is used. These tests hold the money rules:
// a paid invoice grants once, an unpaid or unknown one never, and with no Stripe links nothing about the service changes.
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
function metricsFor(store) {
  const stub = {
    issueCredits: (g) => credits.issueCredits(store, g),
    grantPlanInvoices: (h, s, ids) => credits.grantPlanInvoices(store, h, s, ids),
    spendCredits: (h, m) => credits.spendCredits(store, h, m),
    refundCredits: (h, m) => credits.refundCredits(store, h, m),
    creditBalance: (h) => credits.creditBalance(store, h),
    rotateKey: (o, k, n) => credits.rotateKey(store, o, k, n),
  };
  return { idFromName: (name) => { assert.equal(name, 'credits'); return name; }, get: () => stub };
}
const SUB = 'sub_1QabcDEFghiJKL', FIRST = 'in_1QfirstINVOICE01', SECOND = 'in_1QsecondINVOICE2', THIRD = 'in_1QthirdINVOICE03';
const subscribed = { mode: 'subscription', status: 'complete', payment_status: 'paid', currency: 'usd', amount_total: 900, metadata: { adt_credits: '15000' }, subscription: SUB, invoice: FIRST };
const sessionFetch = (session, status = 200) => async (url, init) => {
  assert.match(url, /^https:\/\/api\.stripe\.com\/v1\/checkout\/sessions\/cs_/);
  assert.equal(init.headers.authorization, 'Bearer rk_test_key');
  return new Response(JSON.stringify(session), { status });
};

test('the plans are the two the owner approved, and none is offered until its Stripe link and the cancel page exist', () => {
  assert.deepEqual(credits.CREDIT_PLANS.map((p) => [p.usdCents, p.credits]), [[900, 15000], [1900, 40000]]);
  // Each plan gives more credits per dollar than the pack nearest in price, or nobody would choose it.
  for (const plan of credits.CREDIT_PLANS) {
    for (const pack of credits.CREDIT_PACKS) assert.ok(plan.credits / plan.usdCents > pack.credits / pack.usdCents, `$${plan.usdCents / 100} plan against the $${pack.usdCents / 100} pack`);
  }
  const offered = credits.CREDIT_PLANS.filter((p) => p.url !== '');
  if (credits.PLAN_PORTAL_URL === '') assert.equal(credits.WEB_PLANS.length, 0, 'no cancel page, no plan on sale');
  else assert.equal(credits.WEB_PLANS.length, offered.length);
  for (const p of offered) assert.match(p.url, /^https:\/\/buy\.stripe\.com\/[A-Za-z0-9]+$/);
  if (credits.PLAN_PORTAL_URL !== '') assert.match(credits.PLAN_PORTAL_URL, /^https:\/\/billing\.stripe\.com\/p\/login\/[A-Za-z0-9_]+$/);
  const info = routes.creditsInfo('https://x.test', false, true);
  assert.equal('monthlyPlans' in info, credits.WEB_PLANS.length > 0);
  assert.equal('monthlyPlans' in routes.creditsInfo('https://x.test', false, false), false, 'never while card payments are off');
});

test('a paid subscription checkout is accepted as a plan; anything else about it is refused', async () => {
  const id = 'cs_live_a1B2c3D4e5F6g7';
  const plan = await credits.verifyCheckout('rk_test_key', id, sessionFetch(subscribed));
  assert.deepEqual(plan, { usdCents: 900, credits: 15000, topUpKeyHash: undefined, plan: { subscriptionId: SUB, invoiceId: FIRST } });
  const big = await credits.verifyCheckout('rk_test_key', id, sessionFetch({ ...subscribed, amount_total: 1900, metadata: { adt_credits: '40000' } }));
  assert.equal(big.credits, 40000);
  const reject = async (session, code) => assert.rejects(credits.verifyCheckout('rk_test_key', id, sessionFetch(session)), (e) => e.status === code);
  await reject({ ...subscribed, payment_status: 'unpaid' }, 402);
  await reject({ ...subscribed, status: 'open' }, 402);
  await reject({ ...subscribed, amount_total: 500 }, 400);                        // a pack's price is not a plan
  await reject({ ...subscribed, metadata: { adt_credits: '40000' } }, 400);       // the $19 credits at the $9 price
  await reject({ ...subscribed, subscription: null }, 400);
  await reject({ ...subscribed, invoice: 'cs_live_notaninvoice' }, 400);
  await reject({ ...subscribed, subscription: '../v1/charges' }, 400);
  await reject({ ...subscribed, mode: 'setup' }, 402);
  // A one-time payment at a plan's price is not a pack, and a subscription at a pack's price is not a plan.
  await reject({ ...subscribed, mode: 'payment' }, 400);
  await reject({ ...subscribed, amount_total: 2000, metadata: { adt_credits: '22000' } }, 400);
  // The packs are judged as before and carry no plan.
  const pack = await credits.verifyCheckout('rk_test_key', id, sessionFetch({ mode: 'payment', status: 'complete', payment_status: 'paid', currency: 'usd', amount_total: 500, metadata: { adt_credits: '5000' } }));
  assert.deepEqual(pack, { usdCents: 500, credits: 5000, topUpKeyHash: undefined, plan: undefined });
});

test('the first invoice is granted with the checkout and never again; each later paid invoice is granted once', async () => {
  const s = storage();
  const first = await credits.issueCredits(s, { sessionId: 'cs_live_plan', credits: 15000, key: 'adt_plan', keyHash: 'h1', plan: { subscriptionId: SUB, invoiceId: FIRST } });
  assert.equal(first.balanceMicros, 15_000_000);
  // Reloading the claim page: same key, no second grant.
  const again = await credits.issueCredits(s, { sessionId: 'cs_live_plan', credits: 15000, key: 'adt_other', keyHash: 'h2', plan: { subscriptionId: SUB, invoiceId: FIRST } });
  assert.equal(again.key, 'adt_plan'); assert.equal(again.balanceMicros, 15_000_000);
  const account = await credits.creditBalance(s, 'h1');
  assert.equal(account.plans.length, 1); assert.equal(account.plans[0].subscriptionId, SUB); assert.equal(account.plans[0].credits, 15000);

  // The first read of Stripe returns the first invoice too: nothing is added for it.
  let read = await credits.grantPlanInvoices(s, 'h1', SUB, [FIRST]);
  assert.deepEqual({ added: read.added, balance: read.balanceMicros }, { added: 0, balance: 15_000_000 });
  // The renewal arrives.
  read = await credits.grantPlanInvoices(s, 'h1', SUB, [SECOND, FIRST]);
  assert.deepEqual({ added: read.added, balance: read.balanceMicros }, { added: 15000, balance: 30_000_000 });
  // Read again, with a duplicate in the list and ids that are not invoices: still once.
  read = await credits.grantPlanInvoices(s, 'h1', SUB, [SECOND, SECOND, FIRST, 'cs_live_x', '', '../x', 42]);
  assert.deepEqual({ added: read.added, balance: read.balanceMicros }, { added: 0, balance: 30_000_000 });
  // Two renewals at once (the key was not used for two months).
  read = await credits.grantPlanInvoices(s, 'h1', SUB, [THIRD, 'in_1QfourthINVOICE4', SECOND, FIRST]);
  assert.equal(read.added, 30000); assert.equal(read.balanceMicros, 60_000_000);
  const summary = await credits.creditSummary({ list: async ({ prefix }) => new Map([...s.records].filter(([k]) => k.startsWith(prefix))) });
  assert.equal(summary.purchases, 4, 'the checkout and three renewals, the first invoice not counted twice');
  assert.equal(summary.topUps, 3);
  assert.equal(summary.purchasedUsd, 60);
});

test('an invoice is granted only to the key that owns the subscription', async () => {
  const s = storage();
  await credits.issueCredits(s, { sessionId: 'cs_live_plan', credits: 15000, key: 'adt_plan', keyHash: 'h1', plan: { subscriptionId: SUB, invoiceId: FIRST } });
  await credits.issueCredits(s, { sessionId: 'cs_live_pack', credits: 5000, key: 'adt_pack', keyHash: 'h2' });
  assert.equal(await credits.grantPlanInvoices(s, 'h2', SUB, [SECOND]), null, 'a key without a plan');
  assert.equal(await credits.grantPlanInvoices(s, 'h1', 'sub_1QsomeoneELSE00', [SECOND]), null, 'another subscription');
  assert.equal(await credits.grantPlanInvoices(s, 'unknown', SUB, [SECOND]), null);
  assert.equal((await credits.creditBalance(s, 'h1')).balanceMicros, 15_000_000);
  assert.equal((await credits.creditBalance(s, 'h2')).balanceMicros, 5_000_000);
  await assert.rejects(credits.issueCredits(s, { sessionId: 'cs_live_bad', credits: 15000, key: 'adt_x', keyHash: 'h3', plan: { subscriptionId: 'nope', invoiceId: FIRST } }), /invalid plan grant/);
});

test('a second subscription into the same key is kept beside the first; a replaced key keeps its plan', async () => {
  const s = storage();
  await credits.issueCredits(s, { sessionId: 'cs_live_one', credits: 15000, key: 'adt_plan', keyHash: 'h1', plan: { subscriptionId: SUB, invoiceId: FIRST } });
  const OTHER = 'sub_1QotherPLAN0001';
  await credits.issueCredits(s, { sessionId: 'cs_live_two', credits: 40000, key: null, keyHash: 'h1', plan: { subscriptionId: OTHER, invoiceId: 'in_1QotherFIRST001' } });
  let account = await credits.creditBalance(s, 'h1');
  assert.deepEqual(account.plans.map((p) => [p.subscriptionId, p.credits]), [[SUB, 15000], [OTHER, 40000]]);
  assert.equal((await credits.grantPlanInvoices(s, 'h1', OTHER, ['in_1QotherSECOND02'])).added, 40000);
  assert.equal((await credits.grantPlanInvoices(s, 'h1', SUB, [SECOND])).added, 15000);
  const rotated = await credits.rotateKey(s, 'h1', 'adt_new', 'h9');
  assert.equal(rotated.balanceMicros, 110_000_000);
  account = await credits.creditBalance(s, 'h9');
  assert.equal(account.plans.length, 2);
  assert.equal((await credits.grantPlanInvoices(s, 'h9', SUB, [THIRD])).added, 15000, 'renewals follow the key');
  assert.equal(await credits.grantPlanInvoices(s, 'h1', SUB, ['in_1QlateINVOICE005']), null, 'the old key is gone');
});

test('only paid invoices with money in them count, and a failed read of Stripe grants nothing', async () => {
  const list = (data, status = 200) => async (url, init) => {
    assert.equal(url, `https://api.stripe.com/v1/invoices?subscription=${SUB}&status=paid&limit=36`);
    assert.equal(init.headers.authorization, 'Bearer rk_test_key');
    return new Response(JSON.stringify({ data }), { status });
  };
  const data = [
    { id: SECOND, status: 'paid', amount_paid: 900 },
    { id: 'in_1QopenINVOICE0001', status: 'open', amount_paid: 0 },
    { id: 'in_1QzeroINVOICE0001', status: 'paid', amount_paid: 0 },
    { id: 'in_1QvoidINVOICE0001', status: 'void', amount_paid: 900 },
    { id: 'not-an-invoice', status: 'paid', amount_paid: 900 },
    { id: FIRST, status: 'paid', amount_paid: 900 },
  ];
  assert.deepEqual(await credits.paidPlanInvoices('rk_test_key', SUB, list(data)), [SECOND, FIRST]);
  assert.equal(await credits.paidPlanInvoices('rk_test_key', SUB, list(data, 403)), null, 'the key may not read invoices');
  assert.equal(await credits.paidPlanInvoices('rk_test_key', SUB, async () => { throw new Error('network'); }), null);
  assert.equal(await credits.paidPlanInvoices('rk_test_key', SUB, async () => new Response('not json')), null);
  assert.equal(await credits.paidPlanInvoices(undefined, SUB, list(data)), null);
  assert.equal(await credits.paidPlanInvoices('rk_test_key', 'sub_x&status=open', list(data)), null, 'the id is never put in a URL unchecked');
});

function app(env) {
  const a = new Hono();
  a.use('/tool', async (c, next) => {
    const key = credits.apiKeyFrom((n) => c.req.header(n), (n) => c.req.query(n));
    if (key) return routes.chargeCredits(c, '$0.01', key, next);
    return c.json({}, 402);
  });
  a.get('/tool', (c) => c.json({ ok: true }));
  a.route('/', routes.credits);
  return { fetch: (path, headers = {}) => a.fetch(new Request(`https://x.test${path}`, { headers }), env, { waitUntil() {} }) };
}

test('a key on the plan that runs short gets its paid renewal on the next call; an unpaid month gets the normal refusal', async () => {
  const s = storage();
  const env = { METRICS: metricsFor(s), STRIPE_READ_KEY: 'rk_test_key' };
  const key = credits.newCreditKey();
  const keyHash = await credits.hashCreditKey(key);
  await credits.issueCredits(s, { sessionId: 'cs_live_plan', credits: 15000, key, keyHash, plan: { subscriptionId: SUB, invoiceId: FIRST } });
  // Spend the month down to 5 credits, and make the last read of Stripe two minutes old.
  const account = s.records.get(`credit:acct:${keyHash}`);
  account.balanceMicros = 5_000; account.plans[0].syncedAt = new Date(Date.now() - 120_000).toISOString();
  const { fetch } = app(env);
  const auth = { authorization: `Bearer ${key}` };
  const realFetch = globalThis.fetch;
  let stripeCalls = 0, paidInvoices = [FIRST];
  globalThis.fetch = async (url) => {
    assert.match(String(url), /^https:\/\/api\.stripe\.com\/v1\/invoices\?subscription=sub_/);
    stripeCalls += 1;
    return new Response(JSON.stringify({ data: paidInvoices.map((id) => ({ id, status: 'paid', amount_paid: 900 })) }));
  };
  try {
    // The month's payment has not been made: Stripe is read once, nothing is added, the call is refused uncharged.
    let res = await fetch('/tool', auth);
    assert.equal(res.status, 402);
    assert.match((await res.json()).error, /not enough credits: this call costs 10, the key has 5/);
    assert.equal(stripeCalls, 1);
    // A second refused call within the minute does not read Stripe again.
    res = await fetch('/tool', auth);
    assert.equal(res.status, 402); assert.equal(stripeCalls, 1);

    // The renewal is paid. Once the last read is a minute old, the next call finds it, adds 15,000 and is served.
    paidInvoices = [SECOND, FIRST];
    s.records.get(`credit:acct:${keyHash}`).plans[0].syncedAt = new Date(Date.now() - 61_000).toISOString();
    res = await fetch('/tool', auth);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('X-Credits-Charged'), '10');
    assert.equal(res.headers.get('X-Credits-Remaining'), '14995');
    assert.equal(stripeCalls, 2);
    // Served calls after that do not read Stripe (the plan was read seconds ago).
    res = await fetch('/tool', auth);
    assert.equal(res.headers.get('X-Credits-Remaining'), '14985'); assert.equal(stripeCalls, 2);

    // After twelve hours a served call reads once more and finds the next renewal without the key ever running short.
    paidInvoices = [THIRD, SECOND, FIRST];
    s.records.get(`credit:acct:${keyHash}`).plans[0].syncedAt = new Date(Date.now() - 13 * 3_600_000).toISOString();
    res = await fetch('/tool', auth);
    assert.equal(res.status, 200); assert.equal(stripeCalls, 3);
    assert.equal(res.headers.get('X-Credits-Remaining'), String(14985 - 10 + 15000));

    // The balance answer names the plan and where to cancel it.
    const balance = await (await fetch('/credits/balance', auth)).json();
    assert.equal(balance.balanceCredits, 29975);
    assert.equal(balance.monthlyPlan.creditsEachMonth, 15000);
    assert.match(balance.monthlyPlan.what, /renews until you cancel/);
  } finally { globalThis.fetch = realFetch; }
});

test('claiming a plan checkout issues a key once and says how the plan works; a plan bought into an existing key tops it up', async () => {
  const s = storage();
  const env = { METRICS: metricsFor(s), STRIPE_READ_KEY: 'rk_test_key' };
  const { fetch } = app(env);
  const realFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (url) => { assert.match(String(url), /\/v1\/checkout\/sessions\/cs_live_PlanClaim0001$/); return new Response(JSON.stringify(subscribed)); };
    const first = await (await fetch('/credits/claim?session_id=cs_live_PlanClaim0001', { accept: 'application/json' })).json();
    assert.match(first.apiKey, /^adt_/);
    assert.equal(first.creditsAdded, 15000); assert.equal(first.balanceCredits, 15000);
    assert.match(first.monthlyPlan, /15,000 credits are added to this key each month.*renews until you cancel/);
    const again = await (await fetch('/credits/claim?session_id=cs_live_PlanClaim0001', { accept: 'application/json' })).json();
    assert.equal(again.apiKey, first.apiKey); assert.equal(again.balanceCredits, 15000, 'reloading the claim page adds nothing');
    const html = await (await fetch('/credits/claim?session_id=cs_live_PlanClaim0001', { accept: 'text/html' })).text();
    assert.match(html, /Your monthly plan/); assert.match(html, /Manage or cancel the plan/);
    const keyHash = await credits.hashCreditKey(first.apiKey);
    assert.equal((await credits.creditBalance(s, keyHash)).plans[0].subscriptionId, SUB);
    // The first renewal read returns the invoice the checkout paid: no second grant.
    assert.equal((await credits.grantPlanInvoices(s, keyHash, SUB, [FIRST])).added, 0);

    // A pack buyer later takes the $19 plan through a link that names the existing key.
    const packKey = credits.newCreditKey();
    const packHash = await credits.hashCreditKey(packKey);
    await credits.issueCredits(s, { sessionId: 'cs_live_pack', credits: 5000, key: packKey, keyHash: packHash });
    globalThis.fetch = async () => new Response(JSON.stringify({ ...subscribed, amount_total: 1900, metadata: { adt_credits: '40000' }, subscription: 'sub_1QupgradePLAN01', invoice: 'in_1QupgradeFIRST1', client_reference_id: `topup_${packHash}` }));
    const top = await (await fetch('/credits/claim?session_id=cs_live_PlanTopup0002', { accept: 'application/json' })).json();
    assert.equal(top.toppedUp, true); assert.equal(top.apiKey, undefined); assert.equal(top.balanceCredits, 45000);
    assert.match(top.monthlyPlan, /40,000 credits are added/);
    assert.equal((await credits.creditBalance(s, packHash)).plans[0].credits, 40000);
  } finally { globalThis.fetch = realFetch; }
});

test('when Stripe cannot be read a call on a key with credits is still served, and the read is not repeated on every call', async () => {
  const s = storage();
  const env = { METRICS: metricsFor(s), STRIPE_READ_KEY: 'rk_test_key' };
  const key = credits.newCreditKey();
  const keyHash = await credits.hashCreditKey(key);
  await credits.issueCredits(s, { sessionId: 'cs_live_plan', credits: 15000, key, keyHash, plan: { subscriptionId: SUB, invoiceId: FIRST } });
  s.records.get(`credit:acct:${keyHash}`).plans[0].syncedAt = new Date(Date.now() - 13 * 3_600_000).toISOString();
  const { fetch } = app(env);
  const realFetch = globalThis.fetch;
  let stripeCalls = 0;
  globalThis.fetch = async () => { stripeCalls += 1; return new Response('{"error":{"type":"permission_error"}}', { status: 403 }); };
  try {
    for (let i = 0; i < 3; i++) assert.equal((await fetch('/tool', { authorization: `Bearer ${key}` })).status, 200);
    assert.equal(stripeCalls, 1);
    assert.equal((await credits.creditBalance(s, keyHash)).balanceMicros, 15_000_000 - 30_000);
  } finally { globalThis.fetch = realFetch; }
});

test('a key without a plan never causes a read of Stripe', async () => {
  const s = storage();
  const env = { METRICS: metricsFor(s), STRIPE_READ_KEY: 'rk_test_key' };
  const key = credits.newCreditKey();
  await credits.issueCredits(s, { sessionId: 'cs_live_pack', credits: 15, key, keyHash: await credits.hashCreditKey(key) });
  const { fetch } = app(env);
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('Stripe must not be called for a key without a plan'); };
  try {
    assert.equal((await fetch('/tool', { authorization: `Bearer ${key}` })).status, 200);
    assert.equal((await fetch('/tool', { authorization: `Bearer ${key}` })).status, 402);
    const balance = await (await fetch('/credits/balance', { authorization: `Bearer ${key}` })).json();
    assert.equal(balance.balanceCredits, 5);
    assert.equal('monthlyPlan' in balance, false);
  } finally { globalThis.fetch = realFetch; }
});
