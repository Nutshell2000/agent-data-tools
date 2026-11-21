// Cookieless measurement (src/lib/beacon.ts): the /e beacon, MCP client names, AI-crawler reads and a visitor's utm tag
// carried into Stripe links. The real Worker runs in Miniflare behind a thin wrapper that hands it a fake Analytics
// Engine binding and serves what that binding received at /__points (reading empties it). A request with the header
// x-no-analytics runs without the binding, as tests and local runs of the Worker do.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { before, after, test } = require('node:test');
const { build } = require('esbuild');
const { Miniflare, convertV4MiniflareOptions } = require('miniflare');

let mf, L;
const O = 'https://glyphcall.test';
const HOST = 'glyphcall.test';
const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const GPTBOT = 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2; +https://openai.com/gptbot)';
const CLAUDE_USER = 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Claude-User/1.0; +Claude-User@anthropic.com)';
const IP = '203.0.113.77';
const STRIPE_REFERENCE = /^[A-Za-z0-9_-]{1,200}$/;
const url = { name: 'url', setup(b) { b.onResolve({ filter: /^url$/ }, () => ({ path: 'node:url', external: true })); } };

before(async () => {
  const worker = await build({ bundle: true, format: 'esm', platform: 'browser', write: false, external: ['cloudflare:workers', 'node:*'], plugins: [url],
    stdin: { resolveDir: process.cwd(), loader: 'ts', contents: `
      import app, { Metrics } from './src/index.ts';
      export { Metrics };
      const points: unknown[] = [];
      export default { fetch(request: Request, env: Record<string, unknown>, ctx: ExecutionContext) {
        if (new URL(request.url).pathname === '/__points') return Response.json(points.splice(0));
        const bound = request.headers.get('x-no-analytics') ? env : { ...env, ANALYTICS: { writeDataPoint: (p: unknown) => { points.push(p); } } };
        return app.fetch(request, bound as never, ctx);
      } };` } });
  mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: worker.outputFiles[0].text, compatibilityDate: '2026-09-01', compatibilityFlags: ['nodejs_compat'],
    durableObjects: { METRICS: { className: 'Metrics', useSQLite: true } },
    bindings: { PAY_TO: '0x2074c40346ae2a90e0e4a391bcee6f16bf5277f5', NETWORK: 'eip155:8453', PAYWALL: 'on', TRIALS_ENABLED: 'on', FACILITATOR_URL: 'https://fixture.invalid', BASE_RPC_URL: 'https://fixture.invalid', STRIPE_READ_KEY: 'rk_test_fixture' },
    outboundService: async (r) => {
      const u = new URL(r.url);
      if (u.hostname === 'fixture.invalid') return Response.json({ kinds: [{ x402Version: 2, scheme: 'exact', network: 'eip155:8453', extra: { name: 'USD Coin', version: '2' } }], extensions: [] });
      // A $1 pack bought through a link that carried a campaign reference.
      if (u.hostname === 'api.stripe.com') return Response.json({ mode: 'payment', status: 'complete', payment_status: 'paid', currency: 'usd', amount_total: 100, metadata: { adt_credits: '1000' }, client_reference_id: 'utm_newsletter_email_nov' });
      return new Response('not expected in this test', { status: 500 });
    } }));
  const lib = await build({ bundle: true, format: 'cjs', platform: 'node', write: false, logLevel: 'silent',
    stdin: { resolveDir: process.cwd(), loader: 'ts', contents: `
      export * from './src/lib/beacon.ts';
      export { aiCrawlerName, AI_CRAWLERS } from './src/lib/ai-crawlers.ts';
      export { topUpLinks, topUpReference, keyHashFromReference, verifyCheckout, planLinks } from './src/lib/credits.ts';
      export { parseUserAgent } from './src/routes/media-text.ts';` } });
  const m = { exports: {} };
  new Function('module', 'exports', 'require', lib.outputFiles[0].text)(m, m.exports, require);
  L = m.exports;
});
after(async () => { await mf?.dispose(); });

