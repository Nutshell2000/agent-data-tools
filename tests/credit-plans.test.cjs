// The monthly plans (lib/credits.ts CREDIT_PLANS). A plan is a Stripe subscription whose every paid invoice tops up one
// key; unused credits are kept and there is no free allowance. There is no webhook: renewals are read from Stripe when
// the key is used. Since 21 Nov 2026 no plan on sale gives more credits than its price covers (1 credit = $0.001):
// $3 for 3,000, $19 for 19,000, and on the voice site $5 for 4,000 and $7 for 7,000. These tests hold the money rules:
// a paid invoice grants once, an unpaid or unknown one never, a checkout is granted only when its amount and credits
// pair, and a checkout through a retired link is still granted what that link promised.
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
const subscribed = { mode: 'subscription', status: 'complete', payment_status: 'paid', currency: 'usd', amount_total: 300, metadata: { adt_credits: '3000' }, subscription: SUB, invoice: FIRST };
const sessionFetch = (session, status = 200) => async (url, init) => {
  assert.match(url, /^https:\/\/api\.stripe\.com\/v1\/checkout\/sessions\/cs_/);
  assert.equal(init.headers.authorization, 'Bearer rk_test_key');
  return new Response(JSON.stringify(session), { status });
};

const NEW_PAIRS = [[300, 3000], [1900, 19000], [500, 4000], [700, 7000]];
const OLD_PAIRS = [[300, 15000], [900, 15000], [1900, 40000]];
const pairs = (list) => list.map((p) => [p.usdCents, p.credits]);
const planSession = ([usdCents, plan]) => ({ ...subscribed, amount_total: usdCents, metadata: { adt_credits: String(plan) } });

test('the plans on sale, the ones the developer pages list, and none offered until its Stripe link and the cancel page exist', () => {
  assert.deepEqual(pairs(credits.CREDIT_PLANS), [...NEW_PAIRS, ...OLD_PAIRS]);
  // The developer lists hold the entry plan and the large plan, entry first; the voice plans and the retired pairs never.
  assert.deepEqual(pairs(credits.WEB_PLANS), [[300, 3000], [1900, 19000]]);
  assert.deepEqual(credits.planLinks().map((p) => [p.price, p.creditsEachMonth]), [['$3 a month', 3000], ['$19 a month', 19000]]);
  assert.deepEqual(credits.CREDIT_PLANS.map((p) => p.kind), ['developer', 'developer', 'voice', 'voice', 'retired', 'retired', 'retired']);
  assert.deepEqual([credits.VOICE_STUDIO_PLAN.usdCents, credits.VOICE_STUDIO_PLAN.credits], [500, 4000]);
  assert.deepEqual([credits.VOICE_BUNDLE_PLAN.usdCents, credits.VOICE_BUNDLE_PLAN.credits], [700, 7000]);
  assert.ok(credits.CREDIT_PLANS.includes(credits.VOICE_STUDIO_PLAN) && credits.CREDIT_PLANS.includes(credits.VOICE_BUNDLE_PLAN), 'the voice plans are rows verifyCheckout reads');
  assert.deepEqual([credits.VOICE_PRO_CENTS, credits.VOICE_PRO_CREDITS], [300, 3000]);
  // Voice Pro is shown as characters of studio speech at the key rate.
  assert.equal(credits.SPEECH_CREDITS_PER_100, 4);
  assert.equal(credits.speechCharacters(credits.VOICE_STUDIO_PLAN.credits), 100_000);
  // The five payment links of 21 Nov 2026, each on its own plan; a retired pair has none.
  const links = [credits.CREDIT_PLANS[0].url, credits.CREDIT_PLANS[1].url, credits.VOICE_STUDIO_PLAN.url, credits.VOICE_BUNDLE_PLAN.url, credits.VOICE_PRO_URL];
  assert.deepEqual(links, [
    'https://buy.stripe.com/28E28r4i6ddR5hwfnnbII0i', 'https://buy.stripe.com/eVq00j5ma0r511ggrrbII0j', 'https://buy.stripe.com/bJe5kD7ui5Lp8tI8YZbII0f',
    'https://buy.stripe.com/8x2bJ14i6ehVh0e7UVbII0g', 'https://buy.stripe.com/5kQ8wP7uiflZcJYejjbII0h',
  ]);
  assert.equal(new Set([...links, ...credits.CREDIT_PACKS.map((p) => p.url), credits.VOICE_HOURS_PACK_URL]).size, links.length + credits.CREDIT_PACKS.length + 1, 'no link is used twice');
  for (const p of credits.CREDIT_PLANS) assert.equal(p.url === '', p.kind === 'retired', `$${p.usdCents / 100} for ${p.credits}`);
  const offered = credits.CREDIT_PLANS.filter((p) => p.kind === 'developer');
  if (credits.PLAN_PORTAL_URL === '') assert.equal(credits.WEB_PLANS.length, 0, 'no cancel page, no plan on sale');
  else assert.equal(credits.WEB_PLANS.length, offered.length);
  for (const p of credits.CREDIT_PLANS.filter((x) => x.url !== '')) assert.match(p.url, /^https:\/\/buy\.stripe\.com\/[A-Za-z0-9]+$/);
  if (credits.PLAN_PORTAL_URL !== '') assert.match(credits.PLAN_PORTAL_URL, /^https:\/\/billing\.stripe\.com\/p\/login\/[A-Za-z0-9_]+$/);
  const info = routes.creditsInfo('https://x.test', false, true);
  assert.equal('monthlyPlans' in info, credits.WEB_PLANS.length > 0);
  assert.deepEqual(info.monthlyPlans.plans.map((p) => p.creditsEachMonth), [3000, 19000]);
  assert.equal('monthlyPlans' in routes.creditsInfo('https://x.test', false, false), false, 'never while card payments are off');
});

