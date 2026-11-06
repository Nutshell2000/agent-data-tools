// Search API 2.0 (6 Nov 2026): filters as operators and post-filters, highlights, contents enrichment, find-similar
// queries, and the archived-copy fallback of the page reader.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { build } = require('esbuild');

async function load(entry) {
  const b = await build({ entryPoints: [entry], bundle: true, format: 'cjs', platform: 'node', write: false, logLevel: 'silent' });
  const m = { exports: {} };
  new Function('module', 'exports', 'require', b.outputFiles[0].text)(m, m.exports, require);
  return m.exports;
}

const kv = () => { const s = new Map(); return { get: async (k) => s.get(k) ?? null, put: async (k, v) => { s.set(k, v); } }; };
const env = () => ({ SEARCH_API_KEY: 'k', TRIALS: kv() });
const brave = (results) => Response.json({ web: { results } });

test('domain lists, categories and dates are read the way agents send them', async () => {
  const s = await load('src/routes/search.ts');
  assert.deepEqual(s.domainList('["https://www.X402.org/", "github.com/coinbase"]'), ['x402.org', 'github.com/coinbase']);
  assert.deepEqual(s.domainList('a.com, b.org\nc.net'), ['a.com', 'b.org', 'c.net']);
  assert.deepEqual(s.domainList('not a domain'), []);
  assert.equal(s.categoryOf('Research_Paper'), 'research paper');
  assert.equal(s.categoryOf('papers'), 'research paper');
  assert.equal(s.categoryOf('tweets'), 'tweet');
  assert.equal(s.categoryOf('constructor'), null);
  assert.equal(s.categoryOf(undefined), undefined);
  assert.equal(s.dayOf('2025-01-31T12:00:00.000Z'), '2025-01-31');
  assert.equal(s.dayOf('1735689600'), '2025-01-01');
  assert.equal(s.dayOf('soon'), null);
});

test('webSearch sends filters as operators and still enforces them on the results', async () => {
  const s = await load('src/routes/search.ts');
  let sent;
  const fetcher = async (url) => {
    sent = new URL(url);
    return brave([
      { title: 'Spec', url: 'https://www.x402.org/spec', description: 'The <strong>x402</strong> spec', page_age: '2026-10-01T00:00:00', meta_url: { hostname: 'www.x402.org', favicon: 'https://imgs/f.png' } },
      { title: 'Repo', url: 'https://github.com/coinbase/x402', description: 'code', page_age: '2024-01-01T00:00:00' },
      { title: 'Spam', url: 'https://spam.example/x402', description: 'casino x402' },
      { title: 'Other', url: 'https://docs.example.com/', description: 'docs' },
    ]);
  };
  const out = await s.webSearch(env(), { query: 'x402', count: 5, includeDomains: ['x402.org', 'github.com'], excludeDomains: ['spam.example'], startPublishedDate: '2025-01-01', excludeText: 'casino' }, fetcher);
  assert.equal(sent.searchParams.get('q'), 'x402 (site:x402.org OR site:github.com) -site:spam.example -"casino"');
  assert.match(sent.searchParams.get('freshness'), /^2025-01-01to\d{4}-\d{2}-\d{2}$/);
  assert.equal(sent.searchParams.get('count'), '20');
  // github.com/coinbase/x402 is from 2024, before the start date; docs.example.com is on no listed domain.
  assert.deepEqual(out.hits.map((h) => h.url), ['https://www.x402.org/spec']);
  assert.deepEqual(out.hits[0], { title: 'Spec', url: 'https://www.x402.org/spec', snippet: 'The x402 spec', age: null, publishedDate: '2026-10-01T00:00:00.000Z', author: null, domain: 'x402.org', favicon: 'https://imgs/f.png', image: null });

  // A news category uses the news index; a LinkedIn profile search keeps /in/ pages only.
  await s.webSearch(env(), { query: 'bitcoin', count: 3, category: 'news' }, async (url) => { sent = new URL(url); return Response.json({ results: [] }); });
  assert.equal(sent.pathname, '/res/v1/news/search');
  const people = await s.webSearch(env(), { query: 'Jane Doe', count: 3, category: 'linkedin profile' }, async (url) => { sent = new URL(url); return brave([{ title: 'Jane', url: 'https://www.linkedin.com/in/jane' }, { title: 'Co', url: 'https://www.linkedin.com/company/x' }]); });
  assert.equal(sent.searchParams.get('q'), 'Jane Doe site:linkedin.com');
  assert.deepEqual(people.hits.map((h) => h.url), ['https://www.linkedin.com/in/jane']);

  // Upstream trouble is an uncharged 503.
  await assert.rejects(s.webSearch(env(), { query: 'x', count: 1 }, async () => new Response('', { status: 500 })), (e) => e.status === 503);
  await assert.rejects(s.webSearch({ TRIALS: kv() }, { query: 'x', count: 1 }, fetcher), (e) => e.status === 503);
});

