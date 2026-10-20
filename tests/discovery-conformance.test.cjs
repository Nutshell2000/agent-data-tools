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
  assert.deepEqual(doc.paths['/time'].get['x-payment-info'].offers[1], { amount: '3000', currency: BASE_USDC, method: 'evm', intent: 'charge' });
  assert.deepEqual(doc.paths['/time'].get['x-payment-info'].offers[0], { amount: '3000', currency: TEMPO_USDC, method: 'tempo', intent: 'charge' });
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
  for (const e of ENDPOINTS) assert.ok(listingTags(e.tags).length <= 5);
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