test('no plan on sale gives more credits than its price covers at 1 credit = $0.001', () => {
  const onSale = [...credits.WEB_PLANS, credits.VOICE_STUDIO_PLAN, credits.VOICE_BUNDLE_PLAN, { usdCents: credits.VOICE_PRO_CENTS, credits: credits.VOICE_PRO_CREDITS, url: credits.VOICE_PRO_URL }, ...credits.CREDIT_PLANS.filter((p) => p.url !== '')];
  assert.ok(onSale.length >= 5);
  for (const p of onSale) assert.ok(p.credits <= p.usdCents * 10, `$${p.usdCents / 100} a month gives ${p.credits} credits`);
  // Only the retired pairs gave more, and nothing offers them.
  for (const p of credits.CREDIT_PLANS.filter((x) => x.credits > x.usdCents * 10)) assert.deepEqual([p.kind, p.url], ['retired', '']);
  assert.deepEqual(pairs(credits.CREDIT_PLANS.filter((x) => x.kind === 'retired')), OLD_PAIRS);
});

test('each plan of 21 Nov 2026 verifies and is granted its credits, on a new key', async () => {
  const id = 'cs_live_a1B2c3D4e5F6g7';
  // Transcribe Pro, the entry plan, Voice Pro, the bundle and the large plan: five plans, four pairs (the first two share one).
  for (const pair of [[300, 3000], [300, 3000], [500, 4000], [700, 7000], [1900, 19000]]) {
    const got = await credits.verifyCheckout('rk_test_key', id, sessionFetch(planSession(pair)));
    assert.deepEqual(got, { usdCents: pair[0], credits: pair[1], topUpKeyHash: undefined, plan: { subscriptionId: SUB, invoiceId: FIRST } });
    const s = storage();
    const issued = await credits.issueCredits(s, { sessionId: id, credits: got.credits, key: 'adt_k', keyHash: 'h', plan: got.plan });
    assert.equal(issued.balanceMicros, pair[1] * 1000);
    assert.equal((await credits.grantPlanInvoices(s, 'h', SUB, [SECOND, FIRST])).added, pair[1], 'a renewal adds the same credits');
  }
});

