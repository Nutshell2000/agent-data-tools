const { getAddress } = require('viem');
const assert = require('node:assert/strict');
const { before, after, test } = require('node:test');
const { build } = require('esbuild');
const { Miniflare, convertV4MiniflareOptions } = require('miniflare');

// The seller-side discovery index (/discovery/resources) and the manifest aliases, with the Worker in Miniflare.
const PAY_TO = '0x2074c40346ae2a90e0e4a391bcee6f16bf5277f5';
let mf;

before(async () => {
  const b = await build({ entryPoints: ['src/index.ts'], bundle: true, format: 'esm', platform: 'browser', write: false, external: ['cloudflare:workers', 'node:*'],
    plugins: [{ name: 'url', setup(b) { b.onResolve({ filter: /^url$/ }, () => ({ path: 'node:url', external: true })); } }] });
  mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: b.outputFiles[0].text, compatibilityDate: '2026-09-01', compatibilityFlags: ['nodejs_compat'],
    durableObjects: { METRICS: { className: 'Metrics', useSQLite: true } },
    bindings: { PAY_TO, NETWORK: 'eip155:8453', EXTRA_NETWORKS: 'eip155:137,eip155:42161,eip155:143,eip155:480', PAYWALL: 'on', TRIALS_ENABLED: 'off', FACILITATOR_URL: 'https://fixture.invalid', BASE_RPC_URL: 'https://rpc.invalid' },
    outboundService: async (r) => {
      // The facilitator supports every network the fixture offers, so the paywall can quote them all.
      if (new URL(r.url).hostname === 'fixture.invalid') return Response.json({ kinds: ['eip155:8453', 'eip155:137', 'eip155:42161', 'eip155:143', 'eip155:480'].map((network) => ({ x402Version: 2, scheme: 'exact', network })), extensions: [] });
      return new Response('unexpected outbound request', { status: 599 });
    } }));
});
after(async () => { await mf?.dispose(); });

test('/discovery/resources lists every tool in the Bazaar item shape, with exact USDC terms per network', async () => {
  const res = await mf.dispatchFetch('https://api.test/discovery/resources?limit=500');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.x402Version, 2);
  assert.equal(body.pagination.total, body.items.length);
  assert.ok(body.pagination.total >= 170);
  const manifest = await (await mf.dispatchFetch('https://api.test/.well-known/x402')).json();
  assert.deepEqual(body.items.map((i) => i.resource), manifest.resources, 'same resources, same order, as the manifest');
  const time = body.items.find((i) => i.resource === 'https://api.test/time');
  assert.equal(time.type, 'http');
  assert.equal(time.x402Version, 2);
  assert.match(time.lastUpdated, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(time.metadata.serviceName, 'Timezone, current time in a zone', 'per-tool name, not the shared brand');
  assert.ok(time.metadata.description.length > 20 && time.metadata.description.length <= 500);
  assert.deepEqual(time.accepts.map((a) => a.network), ['eip155:8453', 'eip155:137', 'eip155:42161', 'eip155:143', 'eip155:480']);
  for (const a of time.accepts) {
    assert.equal(a.scheme, 'exact');
    assert.equal(a.amount, '10000');
    assert.equal(a.payTo, getAddress(PAY_TO), "payTo is quoted checksummed (EIP-55)");
    assert.match(a.asset, /^0x[0-9a-fA-F]{40}$/);
    assert.equal(a.maxTimeoutSeconds, 300);
    assert.equal(a.extra.version, '2');
  }
  assert.equal(time.accepts[0].extra.name, 'USD Coin');
  assert.equal(time.accepts[0].asset, '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913');
  assert.equal(time.accepts[4].extra.name, 'USDC', 'World Chain USDC signs with the short domain name');
  // The terms match what the live 402 quotes for the same tool.
  const quote = await mf.dispatchFetch('https://api.test/time?zone=UTC');
  assert.equal(quote.status, 402);
  const required = JSON.parse(Buffer.from(quote.headers.get('payment-required'), 'base64').toString());
  const live = required.accepts.find((a) => a.network === 'eip155:8453');
  assert.equal(live.amount, time.accepts[0].amount);
  assert.equal(live.asset.toLowerCase(), time.accepts[0].asset.toLowerCase());
  assert.equal(live.payTo.toLowerCase(), time.accepts[0].payTo.toLowerCase());
  assert.deepEqual(live.extra, time.accepts[0].extra);
});

test('without a limit the first page holds every tool, best sellers first and toys last', async () => {
  const page = await (await mf.dispatchFetch('https://api.test/discovery/resources')).json();
  assert.equal(page.items.length, page.pagination.total, 'one page, the whole catalog');
  const paths = page.items.map((i) => new URL(i.resource).pathname);
  assert.deepEqual(paths.slice(0, 3), ['/check/payee', '/check/counterparty', '/check/x402-seller']);
  assert.ok(paths.indexOf('/hyperliquid/market') < 20 && paths.indexOf('/sec/filings') < 20, 'demanded data tools near the top');
  const firstToy = paths.findIndex((p) => /^\/(coin|dice|random\/|magic-8-ball|yes-no|echo|ping)/.test(p));
  assert.ok(firstToy > paths.length - 15, `toys at the end (first at ${firstToy})`);
  assert.equal(new Set(paths).size, paths.length, 'no tool twice');
});

