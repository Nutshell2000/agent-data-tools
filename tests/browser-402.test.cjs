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
