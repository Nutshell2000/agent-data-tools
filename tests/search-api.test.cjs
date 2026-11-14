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
  assert.equal(lib.toToolQuery('/v1/search', { query: 'x402', contents: { text: { maxCharacters: 1200 } } }).query.textChars, '1200');
  // Larger asks are served with the 20 one request can return, not refused.
  assert.equal(lib.toToolQuery('/v1/search', { query: 'x402', numResults: 50 }).query.count, '20');
  assert.match(lib.toToolQuery('/v1/search', { query: 'x402', numResults: 0 }).error, /whole number/);
  assert.match(lib.toToolQuery('/v1/search', {}).error, /query/);
  // The full neural-search body becomes /search inputs.
  assert.deepEqual(lib.toToolQuery('/v1/search', {
    query: 'stablecoin payments', type: 'neural', numResults: 8, includeDomains: ['x402.org', 'github.com'], excludeDomains: 'reddit.com',
    startPublishedDate: '2025-01-01T00:00:00.000Z', category: 'news', includeText: ['HTTP 402'], excludeText: ['casino'],
    contents: { text: { maxCharacters: 2000 }, highlights: { numSentences: 2, highlightsPerUrl: 2, query: 'fees' }, summary: { query: 'pricing' } },
  }).query, {
    q: 'stablecoin payments', count: '8', includeDomains: 'x402.org,github.com', excludeDomains: 'reddit.com', startPublishedDate: '2025-01-01T00:00:00.000Z',
    category: 'news', includeText: 'HTTP 402', excludeText: 'casino', textChars: '2000', highlights: 'true', numSentences: '2', highlightsPerUrl: '2',
    highlightQuery: 'fees', summary: 'true', summaryQuery: 'pricing',
  });
  assert.deepEqual(lib.toToolQuery('/v1/findSimilar', { url: 'https://x402.org/', numResults: 5, excludeSourceDomain: true, contents: { highlights: true } }).query,
    { url: 'https://x402.org/', excludeSourceDomain: 'true', count: '5', highlights: 'true' });
  // Without a choice the tool's own default (leave the source site out) applies; an explicit false is passed on.
  assert.equal(lib.toToolQuery('/v1/findSimilar', { url: 'https://x402.org/' }).query.excludeSourceDomain, undefined);
  assert.equal(lib.toToolQuery('/v1/findSimilar', { url: 'https://x402.org/', excludeSourceDomain: false }).query.excludeSourceDomain, 'false');
  assert.match(lib.toToolQuery('/v1/findSimilar', {}).error, /url/);
  assert.deepEqual(lib.bodyFromQuery({ url: 'https://x402.org/' }), { url: 'https://x402.org/' });
  assert.deepEqual(lib.toToolQuery('/v1/contents', { ids: ['https://a.example/x,y'], text: { maxCharacters: 2000 } }), { query: { urls: '["https://a.example/x,y"]', maxChars: '2000' }, text: 0 });
  assert.match(lib.toToolQuery('/v1/contents', { urls: ['1', '2', '3', '4', '5', '6'].map((n) => `https://a.example/${n}`) }).error, /at most 5/);
  assert.deepEqual(lib.toToolQuery('/v1/answer', { query: 'What is x402?' }), { query: { q: 'What is x402?' }, text: 0 });
  assert.equal(lib.bodyFromQuery({}), null);
  assert.deepEqual(lib.bodyFromQuery({ query: 'x', text: 'true' }), { query: 'x', text: true });
});

test('search-API answers: results with id, url and title; page text only when asked; answer with citations', async () => {
  const lib = await load();
  const search = { results: [{ title: 'A', url: 'https://a.example/', snippet: 'snip', age: '2 days ago', publishedDate: '2026-11-01T00:00:00.000Z', favicon: 'https://a.example/f.ico' }, { title: 'B', url: 'https://b.example/', snippet: '' }], terms: 'T' };
  const plain = lib.toSearchApi('/v1/search', search);
  assert.deepEqual(plain.results[0], { id: 'https://a.example/', url: 'https://a.example/', title: 'A', publishedDate: '2026-11-01T00:00:00.000Z', author: null, score: null, favicon: 'https://a.example/f.ico', highlights: ['snip'], age: '2 days ago' });
  assert.equal(plain.terms, 'T');
  assert.match(plain.requestId, /^[0-9a-f]{32}$/);
  const withContents = lib.toSearchApi('/v1/search', { results: [{ title: 'A', url: 'https://a.example/', snippet: 's', text: 'page A', highlights: ['h1'], highlightScores: [0.5], summary: 'sum' }], filters: { category: 'news' } });
  assert.deepEqual([withContents.results[0].text, withContents.results[0].highlights, withContents.results[0].highlightScores, withContents.results[0].summary], ['page A', ['h1'], [0.5], 'sum']);
  assert.deepEqual(withContents.filters, { category: 'news' });
  assert.equal(lib.toSearchApi('/v1/findSimilar', { query: 'q used', results: [] }).searchQuery, 'q used');
  const answer = lib.toSearchApi('/v1/answer', { answer: 'x402 is…', sources: [{ n: 1, title: 'x402', url: 'https://x402.org/' }], terms: 'T', model: 'm' });
  assert.deepEqual(answer.citations, [{ id: 'https://x402.org/', url: 'https://x402.org/', title: 'x402' }]);
  const contents = lib.toSearchApi('/v1/contents', { results: [{ id: 'u', url: 'u', text: 't' }], statuses: [{ id: 'u', status: 'success' }] });
  assert.equal(contents.results.length, 1);
});

