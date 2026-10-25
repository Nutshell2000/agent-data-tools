const assert = require('node:assert/strict');
const { before, after, test } = require('node:test');
const { build } = require('esbuild');
const { Miniflare, convertV4MiniflareOptions } = require('miniflare');

async function load() {
  const b = await build({ entryPoints: ['src/lib/search-api.ts'], bundle: true, format: 'cjs', platform: 'node', write: false, logLevel: 'silent' });
  const m = { exports: {} };
  new Function('module', 'exports', 'require', b.outputFiles[0].text)(m, m.exports, require);
  return m.exports;
}

test('search-API bodies map onto our tools; bad bodies are named', async () => {
  const lib = await load();
  assert.deepEqual(lib.toToolQuery('/v1/search', { query: ' x402 ', numResults: 5 }), { query: { q: 'x402', count: '5' }, text: 0 });
  assert.equal(lib.toToolQuery('/v1/search', { query: 'x402', contents: { text: true } }).text, 3000);
  assert.equal(lib.toToolQuery('/v1/search', { query: 'x402', contents: { text: { maxCharacters: 1200 } } }).text, 1200);
  assert.match(lib.toToolQuery('/v1/search', { query: 'x402', numResults: 50 }).error, /1 to 20/);
  assert.match(lib.toToolQuery('/v1/search', {}).error, /query/);
  assert.deepEqual(lib.toToolQuery('/v1/contents', { ids: ['https://a.example/x,y'], text: { maxCharacters: 2000 } }), { query: { urls: '["https://a.example/x,y"]', maxChars: '2000' }, text: 0 });
  assert.match(lib.toToolQuery('/v1/contents', { urls: ['1', '2', '3', '4', '5', '6'].map((n) => `https://a.example/${n}`) }).error, /at most 5/);
  assert.deepEqual(lib.toToolQuery('/v1/answer', { query: 'What is x402?' }), { query: { q: 'What is x402?' }, text: 0 });
  assert.equal(lib.bodyFromQuery({}), null);
  assert.deepEqual(lib.bodyFromQuery({ query: 'x', text: 'true' }), { query: 'x', text: true });
});

test('search-API answers: results with id, url and title; page text only when asked; answer with citations', async () => {
  const lib = await load();
  const search = { results: [{ title: 'A', url: 'https://a.example/', snippet: 'snip', age: '2 days ago' }, { title: 'B', url: 'https://b.example/', snippet: '' }], terms: 'T' };
  const plain = await lib.toSearchApi('/v1/search', search, 0, async () => { throw new Error('not called'); });
  assert.deepEqual(plain.results[0], { id: 'https://a.example/', url: 'https://a.example/', title: 'A', publishedDate: null, author: null, score: null, highlights: ['snip'], age: '2 days ago' });
  assert.equal(plain.terms, 'T');
  assert.match(plain.requestId, /^[0-9a-f]{32}$/);
  const withText = await lib.toSearchApi('/v1/search', search, 1500, async (url) => (url.startsWith('https://a') ? { text: 'page A' } : Promise.reject(new Error('blocked'))));
  assert.deepEqual(withText.results.map((r) => r.text), ['page A', '']);
  const answer = await lib.toSearchApi('/v1/answer', { answer: 'x402 is…', sources: [{ n: 1, title: 'x402', url: 'https://x402.org/' }], terms: 'T', model: 'm' }, 0);
  assert.deepEqual(answer.citations, [{ id: 'https://x402.org/', url: 'https://x402.org/', title: 'x402' }]);
  const contents = await lib.toSearchApi('/v1/contents', { results: [{ id: 'u', url: 'u', text: 't' }], statuses: [{ id: 'u', status: 'success' }] }, 0);
  assert.equal(contents.results.length, 1);
});

let mf;
before(async () => {
  const b = await build({ entryPoints: ['src/index.ts'], bundle: true, format: 'esm', platform: 'browser', write: false, external: ['cloudflare:workers', 'node:*'],
    plugins: [{ name: 'url', setup(b) { b.onResolve({ filter: /^url$/ }, () => ({ path: 'node:url', external: true })); } }] });
  mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: b.outputFiles[0].text, compatibilityDate: '2026-09-01', compatibilityFlags: ['nodejs_compat'],
    durableObjects: { METRICS: { className: 'Metrics', useSQLite: true } },
    bindings: { PAY_TO: '0x2074c40346ae2a90e0e4a391bcee6f16bf5277f5', NETWORK: 'eip155:8453', PAYWALL: 'on', FACILITATOR_URL: 'https://fixture.invalid', BASE_RPC_URL: 'https://fixture.invalid' },
    outboundService: async (r) => (new URL(r.url).hostname === 'fixture.invalid'
      ? Response.json({ kinds: [{ x402Version: 2, scheme: 'exact', network: 'eip155:8453', extra: { name: 'USD Coin', version: '2' } }], extensions: [] })
      : new Response('no', { status: 404 })) }));
});
after(async () => { await mf?.dispose(); });

test('an unpaid search-API request is quoted under its own path at the tool price', async () => {
  for (const [path, body] of [['/v1/search', { query: 'x402', numResults: 3 }], ['/v1/contents', { urls: ['https://example.com'] }], ['/v1/answer', { query: 'What is x402?' }]]) {
    const r = await mf.dispatchFetch(`https://api.test${path}`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(body) });
    assert.equal(r.status, 402, path);
    const quote = JSON.parse(Buffer.from(r.headers.get('payment-required'), 'base64').toString());
    assert.equal(new URL(quote.resource.url).pathname, path, path);
    assert.equal(quote.accepts[0].amount, '10000', path);
    await r.body?.cancel();
  }
  const bad = await mf.dispatchFetch('https://api.test/v1/search', { method: 'POST', headers: { 'content-type': 'application/json', 'payment-signature': 'x' }, body: JSON.stringify({ numResults: 3 }) });
  assert.equal(bad.status, 400);
});