test('a checkout through a retired link still verifies and grants what that link promised', async () => {
  const id = 'cs_live_a1B2c3D4e5F6g7';
  for (const pair of OLD_PAIRS) {
    const got = await credits.verifyCheckout('rk_test_key', id, sessionFetch(planSession(pair)));
    assert.deepEqual([got.usdCents, got.credits], pair);
    assert.deepEqual(got.plan, { subscriptionId: SUB, invoiceId: FIRST });
  }
});

test('an amount and adt_credits that do not pair are refused, in every combination', async () => {
  const id = 'cs_live_a1B2c3D4e5F6g7';
  const known = new Set([...NEW_PAIRS, ...OLD_PAIRS].map(([c, n]) => `${c}:${n}`));
  const amounts = [100, 300, 500, 700, 900, 1900, 2000, 10000];
  const grants = [1000, 3000, 4000, 5000, 7000, 15000, 19000, 22000, 40000, 125000];
  let refused = 0;
  for (const usdCents of amounts) for (const n of grants) {
    if (known.has(`${usdCents}:${n}`)) continue;
    await assert.rejects(credits.verifyCheckout('rk_test_key', id, sessionFetch(planSession([usdCents, n]))), (e) => e.status === 400, `$${usdCents / 100} with ${n}`);
    refused += 1;
  }
  assert.equal(refused, amounts.length * grants.length - known.size);
  // The ones a wrong link would most likely produce: the large plan's credits at the entry price, and the old allowances at the new prices.
  for (const pair of [[300, 19000], [300, 4000], [500, 7000], [700, 4000], [500, 15000], [700, 15000]]) await assert.rejects(credits.verifyCheckout('rk_test_key', id, sessionFetch(planSession(pair))), (e) => e.status === 400);
  // Metadata that is missing or not exactly the number is not a plan either.
  for (const metadata of [undefined, {}, { adt_credits: '3000.0' }, { adt_credits: ' 3000' }, { adt_credits: '03000' }]) await assert.rejects(credits.verifyCheckout('rk_test_key', id, sessionFetch({ ...subscribed, metadata })), (e) => e.status === 400);
});

test('the $5 pack (paid once, 5,000 credits) and the $5 plan (4,000 a month) are never taken for each other', async () => {
  const id = 'cs_live_a1B2c3D4e5F6g7';
  const paidOnce = { mode: 'payment', status: 'complete', payment_status: 'paid', currency: 'usd', amount_total: 500, metadata: { adt_credits: '5000' } };
  assert.deepEqual(await credits.verifyCheckout('rk_test_key', id, sessionFetch(paidOnce)), { usdCents: 500, credits: 5000, topUpKeyHash: undefined, plan: undefined });
  const monthly = await credits.verifyCheckout('rk_test_key', id, sessionFetch(planSession([500, 4000])));
  assert.deepEqual([monthly.credits, monthly.plan.subscriptionId], [4000, SUB]);
  const reject = async (session) => assert.rejects(credits.verifyCheckout('rk_test_key', id, sessionFetch(session)), (e) => e.status === 400);
  await reject({ ...paidOnce, metadata: { adt_credits: '4000' } });                 // the plan's credits, paid once
  await reject({ ...paidOnce, subscription: SUB, invoice: FIRST, metadata: { adt_credits: '4000' } });
  await reject(planSession([500, 5000]));                                            // the pack's credits as a subscription
  // A buyer outside the US pays in their own currency; the USD price in currency_conversion decides, in both modes.
  const converted = { currency: 'sek', amount_total: 5400, currency_conversion: { amount_total: 500, source_currency: 'usd' } };
  assert.equal((await credits.verifyCheckout('rk_test_key', id, sessionFetch({ ...planSession([500, 4000]), ...converted }))).credits, 4000);
  assert.equal((await credits.verifyCheckout('rk_test_key', id, sessionFetch({ ...paidOnce, ...converted }))).credits, 5000);
  await reject({ ...planSession([500, 4000]), currency: 'sek', amount_total: 500 });  // 500 of another currency is not $5
});

