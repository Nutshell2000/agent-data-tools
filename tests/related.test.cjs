const assert = require('node:assert/strict');
const { test } = require('node:test');
const { build } = require('esbuild');

async function load() {
  const b = await build({ entryPoints: ['src/lib/related.ts'], bundle: true, format: 'cjs', platform: 'node', write: false, logLevel: 'silent' });
  const m = { exports: {} };
  new Function('module', 'exports', 'require', b.outputFiles[0].text)(m, m.exports, require);
  return m.exports;
}

test('related tools: three others, same category first, best sellers first, never the tool itself', async () => {
  const { relatedTools, relatedLinkHeader, relatedList } = await load();
  const weather = relatedTools('/weather');
  assert.equal(weather.length, 3);
  assert.ok(weather.every((e) => e.path !== '/weather'));
  assert.ok(weather.every((e) => ['/geocode', '/airport/status', '/econ/gdp', '/econ/inflation', '/econ/population', '/econ/unemployment', '/time', '/holidays', '/earthquakes', '/sun', '/moon', '/country', '/npm/downloads', '/pypi'].includes(e.path)), weather.map((e) => e.path).join(','));
  const payee = relatedTools('/check/payee');
  assert.deepEqual(payee.map((e) => e.path), ['/check/counterparty', '/check/x402-seller', '/sanctions/check']);
  const header = relatedLinkHeader('https://api.test', '/btc-fees');
  assert.equal((header.match(/rel="related"/g) ?? []).length, 3);
  assert.match(header, /^<https:\/\/api\.test\/[a-z/-]+>; rel="related"; title="[^"]+"/);
  const list = relatedList('https://api.test', '/btc-fees');
  assert.equal(list.length, 3);
  for (const r of list) { assert.match(r.url, /^https:\/\/api\.test\//); assert.match(r.price, /^\$\d/); assert.ok(r.name.length <= 32); }
});
