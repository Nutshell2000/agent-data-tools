// Task guides (31 Oct 2026): one indexable page per job agents search for, titled as the query, with the request in every
// way an agent can make it, linked from the tool pages, the homepage, llms.txt and the sitemap.
const assert = require('node:assert/strict');
const { before, after, test } = require('node:test');
const { build } = require('esbuild');
const { Miniflare, convertV4MiniflareOptions } = require('miniflare');

let mf;
before(async () => {
  const b = await build({ entryPoints: ['src/index.ts'], bundle: true, format: 'esm', platform: 'browser', write: false, external: ['cloudflare:workers', 'node:*'], plugins: [{ name: 'fixture-facilitator', setup(b) {
    b.onResolve({ filter: /^url$/ }, () => ({ path: 'node:url', external: true }));
    b.onResolve({ filter: /^\.\/facilitator$/ }, () => ({ path: 'fixture', namespace: 'fixture' }));
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ loader: 'js', contents: `export function buildFacilitator(){return {
      getSupported:async()=>({kinds:[],extensions:[]}), verify:async()=>({isValid:false,invalidReason:'fixture'}), settle:async()=>({success:false,errorReason:'fixture'})
    }}` }));
  } }] });
  mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: b.outputFiles[0].text, compatibilityDate: '2026-09-01', compatibilityFlags: ['nodejs_compat'],
    durableObjects: { METRICS: { className: 'Metrics', useSQLite: true } }, kvNamespaces: ['TRIALS'],
    bindings: { PAY_TO: '0x2074c40346ae2a90e0e4a391bcee6f16bf5277f5', NETWORK: 'eip155:8453', PAYWALL: 'on', TRIALS_ENABLED: 'on', MPP_EVM: 'off', FACILITATOR_URL: 'https://fixture.invalid', BASE_RPC_URL: 'https://fixture.invalid' },
    outboundService: async () => new Response('not used', { status: 500 }) }));
});
after(async () => { await mf?.dispose(); });

const GUIDES = [
  ['pdf-to-text-api', 'PDF to text API', '/pdf/text', 'pdf_text'],
  ['url-to-markdown-api', 'URL to Markdown API', '/extract', 'extract'],
  ['ofac-wallet-screening-api', 'OFAC wallet screening API', '/sanctions/check', 'sanctions_check'],
  ['news-headlines-api', 'News headlines API', '/news', 'news'],
  ['describe-image-api', 'Describe image API', '/describe', 'describe'],
  ['chat-completions-api', 'Chat completions API, pay per call', '/ai/chat', 'ai_chat'],
  ['token-price-api', 'Token price API', '/price/token', 'price_token'],
  // Data-only guides: lead and uses come from the tool's description and search copy.
  ['web-search-api', 'Web search API, pay per call', '/search', 'search'],
  ['weather-forecast-api', 'Weather forecast API', '/weather', 'weather'],
  ['email-verification-api', 'Email verification API', '/email', 'email'],
  ['gas-price-api', 'Gas price API', '/base-gas', 'base_gas'],
  ['token-honeypot-check-api', 'Token honeypot check API', '/token-report', 'token_report'],
];

