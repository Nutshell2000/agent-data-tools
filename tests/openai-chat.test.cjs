const assert = require('node:assert/strict');
const Module = require('node:module');
const { before, after, test } = require('node:test');
const esbuild = require('esbuild');
const { Miniflare, convertV4MiniflareOptions } = require('miniflare');

// The OpenAI-compatible front for /ai/chat: request mapping (unit), and the quote, refusal and model-list behaviour
// with the Worker in Miniflare (no AI binding there, so a paid completion is proven on staging, not here).
async function loadTypeScript(entry) {
  const result = await esbuild.build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'cjs', write: false });
  const loaded = new Module(entry, module);
  loaded.filename = entry;
  loaded.paths = Module._nodeModulePaths(process.cwd());
  loaded._compile(result.outputFiles[0].text, entry);
  return loaded.exports;
}

let lib, mf;
const verified = [];
before(async () => {
  lib = await loadTypeScript('src/lib/openai-chat.ts');
  const b = await esbuild.build({ entryPoints: ['src/index.ts'], bundle: true, format: 'esm', platform: 'browser', write: false, external: ['cloudflare:workers', 'node:*'],
    plugins: [{ name: 'url', setup(b) { b.onResolve({ filter: /^url$/ }, () => ({ path: 'node:url', external: true })); } }] });
  mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: b.outputFiles[0].text, compatibilityDate: '2026-09-01', compatibilityFlags: ['nodejs_compat'],
    durableObjects: { METRICS: { className: 'Metrics', useSQLite: true } },
    bindings: { PAY_TO: '0x2074c40346ae2a90e0e4a391bcee6f16bf5277f5', NETWORK: 'eip155:8453', PAYWALL: 'on', TRIALS_ENABLED: 'off', FACILITATOR_URL: 'https://fixture.invalid', BASE_RPC_URL: 'https://rpc.invalid', MPP_SECRET_KEY: 'mpp-test-secret-fixture' },
    outboundService: async (r) => {
      const u = new URL(r.url);
      if (u.hostname === 'fixture.invalid' && u.pathname.endsWith('/verify')) {
        const sent = await r.json();
        verified.push(sent.paymentPayload);
        return Response.json({ isValid: true, payer: sent.paymentPayload.payload.authorization.from });
      }
      if (u.hostname === 'fixture.invalid') return Response.json({ kinds: [{ x402Version: 2, scheme: 'exact', network: 'eip155:8453', extra: { name: 'USD Coin', version: '2' } }], extensions: [] });
      return new Response('unexpected outbound request', { status: 599 });
    } }));
});
after(async () => { await mf?.dispose(); });

test('maps OpenAI messages onto the /ai/chat query', () => {
  const one = lib.toChatQuery({ messages: [{ role: 'system', content: 'Be brief.' }, { role: 'user', content: 'Hi' }], max_tokens: 50, temperature: 0.2 });
  assert.deepEqual(one, { query: { prompt: 'Hi', system: 'Be brief.', maxTokens: 50, temperature: 0.2 } });
  const multi = lib.toChatQuery({ messages: [{ role: 'user', content: 'What is x402?' }, { role: 'assistant', content: [{ type: 'text', text: 'A payment protocol.' }] }, { role: 'user', content: 'In one sentence?' }] });
  assert.match(multi.query.prompt, /^Conversation so far:\nUser: What is x402\?\n\nAssistant: A payment protocol\.\n\nUser: In one sentence\?\n\nReply to the last user message\.$/);
  assert.equal(multi.query.system, undefined);
  assert.equal(lib.toChatQuery({ messages: [{ role: 'user', content: 'x' }], max_tokens: 5000 }).query.maxTokens, 1024, 'clamped to the tool limit');
  assert.match(lib.toChatQuery({}).error, /messages/);
  assert.match(lib.toChatQuery({ messages: [{ role: 'assistant', content: 'Hello' }] }).error, /last message must be from the user/);
  assert.match(lib.toChatQuery({ messages: [{ role: 'tool', content: 'x' }] }).error, /unsupported message role/);
  assert.match(lib.toChatQuery({ messages: [{ role: 'user', content: 'x' }], stream: true }).error, /streaming/);
  const long = lib.toChatQuery({ messages: [{ role: 'user', content: 'a'.repeat(9000) }] });
  assert.equal(long.query.prompt.length, 8000);
});

