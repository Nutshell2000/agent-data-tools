const assert = require('node:assert/strict');
const { test } = require('node:test');
const { build } = require('esbuild');

async function load(entry) {
  const b = await build({ entryPoints: [entry], bundle: true, format: 'cjs', platform: 'node', write: false, logLevel: 'silent', external: ['cloudflare:workers'] });
  const m = { exports: {} };
  new Function('module', 'exports', 'require', b.outputFiles[0].text)(m, m.exports, require);
  return m.exports;
}

const BASE_USDC = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
const TEMPO_USDC = '0x20c000000000000000000000b9537d11c60e8b50';
const mpp = [{ mpp: { method: 'tempo', intent: 'charge', currency: TEMPO_USDC } }, { mpp: { method: 'evm', intent: 'charge', currency: BASE_USDC } }];

test('every paid operation carries MPP offers in base units next to the AgentCash price', async () => {
  const d = await load('src/discovery.ts');
  const doc = d.openApi('https://api.test', true, mpp);
  let fixed = 0;
  for (const [path, item] of Object.entries(doc.paths)) {
    for (const [method, op] of Object.entries(item)) {
      const info = op['x-payment-info'];
      if (!info) continue;
      assert.ok(info.price && info.protocols, `${method} ${path} keeps price and protocols`);
      assert.equal(info.offers.length, 2, `${method} ${path}`);
      for (const o of info.offers) {
        assert.ok(['evm', 'tempo'].includes(o.method) && o.intent === 'charge');
        if (info.price.mode === 'fixed') {
          assert.equal(o.amount, String(Math.round(Number(info.price.amount) * 1e6)), `${path} ${o.method}`);
          fixed++;
        } else assert.equal(o.amount, null, 'dynamic prices name no amount');
      }
    }
  }
  assert.ok(fixed > 300);
  assert.deepEqual(doc.paths['/time'].get['x-payment-info'].offers[1], { amount: '10000', currency: BASE_USDC, method: 'evm', intent: 'charge' });
  assert.deepEqual(doc.paths['/time'].get['x-payment-info'].offers[0], { amount: '10000', currency: TEMPO_USDC, method: 'tempo', intent: 'charge' });
});

test('card packs offer Stripe in cents; GET fronts and /v1/models describe their 200 body', async () => {
  const c = await load('src/lib/mpp-credits.ts');
  const packs = c.mppCreditOpenApiPaths();
  assert.deepEqual(packs['/credits/buy/5'].get['x-payment-info'].offers, [{ amount: '500', currency: 'usd', method: 'stripe', intent: 'charge' }]);
  assert.deepEqual(packs['/credits/buy/5'].get['x-payment-info'].protocols, [{ mpp: { method: 'stripe', intent: 'charge', currency: 'usd' } }]);
  const d = await load('src/discovery.ts');
  const doc = d.openApi('https://api.test', true, mpp);
  for (const path of ['/v1/chat/completions', '/v1/embeddings', '/v1/responses', '/v1/models']) {
    for (const op of Object.values(doc.paths[path])) {
      const json = op.responses['200'].content?.['application/json'];
      assert.ok(json?.schema, `${path} 200 has a schema`);
    }
  }
});

test('listing tags keep the specific ones within the Bazaar limit of 5', async () => {
  const { listingTags } = await load('src/lib/bazaar-extension.ts');
  assert.deepEqual(listingTags(['base', 'blockchain', 'evm', 'erc20', 'transfers', 'wallet', 'history', 'usdc']), ['base', 'erc20', 'transfers', 'wallet', 'history']);
  assert.deepEqual(listingTags(['a', 'b']), ['a', 'b']);
  const { ENDPOINTS } = await load('src/endpoints.ts');
  for (const e of ENDPOINTS) assert.ok(listingTags(e.tags, e.path).length <= 5);
  // Search-phrase tags come first and every SEARCH_TAGS path is a real tool.
  const { SEARCH_TAGS } = await load('src/lib/bazaar-extension.ts');
  for (const [path, phrases] of Object.entries(SEARCH_TAGS)) {
    const e = ENDPOINTS.find((x) => x.path === path);
    assert.ok(e, path);
    assert.deepEqual(listingTags(e.tags, path).slice(0, phrases.length), [...phrases], path);
  }
  assert.deepEqual(listingTags(['sanctions', 'ofac', 'compliance', 'kyc', 'aml'], '/sanctions/check'), ['sanctions-check', 'ofac-screening', 'sanctions', 'ofac', 'compliance']);
});

