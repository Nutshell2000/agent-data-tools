// Quality round two, 21 Nov 2026: the daily budgets of the metered upstreams (Workers AI, the hosted browser, search)
// are counted exactly in the Metrics object with a share for unpaid use; caller-family labels are bounded in the
// funnel row; verify has a deadline and a failed settle says what is really known; OAuth registrations are bounded.
// Storage, the AI binding and the network are all mocked: nothing leaves this process.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { build } = require('esbuild');

const stubWorkers = { name: 'stubs', setup(p) {
  p.onResolve({ filter: /^cloudflare:workers$/ }, () => ({ path: 'cloudflare:workers', namespace: 'stub' }));
  p.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'export class WorkerEntrypoint { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }\nexport class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }', loader: 'js' }));
  p.onResolve({ filter: /^url$/ }, () => ({ path: 'node:url', external: true }));
} };
const cache = new Map();
/** Several source files as ONE bundle, so they share one copy of the request trace. */
async function load(...files) {
  const id = files.join('|');
  if (cache.has(id)) return cache.get(id);
  const b = await build({ stdin: { contents: files.map((f) => `export * from './${f}';`).join('\n'), resolveDir: process.cwd(), loader: 'ts' }, bundle: true, format: 'cjs', platform: 'node', write: false, logLevel: 'silent', plugins: [stubWorkers] });
  const m = { exports: {} };
  new Function('module', 'exports', 'require', b.outputFiles[0].text)(m, m.exports, require);
  cache.set(id, m.exports);
  return m.exports;
}

const tick = () => new Promise((r) => setImmediate(r));
/** Durable Object storage: every read and write yields, and transactions run one after another, as in the object. */
function doStorage() {
  const data = new Map();
  let queue = Promise.resolve();
  const txn = { get: async (k) => { await tick(); return structuredClone(data.get(k)); }, put: async (k, v) => { await tick(); data.set(k, structuredClone(v)); }, delete: async (k) => { await tick(); return data.delete(k); } };
  return {
    data,
    transaction(cb) { const run = queue.then(() => cb(txn)); queue = run.catch(() => {}); return run; },
    async list({ prefix, end, limit }) { const keys = [...data.keys()].filter((k) => k.startsWith(prefix) && (!end || k < end)).sort().slice(0, limit ?? Infinity); return new Map(keys.map((k) => [k, data.get(k)])); },
    async delete(keys) { let n = 0; for (const k of keys) if (data.delete(k)) n++; return n; },
  };
}
const kv = (initial = {}) => {
  const data = new Map(Object.entries(initial));
  return { data, get: async (key) => { await tick(); return data.has(key) ? data.get(key) : null; }, put: async (key, value) => { await tick(); data.set(key, String(value)); }, delete: async (key) => { data.delete(key); } };
};
/** The METRICS binding over the real counting code. */
async function metricsBinding(storage = doStorage()) {
  const { takeCapacity, giveBackCapacity } = await load('src/lib/capacity-count.ts');
  const calls = { take: 0, giveBack: 0 };
  const stub = {
    capacityTake: (kind, day, cap, unpaidCap) => { calls.take++; return takeCapacity(storage, kind, day, cap, unpaidCap); },
    capacityGiveBack: (kind, day, unpaid) => { calls.giveBack++; return giveBackCapacity(storage, kind, day, unpaid); },
  };
  return { storage, calls, METRICS: { idFromName: (n) => n, get: () => stub } };
}
const today = () => new Date().toISOString().slice(0, 10);
const row = (storage, kind) => storage.data.get(`capacity:${kind}`) ?? { used: 0, unpaid: 0 };
const BUNDLE = ['src/lib/daily-cap.ts', 'src/lib/ai.ts', 'src/lib/funnel.ts', 'src/lib/unpaid-call.ts', 'src/lib/switches.ts'];
const silent = async (fn) => { const { error, warn } = console; console.error = () => {}; console.warn = () => {}; try { return await fn(); } finally { console.error = error; console.warn = warn; } };