test('every task guide is a 200 page titled as the query, with the free, card-key (header and URL), x402 and MCP ways to call', async () => {
  for (const [slug, phrase, path, mcp] of GUIDES) {
    const res = await mf.dispatchFetch(`https://api.test/guides/${slug}`);
    assert.equal(res.status, 200, slug);
    assert.match(res.headers.get('content-type'), /text\/html/);
    const html = await res.text();
    assert.match(html, new RegExp(`<title>${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`), `${slug} title starts with the phrase`);
    assert.match(html, new RegExp(`<h1>${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}</h1>`));
    assert.match(html, new RegExp(`<link rel="canonical" href="https://api.test/guides/${slug}">`));
    assert.match(html, new RegExp(`https://api\\.test${path.replace(/\//g, '\\/')}\\?[^"]*&amp;api_key=adt_`), `${slug} shows the URL key`);
    assert.match(html, /Authorization: Bearer adt_/);
    assert.match(html, /402 Payment Required/);
    assert.match(html, new RegExp(`<code>${mcp}</code>`), `${slug} names the MCP tool`);
    assert.match(html, new RegExp(`href="/tools/${path.slice(1).replace(/\//g, '-')}"`), `${slug} links the tool page`);
    assert.doesNotMatch(html, /noindex/);
    // Only the schema.org data runs no script; the page itself has none.
    assert.equal((html.match(/<script/g) ?? []).length, (html.match(/<script type="application\/ld\+json">/g) ?? []).length);
    const md = await mf.dispatchFetch(`https://api.test/guides/${slug}.md`);
    assert.equal(md.status, 200);
    const text = await md.text();
    assert.ok(text.startsWith(`# ${phrase}`), `${slug}.md`);
    assert.match(text, /api_key=adt_/);
  }
});

test('free-call rules carry into the guides: a capacity-limited tool offers no trial, an ordinary one does', async () => {
  const news = await (await mf.dispatchFetch('https://api.test/guides/news-headlines-api')).text();
  assert.match(news, /Not in the free calls/);
  assert.doesNotMatch(news, /\/news\?[^"]*&amp;trial=1/);
  const pdf = await (await mf.dispatchFetch('https://api.test/guides/pdf-to-text-api')).text();
  assert.match(pdf, /\/pdf\/text\?[^"]*&amp;trial=1/);
});

test('the guides are reachable: index page, homepage, tool pages, llms.txt and the sitemap', async () => {
  const index = await mf.dispatchFetch('https://api.test/guides');
  assert.equal(index.status, 200);
  const indexHtml = await index.text();
  for (const [slug] of GUIDES) assert.match(indexHtml, new RegExp(`href="/guides/${slug}"`));
  // Every guide on the index resolves, is titled as its phrase and names a real tool (data-only guides included).
  const slugs = [...indexHtml.matchAll(/href="\/guides\/([a-z0-9-]+)"/g)].map((m) => m[1]).filter((s) => s.endsWith('-api'));
  assert.ok(slugs.length >= 25, `guides on the index: ${slugs.length}`);
  for (const slug of slugs) {
    const page = await mf.dispatchFetch(`https://api.test/guides/${slug}`);
    assert.equal(page.status, 200, slug);
    const html = await page.text();
    assert.match(html, /<h1>[^<]+<\/h1>/, slug);
    assert.match(html, /&amp;api_key=adt_/, slug);
    assert.match(html, /href="\/tools\/[a-z0-9-]+"/, slug);
  }
  assert.match(indexHtml, /href="\/guides\/web-reading"/, 'the older buying guides stay listed');
  const home = await (await mf.dispatchFetch('https://api.test/', { headers: { accept: 'text/html' } })).text();
  assert.match(home, /href="\/guides\/pdf-to-text-api"/);
  assert.match(home, /Buy credits from \$1/, 'the homepage names the $1 pack and the real credit prices');
  const tool = await (await mf.dispatchFetch('https://api.test/tools/pdf-text')).text();
  assert.match(tool, /href="\/guides\/pdf-to-text-api">PDF to text API</);
  const llms = await (await mf.dispatchFetch('https://api.test/llms.txt')).text();
  assert.match(llms, /PDF to text API: https:\/\/api\.test\/guides\/pdf-to-text-api\.md/);
  assert.match(llms, /\$1 = 1,000 credits/);
  const sitemap = await (await mf.dispatchFetch('https://api.test/sitemap.xml')).text();
  for (const [slug] of GUIDES) assert.match(sitemap, new RegExp(`<loc>https://api.test/guides/${slug}</loc>`));
  assert.match(sitemap, /<loc>https:\/\/api.test\/guides<\/loc>/);
  assert.equal((await mf.dispatchFetch('https://api.test/guides/no-such-guide')).status, 404);
  assert.equal((await mf.dispatchFetch('https://api.test/guides/sitemap')).status, 200, 'the specific guide routes still win');
});
