// Safety fixes of 21 Nov 2026, the parts that keep state: a top-up and a refund that meet a key rotation, the bounds
// on OAuth registrations, codes and tokens, and the counted slot in front of free keys. Storage and mail are stand-ins.
const assert = require('node:assert/strict');
const Module = require('node:module');
const { before, test } = require('node:test');
const esbuild = require('esbuild');
async function load(entry) {
  const result = await esbuild.build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'cjs', write: false, logLevel: 'silent' });
  const m = new Module(entry, module); m.filename = entry; m.paths = Module._nodeModulePaths(process.cwd());
  m._compile(result.outputFiles[0].text, entry); return m.exports;
}
let credits, routes, free, clients, oauthLib, freeKeys, voiceKeys, gate, switches, Hono;
before(async () => {
  credits = await load(require.resolve('../src/lib/credits.ts'));
  routes = await load(require.resolve('../src/lib/credit-routes.ts'));
  free = await load(require.resolve('../src/lib/free-calls.ts'));
  clients = await load(require.resolve('../src/lib/oauth-clients.ts'));
  oauthLib = await load(require.resolve('../src/lib/oauth.ts'));
  freeKeys = await load(require.resolve('../src/lib/free-keys.ts'));
  voiceKeys = await load(require.resolve('../src/lib/voice-keys.ts'));
  gate = await load(require.resolve('../src/lib/issue-gate.ts'));
  switches = await load(require.resolve('../src/lib/switches.ts'));
  ({ Hono } = require('hono'));
});

const tick = () => new Promise((r) => setImmediate(r));
/** The storage mock of the credits tests (a transaction sees a draft and commits it whole), with list and delete. */
function storage(records = new Map()) {
  let pending = Promise.resolve();
  return { records, transaction(callback) {
    const next = pending.then(async () => {
      const draft = new Map([...records].map(([k, v]) => [k, structuredClone(v)]));
      const result = await callback({ get: async (k) => { await tick(); return structuredClone(draft.get(k)); }, put: async (k, v) => { await tick(); draft.set(k, structuredClone(v)); }, delete: async (k) => draft.delete(k) });
      records.clear(); for (const [k, v] of draft) records.set(k, v); return result;
    });
    pending = next.catch(() => {}); return next;
  },
  async list({ prefix, end, limit }) { const keys = [...records.keys()].filter((k) => k.startsWith(prefix) && (!end || k < end)).sort().slice(0, limit ?? Infinity); return new Map(keys.map((k) => [k, records.get(k)])); },
  async delete(keys) { let n = 0; for (const k of keys) if (records.delete(k)) n++; return n; } };
}
const accounts = (s) => [...s.records.keys()].filter((k) => k.startsWith('credit:acct:')).map((k) => k.slice('credit:acct:'.length));
const newKey = async () => { const key = credits.newCreditKey(); return { key, hash: await credits.hashCreditKey(key) }; };