test('highlights pick the passages that match the query, with scores', async () => {
  const c = await load('src/lib/search-contents.ts');
  const text = 'Welcome to our site. We sell shoes and hats in many colours. ' +
    'The x402 protocol lets an API charge per request in stablecoins. Payments settle on Base in seconds. ' +
    'Our shipping takes three days. Returns are free within thirty days of purchase.';
  const one = c.highlights(text, 'x402 stablecoin payments', 2, 1);
  assert.equal(one.highlights.length, 1);
  assert.match(one.highlights[0], /x402 protocol/);
  assert.match(one.highlights[0], /Payments settle/);
  assert.ok(one.scores[0] > 0.6 && one.scores[0] <= 1);
  const two = c.highlights(text, 'shipping returns', 1, 2);
  assert.equal(two.highlights.length, 2);
  assert.ok(two.highlights.every((h) => /shipping|Returns/.test(h)));
  assert.deepEqual(c.highlights('', 'x', 3, 1), { highlights: [], scores: [] });
  // Navigation chrome is never a highlight, however many query words it holds.
  const gh = 'Repository navigation [Image alt text: x402-foundation] x402 Public - Notifications - Fork (2.3k) - Star (6.8k) About A payments protocol for the internet. ' +
    'The x402 payments protocol is built on HTTP and lets clients pay per request.';
  assert.deepEqual(c.highlights(gh, 'x402 payments protocol', 1, 1).highlights, ['The x402 payments protocol is built on HTTP and lets clients pay per request.']);
  assert.deepEqual(c.queryTerms('What is the x402 payment protocol?'), ['x402', 'payment', 'protocol']);
});

test('enrich reads, highlights and summarizes the top pages and keeps the snippet when a page fails', async () => {
  const c = await load('src/lib/search-contents.ts');
  const hits = [
    { title: 'A', url: 'https://a.example/', snippet: 'snippet A', age: null, publishedDate: null, author: null, domain: 'a.example', favicon: null, image: null },
    { title: 'B', url: 'https://b.example/', snippet: 'snippet B', age: null, publishedDate: null, author: null, domain: 'b.example', favicon: null, image: null },
    { title: 'C', url: 'https://c.example/', snippet: 'snippet C', age: null, publishedDate: null, author: null, domain: 'c.example', favicon: null, image: null },
  ];
  const reads = [];
  const read = async (url, chars) => {
    reads.push([url, chars]);
    if (url.startsWith('https://b')) throw new Error('target did not respond');
    return { text: 'Stablecoin payments over HTTP are simple. Each request carries a signed payment header today.', sourceMetadata: { authors: [{ value: 'Ada' }], dates: [{ value: '2026-10-30', kind: 'published' }] } };
  };
  const summarize = async (text, title, focus) => `${title} about ${focus}`;
  const out = await c.enrich(hits, 'stablecoin payments', { textChars: 40, numSentences: 1, highlightsPerUrl: 1, summary: true, readTop: 2 }, read, summarize);
  assert.deepEqual(reads.map((r) => r[0]), ['https://a.example/', 'https://b.example/']);
  assert.equal(reads[0][1], 12000);
  assert.equal(out[0].text, 'Stablecoin payments over HTTP are simple');
  assert.equal(out[0].author, 'Ada');
  assert.equal(out[0].publishedDate, '2026-10-30T00:00:00.000Z');
  assert.match(out[0].highlights[0], /^Stablecoin payments/);
  assert.equal(out[0].summary, 'A about stablecoin payments');
  // The failed page keeps its snippet and says why; the third was not read at all.
  assert.equal(out[1].text, 'snippet B');
  assert.deepEqual(out[1].highlights, ['snippet B']);
  assert.equal(out[1].summary, null);
  assert.match(out[1].readError, /did not respond/);
  assert.equal(out[2].readError, undefined);
  // Nothing asked, nothing read.
  assert.equal((await c.enrich(hits, 'q', { textChars: 0, numSentences: 0, highlightsPerUrl: 1, summary: false, readTop: 3 }, async () => { throw new Error('not called'); }, summarize)).length, 3);
});

