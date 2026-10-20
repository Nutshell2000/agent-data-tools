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
  lib = await loadTypeScript('src/lib/openai-responses.ts');
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

test('maps a Responses body onto the chat-completions body', () => {
  assert.deepEqual(lib.toChatBody({ model: 'gpt-oss-120b', instructions: 'Be brief.', input: 'Hi', max_output_tokens: 50, temperature: 0.1 }),
    { model: 'gpt-oss-120b', messages: [{ role: 'system', content: 'Be brief.' }, { role: 'user', content: 'Hi' }], max_tokens: 50, temperature: 0.1, stream: undefined });
  const multi = lib.toChatBody({ input: [{ role: 'user', content: [{ type: 'input_text', text: 'What is x402?' }] }, { role: 'assistant', content: 'A protocol.' }, { role: 'user', content: 'Shorter?' }] });
  assert.deepEqual(multi.messages, [{ role: 'user', content: 'What is x402?' }, { role: 'assistant', content: 'A protocol.' }, { role: 'user', content: 'Shorter?' }]);
  assert.equal(lib.toChatBody('nope'), null);
  const out = lib.toResponsesAnswer({ prompt: 'Hi there', system: 'Be brief.' }, { model: '@cf/meta/llama-3.1-8b-instruct-fp8', response: 'Hello!' });
  assert.match(out.id, /^resp_[0-9a-f]{24}$/);
  assert.equal(out.object, 'response');
  assert.equal(out.status, 'completed');
  assert.equal(out.output[0].content[0].text, 'Hello!');
  assert.equal(out.output_text, 'Hello!');
  assert.deepEqual(out.usage, { input_tokens: 5, output_tokens: 2, total_tokens: 7, estimated: true });
});

test('an unpaid POST /v1/responses is quoted like the chat tool, a large model at the large price, bad input refused unpaid', async () => {
  const res = await mf.dispatchFetch('https://api.test/v1/responses', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ input: 'Hi' }) });
  assert.equal(res.status, 402);
  assert.ok(res.headers.get('payment-required'));
  const quote = await res.json();
  assert.equal(quote.accepts[0].maxAmountRequired, '3000');
  assert.match(quote.accepts[0].resource, /\/ai\/chat\?prompt=Hi/);
  const large = await (await mf.dispatchFetch('https://api.test/v1/responses', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: 'llama-3.3-70b', input: 'Hi' }) })).json();
  assert.equal(large.accepts[0].maxAmountRequired, '10000');
  const bad = await mf.dispatchFetch('https://api.test/v1/responses', { method: 'POST', headers: { 'content-type': 'application/json', 'payment-signature': 'eyJmYWtlIjp0cnVlfQ' }, body: JSON.stringify({ input: [] }) });
  assert.equal(bad.status, 400);
  const get = await mf.dispatchFetch('https://api.test/v1/responses');
  assert.equal(get.status, 405);
  await get.arrayBuffer();
  const api = await (await mf.dispatchFetch('https://api.test/openapi.json')).json();
  assert.deepEqual(api.paths['/v1/responses'].post['x-payment-info'].price, { mode: 'dynamic', currency: 'USD', min: '0.003', max: '0.01' });
});