test('v1 terms list the inputs; Bazaar inputs carry examples and address patterns', async () => {
  const v1 = await load('src/lib/x402-v1.ts');
  const { ENDPOINTS } = await load('src/endpoints.ts');
  const e = ENDPOINTS.find((x) => x.path === '/eth/balance');
  const [req] = v1.v1Requirements({ PAY_TO: '0x' + '1'.repeat(40), NETWORK: 'eip155:8453' }, e, 'https://api.test/eth/balance?address=0x');
  assert.deepEqual(req.outputSchema.input.queryParams.address, { type: 'string', required: true, description: e.params.address.description });
  const { bazaarExtensionFor } = await load('src/lib/bazaar-extension.ts');
  const props = bazaarExtensionFor(e).bazaar.schema.properties.input.properties.queryParams.properties;
  assert.equal(props.address.pattern, '^0x[0-9a-fA-F]{40}$');
  assert.deepEqual(props.address.examples, [e.params.address.example]);
  const ens = bazaarExtensionFor(ENDPOINTS.find((x) => x.path === '/ens')).bazaar.schema.properties.input.properties.queryParams.properties;
  assert.equal(ens.name.pattern, undefined, 'ENS names are not 0x addresses');
});

test('price tools take tickers: ETH and BTC name the wrapped tokens, addresses pass through, unknown tickers list the known ones', async () => {
  const { tokenAddress } = await load('src/routes/prices.ts');
  assert.equal(tokenAddress('eth', 'base'), '0x4200000000000000000000000000000000000006');
  assert.equal(tokenAddress('BTC', 'base'), '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf');
  assert.equal(tokenAddress('btc', 'arb'), '0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f');
  assert.equal(tokenAddress('ARB', 'arb'), '0x912CE59144191C1204E64559FE8253a0e49E6548');
  assert.equal(tokenAddress('0x940181a94a35a4569e4529a3cdfb74e38fd98631', 'base'), '0x940181a94A35A4569E4529A3CDfB74e38FD98631');
  assert.throws(() => tokenAddress('DOGE', 'base'), /not a 0x token address or a ticker known on this network \(ETH, BTC, SOL, XRP, WETH/);
  assert.throws(() => tokenAddress('OP', 'base'), /known on this network/, 'tickers are per network');
});

test('weather by city: the published example (London) needs no Wikidata call', async () => {
  const { weather } = await load('src/routes/weather.ts');
  const realFetch = globalThis.fetch;
  const asked = [];
  globalThis.fetch = async (url) => {
    asked.push(String(url));
    return Response.json({ geometry: { coordinates: [-0.13, 51.51, 20] }, properties: { meta: { updated_at: '2026-10-20T00:00:00Z' }, timeseries: [{ time: '2026-10-20T10:00:00Z', data: { instant: { details: { air_temperature: 12 } }, next_1_hours: { summary: { symbol_code: 'cloudy' }, details: { precipitation_amount: 0 } } } }] } });
  };
  try {
    const r = await weather(undefined, undefined, '1', 'london, UK');
    assert.equal(r.place, 'London');
    assert.equal(r.latitude, 51.5074);
    assert.equal(asked.length, 1);
    assert.match(asked[0], /api\.met\.no.*lat=51\.5074&lon=-0\.1278/);
  } finally { globalThis.fetch = realFetch; }
});
