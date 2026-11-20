// The first call (16 Nov 2026, lib/first-call.ts): what a newcomer reads first is short and leads with a request that
// works without a key or a wallet. /llms.txt under 8 KB (the long file at /llms-full.txt), the root JSON under 4 KB
// (the full card at /service-card.json), the 402 body opening with hint, freeTrial, payByCard, prepay, and the hero of
// the pages for people showing a keyless curl with the answer that request really gives.
const assert = require('node:assert/strict');
const Module = require('node:module');
const { before, after, test } = require('node:test');
const { build } = require('esbuild');
const { Miniflare, convertV4MiniflareOptions } = require('miniflare');

async function load(entry) {
  const result = await build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'cjs', write: false, logLevel: 'silent', external: ['cloudflare:workers'] });
  const m = new Module(entry, module); m.filename = entry; m.paths = Module._nodeModulePaths(process.cwd());
  m._compile(result.outputFiles[0].text, entry); return m.exports;
}

const asset = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
const PAY_TO = '0x2074c40346ae2a90e0e4a391bcee6f16bf5277f5';
const O = 'https://api.test';
let mf, ENDPOINTS, httpFree, free, firstCallLib, pages, discovery, salesFirstPaths;
before(async () => {
  ({ ENDPOINTS } = await load(require.resolve('../src/endpoints.ts')));
  ({ httpFree } = await load(require.resolve('../src/lib/capacity.ts')));
  free = await load(require.resolve('../src/lib/free-calls.ts'));
  firstCallLib = await load(require.resolve('../src/lib/first-call.ts'));
  pages = await load(require.resolve('../src/lib/site-pages.ts'));
  discovery = await load(require.resolve('../src/discovery.ts'));
  ({ salesFirstPaths } = await load(require.resolve('../src/lib/discovery-index.ts')));
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
    bindings: { PAY_TO, NETWORK: 'eip155:8453', PAYWALL: 'on', TRIALS_ENABLED: 'on', MPP_EVM: 'off', PUBLIC_BRAND: 'Glyphcall', STRIPE_READ_KEY: 'rk_test_fixture', FACILITATOR_URL: 'https://fixture.invalid', BASE_RPC_URL: 'https://fixture.invalid' },
    outboundService: async () => new Response('not used', { status: 500 }) }));
});
after(async () => { await mf?.dispose(); });

const browser = { accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36' };
const json = { accept: 'application/json', 'user-agent': 'node' };
const get = (path, headers = json) => mf.dispatchFetch(O + path, { headers });
const unescape = (s) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const byPath = () => new Map(ENDPOINTS.map((e) => [e.path, e]));

test('/llms.txt is under 8 KB and leads with the keyless call, then paying, twelve tools, MCP and the links', async (t) => {
  const res = await get('/llms.txt');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/plain/);
  const body = Buffer.from(await res.arrayBuffer());
  assert.ok(body.length < 8192, `llms.txt is ${body.length} bytes`);
  t.diagnostic(`/llms.txt: ${body.length} bytes`);
  const text = body.toString('utf8');
  assert.match(text, /^# Glyphcall\n\n> Glyphcall[^\n]*by SpellzCode/);
  const order = ['## First call: no key, no wallet', '## How to pay', '## Tools to start with', '## MCP', '## More'].map((h) => text.indexOf(h));
  assert.ok(order.every((at, i) => at > 0 && (i === 0 || at > order[i - 1])), `sections in order: ${order}`);
  // The first call is the shared example, and the free-call numbers are the constants.
  const call = firstCallLib.firstCall(O);
  assert.ok(text.includes(call.curl) && text.includes(call.output));
  assert.match(call.url, /[?&]trial=1$/);
  assert.ok(text.includes(`every caller gets ${free.FREE_HTTP_CALLS_PER_CALLER} free successful calls over HTTP`));
  assert.ok(text.includes(`An MCP client gets ${free.FREE_CALLS_PER_CALLER},`));
  for (const path of free.HTTP_FREE_EXCLUDED) assert.ok(text.includes(path), `${path} is named as excluded over HTTP`);
  // Paying: one line each, with its URL.
  const pay = text.slice(order[1], order[2]);
  for (const url of [`${O}/credits `, `${O}/.well-known/x402`, `${O}/credits/usdc/5`]) assert.ok(pay.includes(url), url);
  assert.ok(!pay.includes('/keys/free'), 'free keys are off here (no mail binding), so the 404 route is not offered');
  // Twelve tools a newcomer can try, each with the catalog's price and summary.
  const tools = text.slice(order[2], order[3]).split('\n').filter((l) => l.startsWith('- GET '));
  assert.equal(tools.length, 12);
  const catalog = byPath();
  for (const line of tools) {
    const m = /^- GET https:\/\/api\.test(\/[^?\s]*)\?\S+ \((\$[\d.]+)\): (.+)$/.exec(line);
    assert.ok(m, line);
    const e = catalog.get(m[1]);
    assert.ok(e, m[1]);
    assert.equal(m[2], e.price, `${m[1]} price comes from the catalog`);
    assert.equal(m[3], e.summary);
    assert.ok(httpFree(m[1]), `${m[1]} is in the HTTP free trial`);
    assert.ok(salesFirstPaths().includes(m[1]), `${m[1]} is one of SALES_FIRST`);
  }
  assert.ok(text.includes(`${O}/mcp (`) && text.includes(`${O}/mcp/compact`));
  for (const link of ['/llms-full.txt', '/openapi.json', '/tools', '/docs']) assert.ok(text.slice(order[4]).includes(O + link), link);
  assert.ok(text.slice(order[4]).includes('spellz111122@gmail.com'));
  assert.doesNotMatch(text, /\b\d{3,}\s+(pay-per-call\s+)?tools\b/, 'no tool count is stated');
});

test('with free calls off the short llms.txt does not offer trial=1 as a free call', () => {
  const text = firstCallLib.llmsShortTxt(O, { brand: 'Glyphcall', trials: false, freeKeys: true, networks: ['eip155:8453'], mpp: [] });
  assert.doesNotMatch(text, /curl "[^"]*trial=1/);
  assert.match(text, /Free calls are switched off right now/);
  assert.ok(text.includes(`${O}/keys/free`), 'the free key is offered when it is on');
  assert.ok(Buffer.byteLength(text) < 8192);
});