test('the exact count: 200 takers at once never pass the cap, and the count is the cap', async () => {
  const { takeCapacity, readCapacity } = await load('src/lib/capacity-count.ts');
  const storage = doStorage();
  const answers = await Promise.all(Array.from({ length: 200 }, (_, i) => takeCapacity(storage, 'ai', '2026-11-21', 50, i % 3 === 0 ? 15 : null)));
  assert.equal(answers.filter((a) => a === 'ok').length, 50);
  const counted = await readCapacity(storage, 'ai', '2026-11-21');
  assert.equal(counted.used, 50);
  assert.ok(counted.unpaid <= 15);
  // A new day starts from nothing, in the same row.
  assert.equal(await takeCapacity(storage, 'ai', '2026-11-22', 50, null), 'ok');
  assert.deepEqual(await readCapacity(storage, 'ai', '2026-11-22'), { day: '2026-11-22', used: 1, unpaid: 0 });
  assert.equal([...storage.data.keys()].length, 1, 'one row per resource, not one per day');
  await assert.rejects(() => takeCapacity(storage, 'ai', 'today', 50, null), /invalid/);
  await assert.rejects(() => takeCapacity(storage, 'ai', '2026-11-22', 1.5, null), /invalid/);
});

test('unpaid use stops at its share while paid calls go on to the cap, and a paid call is never refused for the share', async () => {
  const { takeCapacity, giveBackCapacity, readCapacity } = await load('src/lib/capacity-count.ts');
  const { unpaidCapOf, UNPAID_SHARE } = await load(...BUNDLE);
  assert.equal(UNPAID_SHARE, 0.3);
  assert.deepEqual([1000, 200, 40, 5, 1].map(unpaidCapOf), [300, 60, 12, 1, 1]);
  const storage = doStorage();
  const day = '2026-11-21';
  const unpaid = [];
  for (let i = 0; i < 40; i++) unpaid.push(await takeCapacity(storage, 'ai', day, 100, unpaidCapOf(100)));
  assert.equal(unpaid.filter((a) => a === 'ok').length, 30);
  assert.equal(unpaid[30], 'unpaid_full');
  const paid = [];
  for (let i = 0; i < 80; i++) paid.push(await takeCapacity(storage, 'ai', day, 100, null));
  assert.equal(paid.filter((a) => a === 'ok').length, 70, 'paid calls use everything unpaid use left');
  assert.equal(paid[70], 'full');
  assert.equal(await takeCapacity(storage, 'ai', day, 100, 30), 'full', 'a full day is reported as full to everyone');
  // Paid calls alone may use the whole cap.
  const other = doStorage();
  for (let i = 0; i < 100; i++) assert.equal(await takeCapacity(other, 'ai', day, 100, null), 'ok');
  assert.equal(await takeCapacity(other, 'ai', day, 100, null), 'full');
  // Giving back: an unpaid slot frees one of the unpaid share, a paid one does not touch it; another day is not touched.
  await giveBackCapacity(storage, 'ai', day, true);
  assert.deepEqual(await readCapacity(storage, 'ai', day), { day, used: 99, unpaid: 29 });
  await giveBackCapacity(storage, 'ai', day, false);
  assert.deepEqual(await readCapacity(storage, 'ai', day), { day, used: 98, unpaid: 29 });
  await giveBackCapacity(storage, 'ai', '2026-11-20', true);
  assert.deepEqual(await readCapacity(storage, 'ai', day), { day, used: 98, unpaid: 29 });
});

test('runAi: parallel calls stop exactly at AI_DAILY_CAP, with the old 503 text, and nothing is written to KV', async () => {
  const { runAi, forgetSwitches } = await load(...BUNDLE);
  forgetSwitches();
  const { storage, METRICS } = await metricsBinding();
  const TRIALS = kv();
  let ran = 0;
  const env = { METRICS, TRIALS, AI_DAILY_CAP: '20', AI: { run: async () => { ran++; await tick(); return { response: 'ok' }; } } };
  const results = await Promise.allSettled(Array.from({ length: 60 }, () => runAi(env, '@cf/x', {})));
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 20);
  assert.equal(ran, 20, 'the model ran exactly cap times');
  const refused = results.find((r) => r.status === 'rejected').reason;
  assert.equal(refused.status, 503);
  assert.equal(refused.code, 'DAILY_CAPACITY');
  assert.equal(refused.message, "today's AI capacity is used up; try again after 00:00 UTC");
  assert.equal(row(storage, 'ai').used, 20);
  assert.equal([...TRIALS.data.keys()].some((k) => k.startsWith('cap:')), false, 'the approximate KV count is not used while the exact one answers');
});

