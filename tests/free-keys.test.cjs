// Free keys by e-mail (14 Nov 2026): one key per confirmed address, 100 successful calls a calendar month on the
// tools outside the capacity-limited set, nothing counted as a purchase. No network: mail and storage are stand-ins.
const assert = require('node:assert/strict');
const Module = require('node:module');
const { before, test } = require('node:test');
const esbuild = require('esbuild');
async function load(entry) {
  const result = await esbuild.build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'cjs', write: false, logLevel: 'silent' });
  const m = new Module(entry, module); m.filename = entry; m.paths = Module._nodeModulePaths(process.cwd());
  m._compile(result.outputFiles[0].text, entry); return m.exports;
}
let credits, routes, keys, Hono;
before(async () => {
  credits = await load(require.resolve('../src/lib/credits.ts'));
  routes = await load(require.resolve('../src/lib/credit-routes.ts'));
  keys = await load(require.resolve('../src/lib/free-keys.ts'));
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
  }, async list({ prefix }) { return new Map([...records].filter(([k]) => k.startsWith(prefix))); } };
}
function metricsFor(store) {
  const stub = {
    issueCredits: (g) => credits.issueCredits(store, g),
    issueFreeKey: (g) => credits.issueFreeKey(store, g),
    spendCredits: (h, m, f) => credits.spendCredits(store, h, m, f),
    refundCredits: (h, m, f) => credits.refundCredits(store, h, m, f),
    creditBalance: (h) => credits.creditBalance(store, h),
    rotateKey: (o, k, n) => credits.rotateKey(store, o, k, n),
  };
  return { idFromName: (name) => { assert.equal(name, 'credits'); return name; }, get: () => stub };
}
function kv() {
  const data = new Map();
  return { data, get: async (k, type) => (data.has(k) ? (type === 'json' ? JSON.parse(data.get(k)) : data.get(k)) : null), put: async (k, v) => { data.set(k, v); } };
}
const EMAIL_HASH = 'a'.repeat(64);
const grant = async (store, month = '2026-11', perMonth = 3) => {
  const key = credits.newCreditKey();
  const keyHash = await credits.hashCreditKey(key);
  await credits.issueFreeKey(store, { emailHash: EMAIL_HASH, key, keyHash, perMonth, month });
  return { key, keyHash };
};

test('an address is read the way one mailbox is written', () => {
  assert.equal(keys.normalEmail(' Ada.Lovelace+n8n@GoogleMail.com '), 'adalovelace@gmail.com');
  assert.equal(keys.normalEmail('ada.lovelace@example.co.uk'), 'ada.lovelace@example.co.uk');
  assert.equal(keys.normalEmail('ada+work@example.com'), 'ada@example.com');
  for (const bad of ['', 'ada', 'ada@', '@example.com', 'ada@example', 'a b@example.com', 'ada@exa mple.com', 'ada@-example.com', 'ada..l@example.com', '+tag@example.com', 'ada@example.com, eve@example.com', null, 42, `${'a'.repeat(65)}@example.com`]) assert.equal(keys.normalEmail(bad), null, String(bad));
});

test('one address gets one key, and the allowance is calls, not credits', async () => {
  const store = storage();
  const { key, keyHash } = await grant(store);
  const second = credits.newCreditKey();
  const again = await credits.issueFreeKey(store, { emailHash: EMAIL_HASH, key: second, keyHash: await credits.hashCreditKey(second), perMonth: 3, month: '2026-11' });
  assert.deepEqual(again, { key, repeated: true, perMonth: 3 });
  assert.equal([...store.records.keys()].filter((k) => k.startsWith('credit:acct:')).length, 1);
  // Not a purchase: the card-sales summary still reads zero.
  const summary = await credits.creditSummary(store);
  assert.equal(summary.purchases, 0);
  assert.equal(summary.buyers, 0);
  const account = await credits.creditBalance(store, keyHash);
  assert.equal(account.balanceMicros, 0);
  assert.deepEqual(account.free, { perMonth: 3, month: '2026-11', used: 0 });
  await assert.rejects(credits.issueFreeKey(store, { emailHash: 'nope', key, keyHash, perMonth: 3, month: '2026-11' }), /invalid free key grant/);
});

