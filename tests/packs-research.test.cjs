const assert = require('node:assert/strict');
const { test } = require('node:test');
const { build } = require('esbuild');

async function load() {
  const b = await build({ entryPoints: ['src/routes/packs-research.ts'], bundle: true, format: 'cjs', platform: 'node', write: false, logLevel: 'silent' });
  const m = { exports: {} };
  new Function('module', 'exports', 'require', b.outputFiles[0].text)(m, m.exports, require);
  return m.exports;
}

test('url safety signals: bare IPs, punycode, new domains, plain HTTP, user@host and long chains', async () => {
  const { urlSignals } = await load();
  const u = (s) => new URL(s);
  assert.deepEqual(urlSignals(u('https://github.com/'), u('https://github.com/'), ['github.com'], 6000), { risk: 'low', signals: [] });
  const ip = urlSignals(u('http://192.0.2.1/login'), u('http://192.0.2.1/login'), ['192.0.2.1'], null);
  assert.equal(ip.risk, 'high');
  assert.deepEqual(ip.signals.map((s) => s.code), ['ip_host', 'no_https']);
  assert.equal(urlSignals(u('https://xn--80ak6aa92e.com/'), u('https://xn--80ak6aa92e.com/'), ['xn--80ak6aa92e.com'], 900).risk, 'medium');
  assert.equal(urlSignals(u('https://fresh.example/'), u('https://fresh.example/'), ['fresh.example'], 3).signals[0].code, 'very_new_domain');
  assert.ok(urlSignals(u('https://paypal.com@evil.example/'), u('https://evil.example/'), ['evil.example'], 900).signals.some((s) => s.code === 'userinfo'));
  assert.ok(urlSignals(u('https://a.example/'), u('https://d.example/'), ['a.example', 'b.example', 'c.example', 'd.example'], 900).signals.some((s) => s.code === 'cross_domain_redirects'));
});

test('research packs: names within 32 characters, descriptions within 450, one cent, inputs checked before any request', async () => {
  const { PACKS_RESEARCH } = await load();
  assert.deepEqual(PACKS_RESEARCH.map((e) => e.endpoint.path), ['/pack/web-research', '/pack/news-sentiment', '/pack/url-safety']);
  for (const e of PACKS_RESEARCH) {
    assert.ok(e.endpoint.summary.split(':')[0].length <= 32, e.endpoint.summary);
    assert.ok(e.endpoint.description.length <= 450, `${e.endpoint.path} ${e.endpoint.description.length}`);
    assert.equal(e.endpoint.price, '$0.01');
    await assert.rejects(Promise.resolve().then(() => e.run({}, () => undefined)), (err) => err.status === 400, e.endpoint.path);
  }
  await assert.rejects(Promise.resolve().then(() => PACKS_RESEARCH[2].run({}, (n) => (n === 'url' ? 'http://127.0.0.1/' : undefined))), (err) => err.status === 400);
});