test('a paid subscription checkout is accepted as a plan; anything else about it is refused', async () => {
  const id = 'cs_live_a1B2c3D4e5F6g7';
  const plan = await credits.verifyCheckout('rk_test_key', id, sessionFetch(subscribed));
  assert.deepEqual(plan, { usdCents: 300, credits: 3000, topUpKeyHash: undefined, plan: { subscriptionId: SUB, invoiceId: FIRST } });
  const big = await credits.verifyCheckout('rk_test_key', id, sessionFetch({ ...subscribed, amount_total: 1900, metadata: { adt_credits: '19000' } }));
  assert.equal(big.credits, 19000);
  const reject = async (session, code) => assert.rejects(credits.verifyCheckout('rk_test_key', id, sessionFetch(session)), (e) => e.status === code);
  await reject({ ...subscribed, payment_status: 'unpaid' }, 402);
  await reject({ ...subscribed, status: 'open' }, 402);
  await reject({ ...subscribed, amount_total: 500 }, 400);                        // $5 does not pair with the entry plan's credits
  await reject({ ...subscribed, metadata: { adt_credits: '19000' } }, 400);       // the $19 credits at the $3 price
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
  // 21 Nov 2026: a promotion code lowers amount_total below every price; the price before discounts names the purchase.
  const promo = await credits.verifyCheckout('rk_test_key', id, sessionFetch({ ...subscribed, amount_total: 100, amount_subtotal: 900 }));
  assert.equal(promo.credits, 15000); assert.ok(promo.plan);
  const halfPack = await credits.verifyCheckout('rk_test_key', id, sessionFetch({ mode: 'payment', status: 'complete', payment_status: 'paid', currency: 'usd', amount_total: 250, amount_subtotal: 500, metadata: { adt_credits: '5000' } }));
  assert.equal(halfPack.credits, 5000);
  // The subtotal is read only for a real discount, and it must still name a price we sell with its own credits.
  await reject({ ...subscribed, amount_total: 100, amount_subtotal: 100 }, 400);
  await reject({ ...subscribed, amount_total: 100, amount_subtotal: 900, metadata: { adt_credits: '40000' } }, 400);
  await reject({ ...subscribed, amount_total: 1900, amount_subtotal: 900 }, 400);
});

test('the first invoice is granted with the checkout and never again; each later paid invoice is granted once', async () => {
  const s = storage();
  const first = await credits.issueCredits(s, { sessionId: 'cs_live_plan', credits: 3000, key: 'adt_plan', keyHash: 'h1', plan: { subscriptionId: SUB, invoiceId: FIRST } });
  assert.equal(first.balanceMicros, 3_000_000);
  // Reloading the claim page: same key, no second grant.
  const again = await credits.issueCredits(s, { sessionId: 'cs_live_plan', credits: 3000, key: 'adt_other', keyHash: 'h2', plan: { subscriptionId: SUB, invoiceId: FIRST } });
  assert.equal(again.key, 'adt_plan'); assert.equal(again.balanceMicros, 3_000_000);
  const account = await credits.creditBalance(s, 'h1');
  assert.equal(account.plans.length, 1); assert.equal(account.plans[0].subscriptionId, SUB); assert.equal(account.plans[0].credits, 3000);

  // The first read of Stripe returns the first invoice too: nothing is added for it.
  let read = await credits.grantPlanInvoices(s, 'h1', SUB, [FIRST]);
  assert.deepEqual({ added: read.added, balance: read.balanceMicros }, { added: 0, balance: 3_000_000 });
  // The renewal arrives.
  read = await credits.grantPlanInvoices(s, 'h1', SUB, [SECOND, FIRST]);
  assert.deepEqual({ added: read.added, balance: read.balanceMicros }, { added: 3000, balance: 6_000_000 });
  // Read again, with a duplicate in the list and ids that are not invoices: still once.
  read = await credits.grantPlanInvoices(s, 'h1', SUB, [SECOND, SECOND, FIRST, 'cs_live_x', '', '../x', 42]);
  assert.deepEqual({ added: read.added, balance: read.balanceMicros }, { added: 0, balance: 6_000_000 });
  // Two renewals at once (the key was not used for two months).
  read = await credits.grantPlanInvoices(s, 'h1', SUB, [THIRD, 'in_1QfourthINVOICE4', SECOND, FIRST]);
  assert.equal(read.added, 6000); assert.equal(read.balanceMicros, 12_000_000);
  const summary = await credits.creditSummary({ list: async ({ prefix }) => new Map([...s.records].filter(([k]) => k.startsWith(prefix))) });
  assert.equal(summary.purchases, 4, 'the checkout and three renewals, the first invoice not counted twice');
  assert.equal(summary.topUps, 3);
  assert.equal(summary.purchasedUsd, 12);
});

