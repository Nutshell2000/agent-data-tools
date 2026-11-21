// Safety release of 21 Nov 2026: operator off-switches (src/lib/switches.ts), IPv6 callers counted per /64, the signed
// answer tools out of the free calls, the front's flood guard, and a staging config that gives nothing away.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readFileSync } = require('node:fs');
const { build } = require('esbuild');

const stubWorkers = { name: 'stubs', setup(p) {
  p.onResolve({ filter: /^cloudflare:workers$/ }, () => ({ path: 'cloudflare:workers', namespace: 'stub' }));
  p.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'export class WorkerEntrypoint { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }', loader: 'js' }));
  p.onResolve({ filter: /^url$/ }, () => ({ path: 'node:url', external: true }));
} };
const cache = new Map();
async function load(entry) {
  if (cache.has(entry)) return cache.get(entry);
  const b = await build({ entryPoints: [entry], bundle: true, format: 'cjs', platform: 'node', write: false, logLevel: 'silent', plugins: [stubWorkers] });
  const m = { exports: {} };
  new Function('module', 'exports', 'require', b.outputFiles[0].text)(m, m.exports, require);
  cache.set(entry, m.exports);
  return m.exports;
}

const kv = (initial = {}) => {
  const data = new Map(Object.entries(initial));
  const reads = [];
  return { reads, data, get: async (key) => { reads.push(key); return data.has(key) ? data.get(key) : null; }, put: async (key, value) => { data.set(key, String(value)); }, delete: async (key) => { data.delete(key); } };
};

test('a switch is off only for the exact value "off", and an unreadable value switches nothing off', async () => {
  const { switchedOffNames } = await load('src/lib/switches.ts');
  assert.deepEqual([...switchedOffNames('{"free":"off","ai":"on","browser":"OFF","search":false}')], ['free']);
  for (const raw of [null, undefined, '', 'off', '["free"]', '{broken', '"free"', '42']) assert.equal(switchedOffNames(raw).size, 0, String(raw));
});

test('switchedOff reads the one KV value at most once a minute per isolate and never throws', async () => {
  const { switchedOff, forgetSwitches, SWITCHES_KEY } = await load('src/lib/switches.ts');
  forgetSwitches();
  const TRIALS = kv({ [SWITCHES_KEY]: '{"free":"off"}' });
  assert.equal(await switchedOff({ TRIALS }, 'free'), true);
  assert.equal(await switchedOff({ TRIALS }, 'ai'), false);
  assert.equal(await switchedOff({ TRIALS }, 'free'), true);
  assert.deepEqual(TRIALS.reads, [SWITCHES_KEY], 'one read serves every question within the minute');
  forgetSwitches();
  assert.equal(await switchedOff({ TRIALS: { get: async () => { throw new Error('KV down'); } } }, 'free'), false, 'a KV failure switches nothing off');
  forgetSwitches();
  assert.equal(await switchedOff({}, 'free'), false, 'no KV binding: nothing is off');
  forgetSwitches();
});

test('a switched-off resource is refused with an uncharged 503 before anything is counted', async () => {
  const { takeDailyBudget } = await load('src/lib/daily-cap.ts');
  const { SWITCHES_KEY } = await load('src/lib/switches.ts');
  // daily-cap.ts bundles its own copy of switches.ts with its own one-minute memo; this is its first and only read.
  const off = kv({ [SWITCHES_KEY]: '{"ai":"off"}' });
  await assert.rejects(() => takeDailyBudget({ TRIALS: off }, 'ai', '1000', 1000, 'AI'), (e) => e.status === 503 && e.code === 'PAUSED_BY_OPERATOR' && /nothing was charged/.test(e.message));
  assert.equal([...off.data.keys()].some((k) => k.startsWith('cap:')), false, 'nothing was counted');
  await takeDailyBudget({ TRIALS: off }, 'browser', '5', 5, 'hosted browser');
  assert.equal([...off.data.keys()].filter((k) => k.startsWith('cap:browser:')).length, 1, 'another resource still runs and is counted');
});

test('an IPv6 caller is one caller per /64, and an IPv4 caller hashes as before', async () => {
  const { callerHash, addressBucket } = await load('src/lib/free-calls.ts');
  const { createHash } = require('node:crypto');
  const old = (ip) => createHash('sha256').update(`free-calls:${ip}`).digest('hex');
  assert.equal(await callerHash('203.0.113.7'), old('203.0.113.7'), 'IPv4 counters carry on');
  assert.equal(await callerHash('unknown'), old('unknown'));
  assert.equal(await callerHash('http:abc'), old('http:abc'), 'a non-address string with a colon is hashed as it is');
  const a = await callerHash('2001:db8:1:2::1'), b = await callerHash('2001:db8:1:2:ffff:ffff:ffff:fffe'), c = await callerHash('2001:db8:1:3::1');
  assert.equal(a, b, 'two addresses of one /64 are one caller');
  assert.notEqual(a, c, 'another /64 is another caller');
  assert.equal(addressBucket('2001:DB8:1:2::1'), '2001:db8:1:2');
  assert.equal(addressBucket(addressBucket('2001:db8:1:2::1')), '2001:db8:1:2', 'bucketing twice changes nothing');
});