test('top-up: the key must exist inside the grant itself, and a replaced key is followed to the account', async () => {
  const s = storage();
  const a = await newKey(), b = await newKey();
  // Unknown key: nothing is written, the caller is told to issue a new key.
  let r = await credits.issueCredits(s, { sessionId: 'cs_1', credits: 1000, key: null, keyHash: a.hash, requireExisting: true });
  assert.deepEqual(r, { key: null, credits: 0, balanceMicros: 0, repeated: false, missing: true });
  assert.equal(s.records.size, 0, 'no account, no session record');
  // Without the flag the grant makes the account, as a first purchase does.
  r = await credits.issueCredits(s, { sessionId: 'cs_first', credits: 5000, key: a.key, keyHash: a.hash });
  assert.deepEqual(r, { key: a.key, credits: 5000, balanceMicros: 5_000_000, repeated: false });
  // A known key is topped up; a repeat adds nothing.
  r = await credits.issueCredits(s, { sessionId: 'cs_2', credits: 1000, key: null, keyHash: a.hash, requireExisting: true });
  assert.deepEqual(r, { key: null, credits: 1000, balanceMicros: 6_000_000, repeated: false });
  r = await credits.issueCredits(s, { sessionId: 'cs_2', credits: 1000, key: null, keyHash: a.hash, requireExisting: true });
  assert.deepEqual(r, { key: null, credits: 1000, balanceMicros: 6_000_000, repeated: true });

  // The key is replaced; a top-up that still names the old key reaches the account under its new hash.
  assert.ok(await credits.rotateKey(s, a.hash, b.key, b.hash));
  r = await credits.issueCredits(s, { sessionId: 'cs_3', credits: 2000, key: null, keyHash: a.hash, requireExisting: true });
  assert.deepEqual(r, { key: null, credits: 2000, balanceMicros: 8_000_000, repeated: false });
  assert.deepEqual(accounts(s), [b.hash], 'no account came back under the old key');
  assert.equal(s.records.get('credit:session:cs_3').keyHash, b.hash);
  assert.equal((await credits.creditBalance(s, b.hash)).balanceMicros, 8_000_000);
  assert.equal(await credits.creditBalance(s, a.hash), null);
  // The old key itself pays for nothing.
  assert.deepEqual(await credits.spendCredits(s, a.hash, 2000), { ok: false, reason: 'unknown_key', balanceMicros: 0 });
  // A repeat of that top-up, by either name of the key, adds nothing.
  for (const keyHash of [a.hash, b.hash]) {
    r = await credits.issueCredits(s, { sessionId: 'cs_3', credits: 2000, key: null, keyHash, requireExisting: true });
    assert.equal(r.repeated, true); assert.equal(r.balanceMicros, 8_000_000);
  }
  // A session that was granted to another key is not reported as this key's top-up.
  const c = await newKey();
  await credits.issueCredits(s, { sessionId: 'cs_other', credits: 1000, key: c.key, keyHash: c.hash });
  r = await credits.issueCredits(s, { sessionId: 'cs_other', credits: 1000, key: null, keyHash: a.hash, requireExisting: true });
  assert.equal(r.missing, true);
  assert.equal((await credits.creditBalance(s, b.hash)).balanceMicros, 8_000_000);
});

test('top-up racing a rotation: whichever runs first, the credits end in the one account the buyer holds', async () => {
  for (const order of ['rotate-first', 'top-up-first']) {
    const s = storage();
    const a = await newKey(), b = await newKey();
    await credits.issueCredits(s, { sessionId: 'cs_first', credits: 5000, key: a.key, keyHash: a.hash });
    const rotate = () => credits.rotateKey(s, a.hash, b.key, b.hash);
    const topUp = () => credits.issueCredits(s, { sessionId: 'cs_top', credits: 1000, key: null, keyHash: a.hash, requireExisting: true });
    const [x, y] = await Promise.all(order === 'rotate-first' ? [rotate(), topUp()] : [topUp(), rotate()]);
    const added = order === 'rotate-first' ? y : x;
    assert.equal(added.missing, undefined, order);
    assert.equal(added.credits, 1000, order);
    assert.deepEqual(accounts(s), [b.hash], order);
    assert.equal((await credits.creditBalance(s, b.hash)).balanceMicros, 6_000_000, order);
    assert.equal(s.records.get('credit:session:cs_top').keyHash, b.hash, order);
  }
  // Many top-ups and one rotation at the same moment: every credit is counted once.
  const s = storage();
  const a = await newKey(), b = await newKey();
  await credits.issueCredits(s, { sessionId: 'cs_first', credits: 1000, key: a.key, keyHash: a.hash });
  const jobs = Array.from({ length: 10 }, (_, i) => credits.issueCredits(s, { sessionId: `cs_${i}`, credits: 100, key: null, keyHash: a.hash, requireExisting: true }));
  jobs.splice(4, 0, credits.rotateKey(s, a.hash, b.key, b.hash));
  await Promise.all(jobs);
  assert.deepEqual(accounts(s), [b.hash]);
  assert.equal((await credits.creditBalance(s, b.hash)).balanceMicros, 2_000_000);
});