test('an invoice is granted only to the key that owns the subscription', async () => {
  const s = storage();
  await credits.issueCredits(s, { sessionId: 'cs_live_plan', credits: 3000, key: 'adt_plan', keyHash: 'h1', plan: { subscriptionId: SUB, invoiceId: FIRST } });
  await credits.issueCredits(s, { sessionId: 'cs_live_pack', credits: 5000, key: 'adt_pack', keyHash: 'h2' });
  assert.equal(await credits.grantPlanInvoices(s, 'h2', SUB, [SECOND]), null, 'a key without a plan');
  assert.equal(await credits.grantPlanInvoices(s, 'h1', 'sub_1QsomeoneELSE00', [SECOND]), null, 'another subscription');
  assert.equal(await credits.grantPlanInvoices(s, 'unknown', SUB, [SECOND]), null);
  assert.equal((await credits.creditBalance(s, 'h1')).balanceMicros, 3_000_000);
  assert.equal((await credits.creditBalance(s, 'h2')).balanceMicros, 5_000_000);
  await assert.rejects(credits.issueCredits(s, { sessionId: 'cs_live_bad', credits: 3000, key: 'adt_x', keyHash: 'h3', plan: { subscriptionId: 'nope', invoiceId: FIRST } }), /invalid plan grant/);
});

test('a second subscription into the same key is kept beside the first; a replaced key keeps its plan', async () => {
  const s = storage();
  await credits.issueCredits(s, { sessionId: 'cs_live_one', credits: 3000, key: 'adt_plan', keyHash: 'h1', plan: { subscriptionId: SUB, invoiceId: FIRST } });
  const OTHER = 'sub_1QotherPLAN0001';
  await credits.issueCredits(s, { sessionId: 'cs_live_two', credits: 19000, key: null, keyHash: 'h1', plan: { subscriptionId: OTHER, invoiceId: 'in_1QotherFIRST001' } });
  let account = await credits.creditBalance(s, 'h1');
  assert.deepEqual(account.plans.map((p) => [p.subscriptionId, p.credits]), [[SUB, 3000], [OTHER, 19000]]);
  assert.equal((await credits.grantPlanInvoices(s, 'h1', OTHER, ['in_1QotherSECOND02'])).added, 19000);
  assert.equal((await credits.grantPlanInvoices(s, 'h1', SUB, [SECOND])).added, 3000);
  const rotated = await credits.rotateKey(s, 'h1', 'adt_new', 'h9');
  assert.equal(rotated.balanceMicros, 44_000_000);
  account = await credits.creditBalance(s, 'h9');
  assert.equal(account.plans.length, 2);
  assert.equal((await credits.grantPlanInvoices(s, 'h9', SUB, [THIRD])).added, 3000, 'renewals follow the key');
  assert.equal(await credits.grantPlanInvoices(s, 'h1', SUB, ['in_1QlateINVOICE005']), null, 'the old key is gone');
});

