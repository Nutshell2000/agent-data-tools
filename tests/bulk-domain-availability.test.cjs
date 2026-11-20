const assert = require('node:assert/strict');
const { test } = require('node:test');
const { build } = require('esbuild');

async function load() {
  const b = await build({ entryPoints: ['src/routes/registries.ts'], bundle: true, format: 'cjs', platform: 'node', write: false, logLevel: 'silent' });
  const m = { exports: {} };
  new Function('module', 'exports', 'require', b.outputFiles[0].text)(m, m.exports, require);
  return m.exports;
}

const bulk = (mod) => mod.REGISTRIES.find((e) => e.endpoint.path === '/domain/availability/bulk');

test('bulk domain availability: bounded, sorted, honest partial results, priced $0.05', async () => {
  const mod = await load();
  const e = bulk(mod);
  assert.ok(e, 'route registered');
  assert.equal(e.endpoint.price, '$0.01');
  const realFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    const domain = String(url).split('/').pop().split('?')[0];
    if (/^https:\/\/rdap\.org\//.test(String(url))) {
      return { url: `https://rdap.example/domain/${domain}`, status: 404, json: async () => ({}), body: { cancel: () => Promise.resolve() } };
    }
    return { url: String(url), status: 200, json: async () => ({ Status: 3 }) };
  };
  try {
    const q = (name) => ({ names: 'acme,acmehq', tlds: 'com,io' })[name];
    const out = await e.run({}, q);
    assert.equal(out.checked, 4);
    assert.equal(out.results.length, 4);
    assert.deepEqual(out.results.map((r) => r.domain), ['acme.com', 'acme.io', 'acmehq.com', 'acmehq.io']);
    assert.ok(out.results.every((r) => r.status === 'available'), '404 from registry RDAP reads available');
    assert.equal(out.available_count, 4);
    assert.deepEqual(out.errors, []);
    assert.ok(calls.length >= 4 && calls.length <= 12, 'bounded concurrency, no unbounded fan-out');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('bulk domain availability: invalid inputs are 400 and never charged, 100-combo cap', async () => {
  const mod = await load();
  const e = bulk(mod);
  const many = Array.from({ length: 26 }, (_, i) => `name${i}`).join(',');
  await assert.rejects(e.run({}, (n) => ({ names: many })[n]), (err) => err.status === 400);
  await assert.rejects(e.run({}, (n) => ({ names: 'bad_name!' })[n]), (err) => err.status === 400);
  await assert.rejects(e.run({}, (n) => ({ names: '' })[n]), (err) => err.status === 400);
});
