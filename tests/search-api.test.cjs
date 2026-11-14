const assert = require('node:assert/strict');
const { before, after, test } = require('node:test');
const { build } = require('esbuild');
const { Miniflare, convertV4MiniflareOptions } = require('miniflare');

async function load() {
  const b = await build({ entryPoints: ['src/lib/search-api.ts'], bundle: true, format: 'cjs', platform: 'node', write: false, logLevel: 'silent', external: ['cloudflare:workers'] });
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

test('an Exa search for EU law (category law, or only eur-lex.europa.eu) goes to the EU law index', async () => {
  const lib = await load();
  assert.deepEqual(lib.toToolQuery('/v1/search', { query: 'lawful processing', category: 'law', numResults: 3 }), { query: { q: 'lawful processing', count: '3' }, text: 0, tool: '/law/search' });
  assert.equal(lib.toToolQuery('/v1/search', { query: 'x', includeDomains: ['https://eur-lex.europa.eu/'] }).tool, '/law/search');
  assert.equal(lib.toToolQuery('/v1/search', { query: 'x', includeDomains: ['eur-lex.europa.eu', 'github.com'] }).tool, undefined);
  assert.equal(lib.toToolQuery('/v1/search', { query: 'x', category: 'news' }).tool, undefined);
  const out = lib.toSearchApi('/v1/search', { results: [{ citation: 'GDPR, Article 6', heading: 'Lawfulness of processing', text: '1. Processing shall be lawful only if…', url: 'https://eur-lex.europa.eu/x#art_6', version: 'consolidated text of 2016-05-04', score: 1.02 }], attribution: 'A' }, '/law/search');
  assert.equal(out.results[0].title, 'GDPR, Article 6: Lawfulness of processing');
  assert.equal(out.results[0].text, '1. Processing shall be lawful only if…');
  assert.equal(out.resolvedSearchType, 'eu-law-index');
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

test('Exa categories company, research paper and github go to sources of record, not the web search', async () => {
  const lib = await load();
  assert.deepEqual(lib.toToolQuery('/v1/search', { query: 'Spotify', category: 'company', numResults: 5 }), { query: { q: 'Spotify', limit: '5' }, text: 0, tool: '/company/search' });
  // A description of companies is not a name: a register cannot answer it, so it stays on the web search.
  assert.equal(lib.toToolQuery('/v1/search', { query: 'AI startups in Berlin', category: 'company' }).tool, undefined);
  assert.equal(lib.toToolQuery('/v1/search', { query: 'companies like Klarna', category: 'company' }).tool, undefined);
  assert.equal(lib.toToolQuery('/v1/search', { query: 'Volvo', category: 'company', includeDomains: ['volvo.com'] }).tool, undefined);
  assert.equal(lib.toToolQuery('/v1/search', { query: 'Volvo', category: 'company', includeText: 'trucks' }).tool, undefined);
  const paper = lib.toToolQuery('/v1/search', { query: 'retrieval augmented generation', category: 'research paper', startPublishedDate: '2023-01-01T00:00:00.000Z', contents: { text: true } });
  assert.deepEqual(paper, { query: { query: 'retrieval augmented generation', limit: '10', fromYear: '2023' }, text: 3000, tool: '/papers' });
  assert.equal(lib.toToolQuery('/v1/search', { query: 'attention', category: 'papers', includeDomains: ['arxiv.org'] }).tool, '/arxiv/search');
  assert.equal(lib.toToolQuery('/v1/search', { query: 'attention', category: 'research paper', includeDomains: ['nature.com'] }).tool, undefined);
  assert.deepEqual(lib.toToolQuery('/v1/search', { query: 'vector database', category: 'github', numResults: 50, excludeDomains: ['x.com'] }), { query: { q: 'vector database', count: '20' }, text: 0, tool: '/github/search', ignored: ['excludeDomains: results come from a source of record, not web pages'] });
  assert.equal(lib.looksLikeCompanyName('Bank of America'), true);
  assert.equal(lib.looksLikeCompanyName('best payroll software vendors'), false);
});

test('register, paper, arXiv and GitHub answers take the neural-search shape; companies carry register entities', async () => {
  const lib = await load();
  const co = lib.toSearchApi('/v1/search', { results: [{ name: 'Spotify AB', country: 'SE', idType: 'organisationsnummer', id: '556703-7485', legalForm: 'Aktiebolag', city: 'STOCKHOLM', exact: true, details: '/se/company?orgnr=556703-7485', lei: '5493004INDUJX1TDHI57', source: 'Bolagsverket and SCB (Sweden)' }], retrievedAt: '2026-11-14T00:00:00.000Z', note: 'N', searched: ['SE'] }, '/company/search', { text: 500, origin: 'https://o' });
  assert.equal(co.resolvedSearchType, 'company-registers');
  assert.equal(co.results[0].url, 'https://search.gleif.org/#/record/5493004INDUJX1TDHI57');
  assert.equal(co.results[0].entities[0].type, 'company');
  assert.equal(co.results[0].entities[0].properties.registration.id, '556703-7485');
  assert.equal(co.results[0].entities[0].properties.headquarters.country, 'Sweden');
  assert.equal(co.results[0].entities[0].properties.headquarters.countryCode, 'SE');
  assert.match(co.results[0].text, /organisationsnummer 556703-7485/);
  const noText = lib.toSearchApi('/v1/search', { results: [{ name: 'X Oy', country: 'FI', details: '/fi/company?id=1' }] }, '/company/search', { origin: 'https://o' });
  assert.equal(noText.results[0].url, 'https://o/fi/company?id=1');
  assert.equal(noText.results[0].text, undefined);
  const pa = lib.toSearchApi('/v1/search', { results: [{ title: 'RAG', authors: ['A', 'B'], year: 2020, doi: '10.1/x', url: 'https://doi.org/10.1/x', abstract: 'Long abstract', citations: 9 }, { title: 'no link' }], source: 'OpenAlex' }, '/papers', { text: 4 });
  assert.equal(pa.results.length, 1);
  assert.equal(pa.results[0].text, 'Long');
  assert.equal(pa.results[0].author, 'A, B');
  assert.equal(pa.results[0].year, 2020);
  const ax = lib.toSearchApi('/v1/search', { papers: [{ id: '2005.11401', title: 'RAG', summary: 'S', authors: ['P'], published: '2020-05-22', url: 'https://arxiv.org/abs/2005.11401' }] }, '/arxiv/search', {});
  assert.equal(ax.results[0].publishedDate, '2020-05-22T00:00:00.000Z');
  const gh = lib.toSearchApi('/v1/search', { repos: [{ repo: 'coinbase/x402', url: 'https://github.com/coinbase/x402', description: 'Payments', stars: 5, language: 'TypeScript', pushedAt: '2026-11-09T22:10:44Z' }] }, '/github/search', {});
  assert.equal(gh.results[0].title, 'coinbase/x402');
  assert.equal(gh.results[0].author, null);
});