test('free calls are used first for a tool they cover, run out, come back on failure and start again next month', async () => {
  const store = storage();
  const { keyHash } = await grant(store);
  const first = await credits.spendCredits(store, keyHash, 10_000, '2026-11');
  assert.deepEqual(first, { ok: true, balanceMicros: 0, free: { left: 2, perMonth: 3 } });
  // A failed call gives its free call back.
  assert.equal(await credits.refundCredits(store, keyHash, 0, true), 0);
  assert.equal((await credits.creditBalance(store, keyHash)).free.used, 0);
  for (const left of [2, 1, 0]) assert.equal((await credits.spendCredits(store, keyHash, 10_000, '2026-11')).free.left, left);
  const out = await credits.spendCredits(store, keyHash, 10_000, '2026-11');
  assert.deepEqual(out, { ok: false, reason: 'insufficient', balanceMicros: 0, freeKey: true });
  // A tool the allowance does not cover (no month passed) never uses a free call.
  const key2 = storage();
  const other = await grant(key2);
  assert.deepEqual(await credits.spendCredits(key2, other.keyHash, 10_000), { ok: false, reason: 'insufficient', balanceMicros: 0, freeKey: true });
  assert.equal((await credits.creditBalance(key2, other.keyHash)).free.used, 0);
  // A new month starts the count again.
  const next = await credits.spendCredits(store, keyHash, 10_000, '2026-12');
  assert.deepEqual(next.free, { left: 2, perMonth: 3 });
  assert.equal((await credits.creditBalance(store, keyHash)).free.month, '2026-12');
});

test('credits bought later sit on the same key and are spent only after the month\'s free calls', async () => {
  const store = storage();
  const { keyHash } = await grant(store, '2026-11', 1);
  await credits.issueCredits(store, { sessionId: 'cs_test_1', credits: 1000, key: null, keyHash });
  assert.equal((await credits.spendCredits(store, keyHash, 10_000, '2026-11')).free.left, 0);
  const paid = await credits.spendCredits(store, keyHash, 10_000, '2026-11');
  assert.deepEqual(paid, { ok: true, balanceMicros: 990_000 });
  // A capacity-limited tool spends credits even while free calls remain.
  const s2 = storage();
  const k2 = await grant(s2);
  await credits.issueCredits(s2, { sessionId: 'cs_test_2', credits: 1000, key: null, keyHash: k2.keyHash });
  assert.deepEqual(await credits.spendCredits(s2, k2.keyHash, 10_000), { ok: true, balanceMicros: 990_000 });
  assert.equal((await credits.creditBalance(s2, k2.keyHash)).free.used, 0);
});

test('a rotated free key keeps its allowance, and the address no longer shows the old key', async () => {
  const store = storage();
  const { keyHash } = await grant(store);
  await credits.spendCredits(store, keyHash, 10_000, '2026-11');
  const fresh = credits.newCreditKey();
  const freshHash = await credits.hashCreditKey(fresh);
  await credits.rotateKey(store, keyHash, fresh, freshHash);
  assert.equal(await credits.creditBalance(store, keyHash), null);
  assert.equal((await credits.creditBalance(store, freshHash)).free.used, 1);
  const again = await credits.issueFreeKey(store, { emailHash: EMAIL_HASH, key: credits.newCreditKey(), keyHash: 'b'.repeat(64), perMonth: 3, month: '2026-11' });
  assert.deepEqual(again, { key: null, repeated: true, perMonth: 3 });
});

test('over HTTP: a free call charges nothing, says how many are left, and a failed call does not count', async () => {
  const store = storage();
  const { key, keyHash } = await grant(store, credits.utcMonth(), 2);
  const env = { METRICS: metricsFor(store) };
  const app = new Hono();
  app.use('/tool/*', async (c, next) => routes.chargeCredits(c, '$0.01', key, next, c.req.path !== '/tool/costly'));
  app.get('/tool/ok', (c) => c.json({ ok: true }));
  app.get('/tool/bad', (c) => c.json({ error: 'bad input' }, 400));
  app.get('/tool/costly', (c) => c.json({ ok: true }));
  const call = (path) => app.fetch(new Request(`https://api.test${path}`), env, { waitUntil() {} });
  const ok = await call('/tool/ok');
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('x-credits-charged'), '0');
  assert.equal(ok.headers.get('x-free-calls-left'), '1');
  const bad = await call('/tool/bad');
  assert.equal(bad.status, 400);
  assert.equal(bad.headers.get('x-free-calls-left'), '1');
  assert.equal((await credits.creditBalance(store, keyHash)).free.used, 1);
  const costly = await call('/tool/costly');
  assert.equal(costly.status, 402);
  assert.match((await costly.json()).freeKey, /do not cover this tool/);
  await call('/tool/ok');
  const out = await call('/tool/ok');
  assert.equal(out.status, 402);
  const body = await out.json();
  assert.match(body.freeKey, /used its calls for this month/);
  assert.ok(Array.isArray(body.topUp));
});