test('paging and the manifest aliases', async () => {
  const page = await (await mf.dispatchFetch('https://api.test/discovery/resources?limit=2&offset=3')).json();
  assert.equal(page.items.length, 2);
  assert.deepEqual(page.pagination, { limit: 2, offset: 3, total: page.pagination.total });
  const all = await (await mf.dispatchFetch('https://api.test/discovery/resources?limit=9999')).json();
  assert.equal(all.pagination.limit, 500);
  const bad = await (await mf.dispatchFetch('https://api.test/discovery/resources?limit=abc&offset=-5')).json();
  assert.equal(bad.pagination.limit, 500);
  assert.equal(bad.pagination.offset, 0);
  const json = await (await mf.dispatchFetch('https://api.test/.well-known/x402.json')).json();
  const plain = await (await mf.dispatchFetch('https://api.test/.well-known/x402')).json();
  assert.deepEqual(json, plain);
  assert.equal(json.discovery, 'https://api.test/discovery/resources');
});

test('listingName: every tool gets its own 32-character printable-ASCII serviceName, cut cleanly', async () => {
  const b = await build({ stdin: { contents: 'export { ENDPOINTS } from "./src/discovery"; export { listingName } from "./src/lib/bazaar-extension";', resolveDir: process.cwd(), loader: 'ts' }, bundle: true, format: 'cjs', platform: 'node', write: false, external: ['cloudflare:workers'], logLevel: 'silent' });
  const m = { exports: {} }; new Function('module', 'exports', 'require', b.outputFiles[0].text)(m, m.exports, require);
  const { ENDPOINTS, listingName } = m.exports;
  const names = ENDPOINTS.map((e) => listingName(e.summary));
  for (const n of names) assert.match(n, /^[\x20-\x7e]{1,32}$/, n);
  assert.equal(new Set(names).size, names.length, 'no two tools share a name');
  assert.equal(listingName('Weather forecast: current weather and 48-hour hourly forecast'), 'Weather forecast');
  assert.equal(listingName('SEC EDGAR filings for a US public company'), 'SEC EDGAR filings');
  assert.equal(listingName('Text embeddings (BGE-M3, 1,024 dimensions)'), 'Text embeddings');
  assert.equal(listingName('Sourced token and wallet risk indicators with market facts'), 'Sourced token and wallet risk');
});

// agents-trust and Agent402 probe a seller repeatedly and penalise terms that change between probes.
test('two quotes in a row carry identical payment terms, Base first, at the new payee price', async () => {
  const quote = async () => {
    const res = await mf.dispatchFetch('https://api.test/check/payee?address=0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045', { headers: { accept: 'application/json' } });
    assert.equal(res.status, 402);
    return JSON.parse(Buffer.from(res.headers.get('payment-required'), 'base64').toString());
  };
  const [a, b] = [await quote(), await quote()];
  const terms = (q) => q.accepts.map(({ scheme, network, asset, payTo, amount, maxTimeoutSeconds }) => ({ scheme, network, asset, payTo, amount, maxTimeoutSeconds }));
  assert.deepEqual(terms(a), terms(b));
  assert.equal(a.accepts[0].network, 'eip155:8453');
  assert.equal(a.accepts[0].amount, '5000');
  assert.deepEqual(a.resource, b.resource);
});

// Node's fetch (undici) refuses a response whose headers exceed 16 KB. /extract's 402 reached 16.7 KB in production
// on 22 Oct (PAYMENT-REQUIRED 14.4 KB plus two MPP challenges), so Node agents could not read its quote. Production
// adds about 1.5 KB (the Tempo challenge and edge headers) to what this fixture sends; keep a margin under 16 KB.
test('every tool quote fits a Node client: headers well under 16 KB', async () => {
  const { build: b2 } = require('esbuild');
  const Module = require('node:module');
  const entry = require.resolve('../src/endpoints.ts');
  const out = await b2({ entryPoints: [entry], bundle: true, platform: 'node', format: 'cjs', write: false });
  const loaded = new Module(entry, module); loaded.filename = entry; loaded.paths = Module._nodeModulePaths(process.cwd());
  loaded._compile(out.outputFiles[0].text, entry);
  const { ENDPOINTS, exampleParams } = loaded.exports;
  let largest = { path: '', bytes: 0 };
  for (const e of ENDPOINTS) {
    const query = new URLSearchParams(exampleParams(e).map(([k, p]) => [k, String(p.example)])).toString();
    const res = await mf.dispatchFetch(`https://api.test${e.path}${query ? `?${query}` : ''}`, { headers: { accept: 'application/json' } });
    await res.arrayBuffer();
    if (res.status !== 402) continue;
    let bytes = 0;
    for (const [k, v] of res.headers) bytes += k.length + v.length + 4;
    if (bytes > largest.bytes) largest = { path: e.path, bytes };
    assert.ok(bytes <= 13_000, `${e.path}: ${bytes} header bytes`);
  }
  assert.ok(largest.bytes > 0, 'quotes were measured');
});

// Every quote and every answer names three related tools: a Link header (RFC 8288) and, in the readable 402 body, a list.
test('a quote carries related tools as Link header and body list; a free sample answer carries the Link header too', async () => {
  const quote = await mf.dispatchFetch('https://api.test/btc-fees', { headers: { accept: 'application/json' } });
  assert.equal(quote.status, 402);
  const link = quote.headers.get('link') ?? '';
  assert.equal((link.match(/rel="related"/g) ?? []).length, 3, link);
  assert.match(link, /<https:\/\/api\.test\/[a-z0-9/-]+>; rel="related"; title="[^"]+"/);
  const body = await quote.json();
  assert.equal(body.related.length, 3);
  for (const r of body.related) { assert.match(r.url, /^https:\/\/api\.test\//); assert.match(r.price, /^\$/); assert.ok(r.name); }
  assert.ok(body.related.every((r) => !r.url.endsWith('/btc-fees')));
  const sample = await mf.dispatchFetch('https://api.test/time?zone=UTC&sample=1', { headers: { accept: 'application/json' } });
  assert.equal(sample.status, 200);
  assert.equal(((sample.headers.get('link') ?? '').match(/rel="related"/g) ?? []).length, 3);
});