test('the model string picks the tool: large names go to /ai/chat-large, everything else to /ai/chat', () => {
  assert.deepEqual(lib.toolFor(undefined), { path: '/ai/chat' });
  assert.deepEqual(lib.toolFor('gpt-4o'), { path: '/ai/chat' });
  assert.deepEqual(lib.toolFor('@cf/meta/llama-3.1-8b-instruct-fp8'), { path: '/ai/chat' });
  assert.deepEqual(lib.toolFor('llama-3.3-70b'), { path: '/ai/chat-large', model: 'llama-3.3-70b' });
  assert.deepEqual(lib.toolFor('@cf/meta/llama-3.3-70b-instruct-fp8-fast'), { path: '/ai/chat-large', model: 'llama-3.3-70b' });
  assert.deepEqual(lib.toolFor('gpt-oss-120b'), { path: '/ai/chat-large', model: 'gpt-oss-120b' });
  assert.equal(lib.toChatQuery({ model: 'llama-3.3-70b', messages: [{ role: 'user', content: 'x' }] }).query.model, 'llama-3.3-70b');
  assert.equal(lib.toChatQuery({ messages: [{ role: 'user', content: 'x' }] }).query.model, undefined);
});

test('an unpaid POST for a large model is quoted at the /ai/chat-large price', async () => {
  const res = await mf.dispatchFetch('https://api.test/v1/chat/completions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: 'gpt-oss-120b', messages: [{ role: 'user', content: 'Hi' }] }) });
  assert.equal(res.status, 402);
  const quote = await res.json();
  assert.equal(quote.accepts[0].maxAmountRequired, '10000');
  assert.equal(res.headers.get('x-tool'), '/ai/chat-large');
  const models = await (await mf.dispatchFetch('https://api.test/v1/models')).json();
  assert.deepEqual(models.data.map((m) => m.id), ['@cf/meta/llama-3.1-8b-instruct-fp8', '@cf/meta/llama-3.3-70b-instruct-fp8-fast', '@cf/openai/gpt-oss-120b']);
});

test('shapes the answer like OpenAI and estimates usage', () => {
  const out = lib.toOpenAiResponse({ prompt: 'Hi there', system: 'Be brief.' }, { model: '@cf/meta/llama-3.1-8b-instruct-fp8', response: 'Hello!' }, 'gpt-4o');
  assert.match(out.id, /^chatcmpl-[0-9a-f]{24}$/);
  assert.equal(out.object, 'chat.completion');
  assert.equal(out.model, '@cf/meta/llama-3.1-8b-instruct-fp8');
  assert.deepEqual(out.choices, [{ index: 0, message: { role: 'assistant', content: 'Hello!' }, finish_reason: 'stop' }]);
  assert.deepEqual(out.usage, { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7, estimated: true });
});

test('an unpaid POST gets the /ai/chat quote with x402 terms and MPP challenges, even with an empty body', async () => {
  for (const body of [JSON.stringify({ messages: [{ role: 'user', content: 'Hi' }] }), '', 'not json']) {
    const res = await mf.dispatchFetch('https://api.test/v1/chat/completions', { method: 'POST', headers: { 'content-type': 'application/json' }, body });
    assert.equal(res.status, 402, `body ${JSON.stringify(body)}`);
    assert.ok(res.headers.get('payment-required'), 'x402 v2 terms');
    assert.match(res.headers.get('www-authenticate') ?? '', /method="evm"/, 'MPP challenge');
    const quote = await res.json();
    assert.equal(quote.x402Version, 1);
    assert.equal(quote.accepts[0].maxAmountRequired, '3000', 'the /ai/chat price');
    assert.equal(quote.accepts[0].resource, 'https://api.test/v1/chat/completions', 'the v1 quote names the front');
    const terms = JSON.parse(Buffer.from(res.headers.get('payment-required'), 'base64').toString());
    assert.equal(terms.resource.url, 'https://api.test/v1/chat/completions', 'the v2 quote names the front, without a query');
    assert.match(terms.resource.description, /^OpenAI-compatible chat completions/);
    assert.ok(terms.extensions.bazaar, 'the tool\'s Bazaar extension stays (the paid retry echoes it)');
  }
});

test('a real x402 client pays the renamed front quote: the retry passes the paywall under the front\'s name', async () => {
  const { x402Client, x402HTTPClient } = await import('@x402/fetch');
  const { ExactEvmScheme } = await import('@x402/evm');
  const { privateKeyToAccount, generatePrivateKey } = await import('viem/accounts');
  const http = new x402HTTPClient(new x402Client().register('eip155:*', new ExactEvmScheme(privateKeyToAccount(generatePrivateKey()))));
  const url = 'https://api.test/v1/chat/completions';
  const init = { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messages: [{ role: 'user', content: 'Hi' }] }) };
  const quote = await mf.dispatchFetch(url, init);
  const required = http.getPaymentRequiredResponse((n) => quote.headers.get(n), await quote.json());
  const payload = await http.createPaymentPayload(required);
  verified.length = 0;
  const paid = await mf.dispatchFetch(url, { ...init, headers: { ...init.headers, ...http.encodePaymentSignatureHeader(payload) } });
  await paid.arrayBuffer();
  assert.notEqual(paid.status, 402, 'not refused: matching ignores the renamed resource and the echoed extension is the tool\'s');
  assert.equal(verified.length, 1, 'the facilitator verified the payment');
  assert.equal(verified[0].resource.url, url, 'the payment (and so its settlement) names the front');
});

