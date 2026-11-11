// Review keys (lib/review-keys.ts, 11 Nov 2026): an adt_ key whose SHA-256 is in REVIEW_KEY_HASHES passes the credential
// check and runs tools without a purchase, for marketplace review and demo recordings. The money rules held here: it never
// writes to the credit ledger (so nothing reads as a sale), failed calls are given back, it stops at the price ceiling and
// at its daily cap, and an ordinary key or an unknown key behaves exactly as before.
const assert = require('node:assert/strict');
const Module = require('node:module');
const { before, test } = require('node:test');
const esbuild = require('esbuild');
async function load(entry) {
  const result = await esbuild.build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'cjs', write: false });
  const m = new Module(entry, module); m.filename = entry; m.paths = Module._nodeModulePaths(process.cwd());
  m._compile(result.outputFiles[0].text, entry); return m.exports;
}
let credits, routes, review, free, Hono;
before(async () => {
  credits = await load(require.resolve('../src/lib/credits.ts'));
  routes = await load(require.resolve('../src/lib/credit-routes.ts'));
  review = await load(require.resolve('../src/lib/review-keys.ts'));
  free = await load(require.resolve('../src/lib/free-calls.ts'));
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
    spendCredits: (h, m) => credits.spendCredits(store, h, m),
    refundCredits: (h, m) => credits.refundCredits(store, h, m),
    creditBalance: (h) => credits.creditBalance(store, h),
    takeDailyCall: (c, d, p, t) => free.takeDailyCall(store, c, d, p, t),
    refundDailyCall: (c, d) => free.refundDailyCall(store, c, d),
  };
  return { idFromName: () => 'credits', get: () => stub };
}
const KEY = 'adt_' + 'r'.repeat(43);
const OTHER = 'adt_' + 'o'.repeat(43);
async function envWith(store) {
  return { METRICS: metricsFor(store), REVIEW_KEY_HASHES: ` ${await credits.hashCreditKey(KEY)} ,not-a-hash` };
}
function app(env, price, status = 200) {
  const a = new Hono();
  a.route('/', routes.credits);
  a.get('/tool', (c, next) => routes.chargeCredits(c, price, credits.apiKeyFrom((n) => c.req.header(n)), next), (c) => c.json({ ok: status < 400 }, status));
  return { call: (path) => a.request(path, { headers: { authorization: `Bearer ${KEY}` } }, env) };
}

test('the credential check passes for a review key and names it as one, without a ledger record', async () => {
  const store = storage(); const env = await envWith(store);
  const res = await app(env, '$0.01').call('/credits/balance');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.reviewKey, true);
  assert.equal(body.callsPerDay, review.REVIEW_CALLS_PER_DAY);
  assert.equal([...store.records.keys()].filter((k) => k.startsWith('credit:')).length, 0);
});

test('a review key runs a tool, charges nothing and writes nothing a sales report reads', async () => {
  const store = storage(); const env = await envWith(store);
  const res = await app(env, '$0.01').call('/tool');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('X-Credits-Charged'), '0');
  assert.equal(res.headers.get('X-Review-Calls-Left'), String(review.REVIEW_CALLS_PER_DAY - 1));
  assert.equal([...store.records.keys()].filter((k) => k.startsWith('credit:')).length, 0, 'no account, no session: nothing reads as a purchase');
  const summary = await credits.creditSummary({ list: async ({ prefix }) => new Map([...store.records].filter(([k]) => k.startsWith(prefix))) });
  assert.equal(summary.purchases, 0); assert.equal(summary.buyers, 0); assert.equal(summary.creditCalls, 0);
});

test('a failed call is given back; the price ceiling and the daily cap refuse uncharged', async () => {
  const store = storage(); const env = await envWith(store);
  const failed = await app(env, '$0.01', 502).call('/tool');
  assert.equal(failed.status, 502);
  assert.equal(failed.headers.get('X-Review-Calls-Left'), String(review.REVIEW_CALLS_PER_DAY));
  const dear = await app(env, '$1.00').call('/tool');
  assert.equal(dear.status, 402);
  assert.match((await dear.json()).error, /Not charged/);
  const ok = app(env, '$0.01');
  for (let i = 0; i < review.REVIEW_CALLS_PER_DAY; i++) assert.equal((await ok.call('/tool')).status, 200);
  const over = await ok.call('/tool');
  assert.equal(over.status, 429);
  assert.match((await over.json()).error, /used its \d+ calls/);
});

test('an unknown key and an ordinary bought key behave as before', async () => {
  const store = storage(); const env = await envWith(store);
  const a = new Hono(); a.route('/', routes.credits);
  a.get('/tool', (c, next) => routes.chargeCredits(c, '$0.01', credits.apiKeyFrom((n) => c.req.header(n)), next), (c) => c.json({ ok: true }));
  const unknown = await a.request('/credits/balance', { headers: { authorization: `Bearer ${OTHER}` } }, env);
  assert.equal(unknown.status, 401);
  await credits.issueCredits(store, { sessionId: 'cs_test_bought', credits: 100, key: OTHER, keyHash: await credits.hashCreditKey(OTHER) });
  const paid = await a.request('/tool', { headers: { authorization: `Bearer ${OTHER}` } }, env);
  assert.equal(paid.status, 200);
  assert.equal(paid.headers.get('X-Credits-Charged'), '10');
  assert.equal(paid.headers.get('X-Review-Calls-Left'), null);
});

test('MCP: a review key runs the tool through creditCharger and an error result is given back', async () => {
  const store = storage(); const env = await envWith(store);
  const charge = routes.creditCharger(env, KEY, '$0.01', 'https://x.test');
  const okResult = await charge(async () => ({ content: [{ type: 'text', text: 'hi' }] }));
  assert.equal(okResult.isError, undefined);
  const errResult = await charge(async () => ({ isError: true, content: [] }));
  assert.equal(errResult.isError, true);
  const dear = await routes.creditCharger(env, KEY, '$0.50', 'https://x.test')(async () => ({ content: [] }));
  assert.equal(dear.isError, true);
  assert.match(dear.content[0].text, /review key runs tools priced up to/);
  const day = new Date().toISOString().slice(0, 10);
  const rec = store.records.get(`daily:caller:${review.reviewCaller(await credits.hashCreditKey(KEY))}`);
  assert.deepEqual(rec, { day, used: 1 }, 'one success counted, the failed call given back');
});

test('without the secret no key is a review key', async () => {
  assert.equal(review.isReviewKey({}, 'a'.repeat(64)), false);
  assert.equal(review.reviewKeyHashes({ REVIEW_KEY_HASHES: 'XYZ,' + 'A'.repeat(64) }).size, 1, 'hex in any case, junk ignored');
});