const get = (path, headers = {}, init = {}) => mf.dispatchFetch(`${O}${path}`, { headers: { 'cf-connecting-ip': IP, ...headers }, cf: { country: 'SE' }, redirect: 'manual', ...init });
const points = async () => (await mf.dispatchFetch(`${O}/__points`)).json();
const page = { accept: 'text/html', 'user-agent': CHROME };

test('the beacon answers 204 and writes one point: families and a bare path, never an address, a full user agent or a full referrer', async () => {
  await points();
  const res = await get(`/e?ev=page_view&p=${encodeURIComponent('/credits/claim?session_id=cs_live_secret#frag')}&r=${encodeURIComponent('https://www.google.com/search?q=private+words')}&src=newsletter&extra=${encodeURIComponent('someone@example.com')}`,
    { 'user-agent': CHROME, origin: `https://voice.${HOST}`, referer: `https://voice.${HOST}/transcribe?file=private.mp3`, cookie: 'id=abc' });
  assert.equal(res.status, 204);
  assert.equal(await res.text(), '');
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(res.headers.get('access-control-allow-origin'), '*');
  assert.equal(res.headers.get('set-cookie'), null);
  const got = await points();
  assert.deepEqual(got, [{ indexes: ['page_view'], blobs: ['page_view', '/credits/claim', 'google', 'browser', 'SE', 'newsletter', `voice.${HOST}`], doubles: [1] }]);
  for (const secret of [IP, 'Chrome', 'Mozilla', 'search', 'private', 'cs_live_secret', 'someone', 'transcribe', 'abc']) assert.ok(!JSON.stringify(got).includes(secret), secret);
});

test('the beacon also answers HEAD, POST (navigator.sendBeacon) and a CORS preflight; a foreign page and a missing referrer are named as such', async () => {
  await points();
  assert.equal((await get('/e?ev=signup_click&p=/keys/free', { 'user-agent': CHROME }, { method: 'HEAD' })).status, 204);
  assert.equal((await get('/e?ev=signup_click&p=/keys/free&r=&utm_source=hn', { 'user-agent': CHROME, origin: 'https://elsewhere.example' }, { method: 'POST', body: 'ignored' })).status, 204);
  const preflight = await get('/e?ev=x&p=/', { origin: `https://voice.${HOST}`, 'access-control-request-method': 'GET' }, { method: 'OPTIONS' });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), '*');
  assert.deepEqual((await points()).map((p) => p.blobs), [
    ['signup_click', '/keys/free', 'unknown', 'browser', 'SE', '', 'unknown'],
    ['signup_click', '/keys/free', 'direct', 'browser', 'SE', 'hn', 'other'],
  ]);
});

test('an invalid or reserved event, or a value that is not a path, is answered 204 and writes nothing', async () => {
  await points();
  const bad = ['/e', '/e?ev=page_view', '/e?p=/credits', '/e?ev=Page_View&p=/', '/e?ev=page%20view&p=/', `/e?ev=${'a'.repeat(41)}&p=/`, '/e?ev=page_view&p=credits',
    '/e?ev=page_view&p=https://evil.example/', `/e?ev=page_view&p=/${'a'.repeat(200)}`, `/e?ev=page_view&p=${encodeURIComponent('/a b<script>')}`, '/e?ev=mcp_initialize&p=/mcp', '/e?ev=ai_crawler&p=/llms.txt'];
  for (const path of bad) assert.equal((await get(path, { 'user-agent': CHROME })).status, 204, path);
  assert.deepEqual(await points(), []);
  // An invalid src is dropped, the event is kept; a key in a connector path never reaches the dataset.
  await get(`/e?ev=page_view&p=/mcp/k/adt_SECRETKEY/compact&src=${encodeURIComponent('Bad Value!')}`, { 'user-agent': 'curl/8.7.1' });
  assert.deepEqual((await points()).map((p) => p.blobs), [['page_view', '/mcp/k/:key/compact', 'unknown', 'curl', 'SE', '', 'unknown']]);
});