test('invalid input with a payment attached is refused before anything is charged', async () => {
  const res = await mf.dispatchFetch('https://api.test/v1/chat/completions', { method: 'POST', headers: { 'content-type': 'application/json', 'payment-signature': 'eyJmYWtlIjp0cnVlfQ' }, body: JSON.stringify({ messages: [] }) });
  assert.equal(res.status, 400);
  const err = await res.json();
  assert.equal(err.error.type, 'invalid_request_error');
  assert.match(err.error.message, /messages/);
});

test('a GET carries the same inputs in the query: a bare GET is quoted, prompt= is forwarded, paid nonsense is refused', async () => {
  assert.equal(lib.chatBodyFromQuery({}), null);
  assert.deepEqual(lib.chatBodyFromQuery({ prompt: 'Hi', system: 'Be brief.', model: 'gpt-oss-120b', max_tokens: '50', temperature: '0.2' }),
    { messages: [{ role: 'system', content: 'Be brief.' }, { role: 'user', content: 'Hi' }], model: 'gpt-oss-120b', max_tokens: 50, temperature: 0.2 });
  assert.deepEqual(lib.chatBodyFromQuery({ input: 'Hi' }).messages, [{ role: 'user', content: 'Hi' }]);
  assert.deepEqual(lib.chatBodyFromQuery({ messages: '[{"role":"user","content":"Yo"}]' }).messages, [{ role: 'user', content: 'Yo' }]);
  const bare = await mf.dispatchFetch('https://api.test/v1/chat/completions');
  assert.equal(bare.status, 402, 'a bare GET gets the quote, like a bare POST');
  assert.ok(bare.headers.get('payment-required'));
  await bare.arrayBuffer();
  const get = await mf.dispatchFetch('https://api.test/v1/chat/completions?prompt=Hi&model=llama-3.3-70b');
  assert.equal(get.status, 402);
  const quote = await get.json();
  assert.equal(quote.accepts[0].maxAmountRequired, '10000');
  assert.equal(quote.accepts[0].resource, 'https://api.test/v1/chat/completions');
  const head = await mf.dispatchFetch('https://api.test/v1/chat/completions?prompt=Hi', { method: 'HEAD' });
  assert.equal(head.status, 402);
  await head.arrayBuffer();
  const bad = await mf.dispatchFetch('https://api.test/v1/chat/completions', { headers: { 'payment-signature': 'eyJmYWtlIjp0cnVlfQ' } });
  assert.equal(bad.status, 400, 'a paid GET without a prompt is refused before anything is forwarded');
  await bad.arrayBuffer();
});

test('/v1/models is free; OpenAPI declares the POST, the GET variant and the model list', async () => {
  const models = await (await mf.dispatchFetch('https://api.test/v1/models')).json();
  assert.equal(models.object, 'list');
  assert.equal(models.data[0].id, '@cf/meta/llama-3.1-8b-instruct-fp8');
  const api = await (await mf.dispatchFetch('https://api.test/openapi.json')).json();
  const post = api.paths['/v1/chat/completions'].post;
  assert.deepEqual(post['x-payment-info'].price, { mode: 'dynamic', currency: 'USD', min: '0.003', max: '0.01' });
  assert.deepEqual(post['x-payment-info'].protocols[0], { x402: {} });
  assert.ok(post.requestBody.content['application/json'].schema.properties.messages);
  const get = api.paths['/v1/chat/completions'].get;
  assert.deepEqual(get['x-payment-info'], post['x-payment-info']);
  assert.deepEqual(get.parameters.map((p) => [p.name, p.required]), [['prompt', true], ['system', false], ['model', false], ['max_tokens', false], ['temperature', false]]);
  assert.equal(get.responses['402'].description, 'Payment Required');
  assert.deepEqual(api.paths['/v1/models'].get.security, []);
});