test('/llms-full.txt serves the whole former llms.txt', async () => {
  const res = await get('/llms-full.txt');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/plain/);
  const text = await res.text();
  assert.equal(text, discovery.llmsTxt(O, true, PAY_TO));
  assert.equal(text.match(/^#### GET /gm).length, ENDPOINTS.length, 'every tool is still described');
  assert.match(text, /## Advanced TypeScript x402 client/);
});

test('GET / for a program is under 4 KB and links the full service card, which still lists every tool', async (t) => {
  for (const headers of [json, { 'user-agent': 'python-requests/2.32' }]) {
    const res = await get('/', headers);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /application\/json/);
    const body = Buffer.from(await res.arrayBuffer());
    assert.ok(body.length < 4096, `root JSON is ${body.length} bytes`);
    t.diagnostic(`GET / as JSON: ${body.length} bytes`);
    const card = JSON.parse(body.toString('utf8'));
    assert.equal(card.name, 'Glyphcall');
    assert.equal(card.firstCall.url, firstCallLib.firstCall(O).url);
    assert.equal(card.pay.card, `${O}/credits`);
    assert.equal(card.pay.x402.payTo, PAY_TO);
    assert.equal(card.pay.x402.network, 'eip155:8453');
    assert.equal(card.mcp, `${O}/mcp`);
    assert.equal(card.pay.freeKey, undefined, 'free keys are off here');
    for (const key of ['serviceCard', 'openapi', 'llms', 'llmsFull', 'tools', 'discovery', 'credits', 'support']) assert.ok(card.links[key], key);
    assert.equal(card.links.serviceCard, `${O}/service-card.json`);
  }
  const full = await (await get('/service-card.json')).json();
  assert.equal(full.endpoints.length, ENDPOINTS.length);
  assert.equal(full.payment.payTo, PAY_TO);
  assert.ok(full.docs.buyerSkill);
  assert.match((await get('/', browser)).headers.get('content-type'), /text\/html/, 'browsers keep the page');
  // Every link in the short card that points at this service answers.
  const card = await (await get('/')).json();
  for (const [name, url] of Object.entries(card.links)) {
    if (!url.startsWith(O)) continue;
    const res = await get(url.slice(O.length));
    assert.equal(res.status, 200, name);
    await res.arrayBuffer();
  }
});

const X402_KEYS = ['x402Version', 'error', 'resource', 'accepts', 'extensions'];
test('a tool 402 opens with hint, freeTrial, payByCard, prepay; the x402 terms are the header\'s, unchanged', async (t) => {
  const res = await get('/weather?city=Stockholm');
  assert.equal(res.status, 402);
  const raw = await res.text();
  const body = JSON.parse(raw);
  assert.deepEqual(Object.keys(body).slice(0, 4), ['hint', 'freeTrial', 'payByCard', 'prepay']);
  t.diagnostic(`402 body keys: ${Object.keys(body).join(', ')} (${raw.length} characters; the first four: ${JSON.stringify(Object.fromEntries(Object.entries(body).slice(0, 4))).length})`);
  assert.match(body.hint, /^Try it free: add trial=1/);
  assert.match(body.hint, /pay with X-PAYMENT\. No wallet\?/, 'a space after the full stop');
  assert.doesNotMatch(raw, /X-PAYMENT\.No wallet/);
  assert.equal(body.freeTrial.url, `${O}/weather?city=Stockholm&trial=1`);
  assert.ok(body.freeTrial.what.includes(`${free.FREE_HTTP_CALLS_PER_CALLER} free successful calls per caller`));
  assert.equal(body.payByCard.credits, `${O}/credits`);
  assert.deepEqual(Object.keys(body.payByCard.smallestPack), ['price', 'credits', 'buy']);
  assert.equal(body.payByCard.smallestPack.price, '$1');
  assert.match(body.prepay, /Prepay once: GET https:\/\/api\.test\/credits\/usdc\/5 /);
  // The header is what x402 clients read; the body repeats it field for field, in the header's own order.
  const header = JSON.parse(Buffer.from(res.headers.get('payment-required'), 'base64').toString('utf8'));
  const inBody = Object.fromEntries(Object.keys(header).map((k) => [k, body[k]]));
  assert.equal(JSON.stringify(inBody), JSON.stringify(header));
  assert.deepEqual(Object.keys(body).filter((k) => X402_KEYS.includes(k)), Object.keys(header), 'the x402 fields keep their order among themselves');
  assert.equal(body.x402Version, 2);

  // A request without input is pointed at the tool's published example.
  const bare = await (await get('/weather')).json();
  assert.equal(bare.freeTrial.url, `${O}/weather?city=London&trial=1`);

  // The v1-shaped body (x402=1) opens the same way.
  const v1 = await (await get('/weather?city=Stockholm&x402=1')).json();
  assert.deepEqual(Object.keys(v1).slice(0, 4), ['hint', 'freeTrial', 'payByCard', 'prepay']);
  assert.equal(v1.x402Version, 1);
  assert.equal(v1.freeTrial.url, `${O}/weather?city=Stockholm&trial=1`, 'the control parameter is not carried into the trial URL');
  assert.ok(Array.isArray(v1.accepts) && v1.accepts[0].maxAmountRequired);
});

test('a tool outside the HTTP free trial gets no freeTrial, and a caller who used the free calls gets none either', async () => {
  for (const path of ['/search?q=x402', '/pdf/text?url=https%3A%2F%2Fexample.com%2Fa.pdf']) {
    const res = await get(path);
    assert.equal(res.status, 402, path);
    const body = await res.json();
    assert.equal(httpFree(path.split('?')[0]), false, path);
    assert.deepEqual(Object.keys(body).slice(0, 3), ['hint', 'payByCard', 'prepay'], path);
    assert.equal('freeTrial' in body, false, path);
    assert.doesNotMatch(body.hint, /trial=1/, path);
  }
  // Use up the free calls from one address: the next 402 no longer offers them.
  const caller = { ...json, 'cf-connecting-ip': '198.51.100.44' };
  for (let i = 0; i < free.FREE_HTTP_CALLS_PER_CALLER; i++) assert.equal((await get('/validate/luhn?number=79927398713&trial=1', caller)).status, 200, `free call ${i + 1}`);
  const spent = await get('/validate/luhn?number=79927398713&trial=1', caller);
  assert.equal(spent.status, 402);
  const body = await spent.json();
  assert.equal('freeTrial' in body, false);
  assert.equal(Object.keys(body)[0], 'hint');
  // 19 Nov 2026: the exhausted caller is high-intent. Give it one explicit resume step, as text and as data.
  assert.match(body.hint, /^You've used your 3 free calls here\. To continue:/);
  assert.match(body.hint, /repeat this exact URL with &api_key=adt_/);
  assert.equal(body.resume.usedFreeCalls, 3);
  assert.match(body.resume.buy, /^https:\/\/buy\.stripe\.com\//);
  assert.match(body.resume.retry, /\/validate\/luhn\?/);
  // 20 Nov 2026: /credits/claim reads only session_id and 400s on an e-mail. The 402 must not advertise a
  // step that can never work — point at Stripe's redirect (which carries the session id) or MPP's buy/1.
  assert.doesNotMatch(body.hint, /credits\/claim with the e-mail/, 'no e-mail claim instruction');
  assert.match(body.hint, /Stripe returns you to .*\/credits\/claim\?session_id=/, 'advertise the real redirect');
  assert.match(body.hint, /\/credits\/buy\/1/, 'MPP agents get a browser-free key path');
  assert.equal(body.resume.claimUrl, undefined, 'a bare claim URL 400s; never publish it as resumable');
  assert.match(body.resume.claim, /session_id/);
  assert.match(body.resume.mppBuy, /\/credits\/buy\/1$/);
  assert.match(body.payByCard.use, /then re-send this exact URL/);
});

test('the hero of the front page opens with a keyless curl and the answer that request really gives', async () => {
  const html = await (await get('/', browser)).text();
  assert.match(html, /<a class="brand" href="\/">Glyphcall<\/a>/, 'the product front page');
  // The hero is the free in-browser voice console since 16 Nov 2026; the keyless curl opens the developers section.
  const hero = html.slice(html.indexOf('<span class="kicker">For developers</span>'));
  const firstCode = /<pre><code>([\s\S]*?)<\/code><\/pre>/.exec(hero)[1];
  const curl = unescape(firstCode.replace(/<[^>]+>/g, ''));
  const url = /^curl "(https:\/\/api\.test\/[^"]+[?&]trial=1)"$/.exec(curl)?.[1];
  assert.ok(url, `the first example is a keyless curl on the request origin: ${curl}`);
  assert.doesNotMatch(curl, /Authorization|api_key/);
  const shown = JSON.parse(unescape(/<pre class="res"><code>([\s\S]*?)<\/code><\/pre>/.exec(hero)[1]));
  assert.ok(html.indexOf('<pre class="res">') < html.indexOf('Authorization: Bearer'), 'the keyless example comes before any example with a key');
  // Run exactly what the page prints.
  const live = await get(url.slice(O.length), { ...json, 'cf-connecting-ip': '198.51.100.21' });
  assert.equal(live.status, 200);
  assert.deepEqual(await live.json(), shown, 'the answer on the page is the tool\'s answer');
  assert.ok(hero.includes(`${free.FREE_HTTP_CALLS_PER_CALLER} free calls per caller`));
  const above = html.slice(0, html.indexOf('<h2>For AI agents</h2>'));
  assert.doesNotMatch(above, /x402|MPP|USDC|Tempo|wallet/i, 'no payment protocol before the agents section');
  // Free keys are off in this worker (no mail binding): the nav must not link a route that answers 404.
  assert.equal((await get('/keys/free', browser)).status, 404);
  assert.doesNotMatch(html, /href="\/keys\/free"/);
  assert.doesNotMatch(await (await get('/docs', browser)).text(), /href="\/keys\/free"/);

  // The agent catalogue page and the short llms.txt print the same request and answer.
  const agents = await (await get('/agents', browser)).text();
  const firstAgentCode = unescape(/<pre><code>([\s\S]*?)<\/code><\/pre>/.exec(agents)[1]);
  assert.equal(firstAgentCode, `curl "${url}"`);
  assert.ok(unescape(agents).includes(JSON.stringify(shown)));
});

test('"Get a free key" is in the nav of the pages for people only while free keys are offered', () => {
  const link = /<a[^>]* href="\/keys\/free">Get a free key<\/a>/;
  assert.match(pages.landingPage('Glyphcall', 'https://x.test', true, { freeKey: true }), link);
  assert.doesNotMatch(pages.landingPage('Glyphcall', 'https://x.test', true, { trial: true }), /\/keys\/free/);
  assert.match(pages.docsPage('Glyphcall', 'https://x.test', true), link);
  assert.doesNotMatch(pages.docsPage('Glyphcall', 'https://x.test'), /\/keys\/free/);
  // Without free calls the hero does not print a trial=1 request.
  assert.doesNotMatch(pages.landingPage('Glyphcall', 'https://x.test', true), /trial=1/);
});