test('runAi: a call marked unpaid stops at 30% of the cap; paid calls and unmarked calls continue', async () => {
  const { runAi, forgetSwitches, withRequestTrace, markUnpaidCall, isUnpaidCall } = await load(...BUNDLE);
  forgetSwitches();
  const { storage, METRICS } = await metricsBinding();
  const env = { METRICS, TRIALS: kv(), AI_DAILY_CAP: '10', AI: { run: async () => ({ response: 'ok' }) } };
  const inRequest = (fn) => withRequestTrace({}, '/ai/chat', null, () => {}, fn);
  const unpaidCall = () => inRequest(async () => { markUnpaidCall(); assert.equal(isUnpaidCall(), true); return runAi(env, '@cf/x', {}); });
  const paidCall = () => inRequest(async () => { assert.equal(isUnpaidCall(), false); return runAi(env, '@cf/x', {}); });
  for (let i = 0; i < 3; i++) await unpaidCall();
  const refused = await unpaidCall().catch((e) => e);
  assert.equal(refused.status, 503);
  assert.equal(refused.code, 'DAILY_CAPACITY');
  assert.match(refused.message, /capacity for free calls is used up; paid calls still run/);
  assert.deepEqual({ used: row(storage, 'ai').used, unpaid: row(storage, 'ai').unpaid }, { used: 3, unpaid: 3 });
  // Seven more: paid calls in a request, and calls with no trace at all (nothing known counts as paid).
  for (let i = 0; i < 4; i++) await paidCall();
  for (let i = 0; i < 3; i++) await runAi(env, '@cf/x', {});
  assert.equal(row(storage, 'ai').used, 10);
  await assert.rejects(() => paidCall(), (e) => e.status === 503 && e.message === "today's AI capacity is used up; try again after 00:00 UTC");
  // The mark belongs to one request: the next request is not unpaid because the last one was.
  assert.equal(await inRequest(async () => isUnpaidCall()), false);
  assert.equal(isUnpaidCall(), false, 'no request, no mark');
});

test('a free offer\'s own budget marks the call unpaid, so the AI it goes on to use comes from the unpaid share', async () => {
  const { runAi, takeDailyBudget, forgetSwitches, withRequestTrace, isUnpaidCall } = await load(...BUNDLE);
  forgetSwitches();
  const { storage, METRICS } = await metricsBinding();
  const TRIALS = kv();
  const env = { METRICS, TRIALS, AI_DAILY_CAP: '10', AI: { run: async () => ({ response: 'ok' }) } };
  const page = (kind) => withRequestTrace({}, '/lexglyph', null, () => {}, async () => { await takeDailyBudget(env, kind, undefined, 2000, 'LexGlyph'); return isUnpaidCall(); });
  assert.equal(await page('lexglyph'), true);
  assert.equal(await page('pdftry'), true);
  assert.equal(await page('pdftry-upload'), true);
  assert.equal(await page('payee-claim'), false, 'another budget marks nothing');
  assert.equal([...TRIALS.data.keys()].filter((k) => k.startsWith('cap:lexglyph:')).length, 1, 'the offer\'s own budget is still the KV count it was');
  assert.equal(storage.data.has('capacity:lexglyph'), false);
  const search = () => withRequestTrace({}, '/lexglyph', null, () => {}, async () => { await takeDailyBudget(env, 'lexglyph', undefined, 2000, 'LexGlyph'); return runAi(env, '@cf/embed', {}); });
  for (let i = 0; i < 3; i++) await search();
  await assert.rejects(() => search(), (e) => e.status === 503 && /free calls/.test(e.message));
  assert.equal(row(storage, 'ai').unpaid, 3);
});

