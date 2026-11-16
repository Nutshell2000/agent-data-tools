const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const { build } = require('esbuild');

let P;
before(async () => {
  const b = await build({ entryPoints: ['src/routes/packs-daily.ts'], bundle: true, format: 'cjs', platform: 'node', write: false, logLevel: 'silent' });
  const m = { exports: {} };
  new Function('module', 'exports', 'require', b.outputFiles[0].text)(m, m.exports, require);
  P = m.exports;
});

test('daily brief pack: one path, one cent, listing name starts with the phrase buyers type', () => {
  assert.equal(P.PACKS_DAILY.length, 1);
  const e = P.PACKS_DAILY[0];
  assert.equal(e.endpoint.path, '/pack/daily-brief');
  assert.equal(e.endpoint.price, '$0.01');
  assert.match(e.endpoint.summary, /^Daily market brief:/);
  assert.ok(e.endpoint.tags.length >= 5);
  assert.deepEqual(Object.keys(e.endpoint.params).sort(), ['markets', 'stocks', 'tokens']);
});

test('daily brief pack: when every section fails the call is refused and nothing is charged', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('network cut'); };
  try {
    await assert.rejects(P.PACKS_DAILY[0].run({}, (n) => (n === 'stocks' ? 'AAPL' : n === 'tokens' ? 'BTC' : undefined)), (err) => err.status === 502 || /every part/.test(String(err.message)));
  } finally { globalThis.fetch = realFetch; }
});