test('refund after a rotation goes to the current key instead of being lost', async () => {
  const s = storage();
  const a = await newKey(), b = await newKey(), c = await newKey();
  await credits.issueCredits(s, { sessionId: 'cs_first', credits: 5000, key: a.key, keyHash: a.hash });
  assert.equal((await credits.spendCredits(s, a.hash, 2000)).balanceMicros, 4_998_000);
  await credits.rotateKey(s, a.hash, b.key, b.hash);
  assert.equal(await credits.refundCredits(s, a.hash, 2000), 5_000_000, 'the call that failed after the rotation gets its price back');
  let account = await credits.creditBalance(s, b.hash);
  assert.equal(account.balanceMicros, 5_000_000); assert.equal(account.spentMicros, 0); assert.equal(account.calls, 0);
  assert.deepEqual(accounts(s), [b.hash]);
  // Rotated again: the first key's pointer goes straight to the newest hash.
  await credits.spendCredits(s, b.hash, 3000);
  await credits.rotateKey(s, b.hash, c.key, c.hash);
  assert.equal(await credits.refundCredits(s, a.hash, 1000), 4_998_000);
  assert.equal(await credits.refundCredits(s, b.hash, 2000), 5_000_000);
  assert.equal(await credits.refundCredits(s, c.hash, 0), 5_000_000, 'the current key refunds as before');
  assert.deepEqual(accounts(s), [c.hash]);
  // A key that never existed still refunds nothing and creates nothing.
  const before = s.records.size;
  assert.equal(await credits.refundCredits(s, 'f'.repeat(64), 2000), 0);
  assert.equal(s.records.size, before);
  // A free key's call is given back after a rotation too.
  const f = storage();
  const k1 = await newKey(), k2 = await newKey();
  await credits.issueFreeKey(f, { emailHash: 'e'.repeat(64), key: k1.key, keyHash: k1.hash, perMonth: 3, month: '2026-11' });
  assert.equal((await credits.spendCredits(f, k1.hash, 2000, '2026-11')).free.left, 2);
  await credits.rotateKey(f, k1.hash, k2.key, k2.hash);
  await credits.refundCredits(f, k1.hash, 0, true);
  assert.equal((await credits.creditBalance(f, k2.hash)).free.used, 0);
  // The pointers of one account are bounded: after many rotations the oldest ones are gone and resolve to nothing.
  let current = c;
  const olds = [a.hash, b.hash];
  for (let i = 0; i < 25; i++) { const next = await newKey(); olds.push(current.hash); await credits.rotateKey(s, current.hash, next.key, next.hash); current = next; }
  const pointers = [...s.records.keys()].filter((k) => k.startsWith('credit:moved:'));
  assert.equal(pointers.length, 20);
  assert.ok([...pointers].every((k) => s.records.get(k) === current.hash), 'every kept pointer names the current key');
  assert.equal(await credits.refundCredits(s, olds[0], 1000), 0, 'a pointer older than the kept ones is gone');
  assert.equal(await credits.refundCredits(s, olds[olds.length - 1], 0), 5_000_000);
  assert.deepEqual(accounts(s), [current.hash]);
});