test('the signed answers and the evidence bundle are paid only', async () => {
  const { CAPACITY_LIMITED, httpFree } = await load('src/lib/capacity.ts');
  for (const p of ['/answers/page-evidence', '/answers/company-diligence', '/evidence/bundle']) {
    assert.ok(CAPACITY_LIMITED.has(p), p);
    assert.equal(httpFree(p), false, p);
  }
});

test('the front answers 429 itself above the flood limit and never fails a request because of the guard', async () => {
  const front = (await load('src/front/index.ts')).default;
  const ctx = { waitUntil() {} };
  let coreCalls = 0;
  const base = { CORE: { fetch: async () => { coreCalls++; return new Response('core', { status: 200 }); } }, QUOTES: kv(), FRONT: 'off' };
  const ask = (env, ip) => front.fetch(new Request('https://agent-data-tools.revmesh2074.workers.dev/btc-fees', { headers: ip ? { 'cf-connecting-ip': ip } : {} }), env, ctx);
  const keys = [];
  const limiter = (allow) => ({ limit: async ({ key }) => { keys.push(key); return { success: allow(key) }; } });

  const blocked = await ask({ ...base, FLOOD: limiter(() => false) }, '198.51.100.9');
  assert.equal(blocked.status, 429);
  assert.equal(blocked.headers.get('retry-after'), '60');
  assert.equal(blocked.headers.get('cache-control'), 'no-store');
  assert.equal((await blocked.json()).code, 'RATE_LIMITED');
  assert.equal(coreCalls, 0, 'a refused request reaches neither KV nor the core');

  assert.equal((await ask({ ...base, FLOOD: limiter(() => true) }, '198.51.100.9')).status, 200);
  assert.equal((await ask(base, '198.51.100.9')).status, 200, 'no binding: no guard');
  assert.equal((await ask({ ...base, FLOOD: limiter(() => false) }, undefined)).status, 200, 'no address: not counted');
  assert.equal((await ask({ ...base, FLOOD: { limit: async () => { throw new Error('limiter down'); } } }, '198.51.100.9')).status, 200, 'a limiter error lets the request through');

  keys.length = 0;
  await ask({ ...base, FLOOD: limiter(() => true) }, '2001:db8:1:2::1');
  await ask({ ...base, FLOOD: limiter(() => true) }, '2001:DB8:1:2:aaaa:bbbb:cccc:dddd');
  assert.deepEqual(keys, ['2001:db8:1:2', '2001:db8:1:2'], 'an IPv6 caller is counted as its /64');
});

test('staging gives nothing away, and production keeps the tightened voice-key limits', () => {
  const vars = (file) => JSON.parse(readFileSync(file, 'utf8').replace(/^\s*\/\/.*$/gm, '')).vars;
  const staging = vars('wrangler.staging.jsonc');
  for (const name of ['FREE_KEYS', 'VOICE_TEST_KEYS', 'CREDITS_TRIAL', 'TRIALS_ENABLED']) assert.equal(staging[name], 'off', `staging ${name}`);
  assert.equal(staging.NOINDEX, 'on');
  assert.ok(Number(staging.AI_DAILY_CAP) <= 50 && Number(staging.BROWSER_DAILY_CAP) <= 10 && Number(staging.SEARCH_DAILY_CAP) <= 20, 'staging caps cover proofs, not a day of free use');
  assert.equal(staging.NETWORK, 'eip155:84532', 'staging stays on the testnet');
  const production = vars('wrangler.jsonc');
  assert.ok(Number(production.VOICE_TEST_KEYS_PER_DAY) <= 10, 'at most 10 free voice test keys a day');
  assert.equal(production.NOINDEX, undefined);
  const front = JSON.parse(readFileSync('wrangler.front.jsonc', 'utf8').replace(/^\s*\/\/.*$/gm, ''));
  assert.deepEqual(front.ratelimits.map((r) => [r.name, r.simple.period]), [['FLOOD', 60]]);
  assert.ok(front.ratelimits[0].simple.limit >= 600, 'the limit stays far above a directory monitor or a paid burst');
});

test('the worst day of free voice test keys stays under fifty cents', async () => {
  const vk = await load('src/lib/voice-keys.ts');
  const production = JSON.parse(readFileSync('wrangler.jsonc', 'utf8').replace(/^\s*\/\/.*$/gm, '')).vars;
  const calls = Number(production.VOICE_TEST_KEYS_PER_DAY) * vk.VOICE_TEST_CALLS;
  const speech = vk.VOICE_TEST_SPEECH_CALLS_PER_DAY * (vk.VOICE_TEST_SPEECH_CHARS / 1000) * 0.03;
  const audio = calls * (vk.VOICE_TEST_AUDIO_SECONDS / 60) * 0.000513;
  assert.ok(speech + audio < 0.5, `worst day $${(speech + audio).toFixed(2)}`);
});