test('without the binding the beacon still answers 204 and pages, crawlers and MCP work as before', async () => {
  await points();
  const none = { 'x-no-analytics': '1' };
  assert.equal((await get('/e?ev=page_view&p=/', { ...none, 'user-agent': CHROME })).status, 204);
  assert.equal((await get('/llms.txt', { ...none, 'user-agent': GPTBOT })).status, 200);
  const init = await get('/mcp?src=glama', { ...none, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'no-binding', version: '1' } } }) });
  assert.equal(init.status, 200);
  assert.match(await init.text(), /serverInfo/);
  assert.deepEqual(await points(), []);
});

test('the beacon is not a tool: absent from the catalog, discovery and OpenAPI, and never answered 402', async () => {
  assert.equal((await get('/e')).status, 204);
  const openapi = await (await get('/openapi.json')).json();
  assert.ok(!Object.keys(openapi.paths).includes('/e'));
  for (const file of ['/llms.txt', '/discovery/resources', '/.well-known/x402', '/sitemap.xml']) assert.ok(!/glyphcall\.test\/e["\s<?]/.test(await (await get(file)).text()), file);
  const callers = await (await get('/metrics/callers')).json();
  assert.ok(!JSON.stringify(callers).includes('"/e"'));
});

test('MCP initialize with ?src= logs the client software name, the tag, the route and the mode, and the server still lists tools', async () => {
  await points();
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
  const client = new Client({ name: 'Measure Test/Client', version: '9.9.9-user@example.com' });
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(`${O}/mcp?src=glama`), { requestInit: { headers: { 'cf-connecting-ip': IP, 'user-agent': 'node' } }, fetch: (u, i) => mf.dispatchFetch(u, i) }));
    const { tools } = await client.listTools();
    assert.ok(tools.length >= 10, `the server still lists tools (the small /mcp surface since 1.215.0), got ${tools.length}`);
  } finally { await client.close(); }
  const got = await points();
  // One point for the initialize request only: not for notifications/initialized, tools/list or the stream.
  assert.deepEqual(got, [{ indexes: ['mcp_initialize'], blobs: ['mcp_initialize', '/mcp', 'measuretestclient', 'open', '', 'glama', HOST], doubles: [1] }]);
  for (const secret of ['9.9.9', 'example.com', IP]) assert.ok(!JSON.stringify(got).includes(secret), secret);

  // A bundle route, an invalid tag, and a request the server refuses (no sign-in on /mcp/account): the last writes nothing.
  const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'cursor-vscode', version: '1' } } });
  const post = (path) => get(path, { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, { method: 'POST', body });
  assert.equal((await post('/mcp/compact?src=Not%20Valid')).status, 200);
  assert.equal((await post('/mcp/account?src=directory')).status, 401);
  assert.deepEqual((await points()).map((p) => p.blobs), [['mcp_initialize', '/mcp/compact', 'cursor-vscode', 'open', '', '', HOST]]);
  // The existing per-day connection counter is untouched: it counted both accepted initializes.
  const callers = await (await get('/metrics/callers')).json();
  assert.match(JSON.stringify(callers.mcpConnections), /measuretestclient/);
  assert.match(JSON.stringify(callers.mcpConnections), /cursor-vscode/);
});