test('/credits/claim: a top-up link that names a replaced key adds to the current key; an unknown one still gets a new key', async () => {
  const s = storage();
  const stub = {
    issueCredits: (g) => credits.issueCredits(s, g), spendCredits: (h, m) => credits.spendCredits(s, h, m), refundCredits: (h, m) => credits.refundCredits(s, h, m),
    creditBalance: (h) => credits.creditBalance(s, h), rotateKey: (o, k, n) => credits.rotateKey(s, o, k, n),
  };
  const env = { METRICS: { idFromName: () => 'credits', get: () => stub }, STRIPE_READ_KEY: 'rk_test_key' };
  const app = new Hono(); app.route('/', routes.credits);
  const get = (path, headers = { accept: 'application/json' }) => app.fetch(new Request(`https://api.test${path}`, { headers }), env, { waitUntil() {} });
  const paid = { mode: 'payment', status: 'complete', payment_status: 'paid', currency: 'usd', amount_total: 2000, metadata: { adt_credits: '22000' } };
  const a = await newKey();
  await credits.issueCredits(s, { sessionId: 'cs_live_first', credits: 5000, key: a.key, keyHash: a.hash });
  const rotated = await (await app.fetch(new Request('https://api.test/credits/rotate', { method: 'POST', headers: { authorization: `Bearer ${a.key}` } }), env, { waitUntil() {} })).json();
  assert.match(rotated.apiKey, /^adt_/);
  const realFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({ ...paid, client_reference_id: `topup_${a.hash}` }));
    let body = await (await get('/credits/claim?session_id=cs_live_TopupOld0001')).json();
    assert.equal(body.toppedUp, true);
    assert.equal(body.apiKey, undefined);
    assert.equal(body.balanceCredits, 27000);
    assert.equal((await (await get('/credits/claim?session_id=cs_live_TopupOld0001')).json()).balanceCredits, 27000, 'reloading does not add twice');
    assert.deepEqual(accounts(s), [await credits.hashCreditKey(rotated.apiKey)], 'nothing was credited to the key that stopped working');
    assert.equal((await (await get('/credits/balance', { authorization: `Bearer ${rotated.apiKey}` })).json()).balanceCredits, 27000);
    assert.equal((await get('/credits/balance', { authorization: `Bearer ${a.key}` })).status, 401);

    globalThis.fetch = async () => new Response(JSON.stringify({ ...paid, client_reference_id: `topup_${'0'.repeat(64)}` }));
    body = await (await get('/credits/claim?session_id=cs_live_TopupTwo0002')).json();
    assert.match(body.apiKey, /^adt_/, 'the payment is not lost');
    assert.equal(body.balanceCredits, 22000);
    const again = await (await get('/credits/claim?session_id=cs_live_TopupTwo0002')).json();
    assert.equal(again.apiKey, body.apiKey, 'a reload shows the same new key');
    assert.equal(again.balanceCredits, 22000);
    assert.equal(accounts(s).length, 2);
  } finally { globalThis.fetch = realFetch; }
});