test('a failed AI call gives its slot back; a refused input keeps it (the model ran)', async () => {
  const { runAi, forgetSwitches, withRequestTrace, markUnpaidCall } = await load(...BUNDLE);
  forgetSwitches();
  const { storage, calls, METRICS } = await metricsBinding();
  let fail = new Error('5007: No such model or model deprecated');
  const env = { METRICS, TRIALS: kv(), AI_DAILY_CAP: '5', AI: { run: async () => { if (fail) throw fail; return { response: 'ok' }; } } };
  await silent(async () => {
    for (let i = 0; i < 12; i++) await assert.rejects(() => runAi(env, '@cf/x', {}), (e) => e.status === 502);
    assert.equal(row(storage, 'ai').used, 0, 'twelve failures used none of the five slots');
    assert.equal(calls.giveBack, 12);
    fail = new Error('4006: you have used up your daily free allocation of neurons');
    await assert.rejects(() => runAi(env, '@cf/x', {}), (e) => e.status === 503);
    assert.equal(row(storage, 'ai').used, 0);
    // An unpaid failure frees its place in the unpaid share too.
    await assert.rejects(() => withRequestTrace({}, '/ai/chat', null, () => {}, async () => { markUnpaidCall(); return runAi(env, '@cf/x', {}); }), (e) => e.status === 503);
    assert.deepEqual({ used: row(storage, 'ai').used, unpaid: row(storage, 'ai').unpaid }, { used: 0, unpaid: 0 });
    fail = new Error('3030: input flagged as NSFW');
    await assert.rejects(() => runAi(env, '@cf/x', {}), (e) => e.status === 422);
    assert.equal(row(storage, 'ai').used, 1, 'a refused input was run and billed: its slot stays');
  });
  fail = null;
  for (let i = 0; i < 4; i++) await runAi(env, '@cf/x', {});
  await assert.rejects(() => runAi(env, '@cf/x', {}), (e) => e.status === 503 && e.code === 'DAILY_CAPACITY');
});

test('the counter is down: the call still runs (KV count instead; with KV down too, uncounted)', async () => {
  const { runAi, takeDailyBudget, forgetSwitches } = await load(...BUNDLE);
  forgetSwitches();
  const AI = { run: async () => ({ response: 'ok' }) };
  const key = `cap:ai:${today()}`;
  await silent(async () => {
    // 1. The object throws.
    const broken = { idFromName: (n) => n, get: () => ({ capacityTake: async () => { throw new Error('Durable Object is overloaded'); }, capacityGiveBack: async () => {} }) };
    const TRIALS = kv();
    assert.deepEqual(await runAi({ METRICS: broken, TRIALS, AI, AI_DAILY_CAP: '3' }, '@cf/x', {}), { response: 'ok' });
    assert.equal(TRIALS.data.get(key), '1', 'counted approximately instead');
    // The approximate count still enforces the cap, with the same answer.
    await runAi({ METRICS: broken, TRIALS, AI, AI_DAILY_CAP: '3' }, '@cf/x', {});
    await runAi({ METRICS: broken, TRIALS, AI, AI_DAILY_CAP: '3' }, '@cf/x', {});
    await assert.rejects(() => runAi({ METRICS: broken, TRIALS, AI, AI_DAILY_CAP: '3' }, '@cf/x', {}), (e) => e.status === 503 && e.code === 'DAILY_CAPACITY');
    // 2. The binding itself throws, or the stub has no such method (an older object), or answers nonsense.
    for (const METRICS of [{ idFromName: () => { throw new Error('no namespace'); } }, { idFromName: (n) => n, get: () => ({}) }, { idFromName: (n) => n, get: () => ({ capacityTake: async () => undefined }) }]) {
      const store = kv();
      assert.deepEqual(await runAi({ METRICS, TRIALS: store, AI, AI_DAILY_CAP: '3' }, '@cf/x', {}), { response: 'ok' });
      assert.equal(store.data.get(key), '1');
    }
    // 3. The object throws and KV throws on read, or on write: the call goes on uncounted.
    const deadKv = { get: async () => { throw new Error('KV down'); }, put: async () => { throw new Error('KV down'); } };
    const readOnlyKv = { get: async (k) => (k === 'switches' ? null : '0'), put: async () => { throw new Error('429 too many writes to one key'); } };
    for (const store of [deadKv, readOnlyKv]) {
      forgetSwitches();
      assert.deepEqual(await runAi({ METRICS: broken, TRIALS: store, AI, AI_DAILY_CAP: '3' }, '@cf/x', {}), { response: 'ok' });
    }
    forgetSwitches();
    // 4. No bindings at all (unit tests, odd deployments): nothing is refused.
    assert.deepEqual(await runAi({ AI }, '@cf/x', {}), { response: 'ok' });
    // 5. The object does not answer: the call goes on after two seconds.
    const hung = { idFromName: (n) => n, get: () => ({ capacityTake: () => new Promise(() => {}), capacityGiveBack: async () => {} }) };
    const started = Date.now();
    const slot = await takeDailyBudget({ METRICS: hung, TRIALS: kv() }, 'ai', '3', 1000, 'AI', true);
    assert.ok(Date.now() - started >= 1900 && Date.now() - started < 4000, 'waited about two seconds, no longer');
    await slot.giveBack();
  });
});

