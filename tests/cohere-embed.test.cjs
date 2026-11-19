// Cohere v2 (the default SDK generation) embed alias over the paid /ai/embed tool (19 Nov 2026). Read-only tests.
const assert = require('node:assert/strict');
const Module = require('node:module');
const { before, after, test } = require('node:test');
const esbuild = require('esbuild');
const { Miniflare, convertV4MiniflareOptions } = require('miniflare');

async function loadTypeScript(entry) {
  const result = await esbuild.build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'cjs', write: false });
  const loaded = new Module(entry, module); loaded.filename = entry; loaded.paths = Module._nodeModulePaths(process.cwd());
  loaded._compile(result.outputFiles[0].text, entry); return loaded.exports;
}

let lib, mf;
before(async () => {
  lib = await loadTypeScript('src/lib/cohere-embed.ts');
  const b = await esbuild.build({ entryPoints: ['src/index.ts'], bundle: true, format: 'esm', platform: 'browser', write: false,
    external: ['cloudflare:workers', 'node:*'], plugins: [{ name: 'url', setup(b) { b.onResolve({ filter: /^url$/ }, () => ({ path: 'node:url', external: true })); } }] });
  mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: b.outputFiles[0].text, compatibilityDate: '2026-09-01', compatibilityFlags: ['nodejs_compat'],
    durableObjects: { METRICS: { className: 'Metrics', useSQLite: true } },
    bindings: { PAY_TO: '0x2074c40346ae2a90e0e4a391bcee6f16bf5277f5', NETWORK: 'eip155:8453', PAYWALL: 'on', TRIALS_ENABLED: 'off', FACILITATOR_URL: 'https://fixture.invalid' },
    outboundService: async (r) => {
      if (new URL(r.url).hostname === 'fixture.invalid') return Response.json({ kinds: [{ x402Version: 2, scheme: 'exact', network: 'eip155:8453', extra: { name: 'USD Coin', version: '2', asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', assetTransferMethod: 'eip3009' } }], extensions: [] });
      return new Response('unexpected outbound request', { status: 599 });
    } }));
});
after(async () => { await mf?.dispose(); });

test('Cohere v2 embed maps one text and answers in the official v2 envelope', () => {
  assert.equal(lib.COHERE_EMBED_V2_PATH, '/v2/embed');
  assert.deepEqual(lib.toCohereEmbedText({ model: 'embed-v5.0-fast', input_type: 'search_document', texts: [' hello '] }), { text: 'hello' });
  assert.match(lib.toCohereEmbedText({ texts: ['a', 'b'] }).error, /one text per request/);
  assert.match(lib.toCohereEmbedText({ texts: 'hello' }).error, /array/);
  const out = lib.toCohereEmbed('hello world', { embedding: [0.1, 0.2] });
  assert.ok(out.id);
  assert.deepEqual(out.embeddings.float, [[0.1, 0.2]]);
  assert.deepEqual(out.texts, ['hello world']);
  assert.equal(out.meta.api_version.version, '2');
  assert.equal(out.meta.billed_units.input_tokens, 3);
});

test('the real worker quotes /v2/embed at the /ai/embed price, not a 404', async () => {
  const res = await mf.dispatchFetch('https://api.test/v2/embed', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: 'embed-v5.0-fast', input_type: 'search_document', texts: ['hello'] }) });
  assert.equal(res.status, 402, 'Cohere v2 SDK gets a payment quote, not a 404');
  assert.ok(res.headers.get('payment-required'));
  const quote = await res.json();
  assert.equal(quote.resource.url, 'https://api.test/v2/embed');
  assert.equal(res.headers.get('x-tool'), '/ai/embed');
  const bad = await mf.dispatchFetch('https://api.test/v2/embed', { method: 'POST', headers: { 'content-type': 'application/json', 'payment-signature': 'eyJmYWtlIjp0cnVlfQ' }, body: JSON.stringify({ texts: ['a', 'b'], input_type: 'search_query' }) });
  assert.equal(bad.status, 400);
  assert.match((await bad.json()).message, /one text per request/);
});