test('OAuth store: registrations are capped per address and in total per day, and codes and tokens are removed when expired', async () => {
  const { registerClient, putExpiring, sweepExpired, REGISTRATIONS_PER_DAY, REGISTRATIONS_PER_ADDRESS_PER_DAY } = clients;
  assert.equal(REGISTRATIONS_PER_ADDRESS_PER_DAY, 500);
  assert.equal(REGISTRATIONS_PER_DAY, 5000);
  const DAY = 86_400_000, t0 = Date.parse('2026-11-21T10:00:00Z');
  const s = storage();
  const client = (n) => ({ clientId: `adtc_${String(n).padStart(12, '0')}`, clientName: 'An app', redirectUris: ['https://app.example/cb'], createdAt: new Date(t0).toISOString() });
  const reg = (n, address, now = t0, perDay = 500, total = 5000) => registerClient(s, { client: client(n), address, day: new Date(now).toISOString().slice(0, 10), now }, perDay, 30, total);
  const count = (prefix) => [...s.records.keys()].filter((k) => k.startsWith(prefix)).length;

  // The total of the day: 8 registrations from 8 addresses and some with no known address, at the same moment.
  const answers = await Promise.all(Array.from({ length: 12 }, (_, i) => reg(i, i % 3 === 0 ? null : `addr-${i}`, t0, 500, 8)));
  assert.equal(answers.filter((x) => x === 'ok').length, 8);
  assert.equal(answers.filter((x) => x === 'limit').length, 4);
  assert.equal(count('oauth:client:'), 8, 'a refused registration stored nothing');
  assert.equal(await reg(50, null, t0, 500, 8), 'limit', 'an unknown address is inside the total too');
  assert.equal(await reg(51, 'addr-new', t0 + DAY, 500, 8), 'ok', 'the next day starts again');
  // The per-address limit still counts exactly.
  const mine = await Promise.all(Array.from({ length: 6 }, (_, i) => reg(100 + i, 'addr-x', t0 + DAY, 4, 5000)));
  assert.equal(mine.filter((x) => x === 'ok').length, 4);
  // One small count per address and day, and it does not stay: two days later it is gone.
  assert.ok(count('oauth:regs:') >= 2);
  await reg(200, 'addr-y', t0 + 4 * DAY);
  assert.deepEqual([...s.records.keys()].filter((k) => k.startsWith('oauth:regs:')), [`oauth:regs:${new Date(t0 + 4 * DAY).toISOString().slice(0, 10)}:addr-y`]);
  assert.equal(s.records.get('oauth:regs-total').used, 1);

  // Codes and tokens: stored with their expiry, removed by a later write once it has passed, never before.
  const e = storage();
  await putExpiring(e, 'oauth:code:c1', { expiresAt: t0 + 600_000 }, t0 + 600_000, t0);
  await putExpiring(e, 'oauth:access:a1', { expiresAt: t0 + 30 * DAY }, t0 + 30 * DAY, t0);
  await putExpiring(e, 'oauth:refresh:r1', { expiresAt: t0 + 365 * DAY }, t0 + 365 * DAY, t0);
  assert.equal(e.records.size, 6);
  assert.equal(await sweepExpired(e, t0 + 599_000), 0);
  assert.ok(e.records.has('oauth:code:c1'));
  await putExpiring(e, 'oauth:code:c2', { expiresAt: t0 + 1_200_000 }, t0 + 1_200_000, t0 + 601_000);
  assert.equal(e.records.has('oauth:code:c1'), false, 'the code that was never exchanged is gone');
  assert.ok(e.records.has('oauth:code:c2') && e.records.has('oauth:access:a1') && e.records.has('oauth:refresh:r1'));
  assert.equal(await sweepExpired(e, t0 + 31 * DAY), 2);
  assert.deepEqual([...e.records.keys()].filter((k) => !k.startsWith('oauth:exp:')), ['oauth:refresh:r1']);
  assert.equal(await sweepExpired(e, t0 + 366 * DAY), 1);
  assert.equal(e.records.size, 0, 'nothing is left behind, entries included');
  // A record that was used up (deleted) before its time leaves only an entry, and that goes too.
  await putExpiring(e, 'oauth:code:c3', { expiresAt: t0 + 1000 }, t0 + 1000, t0);
  e.records.delete('oauth:code:c3');
  assert.equal(await sweepExpired(e, t0 + 2000), 1);
  assert.equal(e.records.size, 0);
  // A flood of abandoned codes is cleared at least as fast as it is written.
  for (let i = 0; i < 120; i++) await putExpiring(e, `oauth:code:f${i}`, { expiresAt: t0 + i }, t0 + i, t0);
  assert.equal([...e.records.keys()].filter((k) => k.startsWith('oauth:code:')).length, 120);
  for (let i = 0; i < 3; i++) await putExpiring(e, `oauth:code:g${i}`, { expiresAt: t0 + DAY }, t0 + DAY, t0 + 1000);
  assert.deepEqual([...e.records.keys()].filter((k) => k.startsWith('oauth:code:')).sort(), ['oauth:code:g0', 'oauth:code:g1', 'oauth:code:g2']);
  // Only this module's own records can be named, and a failing store never fails the caller's write.
  await assert.rejects(() => putExpiring(e, 'credit:acct:x', {}, t0, t0), /invalid expiring record/);
  const realError = console.error; console.error = () => {};
  try { assert.equal(await sweepExpired({ list: async () => { throw new Error('down'); } }, t0), 0); } finally { console.error = realError; }
  // An entry can only ever remove an oauth record.
  e.records.set('oauth:exp:2020-01-01T00:00:00.000Z:x', 'credit:acct:victim'); e.records.set('credit:acct:victim', { balanceMicros: 1 });
  await sweepExpired(e, t0);
  assert.ok(e.records.has('credit:acct:victim'));
});