test('the off-switch and a cap of zero behave as before on the exact path, and search keeps its own answers', async () => {
  const { takeDailyBudget, takeExactBudget, forgetSwitches, SWITCHES_KEY } = await load(...BUNDLE);
  forgetSwitches();
  const { storage, calls, METRICS } = await metricsBinding();
  const off = kv({ [SWITCHES_KEY]: '{"ai":"off"}' });
  await assert.rejects(() => takeDailyBudget({ METRICS, TRIALS: off }, 'ai', '1000', 1000, 'AI', true), (e) => e.status === 503 && e.code === 'PAUSED_BY_OPERATOR' && e.message === 'AI calls are paused by the operator right now; nothing was charged, try again later');
  assert.equal(calls.take, 0, 'nothing was counted for a paused resource');
  await takeDailyBudget({ METRICS, TRIALS: off }, 'browser', '5', 5, 'hosted browser', true);
  assert.equal(row(storage, 'browser').used, 1, 'another resource still runs and is counted');
  forgetSwitches();
  // The search budget, as src/routes/search.ts asks for it.
  const HttpError = class extends Error { constructor(status, message, code) { super(message); this.status = status; this.code = code; } };
  const budget = { kind: 'search', cap: 2, kvKey: `search:${today()}`, full: () => new HttpError(503, "today's search capacity is used up; try again after 00:00 UTC", 'SEARCH_CAPACITY'), unpaidFull: () => new HttpError(503, 'free', 'SEARCH_CAPACITY') };
  const TRIALS = kv();
  await takeExactBudget({ METRICS, TRIALS }, budget);
  const slot = await takeExactBudget({ METRICS, TRIALS }, budget);
  await assert.rejects(() => takeExactBudget({ METRICS, TRIALS }, budget), (e) => e.code === 'SEARCH_CAPACITY' && /search capacity is used up/.test(e.message));
  await slot.giveBack();
  await takeExactBudget({ METRICS, TRIALS }, budget);
  assert.equal(row(storage, 'search').used, 2);
  assert.equal(TRIALS.data.size, 0);
});