test('over MCP: the same allowance, and an error result gives the call back', async () => {
  const store = storage();
  const { key, keyHash } = await grant(store, credits.utcMonth(), 1);
  const env = { METRICS: metricsFor(store) };
  const run = (eligible, result) => routes.creditCharger(env, key, '$0.01', 'https://api.test', false, eligible)(async () => result);
  assert.deepEqual(await run(true, { isError: true, content: [] }), { isError: true, content: [] });
  assert.equal((await credits.creditBalance(store, keyHash)).free.used, 0);
  assert.deepEqual(await run(true, { content: [{ type: 'text', text: 'ok' }] }), { content: [{ type: 'text', text: 'ok' }] });
  assert.equal((await credits.creditBalance(store, keyHash)).free.used, 1);
  const out = await run(true, { content: [] });
  assert.equal(out.isError, true);
  assert.match(out.content[0].text, /not enough credits/);
});

test('sign-up: off unless switched on with a sender; one message, a link that shows one key, limits on mail', async () => {
  const store = storage();
  const mail = [];
  const TRIALS = kv();
  const on = { FREE_KEYS: 'on', FREE_KEY_FROM: 'keys@example.test', EMAIL: { send: async (m) => { mail.push(m); return { messageId: 'm1' }; } }, TRIALS, METRICS: metricsFor(store) };
  const app = new Hono();
  app.route('/', keys.freeKeys);
  const json = { accept: 'application/json', 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.7' };
  const post = (env, email, headers = json) => app.fetch(new Request('https://api.test/keys/free', { method: 'POST', headers, body: JSON.stringify({ email }) }), env, { waitUntil() {} });
  const get = (env, path) => app.fetch(new Request(`https://api.test${path}`, { headers: { accept: 'application/json' } }), env, { waitUntil() {} });

  for (const off of [{ ...on, FREE_KEYS: undefined }, { ...on, EMAIL: undefined }, { ...on, FREE_KEY_FROM: undefined }]) {
    assert.equal((await post(off, 'ada@example.com')).status, 404);
    assert.equal((await get(off, '/keys/free')).status, 404);
  }
  assert.equal(mail.length, 0);

  const info = await (await get(on, '/keys/free')).json();
  assert.equal(info.callsEachMonth, credits.FREE_KEY_CALLS);
  assert.equal(credits.FREE_KEY_CALLS, 100);

  assert.equal((await post(on, 'not an address')).status, 400);
  const sent = await post(on, 'Ada+n8n@Example.com');
  assert.equal(sent.status, 200);
  assert.equal(mail.length, 1);
  assert.equal(mail[0].to, 'Ada+n8n@Example.com');
  assert.equal(mail[0].from, 'keys@example.test');
  const link = /https:\/\/api\.test(\/keys\/free\/confirm\?token=[A-Za-z0-9_-]+)/.exec(mail[0].text)[1];
  // Only a hash of the address is kept anywhere.
  // Look for the address itself: stored hashes are hex, so a bare /ada/ matched by chance (CI flake, 14 Nov 2026).
  const kept = (JSON.stringify([...TRIALS.data]) + JSON.stringify([...store.records])).toLowerCase();
  assert.ok(!kept.includes('ada+n8n') && !kept.includes('example.com'), 'the address is not stored');

  assert.equal((await get(on, '/keys/free/confirm?token=short')).status, 400);
  assert.equal((await get(on, `/keys/free/confirm?token=${'x'.repeat(43)}`)).status, 400);
  const shown = await (await get(on, link)).json();
  assert.match(shown.apiKey, /^adt_/);
  assert.equal(shown.callsEachMonth, 100);
  assert.equal((await (await get(on, link)).json()).apiKey, shown.apiKey, 'the link shows the same key again');
  // The same mailbox written another way gets the same key, not a second one.
  await post(on, 'ada@example.com');
  const link2 = /(\/keys\/free\/confirm\?token=[A-Za-z0-9_-]+)/.exec(mail[1].text)[1];
  assert.equal((await (await get(on, link2)).json()).apiKey, shown.apiKey);
  assert.equal([...store.records.keys()].filter((k) => k.startsWith('credit:acct:')).length, 1);

  // Three sign-ups a day from one address: the fourth sends nothing.
  await post(on, 'eve@example.com');
  const refused = await post(on, 'mallory@example.com');
  assert.equal(refused.status, 429);
  assert.equal(mail.length, 3);

  // Mail that cannot be sent creates nothing and says so.
  const failing = { ...on, TRIALS: kv(), EMAIL: { send: async () => { throw Object.assign(new Error('no'), { code: 'E_SENDER_NOT_VERIFIED' }); } } };
  assert.equal((await post(failing, 'bob@example.com')).status, 503);
});
