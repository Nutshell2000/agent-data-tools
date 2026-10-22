const assert = require('node:assert/strict');
const { test, beforeEach, afterEach } = require('node:test');
const { build } = require('esbuild');

// fetchPublic's retry and edge-cache behaviour, with fetch and caches.default replaced by fakes: no network.
async function load() {
  const b = await build({ entryPoints: ['src/lib/fetch.ts'], bundle: true, format: 'cjs', platform: 'node', write: false, logLevel: 'silent' });
  const m = { exports: {} };
  new Function('module', 'exports', 'require', b.outputFiles[0].text)(m, m.exports, require);
  return m.exports;
}
const realFetch = globalThis.fetch;
const realCaches = globalThis.caches;
let calls;
function answers(...list) {
  calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    const next = list.shift();
    if (next instanceof Error) throw next;
    return next;
  };
}
const ok = (body = 'hello', headers = { 'content-type': 'text/plain' }) => new Response(body, { status: 200, headers });
beforeEach(() => { delete globalThis.caches; });
afterEach(() => { globalThis.fetch = realFetch; if (realCaches) globalThis.caches = realCaches; else delete globalThis.caches; });

test('a target 503 is retried once and the second answer is returned', async () => {
  const { fetchPublic } = await load();
  answers(new Response('busy', { status: 503 }), ok('fine'));
  const res = await fetchPublic(new URL('https://example.com/a'), 'text/plain');
  assert.equal(await res.text(), 'fine');
  assert.equal(calls.length, 2);
});

test('a 429 that asks to wait longer than the budget allows is not retried and is a 502', async () => {
  const { fetchPublic } = await load();
  answers(new Response('slow down', { status: 429, headers: { 'retry-after': '120' } }), ok());
  await assert.rejects(fetchPublic(new URL('https://example.com/a'), 'text/plain'), (e) => e.status === 502);
  assert.equal(calls.length, 1);
});

test('a network error is retried once; a second failure is a 502', async () => {
  const { fetchPublic } = await load();
  answers(new TypeError('fetch failed'), ok('after retry'));
  assert.equal(await (await fetchPublic(new URL('https://example.com/a'), 'text/plain')).text(), 'after retry');
  assert.equal(calls.length, 2);
  answers(new TypeError('fetch failed'), new TypeError('fetch failed'));
  await assert.rejects(fetchPublic(new URL('https://example.com/a'), 'text/plain'), (e) => e.status === 502);
});

test("a target 404 is the caller's input: 422, never retried", async () => {
  const { fetchPublic } = await load();
  answers(new Response('gone', { status: 404 }), ok());
  await assert.rejects(fetchPublic(new URL('https://example.com/missing'), 'text/plain'), (e) => e.status === 422);
  assert.equal(calls.length, 1);
});

test('with cacheSeconds a 2xx answer is kept in caches.default and served without a second fetch, keeping its final URL', async () => {
  const { fetchPublic } = await load();
  const store = new Map();
  globalThis.caches = { default: { match: async (req) => store.get(req.url)?.clone(), put: async (req, res) => { store.set(req.url, res); } } };
  answers(new Response(null, { status: 302, headers: { location: 'https://example.com/final' } }), ok('cached body'));
  const first = await fetchPublic(new URL('https://example.com/start'), 'text/plain', [], { cacheSeconds: 600 });
  assert.equal(await first.text(), 'cached body');
  assert.equal(first.url, 'https://example.com/final');
  assert.equal(calls.length, 2);
  assert.equal(store.size, 1);
  assert.match([...store.values()][0].headers.get('cache-control'), /max-age=600/);
  answers(new Error('must not be called'));
  const second = await fetchPublic(new URL('https://example.com/start'), 'text/plain', [], { cacheSeconds: 600 });
  assert.equal(await second.text(), 'cached body');
  assert.equal(second.url, 'https://example.com/final');
  assert.equal(calls.length, 0);
});

test('allowStatus answers (a 402 probe) are returned as they are and never cached or retried', async () => {
  const { fetchPublic } = await load();
  const store = new Map();
  globalThis.caches = { default: { match: async () => undefined, put: async (req, res) => { store.set(req.url, res); } } };
  answers(new Response('{}', { status: 402, headers: { 'payment-required': 'abc' } }));
  const res = await fetchPublic(new URL('https://example.com/paid'), 'application/json', [402], { cacheSeconds: 600 });
  assert.equal(res.status, 402);
  assert.equal(calls.length, 1);
  assert.equal(store.size, 0);
});