test('similarQuery builds a search from the page title and topic words', async () => {
  const s = await load('src/routes/search.ts');
  const q = s.similarQuery({ title: 'x402 - An open payment protocol | Coinbase', description: 'Stablecoin payments for APIs and agents.', text: 'stablecoin stablecoin agents agents agents http payments' }, new URL('https://www.x402.org/'));
  assert.match(q, /^An open payment protocol/);
  assert.match(q, /agents/);
  assert.match(q, /stablecoin/);
  assert.equal(s.similarQuery({}, new URL('https://blog.example.com/posts/best-running-shoes-2026.html')), 'posts best running shoes');
});

test('the page reader serves the latest archived copy when the target is down, never when it refuses', async () => {
  const realFetch = globalThis.fetch;
  const calls = [];
  const page = '<html><head><title>Archived page</title></head><body><main><p>This page text came from the archive copy of the site, with enough words to read.</p><a href="/next">next</a></main></body></html>';
  globalThis.fetch = async (input) => {
    const url = new URL(typeof input === 'string' ? input : input.url ?? String(input));
    calls.push(url.href);
    if (url.hostname === 'down.example') return new Response('busy', { status: 503 });
    if (url.hostname === 'closed.example') return new Response('no', { status: 403 });
    if (url.pathname.startsWith('/cdx/')) return Response.json([['timestamp', 'original'], ['20261025102749', `https://${new URL(url.searchParams.get('url')).hostname}/a`]]);
    if (url.hostname === 'web.archive.org') return new Response(page, { headers: { 'content-type': 'text/html; charset=utf-8' } });
    return new Response('?', { status: 404 });
  };
  try {
    const { extract } = await load('src/routes/extract.ts');
    const out = await extract('https://down.example/a', '2000', 'markdown', undefined, { budgetMs: 1500 });
    assert.equal(out.finalUrl, 'https://down.example/a');
    assert.equal(out.title, 'Archived page');
    assert.match(out.markdown, /archive copy/);
    assert.match(out.markdown, /https:\/\/down\.example\/next/);
    assert.deepEqual(out.archived, { source: 'Internet Archive (web.archive.org)', capturedAt: '2026-10-25T10:27:49Z', snapshotUrl: 'https://web.archive.org/web/20261025102749id_/https://down.example/a', reason: 'the live page was down or did not answer in time' });
    assert.ok(out.warnings.includes('archived_snapshot'));
    // A refusal is final: no archive lookup.
    calls.length = 0;
    await assert.rejects(extract('https://closed.example/a', '2000', 'text'), (e) => e.status === 422);
    assert.ok(!calls.some((u) => u.includes('archive.org')));
    // Callers that opt out get the original failure.
    await assert.rejects(extract('https://down.example/a', '2000', 'text', undefined, { budgetMs: 1500, archiveFallback: false }), (e) => e.status === 502);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('format words agents send map onto text or markdown', async () => {
  const f = await load('src/family.ts');
  const values = ['text', 'markdown', 'both'];
  assert.equal(f.allowedValue('json', values), 'text');
  assert.equal(f.allowedValue('LLM', values), 'markdown');
  assert.equal(f.allowedValue('text/html', values), 'markdown');
  assert.equal(f.allowedValue('full', values), 'both');
  assert.equal(f.allowedValue('json', ['json', 'csv']), 'json');
  assert.equal(f.allowedValue('json', ['csv']), undefined);
});