test('MCP routes are stored without the key, and a key in a header or the URL sets the mode', () => {
  assert.deepEqual(L.mcpRoute('/mcp', false), { route: '/mcp', mode: 'open' });
  assert.deepEqual(L.mcpRoute('/mcp', true), { route: '/mcp', mode: 'key' });
  assert.deepEqual(L.mcpRoute('/mcp/chain', false), { route: '/mcp/chain', mode: 'open' });
  assert.deepEqual(L.mcpRoute('/mcp/k/adt_SECRETKEY', false), { route: '/mcp/k/:key', mode: 'key' });
  assert.deepEqual(L.mcpRoute('/mcp/k/adt_SECRETKEY/compact', false), { route: '/mcp/k/:key/compact', mode: 'key' });
  assert.deepEqual(L.mcpRoute('/mcp/account/compact', false), { route: '/mcp/account/compact', mode: 'account' });
  assert.deepEqual(L.mcpRoute('/mcp/chatgpt', false), { route: '/mcp/chatgpt', mode: 'account' });
  assert.deepEqual(L.mcpRoute('/mcp/Some%20Thing/else/more', false), { route: '/mcp/other', mode: 'open' });
});

test('an AI crawler reading a page or a discovery file writes one ai_crawler point; a browser, and a crawler on a tool, write none', async () => {
  await points();
  assert.equal((await get('/llms.txt', { 'user-agent': GPTBOT })).status, 200);
  assert.deepEqual(await points(), [{ indexes: ['ai_crawler'], blobs: ['ai_crawler', '/llms.txt', 'GPTBot', '2xx', '', '', HOST], doubles: [1] }]);
  assert.equal((await get('/llms.txt', { 'user-agent': CHROME })).status, 200);
  assert.equal((await get('/tools', page)).status, 200);
  assert.equal((await get('/time?zone=UTC', { 'user-agent': GPTBOT })).status, 402);
  assert.equal((await get('/mcp', { 'user-agent': GPTBOT })).status >= 400, true);
  assert.deepEqual(await points(), []);
  for (const path of ['/tools?utm_source=x&q=private', '/robots.txt', '/sitemap.xml', '/privacy', '/tools/no-such-tool-here']) await get(path, { 'user-agent': CLAUDE_USER, accept: 'text/html' });
  await get('/openapi.json', { 'user-agent': 'Mozilla/5.0 (compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)' });
  assert.deepEqual((await points()).map((p) => p.blobs.slice(1, 4)), [
    ['/tools', 'Claude-User', '2xx'], ['/robots.txt', 'Claude-User', '2xx'], ['/sitemap.xml', 'Claude-User', '2xx'], ['/privacy', 'Claude-User', '2xx'],
    ['/tools/no-such-tool-here', 'Claude-User', '4xx'], ['/openapi.json', 'PerplexityBot', '2xx'],
  ]);
});

