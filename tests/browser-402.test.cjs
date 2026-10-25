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
  assert.match(trial[1], /city=London/, 'the published example: a city name');
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

test('"Try it with your own inputs": a GET form with the example prefilled on the tool page and the 402 page', async () => {
  for (const [url, headers] of [['https://api.test/tools/weather', {}], ['https://api.test/weather', browser]]) {
    const html = await (await mf.dispatchFetch(url, { headers })).text();
    const form = /<form class="try" method="get" action="\/weather">([\s\S]*?)<\/form>/.exec(html);
    assert.ok(form, `form on ${url}`);
    assert.match(form[1], /<input id="try-city" name="city" type="text" value="London"/);
    assert.match(form[1], /<input type="hidden" name="trial" value="1">/);
    assert.doesNotMatch(form[1], /name="only"/);
  }
  // The visitor's own inputs prefill the form on the 402 page.
  const own = await (await mf.dispatchFetch('https://api.test/sanctions/check?address=0x1234567890abcdef1234567890abcdef12345678', { headers: browser })).text();
  assert.match(own, /name="address" type="text" value="0x1234567890abcdef1234567890abcdef12345678"/);
  // Capacity-limited tools are outside the free calls: no form.
  assert.doesNotMatch(await (await mf.dispatchFetch('https://api.test/tools/image')).text(), /<form class="try"/); // AI media stays outside the free calls; AI text joined them 25 Oct 2026
});

test('a browser trial result offers another run; refused inputs come back as a page with the reason and the form', async () => {
  const ok = await (await mf.dispatchFetch('https://api.test/time?zone=UTC&trial=1', { headers: { ...browser, 'cf-connecting-ip': '198.51.100.21' } })).text();
  assert.match(ok, /Run it again with other inputs/);
  assert.match(ok, /name="zone" type="text" value="UTC"/);
  const bad = await mf.dispatchFetch('https://api.test/time?zone=Not%2FA_Zone&trial=1', { headers: { ...browser, 'cf-connecting-ip': '198.51.100.22' } });
  assert.ok(bad.status >= 400 && bad.status < 500, `status ${bad.status}`);
  assert.match(bad.headers.get('content-type'), /text\/html/);
  const html = await bad.text();
  assert.match(html, /Nothing was charged and this did not use a free call/);
  assert.match(html, /name="zone" type="text" value="Not\/A_Zone"/, 'keeps what the visitor typed');
  assert.doesNotMatch(html, /<script/i);
  const json = await mf.dispatchFetch('https://api.test/time?zone=Not%2FA_Zone&trial=1', { headers: { accept: 'application/json', 'cf-connecting-ip': '198.51.100.23' } });
  assert.match(json.headers.get('content-type'), /application\/json/, 'code still gets the JSON error');
});

test('the homepage offers one-click MCP installs (Cursor, VS Code) and the Claude Code command', async () => {
  const html = await (await mf.dispatchFetch('https://api.test/', { headers: browser })).text();
  const cursor = /href="cursor:\/\/anysphere\.cursor-deeplink\/mcp\/install\?name=agent-data-tools&amp;config=([^"]+)"/.exec(html);
  assert.ok(cursor, 'Cursor deep link');
  assert.deepEqual(JSON.parse(Buffer.from(decodeURIComponent(cursor[1]), 'base64').toString()), { url: 'https://api.test/mcp' });
  const vscode = /href="vscode:mcp\/install\?([^"]+)"/.exec(html);
  assert.ok(vscode, 'VS Code deep link');
  assert.deepEqual(JSON.parse(decodeURIComponent(vscode[1])), { name: 'agent-data-tools', type: 'http', url: 'https://api.test/mcp' });
  assert.match(html, /href="vscode-insiders:mcp\/install\?/);
  assert.match(html, /claude mcp add --transport http agent-data-tools https:\/\/api\.test\/mcp/);
  assert.match(html, /https:\/\/api\.test\/mcp\/account/);
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
  // AI media pages must not promise free calls (outside the allowance); AI text pages do (since 25 Oct 2026).
  const image = await (await mf.dispatchFetch('https://api.test/tools/image')).text();
  assert.match(image, /This tool is not in the free calls/);
  const chat = await (await mf.dispatchFetch('https://api.test/tools/ai-chat')).text();
  assert.match(chat, /The first 25 calls are free/);
});

test('a POST with a flat JSON body is the GET with those fields: quoted, not refused with 405', async () => {
  const post = await mf.dispatchFetch('https://api.test/weather', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ city: 'London', hours: 6, ignored: { nested: true } }) });
  assert.equal(post.status, 402);
  const terms = JSON.parse(Buffer.from(post.headers.get('payment-required'), 'base64').toString());
  assert.equal(terms.resource.url, 'https://api.test/weather?city=London&hours=6', 'known fields become the query; unknown and nested ones are dropped');
  for (const body of ['', 'not json', '[1,2]']) {
    const res = await mf.dispatchFetch('https://api.test/time', { method: 'POST', headers: { 'content-type': 'application/json' }, body });
    assert.equal(res.status, 402, `body ${JSON.stringify(body)} still gets the quote`);
    await res.arrayBuffer();
  }
});

test('/demo is a static walkthrough page that points at the recording and the free tools', async () => {
  const res = await mf.dispatchFetch('https://api.test/demo');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  const html = await res.text();
  assert.match(html, /<img src="\/demo\.gif"/);
  assert.match(html, /bc_09e30bdm/);
  assert.match(html, /href="\/tools\/check-counterparty"/);
  assert.doesNotMatch(html, /<script/i);
});

test('free-trial links are nofollow, robots.txt disallows them and trial answers are noindex', async () => {
  const page = await (await mf.dispatchFetch('https://api.test/tools/weather')).text();
  assert.match(page, /<a class="btn primary" rel="nofollow" href="\/weather\?[^"]*trial=1"/);
  const robots = await (await mf.dispatchFetch('https://api.test/robots.txt')).text();
  assert.match(robots, /^Disallow: \/\*trial=1$/m);
  const trial = await mf.dispatchFetch('https://api.test/time?zone=UTC&trial=1', { headers: { accept: 'application/json', 'cf-connecting-ip': '198.51.100.31' } });
  assert.equal(trial.status, 200);
  assert.equal(trial.headers.get('x-robots-tag'), 'noindex, nofollow');
  await trial.arrayBuffer();
});