test('caller-family labels: the funnel row keeps at most 300 a day; later names count as "other", known labels and tool paths are untouched', async () => {
  const { boundFamilyLabels, MAX_FAMILY_LABELS, Metrics, __test } = await load('src/metrics.ts');
  assert.equal(MAX_FAMILY_LABELS, 300);
  const stored = { 'http:/extract:quote': 5, 'http:/read/curl:discovery_read': 2 };
  const incoming = { 'http:/extract:quote': 1, 'http:/read/curl:discovery_read': 1, 'http:/read/newbot:discovery_read': 1, 'http:/caller/newbot:free_exhausted_by': 4, 'http:/read/third:discovery_read': 7, 'mcp:/pdf/text:free_call': 3, 'http:/from/google:referral': 1 };
  assert.deepEqual(boundFamilyLabels(stored, incoming, 3), {
    'http:/extract:quote': 1, 'http:/read/curl:discovery_read': 1, 'http:/read/newbot:discovery_read': 1, 'http:/caller/newbot:free_exhausted_by': 4,
    'http:/read/other:discovery_read': 7, 'mcp:/pdf/text:free_call': 3, 'http:/from/google:referral': 1,
  });
  assert.deepEqual(boundFamilyLabels(stored, incoming), incoming, 'below the bound nothing is renamed');
  // Through the object: 3,000 made-up names over many batches end as 300 labels plus "other", and no count is lost.
  __test.unblockWrites();
  const rows = new Map();
  const txn = { get: async (k) => structuredClone(rows.get(k)), put: async (k, v) => { rows.set(k, structuredClone(v)); } };
  const storage = { transaction: async (cb) => cb(txn), setAlarm: async () => {}, list: async ({ prefix }) => new Map([...rows].filter(([k]) => k.startsWith(prefix))), get: async (k) => rows.get(k), put: async (k, v) => { rows.set(k, v); } };
  const metrics = new Metrics({ storage }, {});
  const at = new Date().toISOString();
  const event = (path, stage) => ({ requestId: '00000000-0000-4000-8000-000000000000', path, transport: 'http', stage, at });
  for (let batch = 0; batch < 30; batch++) {
    const funnel = [];
    for (let i = 0; i < 100; i++) funnel.push(event(`/read/bot-${batch * 100 + i}`, 'discovery_read'));
    funnel.push(event('/read/curl', 'discovery_read'), event('/extract', 'quote'));
    await metrics.ingest({ bumps: [], funnel, mcp: [] });
    await metrics.flush();
  }
  const day = rows.get(`funnel:day:${at.slice(0, 10)}`);
  const family = Object.keys(day).filter((k) => /:\/(read|caller)\//.test(k));
  assert.equal(family.length, 301, '300 names and "other"');
  assert.equal(day['http:/read/other:discovery_read'], 3000 - 299, 'every name beyond the 299 kept beside curl was counted under "other"');
  assert.equal(day['http:/read/curl:discovery_read'], 30, 'a label in the row keeps its own name all day');
  assert.equal(day['http:/extract:quote'], 30);
  assert.equal(day['http:/read/bot-0:discovery_read'], 1, 'a label that was kept keeps its own count');
  assert.equal(Object.values(day).reduce((n, v) => n + v, 0), 30 * 102, 'no event was dropped');
  // A label kept earlier in the day keeps counting under its own name after the bound is reached.
  await metrics.ingest({ bumps: [], funnel: [event('/read/bot-5', 'discovery_read'), event('/caller/late', 'free_exhausted_by')], mcp: [] });
  await metrics.flush();
  const after = rows.get(`funnel:day:${at.slice(0, 10)}`);
  assert.equal(after['http:/read/bot-5:discovery_read'], 2);
  assert.equal(after['http:/caller/other:free_exhausted_by'], 1);
  assert.equal(after['http:/caller/late:free_exhausted_by'], undefined);
});

test('the per-caller report is not changed by the label bound', async () => {
  const { Metrics, __test } = await load('src/metrics.ts');
  __test.unblockWrites();
  const rows = new Map();
  const txn = { get: async (k) => structuredClone(rows.get(k)), put: async (k, v) => { rows.set(k, structuredClone(v)); } };
  const storage = { transaction: async (cb) => cb(txn), setAlarm: async () => {}, list: async ({ prefix }) => new Map([...rows].filter(([k]) => k.startsWith(prefix))) };
  const metrics = new Metrics({ storage }, {});
  for (let i = 0; i < 80; i++) await metrics.bump('/extract', 'challenged', undefined, `family-${i}`);
  await metrics.flush();
  const callers = Object.values(await metrics.callers())[0];
  assert.equal(Object.keys(callers).length, 61, '60 families and "other", as before');
  assert.equal(callers.other.challenged, 20);
  assert.equal(callers['family-0'].challenged, 1);
});

test('verify has a 10-second deadline of its own; settle is left to run', async (t) => {
  const { withDeadline, VERIFY_TIMEOUT_MS, buildFacilitator } = await load('src/lib/facilitator.ts');
  assert.equal(VERIFY_TIMEOUT_MS, 10_000);
  await assert.rejects(() => withDeadline(() => new Promise(() => {}), 40, 'verify')(), /Facilitator verify timed out after 40 ms/);
  assert.equal(await withDeadline(async (a, b) => a + b, 40, 'verify')(2, 3), 5, 'an answer in time passes through');
  await assert.rejects(() => withDeadline(async () => { throw new Error('invalid_exact_evm_signature'); }, 40, 'verify')(), /^Error: invalid_exact_evm_signature$/, 'a refusal stays the facilitator\'s own');
  // On the client the service builds: a facilitator that never answers.
  const realFetch = globalThis.fetch;
  const asked = [];
  globalThis.fetch = (url) => { asked.push(String(url)); return new Promise(() => {}); };
  t.mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const client = buildFacilitator({ FACILITATOR_URL: 'https://facilitator.invalid' });
    const verify = client.verify({ x402Version: 2, payload: {} }, { network: 'eip155:8453' }).then(() => 'answered', (e) => e);
    const settle = client.settle({ x402Version: 2, payload: {} }, { network: 'eip155:8453' }).then(() => 'answered', (e) => e);
    let settleDone = false;
    void settle.then(() => { settleDone = true; });
    for (let i = 0; i < 20; i++) await Promise.resolve();
    t.mock.timers.tick(9_999);
    for (let i = 0; i < 20; i++) await Promise.resolve();
    assert.deepEqual(asked.sort(), ['https://facilitator.invalid/settle', 'https://facilitator.invalid/verify']);
    t.mock.timers.tick(2);
    const failed = await verify;
    assert.match(String(failed.message), /Facilitator verify timed out after 10000 ms/);
    assert.notEqual(failed.name, 'VerifyError', 'read as an outage, not as a refused payment');
    assert.doesNotMatch(String(failed.message), /^invalid_|insufficient_funds/);
    t.mock.timers.tick(60_000);
    for (let i = 0; i < 20; i++) await Promise.resolve();
    assert.equal(settleDone, false, 'settle was not cut short by our deadline');
    assert.equal(asked.length, 2, 'a timed-out verify is not sent again');
  } finally {
    t.mock.timers.reset();
    globalThis.fetch = realFetch;
  }
});

