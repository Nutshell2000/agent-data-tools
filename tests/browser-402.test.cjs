const assert = require('node:assert/strict');
const { before, after, test } = require('node:test');
const { build } = require('esbuild');
const { Miniflare, convertV4MiniflareOptions } = require('miniflare');

const asset = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
let mf;
before(async () => {
  const b = await build({ entryPoints: ['src/index.ts'], bundle: true, format: 'esm', platform: 'browser', write: false, external: ['cloudflare:workers', 'node:*'], plugins: [{ name: 'fixture-facilitator', setup(b) {
    b.onResolve({ filter: /^url$/ }, () => ({ path: 'node:url', external: true }));
    b.onResolve({ filter: /^\.\/facilitator$/ }, () => ({ path: 'fixture', namespace: 'fixture' }));
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ loader: 'js', contents: `export function buildFacilitator(){return {
      getSupported:async()=>({kinds:[{x402Version:2,scheme:'exact',network:'eip155:8453',extra:{name:'USD Coin',version:'2',asset:'${asset}',assetTransferMethod:'eip3009'}}],extensions:[]}),
      verify:async()=>({isValid:false,invalidReason:'fixture'}), settle:async()=>({success:false,errorReason:'fixture'})
    }}` }));
  } }] });
  mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: b.outputFiles[0].text, compatibilityDate: '2026-09-01', compatibilityFlags: ['nodejs_compat'],
    durableObjects: { METRICS: { className: 'Metrics', useSQLite: true } }, kvNamespaces: ['TRIALS'],
    bindings: { PAY_TO: '0x2074c40346ae2a90e0e4a391bcee6f16bf5277f5', NETWORK: 'eip155:8453', PAYWALL: 'on', TRIALS_ENABLED: 'on', MPP_EVM: 'off', FACILITATOR_URL: 'https://fixture.invalid', BASE_RPC_URL: 'https://fixture.invalid' },
    outboundService: async () => new Response('not used', { status: 500 }) }));
});
after(async () => { await mf?.dispose(); });

const browser = { accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36' };

test('a browser opening a paid tool gets a page with the tool, a free trial and card credits, still as a 402', async () => {
  const res = await mf.dispatchFetch('https://api.test/weather?lat=59.33&lon=18.07', { headers: browser });
  assert.equal(res.status, 402);
  assert.match(res.headers.get('content-type'), /text\/html/);
  assert.ok(res.headers.get('payment-required'), 'machine-readable terms stay in the header');
  const html = await res.text();
  assert.doesNotMatch(html, /@x402\/paywall/);
  assert.match(html, /<h1>[^<]*weather/i);
  assert.match(html, /href="\/weather\?lat=59.33&amp;lon=18.07&amp;trial=1"/, 'the trial keeps the caller\'s own inputs');
  assert.match(html, /href="\/weather\?lat=59.33&amp;lon=18.07&amp;sample=1"/);
  assert.match(html, /href="\/credits"/);
  assert.match(html, /https:\/\/api\.test\/mcp/);
  assert.doesNotMatch(html, /<script/i, 'static page, nothing executes');
});

test('a bare tool link offers the trial on the published example inputs', async () => {
  const res = await mf.dispatchFetch('https://api.test/weather', { headers: browser });
  assert.equal(res.status, 402);
  const html = await res.text();
  const trial = /href="(\/weather\?[^"]*trial=1)"/.exec(html);
  assert.ok(trial, 'trial link present');
  assert.match(trial[1], /lat=/);
  assert.match(trial[1], /lon=/);
});

test('JSON clients keep the machine-readable 402 body', async () => {
  const res = await mf.dispatchFetch('https://api.test/weather?city=Stockholm', { headers: { accept: 'application/json' } });
  assert.equal(res.status, 402);
  assert.match(res.headers.get('content-type'), /application\/json/);
  const body = await res.json();
  assert.ok(Array.isArray(body.accepts) && body.accepts.length > 0);
  assert.match(body.hint, /trial=1/);
});

