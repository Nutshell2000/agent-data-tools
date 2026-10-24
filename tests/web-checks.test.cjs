const assert = require('node:assert/strict');
const { test, before, after } = require('node:test');
const { build } = require('esbuild');

let W;
const realFetch = globalThis.fetch;
let handler;
const requested = [];
before(async () => {
  const b = await build({ entryPoints: ['src/routes/web-checks.ts'], bundle: true, format: 'cjs', platform: 'node', write: false, logLevel: 'silent' });
  const m = { exports: {} };
  new Function('module', 'exports', 'require', b.outputFiles[0].text)(m, m.exports, require);
  W = m.exports;
  globalThis.fetch = async (url, init) => { requested.push(String(url)); return handler(String(url), init); };
});
after(() => { globalThis.fetch = realFetch; });
const run = async (path, params = {}) => W.WEB_CHECKS.find((f) => f.endpoint.path === path).run({}, (n) => params[n]);
const redirect = (to, status = 301) => new Response(null, { status, headers: { location: to } });

test('redirects: chain, loop, private targets are reported and never requested', async () => {
  handler = (url) => url === 'http://a.example/' ? redirect('https://a.example/') : url === 'https://a.example/' ? redirect('/home', 302) : new Response('ok', { headers: { 'content-type': 'text/html' } });
  const out = await run('/url/redirects', { url: 'http://a.example/' });
  assert.equal(out.finalUrl, 'https://a.example/home');
  assert.equal(out.redirects, 2);
  assert.deepEqual(out.hops.map((h) => h.status), [301, 302, 200]);
  handler = (url) => redirect(url.endsWith('/x') ? 'https://b.example/y' : 'https://b.example/x');
  const loop = await run('/url/redirects', { url: 'https://b.example/x' });
  assert.equal(loop.loop, true);
  requested.length = 0;
  handler = () => redirect('http://127.0.0.1/admin');
  const priv = await run('/url/redirects', { url: 'https://c.example/' });
  assert.match(priv.error, /private/);
  assert.ok(!requested.some((u) => u.includes('127.0.0.1')));
  await assert.rejects(run('/url/redirects', { url: 'http://localhost/' }), (e) => e.status === 400);
});

test('uptime: up with timing and contains check; failures are down, not errors', async () => {
  handler = () => new Response('<html>Hello Wikipedia</html>', { headers: { 'content-type': 'text/html; charset=utf-8', server: 'test' } });
  const up = await run('/url/uptime', { url: 'https://d.example/', contains: 'wikipedia' });
  assert.equal(up.up, true);
  assert.equal(up.contains.found, true);
  assert.equal(up.contentType, 'text/html');
  handler = () => new Response('nope', { status: 503 });
  const down = await run('/url/uptime', { url: 'https://d.example/' });
  assert.equal(down.up, false);
  assert.equal(down.reason, 'HTTP 503');
  handler = () => { throw new TypeError('fetch failed'); };
  const dead = await run('/url/uptime', { url: 'https://e.example/' });
  assert.equal(dead.up, false);
  assert.match(dead.reason, /could not be reached/);
});

test('dns: host input, record types, propagation majority and disagreement', async () => {
  assert.equal(W.hostInput('https://Example.COM/path'), 'example.com');
  assert.throws(() => W.hostInput('not a domain'), (e) => e.status === 400);
  handler = (url) => {
    const ip = url.includes('alidns') ? '9.9.9.9' : '1.2.3.4';
    return new Response(JSON.stringify({ Status: 0, AD: true, Answer: [{ name: 'example.com.', type: 1, TTL: 60, data: ip }] }));
  };
  const one = await run('/dns/lookup', { name: 'example.com', type: 'a' });
  assert.deepEqual(one.answers, [{ data: '1.2.3.4', ttl: 60 }]);
  assert.equal(one.status, 'NOERROR');
  const p = await run('/dns/propagation', { name: 'example.com' });
  assert.equal(p.propagated, false);
  assert.equal(p.agreeing, 4);
  assert.deepEqual(p.majority, ['1.2.3.4']);
  await assert.rejects(run('/dns/lookup', { name: 'example.com', type: 'zz' }), (e) => e.status === 400);
});

test('seo audit: fields, bare alt is fine, issues and score', () => {
  const html = '<html lang="en"><head><title>A good title for this page about agents</title><meta name="description" content="' + 'x'.repeat(100) + '"><link rel="canonical" href="https://f.example/"><meta name="viewport" content="width=device-width"><meta property="og:title" content="T"><meta property="og:image" content="https://f.example/i.png"><script type="application/ld+json">{}</script></head><body><h1>Agents</h1><h2>a</h2><img src="a.png" alt><img src="b.png"><a href="/x">x</a><a href="https://other.example/">y</a>' + ' word'.repeat(400) + '</body></html>';
  const r = W.seoAudit(html, 'https://f.example/');
  assert.equal(r.titleLength, 39);
  assert.equal(r.canonical, 'https://f.example/');
  assert.equal(r.imagesWithoutAlt, 1);
  assert.deepEqual(r.links, { internal: 1, external: 1 });
  assert.deepEqual(r.issues, ['1 of 2 images have no alt text']);
  assert.equal(r.score, 91);
  const bare = W.seoAudit('<html><body><p>hi</p></body></html>', 'https://g.example/');
  assert.ok(bare.issues.includes('missing <title>') && bare.issues.includes('no <h1>'));
});

test('keyword density: stop words removed, phrases repeated at least twice, empty text refused', async () => {
  const k = W.keywordDensity('Agents pay per call. Agents pay with USDC. Pay per call tools for agents.', 5);
  assert.equal(k.totalWords, 14);
  assert.equal(k.keywords[0].count, 3);
  assert.ok(k.phrases.every((p) => p.count >= 2));
  assert.throws(() => W.keywordDensity('123 456', 5), (e) => e.status === 422);
  await assert.rejects(run('/text/keyword-density', {}), (e) => e.status === 400);
});