test('Exa SDK parity (14 Nov 2026): duplicate pages dropped, costDollars, a streamed answer the SDK can read', async () => {
  const lib = await load();
  // Tracking parameters, www, scheme and trailing slash do not make a different page; a real query parameter does.
  assert.equal(lib.pageKey('https://www.firecrawl.dev/?dub_id=abc&via=_root'), lib.pageKey('http://firecrawl.dev'));
  assert.notEqual(lib.pageKey('https://a.example/item?id=1'), lib.pageKey('https://a.example/item?id=2'));
  const out = lib.toSearchApi('/v1/search', { results: [{ title: 'A', url: 'https://www.a.example/' }, { title: 'A again', url: 'https://a.example/?utm_source=x' }, { title: 'B', url: 'https://b.example/' }] });
  assert.deepEqual(out.results.map((r) => r.title), ['A', 'B']);
  // What the caller paid: nothing on a free trial, the key price with a key, the tool price otherwise.
  assert.deepEqual(lib.costDollars('$0.01', '$0.008', 'free'), { total: 0 });
  assert.deepEqual(lib.costDollars('$0.01', '$0.008', 'key'), { total: 0.008 });
  assert.deepEqual(lib.costDollars('$0.01', undefined, 'key'), { total: 0.01 });
  assert.deepEqual(lib.costDollars('$0.01', '$0.008', 'paid'), { total: 0.01 });
  assert.equal(lib.costDollars(undefined, undefined, 'paid'), undefined);
  // The stream is what exa-js streamAnswer parses: delta.content chunks, then citations and cost, then [DONE].
  const sse = lib.answerStream({ requestId: 'r1', answer: 'First sentence. Second one!', citations: [{ id: 'u', url: 'u', title: 't' }], costDollars: { total: 0.01 } });
  const events = sse.split('\n\n').filter(Boolean).map((e) => e.replace(/^data: /, ''));
  assert.equal(events.at(-1), '[DONE]');
  const chunks = events.slice(0, -1).map((e) => JSON.parse(e));
  assert.equal(chunks.filter((c) => c.choices).map((c) => c.choices[0].delta.content).join(''), 'First sentence. Second one!');
  assert.deepEqual(chunks.at(-1), { requestId: 'r1', citations: [{ id: 'u', url: 'u', title: 't' }], costDollars: { total: 0.01 } });
});

test('find similar leaves out pages about the source itself', async () => {
  const b = await build({ entryPoints: ['src/routes/search.ts'], bundle: true, format: 'cjs', platform: 'node', write: false, logLevel: 'silent', external: ['cloudflare:workers'] });
  const m = { exports: {} };
  new Function('module', 'exports', 'require', b.outputFiles[0].text)(m, m.exports, require);
  const { aboutSource } = m.exports;
  for (const u of ['https://www.firecrawl.dev/', 'https://docs.firecrawl.dev/x', 'https://github.com/firecrawl/firecrawl', 'https://www.ycombinator.com/companies/firecrawl', 'https://github.com/mendableai/firecrawl-py'])
    assert.equal(aboutSource(u, 'firecrawl.dev'), true, u);
  for (const u of ['https://www.scrapingbee.com/', 'https://jina.ai/reader/', 'https://apify.com/store', 'https://example.com/firecrawling-guide'])
    assert.equal(aboutSource(u, 'firecrawl.dev'), false, u);
  // Short brands are too common to match inside other URLs.
  assert.equal(aboutSource('https://github.com/x/ai', 'ai.com'), false);
  assert.equal(aboutSource('not a url', 'firecrawl.dev'), false);
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
  for (const [path, body] of [['/v1/search', { query: 'x402', numResults: 3 }], ['/v1/findSimilar', { url: 'https://x402.org/' }], ['/v1/contents', { urls: ['https://example.com'] }], ['/v1/answer', { query: 'What is x402?' }]]) {
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