test('only paid invoices with money in them count, and a failed read of Stripe grants nothing', async () => {
  const list = (data, status = 200) => async (url, init) => {
    assert.equal(url, `https://api.stripe.com/v1/invoices?subscription=${SUB}&status=paid&limit=36`);
    assert.equal(init.headers.authorization, 'Bearer rk_test_key');
    return new Response(JSON.stringify({ data }), { status });
  };
  const data = [
    { id: SECOND, status: 'paid', amount_paid: 300 },
    { id: 'in_1QopenINVOICE0001', status: 'open', amount_paid: 0 },
    { id: 'in_1QzeroINVOICE0001', status: 'paid', amount_paid: 0 },
    { id: 'in_1QvoidINVOICE0001', status: 'void', amount_paid: 300 },
    { id: 'not-an-invoice', status: 'paid', amount_paid: 300 },
    { id: FIRST, status: 'paid', amount_paid: 300 },
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
  await credits.issueCredits(s, { sessionId: 'cs_live_plan', credits: 3000, key, keyHash, plan: { subscriptionId: SUB, invoiceId: FIRST } });
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
    return new Response(JSON.stringify({ data: paidInvoices.map((id) => ({ id, status: 'paid', amount_paid: 300 })) }));
  };
  try {
    // The month's payment has not been made: Stripe is read once, nothing is added, the call is refused uncharged.
    let res = await fetch('/tool', auth);
    assert.equal(res.status, 402);
    assert.match((await res.json()).error, /^This key does not have enough credits for this call: it costs 10 credits and the key has 5\./);
    assert.equal(stripeCalls, 1);
    // A second refused call within the minute does not read Stripe again.
    res = await fetch('/tool', auth);
    assert.equal(res.status, 402); assert.equal(stripeCalls, 1);

    // The renewal is paid. Once the last read is a minute old, the next call finds it, adds 3,000 and is served.
    paidInvoices = [SECOND, FIRST];
    s.records.get(`credit:acct:${keyHash}`).plans[0].syncedAt = new Date(Date.now() - 61_000).toISOString();
    res = await fetch('/tool', auth);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('X-Credits-Charged'), '10');
    assert.equal(res.headers.get('X-Credits-Remaining'), '2995');
    assert.equal(stripeCalls, 2);
    // Served calls after that do not read Stripe (the plan was read seconds ago).
    res = await fetch('/tool', auth);
    assert.equal(res.headers.get('X-Credits-Remaining'), '2985'); assert.equal(stripeCalls, 2);

    // After twelve hours a served call reads once more and finds the next renewal without the key ever running short.
    paidInvoices = [THIRD, SECOND, FIRST];
    s.records.get(`credit:acct:${keyHash}`).plans[0].syncedAt = new Date(Date.now() - 13 * 3_600_000).toISOString();
    res = await fetch('/tool', auth);
    assert.equal(res.status, 200); assert.equal(stripeCalls, 3);
    assert.equal(res.headers.get('X-Credits-Remaining'), String(2985 - 10 + 3000));

    // The balance answer names the plan and where to cancel it.
    const balance = await (await fetch('/credits/balance', auth)).json();
    assert.equal(balance.balanceCredits, 5975);
    assert.equal(balance.monthlyPlan.creditsEachMonth, 3000);
    assert.match(balance.monthlyPlan.what, /renews until you cancel/);
  } finally { globalThis.fetch = realFetch; }
});