test('a free trial opened in a browser shows its result as a page; code still gets JSON', async () => {
  const page = await mf.dispatchFetch('https://api.test/time?zone=UTC&trial=1', { headers: { ...browser, 'cf-connecting-ip': '198.51.100.7' } });
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type'), /text\/html/);
  assert.ok(page.headers.get('x-free-trial-remaining'));
  const html = await page.text();
  assert.match(html, /free calls left/);
  assert.match(html, /&quot;timezone&quot;|&quot;zone&quot;|UTC/);
  assert.match(html, /href="\/credits"/);
  assert.doesNotMatch(html, /<script/i);
  const json = await mf.dispatchFetch('https://api.test/time?zone=UTC&trial=1', { headers: { accept: 'application/json', 'cf-connecting-ip': '198.51.100.8' } });
  assert.equal(json.status, 200);
  assert.match(json.headers.get('content-type'), /application\/json/);
  await json.json();
});

test('every tool has an indexable page (200, canonical, in the sitemap); the tool URL itself stays a 402', async () => {
  const res = await mf.dispatchFetch('https://api.test/tools/check-counterparty');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('payment-required'), null);
  const html = await res.text();
  assert.match(html, /<link rel="canonical" href="https:\/\/api\.test\/tools\/check-counterparty">/);
  assert.match(html, /<script type="application\/ld\+json">\{"@context":"https:\/\/schema\.org","@type":"WebAPI"/);
  assert.match(html, /href="\/check\/counterparty\?[^"]*trial=1"/);
  assert.match(html, /href="\/credits"/);
  assert.match(html, /check_counterparty/);
  assert.equal((await mf.dispatchFetch('https://api.test/tools/no-such-tool')).status, 404);

  const index = await (await mf.dispatchFetch('https://api.test/tools')).text();
  const linked = new Set([...index.matchAll(/href="(\/tools\/[^"]+)"/g)].map((m) => m[1]));
  const sitemap = await (await mf.dispatchFetch('https://api.test/sitemap.xml')).text();
  const listed = [...sitemap.matchAll(/<loc>https:\/\/api\.test(\/tools\/[^<]+)<\/loc>/g)].map((m) => m[1]);
  assert.ok(listed.length >= 150, `sitemap lists ${listed.length} tool pages`);
  assert.equal(new Set(listed).size, listed.length, 'slugs are unique');
  assert.deepEqual([...linked].sort(), [...listed].sort(), '/tools links exactly the pages in the sitemap');
  assert.doesNotMatch(sitemap, /<loc>[^<]*\?/, 'no payment URLs in the sitemap');
  for (const path of listed.slice(0, 40)) assert.equal((await mf.dispatchFetch(`https://api.test${path}`)).status, 200, path);

  const home = await (await mf.dispatchFetch('https://api.test/', { headers: browser })).text();
  assert.match(home, /href="\/tools\/extract"/);
});

test('the IndexNow key file serves its own key', async () => {
  const key = /INDEXNOW_KEY = "([0-9a-f]{32})"/.exec(require('node:fs').readFileSync('src/index.ts', 'utf8'))[1];
  const res = await mf.dispatchFetch(`https://api.test/${key}.txt`);
  assert.equal(res.status, 200);
  assert.equal((await res.text()).trim(), key);
});

test('search copy: every TOOL_SEO entry is a real tool page with a short title, uses, FAQ and FAQPage data', async () => {
  const { build } = require('esbuild');
  const b = await build({ entryPoints: ['src/lib/tool-seo.ts'], bundle: true, format: 'cjs', platform: 'node', write: false });
  const m = { exports: {} }; new Function('module', 'exports', b.outputFiles[0].text)(m, m.exports);
  const seo = m.exports.TOOL_SEO;
  assert.ok(Object.keys(seo).length >= 20);
  for (const [path, entry] of Object.entries(seo)) {
    assert.ok(entry.title.length <= 70, `${path} title too long`);
    assert.ok(entry.uses.length >= 2 && entry.faq.length >= 1, path);
    const res = await mf.dispatchFetch(`https://api.test/tools/${path.slice(1).replaceAll('/', '-')}`);
    assert.equal(res.status, 200, path);
    const html = await res.text();
    assert.ok(html.includes(`<h1>${entry.title.replaceAll('&', '&amp;')}</h1>`), `${path} heading`);
    assert.match(html, /"@type":"FAQPage"/, path);
    assert.match(html, /<h2>When to use it<\/h2>/, path);
    assert.match(html, /How do I pay\?/, path);
  }
  // The AI chat page must not promise free calls (AI tools are outside the free allowance).
  const chat = await (await mf.dispatchFetch('https://api.test/tools/ai-chat')).text();
  assert.match(chat, /This tool is not in the free calls/);
});