test('OAuth sign-in: the consent page shows where the browser goes, and codes and tokens are written with their expiry', async () => {
  const s = storage();
  // The routes stamp records with the real clock; `later` moves the store's clock and what is written from then on.
  let later = 0;
  const stub = {
    oauthGet: async (k) => s.records.get(`oauth:${k}`) ?? null,
    oauthPut: async (k, v) => { s.records.set(`oauth:${k}`, v); },
    oauthTake: async (k) => { const v = s.records.get(`oauth:${k}`) ?? null; s.records.delete(`oauth:${k}`); return v; },
    oauthPutExpiring: (k, v, at) => clients.putExpiring(s, `oauth:${k}`, v, at + later, Date.now() + later),
    oauthRegisterClient: (r) => clients.registerClient(s, r),
    oauthClientUsed: (id) => clients.markClientUsed(s, id),
    creditBalance: async () => null,
  };
  const env = { METRICS: { idFromName: () => 'credits', get: () => stub } };
  const app = new Hono(); app.route('/', oauthLib.oauth);
  const call = (path, init = {}) => app.fetch(new Request(`https://api.test${path}`, init), env, { waitUntil() {} });
  const crypto = require('node:crypto');
  const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const REDIRECT = 'https://app.example.com:8443/cb';
  const reg = await call('/oauth/register', { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.9' }, body: JSON.stringify({ client_name: 'Trusted Bank <b>', redirect_uris: [REDIRECT] }) });
  assert.equal(reg.status, 201);
  const clientId = (await reg.json()).client_id;
  const verifier = b64url(crypto.randomBytes(32)), challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  const q = { client_id: clientId, redirect_uri: REDIRECT, state: 's', code_challenge: challenge, code_challenge_method: 'S256', response_type: 'code' };
  const form = await call(`/oauth/authorize?${new URLSearchParams(q)}`);
  assert.equal(form.status, 200);
  const html = await form.text();
  // The address is on its own, large, with its port, apart from the name the app chose for itself.
  assert.match(html, /<div class="box" id="returns-to"><small>After you continue, your browser goes to<\/small><br><strong style="font-size:1\.3rem;overflow-wrap:anywhere">app\.example\.com:8443<\/strong>/);
  assert.match(html, /Continue only if this is the app you are connecting\./);
  assert.ok(html.indexOf('id="returns-to"') < html.indexOf('<form'), 'shown before the buttons');
  assert.ok(!html.includes('<b>'), 'the app name is escaped');
  // The ChatGPT page has the same line and still no word about keys or prices.
  const chat = await call('/oauth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: 'ChatGPT', redirect_uris: ['https://chatgpt.com/connector/cb'] }) });
  const chatHtml = await (await call(`/oauth/authorize?${new URLSearchParams({ ...q, client_id: (await chat.json()).client_id, redirect_uri: 'https://chatgpt.com/connector/cb' })}`)).text();
  assert.match(chatHtml, /id="returns-to".*<strong[^>]*>chatgpt\.com<\/strong>/);
  assert.doesNotMatch(chatHtml, /API key|credits|\$/);

  // A sign-in that is started and abandoned leaves a code that a later write removes.
  const post = () => call('/oauth/authorize', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'cf-connecting-ip': '203.0.113.9' }, body: new URLSearchParams({ ...q, mode: 'free' }) });
  const abandoned = await post();
  assert.equal(abandoned.status, 302);
  const codes = () => [...s.records.keys()].filter((k) => k.startsWith('oauth:code:'));
  assert.equal(codes().length, 1);
  const lost = codes()[0];
  later += 11 * 60_000;
  const second = await post();
  assert.deepEqual(codes().includes(lost), false, 'the expired code is gone');
  assert.equal(codes().length, 1);
  // The live code is exchanged; the tokens carry their expiry entries, and they too are removed in the end.
  const code = new URL(second.headers.get('location')).searchParams.get('code');
  const token = await call('/oauth/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', code, code_verifier: verifier, client_id: clientId, redirect_uri: REDIRECT }) });
  assert.equal(token.status, 200);
  const tokens = await token.json();
  assert.match(tokens.access_token, /^adtok_/);
  assert.ok(await oauthLib.grantFromRequest(env, `Bearer ${tokens.access_token}`));
  const kinds = (prefix) => [...s.records.keys()].filter((k) => k.startsWith(prefix)).length;
  assert.equal(kinds('oauth:access:'), 1); assert.equal(kinds('oauth:refresh:'), 1);
  assert.equal([...s.records.keys()].filter((k) => k.startsWith('oauth:exp:') && /:oauth:(access|refresh):/.test(k)).length, 2);
  later += 31 * 86_400_000;
  const refreshed = await call('/oauth/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id: clientId }) });
  assert.equal(refreshed.status, 200);
  assert.equal(kinds('oauth:access:'), 1, 'the expired access token was removed when the new one was written');
  assert.equal(kinds('oauth:refresh:'), 1);
  assert.ok(s.records.has(`oauth:client:${clientId}`), 'a client that completed a sign-in is kept');
  // If the expiring store fails, the sign-in still works the old way.
  stub.oauthPutExpiring = async () => { throw new Error('down'); };
  const realError = console.error; console.error = () => {};
  try { assert.equal((await post()).status, 302); } finally { console.error = realError; }
  assert.equal(codes().length, 1);
});