test('a failed v1 settlement says "not charged" only when that is known', async () => {
  const { settleOutcomeUnknown, payV1 } = await load('src/lib/x402-v1.ts');
  const named = (name, message) => Object.assign(new Error(message), { name });
  assert.equal(settleOutcomeUnknown(named('SettleError', 'insufficient_funds')), false);
  assert.equal(settleOutcomeUnknown(new Error('Facilitator settle failed (403): <!doctype html>')), false);
  assert.equal(settleOutcomeUnknown(new Error('Facilitator settle failed (400): {"error":"bad request"}')), false);
  assert.equal(settleOutcomeUnknown(new Error('Facilitator settle failed (502): <html><body>Bad gateway</body></html>')), false, 'stopped at the edge');
  assert.equal(settleOutcomeUnknown(new Error('Facilitator settle failed (500): {"error":"internal"}')), true, 'the facilitator failed while working on it');
  assert.equal(settleOutcomeUnknown(new Error('invalid_exact_evm_payload_authorization_valid_before')), false);
  assert.equal(settleOutcomeUnknown(named('FacilitatorTimeoutError', 'Facilitator settle request timed out after 90000ms')), true);
  assert.equal(settleOutcomeUnknown(new TypeError('fetch failed')), true);
  assert.equal(settleOutcomeUnknown(new Error('Network connection lost.')), true);

  const PAY_TO = '0x2074c40346ae2a90e0e4a391bcee6f16bf5277f5';
  const endpoint = { path: '/time', price: '$0.01', description: 'The time', params: {}, outputExample: {} };
  const header = Buffer.from(JSON.stringify({ x402Version: 1, scheme: 'exact', network: 'base', payload: { signature: '0x00', authorization: { from: '0x1111111111111111111111111111111111111111', to: PAY_TO, value: '10000', nonce: '0xabc', validBefore: String(Math.floor(Date.now() / 1000) + 300) } } })).toString('base64');
  const realFetch = globalThis.fetch;
  let settleAnswer;
  globalThis.fetch = async (url) => {
    if (String(url).endsWith('/verify')) return Response.json({ isValid: true, payer: '0x1111111111111111111111111111111111111111' });
    if (String(url).endsWith('/settle')) return settleAnswer();
    throw new Error(`unexpected request ${url}`);
  };
  const call = async () => {
    const c = { env: { PAY_TO, NETWORK: 'eip155:8453', FACILITATOR_URL: 'https://facilitator.invalid' }, req: { url: 'https://api.test/time' }, json: (body, status = 200) => Response.json(body, { status }), res: undefined, executionCtx: { waitUntil() {} } };
    const direct = await payV1(c, endpoint, header, async () => { c.res = Response.json({ now: 'then' }); });
    return direct ?? c.res;
  };
  try {
    await silent(async () => {
      settleAnswer = () => Response.json({ success: false, errorReason: 'insufficient_funds', transaction: '', network: 'base' });
      let res = await call();
      assert.equal(res.status, 402);
      assert.equal((await res.json()).error, 'settlement failed: insufficient_funds; you were not charged');
      settleAnswer = () => { throw new TypeError('fetch failed'); };
      res = await call();
      assert.equal(res.status, 402);
      const body = await res.json();
      assert.match(body.error, /^settlement could not be confirmed: fetch failed\. The payment may or may not have gone through; before paying again, check whether this authorization was used on chain$/);
      assert.doesNotMatch(body.error, /not charged/);
      assert.equal(body.x402Version, 1);
      assert.ok(Array.isArray(body.accepts) && body.accepts.length > 0, 'still a v1 payment answer');
      // A settlement that works is answered as before.
      settleAnswer = () => Response.json({ success: true, transaction: '0xfeed', network: 'base', payer: '0x1111111111111111111111111111111111111111' });
      res = await call();
      assert.equal(res.status, 200);
      assert.deepEqual(await res.json(), { now: 'then' });
      assert.ok(res.headers.get('X-PAYMENT-RESPONSE'));
    });
  } finally { globalThis.fetch = realFetch; }
});

