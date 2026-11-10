// 1.114.0 (10 Nov 2026): /fx, /fx/rates and /price/tokens answer an HTTP call with no input at all for their reference
// default (1 USD; BTC and ETH), with a note. The structure of every EMPTY_CALL_DEFAULTS entry is checked in
// tests/buyer-fixes-1111.test.cjs; this file checks what the new entries do.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { build } = require('esbuild');

async function load(entry) {
  const b = await build({ entryPoints: [entry], bundle: true, format: 'cjs', platform: 'node', write: false, logLevel: 'silent' });
  const m = { exports: {} };
  new Function('module', 'exports', 'require', b.outputFiles[0].text)(m, m.exports, require);
  return m.exports;
}

test('empty call: /fx and its door answer for 1 USD with a note; a sent input is used as before; no flag is the plain 400', async () => {
  const T = await load('src/tools.ts');
  const env = new Proxy({}, { get: () => undefined });
  const realFetch = globalThis.fetch;
  const asked = [];
  // The ECB rates source, answered here: whatever base the tool asks for comes back with two rates.
  globalThis.fetch = async (url) => {
    asked.push(String(url));
    const base = /(?:from|base)=([A-Z]{3})/.exec(String(url))?.[1] ?? 'EUR';
    return new Response(JSON.stringify({ amount: 1, base, date: '2026-11-10', rates: { GBP: 0.76, SEK: 10.1 } }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    for (const path of ['/fx', '/fx/rates']) {
      asked.length = 0;
      const out = await T.TOOLS[path](env, (n) => (n === T.NO_INPUT ? '1' : undefined));
      assert.equal(out.from, 'USD', `${path} answers for USD`);
      assert.match(out.note, /^No input was sent, so these are the exchange rates for 1 USD/);
      assert.ok(asked.some((u) => /USD/.test(u)), `${path} asked the source for USD`);
      // Anything the caller sent is used and carries no note.
      const eur = await T.TOOLS[path](env, (n) => ({ from: 'EUR' })[n]);
      assert.equal(eur.from, 'EUR');
      assert.equal(eur.note, undefined);
      // Without the route's flag (MCP, packs, a misspelled input) the refusal is unchanged.
      await assert.rejects(T.TOOLS[path](env, () => undefined), (e) => e.status === 400);
    }
  } finally { globalThis.fetch = realFetch; }
});

test('empty call: /price/tokens gets past its input check only on the flag', async () => {
  const T = await load('src/tools.ts');
  const env = new Proxy({}, { get: () => undefined });
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('NET'); };
  try {
    await assert.rejects(T.TOOLS['/price/tokens'](env, () => undefined), (e) => e.status === 400 && /1 to 20 tokens/.test(e.message));
    await assert.rejects(Promise.race([T.TOOLS['/price/tokens'](env, (n) => (n === T.NO_INPUT ? '1' : undefined)), new Promise((_, r) => setTimeout(() => r(Object.assign(new Error('NET timeout'), { status: 599 })), 1500))]), (e) => e.status !== 400);
  } finally { globalThis.fetch = realFetch; }
  assert.deepEqual(T.EMPTY_CALL_DEFAULTS['/price/tokens'].input, { symbols: 'BTC,ETH' });
});

test('paycheck.json: every known-answer test is a pure-computation tool on its published example, and the tool gives that answer', async () => {
  const { KNOWN_ANSWER_TESTS, paycheckDeclaration } = await load('src/lib/payout-wallets.ts');
  const T = await load('src/tools.ts');
  const { ENDPOINTS, exampleParams } = await load('src/endpoints.ts');
  const { LOCAL_PATHS } = await load('src/families.ts');
  assert.equal(paycheckDeclaration({ PAY_TO: '', TEMPO_PAY_TO: '', SOLANA_PAY_TO: '' }).tests, KNOWN_ANSWER_TESTS);
  assert.ok(Object.keys(KNOWN_ANSWER_TESTS).length >= 11);
  const env = new Proxy({}, { get: () => undefined });
  const realFetch = globalThis.fetch;
  // No test may depend on anything outside the tool: the network is cut for the whole run.
  globalThis.fetch = async () => { throw new Error('NET'); };
  try {
    for (const [path, tests] of Object.entries(KNOWN_ANSWER_TESTS)) {
      const e = ENDPOINTS.find((x) => x.path === path);
      assert.ok(e, `${path} is a tool`);
      assert.ok(LOCAL_PATHS.has(path), `${path} is pure computation`);
      const example = Object.fromEntries(exampleParams(e).map(([k, p]) => [k, String(p.example)]));
      for (const t of tests) {
        // The test asks what the listing's own example asks, so a checker and a buyer copying the example agree.
        assert.deepEqual(t.query, example, `${path}: the test query is the published example`);
        const out = await T.TOOLS[path](env, (n) => t.query[n]);
        assert.ok(t.expect.length >= 1, path);
        for (const x of t.expect) {
          assert.match(x.path, /^\$\.[A-Za-z0-9_]+$/, `${path}: a top-level field`);
          assert.deepEqual(out[x.path.slice(2)], x.equals, `${path} ${t.name}: ${x.path}`);
        }
      }
    }
  } finally { globalThis.fetch = realFetch; }
});