// Anthropic SDK setup routes through the real worker (19 Nov 2026): GET /v1/models with the Anthropic header gets an
// Anthropic envelope, and /v1/messages/count_tokens answers locally and free, so the paid POST /v1/messages is reachable.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { build } = require('esbuild');
const { Miniflare, convertV4MiniflareOptions } = require('miniflare');

const supported = {
  kinds: [{ x402Version: 2, scheme: 'exact', network: 'eip155:8453',
    extra: { name: 'USD Coin', version: '2', asset: '0x833589fcd6edb6e08f4c7c32d4f71b54bdA02913', assetTransferMethod: 'eip3009' } }],
  extensions: [],
};

test('the real worker serves Anthropic model list and token count before any paid call', async () => {
  const bundle = await build({ entryPoints: ['src/index.ts'], bundle: true, format: 'esm', platform: 'browser', write: false,
    external: ['cloudflare:workers', 'node:*'], plugins: [{ name: 'fac', setup(b) {
      b.onResolve({ filter: /^url$/ }, () => ({ path: 'node:url', external: true }));
      b.onResolve({ filter: /^\.\/facilitator$/ }, () => ({ path: 'fixture', namespace: 'fac' }));
      b.onLoad({ filter: /.*/, namespace: 'fac' }, () => ({ loader: 'js', contents: `export function buildFacilitator(){return {
        getSupported:async()=>(await fetch('https://facilitator.fixture/supported')).json(),
        verify:async()=>{throw new Error('unsigned setup test must not verify')},
        settle:async()=>{throw new Error('unsigned setup test must not settle')}
      }}` }));
    } }] });
  const mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: bundle.outputFiles[0].text,
    compatibilityDate: '2026-09-01', compatibilityFlags: ['nodejs_compat'],
    durableObjects: { METRICS: { className: 'Metrics', useSQLite: true } },
    bindings: { PAY_TO: '0x2074c40346ae2a90e0e4a391bcee6f16bf5277f5', NETWORK: 'eip155:8453', PAYWALL: 'on', TRIALS_ENABLED: 'off', FACILITATOR_URL: 'https://facilitator.fixture', COLD_SINGLE_ROUTES: '0' },
    outboundService: async request => request.url === 'https://facilitator.fixture/supported'
      ? Response.json(supported) : new Response('unexpected', { status: 500 }),
  }));
  try {
    const models = await mf.dispatchFetch('https://api.test/v1/models', { headers: { 'anthropic-version': '2023-06-01' } });
    assert.equal(models.status, 200);
    assert.equal(models.headers.get('vary'), 'anthropic-version');
    const mj = await models.json();
    assert.equal(mj.has_more, false);
    assert.ok(mj.data.length > 0 && mj.data.every((m) => m.type === 'model' && !/claude/i.test(m.id)));

    // Without the header the OpenAI list is still served.
    const openai = await (await mf.dispatchFetch('https://api.test/v1/models')).json();
    assert.equal(openai.object, 'list');

    const count = await mf.dispatchFetch('https://api.test/v1/messages/count_tokens', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'llama-4-scout', messages: [{ role: 'user', content: 'Hello world' }] }),
    });
    assert.equal(count.status, 200, 'count_tokens is free, not a 402');
    const cj = await count.json();
    assert.ok(cj.input_tokens > 0 && /estimate/i.test(cj.note));
  } finally {
    await mf.dispose();
  }
});