test('one crawler table: the names that are counted are the ones /useragent/parse answers', () => {
  const named = {
    GPTBot: GPTBOT, 'ChatGPT-User': 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot', 'OAI-SearchBot': 'OAI-SearchBot/1.0; +https://openai.com/searchbot',
    ClaudeBot: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)', 'Claude-User': CLAUDE_USER, 'Claude-SearchBot': 'Claude-SearchBot/1.0', 'anthropic-ai': 'anthropic-ai',
    PerplexityBot: 'PerplexityBot/1.0', 'Perplexity-User': 'Perplexity-User/1.0', 'Google-Extended': 'Google-Extended', GoogleOther: 'Mozilla/5.0 (compatible; GoogleOther)', 'Applebot-Extended': 'Applebot-Extended/0.1',
    Bytespider: 'Mozilla/5.0 (compatible; Bytespider; spider-feedback@bytedance.com)', CCBot: 'CCBot/2.0 (https://commoncrawl.org/faq/)', Amazonbot: 'Mozilla/5.0 (compatible; Amazonbot/0.1)',
    'Meta-ExternalAgent': 'meta-externalagent/1.1 (+https://developers.facebook.com/docs/sharing/webmasters/crawler)', 'Meta-ExternalFetcher': 'meta-externalfetcher/1.1', DuckAssistBot: 'DuckAssistBot/1.2',
    'MistralAI-User': 'MistralAI-User/1.0', 'cohere-ai': 'cohere-ai', Diffbot: 'Mozilla/5.0 (compatible; Diffbot/3.0)', YouBot: 'Mozilla/5.0 (compatible; YouBot/1.0)',
  };
  for (const [name, ua] of Object.entries(named)) {
    assert.equal(L.aiCrawlerName(ua), name, ua);
    assert.equal(L.parseUserAgent(ua).bot.replace(/ \(.*$/, ''), name, ua);
  }
  for (const ua of [CHROME, 'curl/8.7.1', 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)', 'Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15 (Applebot/0.1)', 'facebookexternalhit/1.1', '', undefined]) assert.equal(L.aiCrawlerName(ua), undefined, String(ua));
  // What the parser answered before the table moved is unchanged for the crawlers it already knew.
  assert.equal(L.parseUserAgent(GPTBOT).bot, 'GPTBot (OpenAI)');
  assert.equal(L.parseUserAgent(named.ClaudeBot).bot, 'ClaudeBot (Anthropic)');
  assert.equal(L.parseUserAgent('facebookexternalhit/1.1').bot, 'Meta crawler');
  assert.equal(L.parseUserAgent('Mozilla/5.0 (compatible; Applebot/0.1)').bot, 'Applebot');
});

test('a campaign tag is cut to what Stripe accepts as client_reference_id', () => {
  const ref = (query) => L.utmReference(new URLSearchParams(query));
  assert.equal(ref('utm_source=google'), 'utm_google');
  assert.equal(ref('utm_source=Hacker%20News&utm_medium=social&utm_campaign=Launch_1'), 'utm_hacker-news_social_launch-1');
  assert.equal(ref('utm_source=newsletter&utm_campaign=nov'), 'utm_newsletter_-_nov');
  assert.equal(ref('src=glama'), 'utm_glama');
  assert.equal(ref('utm_source=chatgpt.com&src=other'), 'utm_chatgpt-com');
  assert.equal(ref('utm_medium=cpc&utm_campaign=x'), undefined);
  assert.equal(ref('utm_source=%3Cscript%3E%22%27%3F%26%3D'), 'utm_script');
  assert.equal(ref('utm_source=!!!'), undefined);
  const long = ref(`utm_source=${'s'.repeat(300)}&utm_medium=${'m-'.repeat(200)}&utm_campaign=${'ç'.repeat(10)}c${'x'.repeat(90)}`);
  assert.match(long, STRIPE_REFERENCE);
  assert.ok(long.length <= 126, String(long.length));
  assert.match(long, /^utm_s{40}_(m-){19}m_c-?x{38,39}$/);
  // Never mistaken for a top-up: the parser the claim uses reads no key from it.
  for (const r of [long, 'utm_google', 'utm_topup', `utm_${'a'.repeat(40)}`]) assert.equal(L.keyHashFromReference(r), undefined);
});

test('the tag reaches every Stripe link on /credits; without a tag, and in the JSON answer, the links are as before', async () => {
  const links = (html) => [...html.matchAll(/href="(https:\/\/buy\.stripe\.com\/[^"]+)"/g)].map((m) => m[1]);
  const plain = links(await (await get('/credits', page)).text());
  assert.ok(plain.length >= 4, 'packs and plans are offered');
  for (const link of plain) assert.match(link, /^https:\/\/buy\.stripe\.com\/[A-Za-z0-9]+$/);
  const tagged = links(await (await get('/credits?utm_source=Hacker%20News&utm_medium=social&utm_campaign=Launch_1', page)).text());
  assert.deepEqual(tagged, plain.map((link) => `${link}?client_reference_id=utm_hacker-news_social_launch-1`));
  for (const link of tagged) assert.match(new URL(link).searchParams.get('client_reference_id'), STRIPE_REFERENCE);
  assert.deepEqual(links(await (await get('/credits?src=glama', page)).text()), plain.map((link) => `${link}?client_reference_id=utm_glama`));
  const json = await (await get('/credits?utm_source=google', { accept: 'application/json' })).text();
  assert.ok(!json.includes('client_reference_id'), 'the JSON answer for agents is not rewritten');
  // A tool quote is never rewritten, whatever its query says.
  const quote = await get('/time?zone=UTC&utm_source=google', page);
  assert.equal(quote.status, 402);
  assert.ok(!(await quote.text()).includes('client_reference_id=utm_'));
});

test('top-up links keep their reference and the claim still reads it; a campaign reference grants the pack exactly as none does', async () => {
  const hash = crypto.createHash('sha256').update('adt_some_key').digest('hex');
  const topUps = L.topUpLinks(hash);
  for (const l of topUps) {
    assert.equal(new URL(l.buy).searchParams.get('client_reference_id'), `topup_${hash}`);
    assert.equal(L.keyHashFromReference(new URL(l.buy).searchParams.get('client_reference_id')), hash);
  }
  const html = topUps.map((l) => `<a class="buy" href="${l.buy}">x</a>`).join('') + L.planLinks(hash).map((l) => `<a href="${l.buy}">y</a>`).join('');
  assert.equal(L.withUtmOnStripeLinks(html, 'utm_google'), html, 'a link that names a key is left alone');

  const session = (client_reference_id) => async () => Response.json({ mode: 'payment', status: 'complete', payment_status: 'paid', currency: 'usd', amount_total: 500, metadata: { adt_credits: '5000' }, client_reference_id });
  const verify = (reference) => L.verifyCheckout('rk_test_fixture', 'cs_live_Measurement0001', session(reference));
  const none = await verify(null);
  assert.deepEqual(none, { usdCents: 500, credits: 5000, topUpKeyHash: undefined, plan: undefined });
  for (const reference of ['utm_google', 'utm_hacker-news_social_launch-1', 'utm_newsletter_-_nov', 'utm_topup_x', 'anything else!', '']) assert.deepEqual(await verify(reference), none, reference);
  assert.deepEqual(await verify(`topup_${hash}`), { ...none, topUpKeyHash: hash });

  // End to end: a purchase whose session carries a campaign reference issues a new key, and the key page, opened with a
  // tag of its own, still shows top-up links that name the key and nothing else.
  const claim = await get('/credits/claim?session_id=cs_live_Measurement0002&utm_source=google', page);
  assert.equal(claim.status, 200);
  const claimed = await claim.text();
  const key = /<pre id="gc-key">(adt_[A-Za-z0-9_-]+)<\/pre>/.exec(claimed)[1];
  const keyHash = crypto.createHash('sha256').update(key).digest('hex');
  const refs = [...claimed.matchAll(/href="https:\/\/buy\.stripe\.com\/[A-Za-z0-9]+\?client_reference_id=([^"&]+)"/g)].map((m) => m[1]);
  assert.ok(refs.length >= 3);
  for (const r of refs) assert.equal(r, `topup_${keyHash}`);
  assert.ok(!claimed.includes('client_reference_id=utm_'));
  const balance = await (await get('/credits/balance', { authorization: `Bearer ${key}` })).json();
  assert.equal(balance.balanceCredits, 1000);
});

test('the privacy page says what the measurement records', async () => {
  const html = await (await get('/privacy', page)).text();
  assert.match(html, /Visit counts without cookies/);
  assert.match(html, /no cookie, no identifier and no address/);
  assert.match(html, /The pages set no tracking cookies: the only cookie is the language choice above, and only after you pick a language\./);
});

test('both wrangler files bind an Analytics Engine dataset and still parse', () => {
  const fs = require('node:fs');
  for (const [file, name] of [['wrangler.jsonc', 'glyphcall_events'], ['wrangler.staging.jsonc', 'glyphcall_events_staging']]) {
    const config = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\s*\/\/.*$/gm, ''));
    assert.deepEqual(config.analytics_engine_datasets, [{ binding: 'ANALYTICS', dataset: name }], file);
  }
});