test('OAuth registrations: 500 a day per address, removed after 30 days unless a sign-in was completed', async () => {
  const { registerClient, markClientUsed, clientExpired, REGISTRATIONS_PER_ADDRESS_PER_DAY, UNUSED_CLIENT_DAYS } = await load('src/lib/oauth-clients.ts');
  assert.equal(REGISTRATIONS_PER_ADDRESS_PER_DAY, 500);
  assert.equal(UNUSED_CLIENT_DAYS, 30);
  const storage = doStorage();
  const DAY = 86_400_000;
  const t0 = Date.parse('2026-11-21T10:00:00Z');
  const client = (n) => ({ clientId: `adtc_${String(n).padStart(12, '0')}`, clientName: 'An app', redirectUris: ['https://app.example/cb'], createdAt: new Date(t0).toISOString() });
  const reg = (n, address, now = t0, perDay) => registerClient(storage, { client: client(n), address, day: new Date(now).toISOString().slice(0, 10), now }, perDay);
  // The limit, counted exactly under parallel requests, per address and per day.
  const answers = await Promise.all(Array.from({ length: 12 }, (_, i) => reg(i, 'addr-a', t0, 10)));
  assert.equal(answers.filter((a) => a === 'ok').length, 10);
  assert.equal(answers.filter((a) => a === 'limit').length, 2);
  assert.equal([...storage.data.keys()].filter((k) => k.startsWith('oauth:client:')).length, 10, 'a refused registration stored nothing');
  assert.equal(await reg(100, 'addr-b', t0, 10), 'ok', 'another address is not affected');
  assert.equal(await reg(101, 'addr-a', t0 + DAY, 10), 'ok', 'the next day starts again');
  for (let i = 0; i < 30; i++) assert.equal(await reg(200 + i, null, t0, 10), 'ok', 'no known address: never limited');
  // The record is what the sign-in code reads, plus its expiry.
  const kept = storage.data.get('oauth:client:adtc_000000000100');
  assert.deepEqual({ ...kept, unusedUntil: undefined }, { ...client(100), unusedUntil: undefined });
  assert.equal(kept.unusedUntil, t0 + 30 * DAY);
  assert.equal(clientExpired(kept, t0 + 29 * DAY), false);
  assert.equal(clientExpired(kept, t0 + 31 * DAY), true);
  assert.equal(clientExpired({ clientId: 'old' }, t0 + 9999 * DAY), false, 'a record from before this change never expires');
  assert.equal(clientExpired(null, t0), false);
  // A completed sign-in keeps the client for good.
  await markClientUsed(storage, 'adtc_000000000100');
  assert.equal(storage.data.get('oauth:client:adtc_000000000100').unusedUntil, undefined);
  assert.equal([...storage.data.keys()].some((k) => k.startsWith('oauth:unused:') && k.endsWith(':adtc_000000000100')), false);
  await markClientUsed(storage, 'adtc_000000000100');
  await markClientUsed(storage, 'adtc_unknown00000');
  // 31 days later: each new registration removes up to 50 expired ones; the used client stays.
  const unusedBefore = [...storage.data.keys()].filter((k) => k.startsWith('oauth:unused:')).length;
  assert.equal(unusedBefore, 41);
  await reg(900, 'addr-c', t0 + 31 * DAY);
  const left = [...storage.data.keys()].filter((k) => k.startsWith('oauth:client:')).map((k) => k.slice('oauth:client:'.length)).sort();
  assert.deepEqual(left, ['adtc_000000000100', 'adtc_000000000101', 'adtc_000000000900'], 'only the used client, the one registered a day later and the new one are left');
  assert.equal([...storage.data.keys()].filter((k) => k.startsWith('oauth:unused:')).length, 2);
  await assert.rejects(() => registerClient(storage, { client: { clientId: 'x' }, address: null, day: '2026-11-21', now: t0 }), /invalid client/);
});