test('claiming a plan checkout issues a key once and says how the plan works; a plan bought into an existing key tops it up', async () => {
  const s = storage();
  const env = { METRICS: metricsFor(s), STRIPE_READ_KEY: 'rk_test_key' };
  const { fetch } = app(env);
  const realFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (url) => { assert.match(String(url), /\/v1\/checkout\/sessions\/cs_live_PlanClaim0001(\?expand\[\]=payment_intent\.latest_charge)?$/); return new Response(JSON.stringify(subscribed)); };
    const first = await (await fetch('/credits/claim?session_id=cs_live_PlanClaim0001', { accept: 'application/json' })).json();
    assert.match(first.apiKey, /^adt_/);
    assert.equal(first.creditsAdded, 3000); assert.equal(first.balanceCredits, 3000);
    assert.match(first.monthlyPlan, /3,000 credits are added to this key each month.*renews until you cancel/);
    const again = await (await fetch('/credits/claim?session_id=cs_live_PlanClaim0001', { accept: 'application/json' })).json();
    assert.equal(again.apiKey, first.apiKey); assert.equal(again.balanceCredits, 3000, 'reloading the claim page adds nothing');
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
    globalThis.fetch = async () => new Response(JSON.stringify({ ...subscribed, amount_total: 1900, metadata: { adt_credits: '19000' }, subscription: 'sub_1QupgradePLAN01', invoice: 'in_1QupgradeFIRST1', client_reference_id: `topup_${packHash}` }));
    const top = await (await fetch('/credits/claim?session_id=cs_live_PlanTopup0002', { accept: 'application/json' })).json();
    assert.equal(top.toppedUp, true); assert.equal(top.apiKey, undefined); assert.equal(top.balanceCredits, 24000);
    assert.match(top.monthlyPlan, /19,000 credits are added/);
    assert.equal((await credits.creditBalance(s, packHash)).plans[0].credits, 19000);
  } finally { globalThis.fetch = realFetch; }
});

test('when Stripe cannot be read a call on a key with credits is still served, and the read is not repeated on every call', async () => {
  const s = storage();
  const env = { METRICS: metricsFor(s), STRIPE_READ_KEY: 'rk_test_key' };
  const key = credits.newCreditKey();
  const keyHash = await credits.hashCreditKey(key);
  await credits.issueCredits(s, { sessionId: 'cs_live_plan', credits: 3000, key, keyHash, plan: { subscriptionId: SUB, invoiceId: FIRST } });
  s.records.get(`credit:acct:${keyHash}`).plans[0].syncedAt = new Date(Date.now() - 13 * 3_600_000).toISOString();
  const { fetch } = app(env);
  const realFetch = globalThis.fetch;
  let stripeCalls = 0;
  globalThis.fetch = async () => { stripeCalls += 1; return new Response('{"error":{"type":"permission_error"}}', { status: 403 }); };
  try {
    for (let i = 0; i < 3; i++) assert.equal((await fetch('/tool', { authorization: `Bearer ${key}` })).status, 200);
    assert.equal(stripeCalls, 1);
    assert.equal((await credits.creditBalance(s, keyHash)).balanceMicros, 3_000_000 - 30_000);
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

test('a refunded or disputed checkout grants nothing; a key without charge access still claims (21 Nov 2026)', async () => {
  const id = 'cs_live_RefundCheck0001';
  const pack = { mode: 'payment', status: 'complete', payment_status: 'paid', currency: 'usd', amount_total: 500, metadata: { adt_credits: '5000' } };
  for (const charge of [{ refunded: true }, { amount_refunded: 100 }, { disputed: true }]) {
    await assert.rejects(credits.verifyCheckout('rk_test_key', id, sessionFetch({ ...pack, payment_intent: { latest_charge: charge } })), (e) => e.status === 402 && /refunded or disputed/.test(e.message));
  }
  assert.equal((await credits.verifyCheckout('rk_test_key', id, sessionFetch({ ...pack, payment_intent: { latest_charge: { refunded: false, amount_refunded: 0, disputed: false } } }))).credits, 5000);
  // A restricted key that may not expand charges: Stripe refuses the expansion, the plain session is read instead.
  const seen = [];
  const fallback = async (url) => { seen.push(String(url)); return String(url).includes('expand') ? new Response('{"error":{}}', { status: 403 }) : new Response(JSON.stringify(pack)); };
  assert.equal((await credits.verifyCheckout('rk_test_key', id, fallback)).credits, 5000);
  assert.equal(seen.length, 2);
  assert.ok(!seen[1].includes('expand'));
});
