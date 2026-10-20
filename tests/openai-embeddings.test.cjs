const assert = require('node:assert/strict');
const Module = require('node:module');
const { before, after, test } = require('node:test');
const esbuild = require('esbuild');
const { Miniflare, convertV4MiniflareOptions } = require('miniflare');

async function loadTypeScript(entry) {
  const result = await esbuild.build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'cjs', write: false });
  const loaded = new Module(entry, module);
  loaded.filename = entry;
  loaded.paths = Module._nodeModulePaths(process.cwd());
  loaded._compile(result.outputFiles[0].text, entry);
  return loaded.exports;
}

let lib, mf;
before(async () => {
  lib = await loadTypeScript('src/lib/openai-embeddings.ts');
  const b = await esbuild.build({ entryPoints: ['src/index.ts'], bundle: true, format: 'esm', platform: 'browser', write: false, external: ['cloudflare:workers', 'node:*'],
    plugins: [{ name: 'url', setup(b) { b.onResolve({ filter: /^url$/ }, () => ({ path: 'node:url', external: true })); } }] });
  mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: b.outputFiles[0].text, compatibilityDate: '2026-09-01', compatibilityFlags: ['nodejs_compat'],
    durableObjects: { METRICS: { className: 'Metrics', useSQLite: true } },
    bindings: { PAY_TO: '0x2074c40346ae2a90e0e4a391bcee6f16bf5277f5', NETWORK: 'eip155:8453', PAYWALL: 'on', TRIALS_ENABLED: 'off', FACILITATOR_URL: 'https://fixture.invalid', BASE_RPC_URL: 'https://rpc.invalid', MPP_SECRET_KEY: 'mpp-test-secret-fixture' },
    outboundService: async (r) => {
      if (new URL(r.url).hostname === 'fixture.invalid') return Response.json({ kinds: [{ x402Version: 2, scheme: 'exact', network: 'eip155:8453', extra: { name: 'USD Coin', version: '2' } }], extensions: [] });
      return new Response('unexpected outbound request', { status: 599 });
    } }));
});
after(async () => { await mf?.dispose(); });

test('accepts one input string or a one-item array, refuses the rest', () => {
  assert.deepEqual(lib.toEmbedText({ input: ' hello ' }), { text: 'hello' });
  assert.deepEqual(lib.toEmbedText({ input: ['hello'] }), { text: 'hello' });
  assert.match(lib.toEmbedText({ input: ['a', 'b'] }).error, /one input per request/);
  assert.match(lib.toEmbedText({ input: [] }).error, /one input per request/);
  assert.match(lib.toEmbedText({ input: '' }).error, /non-empty/);
  assert.match(lib.toEmbedText({ input: 'x'.repeat(4001) }).error, /4000/);
  assert.match(lib.toEmbedText(null).error, /input string/);
  const out = lib.toOpenAiEmbedding('hello world', { embedding: [0.1, 0.2], model: '@cf/baai/bge-m3' });
  assert.deepEqual(out, { object: 'list', data: [{ object: 'embedding', index: 0, embedding: [0.1, 0.2] }], model: '@cf/baai/bge-m3', usage: { prompt_tokens: 3, total_tokens: 3, estimated: true } });
});

test('an unpaid POST gets the /ai/embed quote; a multi-input body with a payment is refused unpaid; OpenAPI declares it', async () => {
  const res = await mf.dispatchFetch('https://api.test/v1/embeddings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ input: 'hello' }) });
  assert.equal(res.status, 402);
  assert.ok(res.headers.get('payment-required'));
  assert.match(res.headers.get('www-authenticate') ?? '', /method="evm"/);
  const quote = await res.json();
  assert.equal(quote.accepts[0].maxAmountRequired, '3000');
  assert.match(quote.accepts[0].resource, /\/ai\/embed\?text=hello/);
  const bad = await mf.dispatchFetch('https://api.test/v1/embeddings', { method: 'POST', headers: { 'content-type': 'application/json', 'payment-signature': 'eyJmYWtlIjp0cnVlfQ' }, body: JSON.stringify({ input: ['a', 'b'] }) });
  assert.equal(bad.status, 400);
  assert.match((await bad.json()).error.message, /one input per request/);
  const get = await mf.dispatchFetch('https://api.test/v1/embeddings');
  assert.equal(get.status, 405);
  await get.arrayBuffer();
  const api = await (await mf.dispatchFetch('https://api.test/openapi.json')).json();
  const post = api.paths['/v1/embeddings'].post;
  assert.equal(post['x-payment-info'].price.amount, '0.003');
  assert.ok(post.requestBody.content['application/json'].schema.properties.input);
});