test('issue gate: of N sign-ups sent at the same moment from one address, only the allowed number pass', async () => {
  // The counter itself.
  const counter = storage();
  const stub = { takeFreeCall: (c, d, l) => free.takeFreeCall(counter, c, d, l), refundFreeCall: (c, d) => free.refundFreeCall(counter, c, d) };
  const METRICS = { idFromName: (n) => { assert.equal(n, 'credits'); return n; }, get: () => stub };
  const taken = await Promise.all(Array.from({ length: 20 }, () => gate.takeIssueSlot({ METRICS }, 'thing', '2026-11-21', 'caller-a', 3)));
  assert.equal(taken.filter((x) => x === true).length, 3);
  assert.equal(taken.filter((x) => x === false).length, 17);
  assert.equal(await gate.takeIssueSlot({ METRICS }, 'thing', '2026-11-21', 'caller-b', 3), true, 'another caller has its own');
  assert.equal(await gate.takeIssueSlot({ METRICS }, 'thing', '2026-11-22', 'caller-a', 3), true, 'and so has another day');
  assert.equal(await gate.takeIssueSlot({ METRICS }, 'other', '2026-11-21', 'caller-a', 3), true, 'and another kind of key');
  // No counter, or one that fails: null, and the caller keeps its own check.
  assert.equal(await gate.takeIssueSlot({}, 'thing', '2026-11-21', 'caller-a', 3), null);
  const realError = console.error; console.error = () => {};
  try { assert.equal(await gate.takeIssueSlot({ METRICS: { idFromName: (n) => n, get: () => ({ takeFreeCall: async () => { throw new Error('down'); } }) } }, 'thing', '2026-11-21', 'caller-a', 3), null); } finally { console.error = realError; }

  // A slow KV, as in production: every parallel request reads the count before any of them has written it.
  const slowKv = () => { const data = new Map(); return { data, get: async (k, type) => { await tick(); await tick(); return data.has(k) ? (type === 'json' ? JSON.parse(data.get(k)) : data.get(k)) : null; }, put: async (k, v) => { await tick(); await tick(); data.set(k, v); }, delete: async (k) => { data.delete(k); } }; };

  // Free keys by e-mail: 3 sign-ups per address and day.
  switches.forgetSwitches();
  const mail = [];
  const keysEnv = (metrics) => ({ FREE_KEYS: 'on', FREE_KEY_FROM: 'keys@example.test', EMAIL: { send: async (m) => { mail.push(m); return { messageId: 'm' }; } }, TRIALS: slowKv(), METRICS: metrics });
  const app = new Hono(); app.route('/', freeKeys.freeKeys);
  const signUp = (env, i, ip = '203.0.113.7') => app.fetch(new Request('https://api.test/keys/free', { method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json', 'cf-connecting-ip': ip }, body: JSON.stringify({ email: `person${i}@example.com` }) }), env, { waitUntil() {} });
  const creditsStore = storage();
  const ledger = { issueCredits: (g) => credits.issueCredits(creditsStore, g), issueFreeKey: (g) => credits.issueFreeKey(creditsStore, g), creditBalance: (h) => credits.creditBalance(creditsStore, h) };
  const withGate = keysEnv({ idFromName: () => 'credits', get: () => ({ ...ledger, ...stub }) });
  let statuses = (await Promise.all(Array.from({ length: 12 }, (_, i) => signUp(withGate, i)))).map((r) => r.status);
  assert.equal(statuses.filter((x) => x === 200).length, freeKeys.FREE_KEY_REQUESTS_PER_CALLER, 'exactly the cap');
  assert.equal(statuses.filter((x) => x === 429).length, 12 - freeKeys.FREE_KEY_REQUESTS_PER_CALLER);
  assert.equal(mail.length, freeKeys.FREE_KEY_REQUESTS_PER_CALLER, 'and exactly that many messages');
  assert.equal((await signUp(withGate, 99)).status, 429, 'later requests from that address stay refused');
  assert.equal((await signUp(withGate, 100, '203.0.113.8')).status, 200, 'another address is not affected');
  // The same IPv6 /64 is one address; an IPv4 address written inside IPv6 is that IPv4 address.
  mail.length = 0;
  statuses = (await Promise.all(Array.from({ length: 8 }, (_, i) => signUp(withGate, 200 + i, `2001:db8:5:6::${i + 1}`)))).map((r) => r.status);
  assert.equal(statuses.filter((x) => x === 200).length, freeKeys.FREE_KEY_REQUESTS_PER_CALLER);
  assert.equal((await signUp(withGate, 300, '::ffff:203.0.113.7')).status, 429, 'the mapped form of an address that used its sign-ups');
  // Without the counter (a store that has no such method) the old check applies and nothing breaks.
  mail.length = 0;
  const without = keysEnv({ idFromName: () => 'credits', get: () => ledger });
  const realError2 = console.error; console.error = () => {};
  try {
    assert.equal((await signUp(without, 1)).status, 200);
    assert.equal((await signUp(without, 2)).status, 200);
    assert.equal((await signUp(without, 3)).status, 200);
    assert.equal((await signUp(without, 4)).status, 429);
  } finally { console.error = realError2; }

  // Voice test keys: one per address and day.
  switches.forgetSwitches();
  const voiceEnv = { TRIALS: slowKv(), METRICS, VOICE_TEST_KEYS: 'on' };
  const issue = (env, ip) => voiceKeys.voiceKeys.request('https://api.test/keys/voice-test', { method: 'POST', headers: { accept: 'application/json', 'cf-connecting-ip': ip } }, env);
  const answers = await Promise.all(Array.from({ length: 10 }, () => issue(voiceEnv, '198.51.100.20')));
  const bodies = await Promise.all(answers.map((r) => r.json()));
  assert.equal(bodies.filter((b) => typeof b.apiKey === 'string').length, 1, 'one key for ten parallel requests');
  assert.equal(answers.filter((r) => r.status === 200).length, 1);
  assert.equal([...voiceEnv.TRIALS.data.keys()].filter((k) => k.startsWith('voicekey:key:') || k.startsWith('voicekey:record:')).length <= 1, true);
  const v6 = await Promise.all(Array.from({ length: 6 }, (_, i) => issue(voiceEnv, `2001:db8:9:9::${i + 1}`)));
  assert.equal(v6.filter((r) => r.status === 200).length, 1, 'one /64 is one address');
  assert.equal((await issue(voiceEnv, '198.51.100.21')).status, 200, 'another address gets its key');
  // Without the counter the old behaviour applies: a first request gets a key, a second from the same address does not.
  switches.forgetSwitches();
  const plain = { TRIALS: slowKv(), VOICE_TEST_KEYS: 'on', METRICS: { idFromName: (n) => n, get: () => ({}) } };
  const realError3 = console.error; console.error = () => {};
  try {
    assert.equal((await issue(plain, '198.51.100.30')).status, 200);
    assert.notEqual((await issue(plain, '198.51.100.30')).status, 200);
  } finally { console.error = realError3; }
});
