// POST /v1/audio/speech: OpenAI's text-to-speech request shape as a front for /ai/speech (up to 300 characters) and
// /text-to-speech (up to 2,000), answered with the audio file itself.
const assert = require('node:assert/strict');
const { before, after, test } = require('node:test');
const { build } = require('esbuild');
const { Miniflare, convertV4MiniflareOptions } = require('miniflare');

async function load(entry) {
  const b = await build({ entryPoints: [entry], bundle: true, format: 'cjs', platform: 'node', write: false, logLevel: 'silent' });
  const m = { exports: {} };
  new Function('module', 'exports', 'require', b.outputFiles[0].text)(m, m.exports, require);
  return m.exports;
}

test('OpenAI speech body: input, voice, format and length decide the tool', async () => {
  const lib = await load('src/lib/openai-speech.ts');
  const ai = await load('src/routes/ai-text.ts');
  assert.equal(lib.SPEECH_SHORT_LIMIT, ai.SPEECH_MAX, 'the front routes on the short tool\'s own limit');
  assert.equal(lib.SPEECH_INPUT_LIMIT, ai.SPEECH_LONG_MAX);
  assert.deepEqual(lib.toSpeechRequest({ model: 'tts-1', input: ' Hello there. ', voice: 'Nova' }), { text: 'Hello there.', voice: 'nova', tool: '/ai/speech' });
  assert.equal(lib.toSpeechRequest({ input: 'x'.repeat(300) }).tool, '/ai/speech');
  assert.equal(lib.toSpeechRequest({ input: 'x'.repeat(301) }).tool, '/text-to-speech');
  assert.equal(lib.toSpeechRequest({ input: 'x'.repeat(2000) }).tool, '/text-to-speech');
  assert.match(lib.toSpeechRequest({ input: 'x'.repeat(2001) }).error, /at most 2000/);
  assert.match(lib.toSpeechRequest({ voice: 'nova' }).error, /input is required/);
  assert.match(lib.toSpeechRequest(null).error, /JSON object/);
  // Only what the tools can return is accepted; a paying caller is told before anything is charged.
  assert.match(lib.toSpeechRequest({ input: 'Hi', response_format: 'wav' }).error, /mp3/);
  assert.equal(lib.toSpeechRequest({ input: 'Hi', response_format: 'MP3' }).tool, '/ai/speech');
  assert.match(lib.toSpeechRequest({ input: 'Hi', speed: 1.5 }).error, /speed/);
  assert.equal(lib.toSpeechRequest({ input: 'Hi', speed: 1 }).tool, '/ai/speech');
  // A voice object ({ id }) and a language are read; an unknown language is refused.
  assert.equal(lib.toSpeechRequest({ input: 'Hola', voice: { id: 'Aquila' }, language: 'es-ES' }).voice, 'aquila');
  assert.equal(lib.toSpeechRequest({ input: 'Hola', language: 'es-ES' }).lang, 'es');
  assert.match(lib.toSpeechRequest({ input: 'Hallo', language: 'de' }).error, /en or es/);
  // GET: input or text in the query.
  assert.equal(lib.speechBodyFromQuery({ input: 'Hi', voice: 'alloy' }).input, 'Hi');
  assert.equal(lib.speechBodyFromQuery({ text: 'Hi' }).input, 'Hi');
  assert.equal(lib.speechBodyFromQuery({}), null);
  assert.deepEqual([...lib.audioBytes('SUQz')], [0x49, 0x44, 0x33]);
});

let mf;
const O = 'https://api.test';
before(async () => {
  const b = await build({ entryPoints: ['src/index.ts'], bundle: true, format: 'esm', platform: 'browser', write: false, external: ['cloudflare:workers', 'node:*'],
    plugins: [{ name: 'url', setup(b) { b.onResolve({ filter: /^url$/ }, () => ({ path: 'node:url', external: true })); } }] });
  mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: b.outputFiles[0].text, compatibilityDate: '2026-09-01', compatibilityFlags: ['nodejs_compat'],
    durableObjects: { METRICS: { className: 'Metrics', useSQLite: true } },
    bindings: { PAY_TO: '0x2074c40346ae2a90e0e4a391bcee6f16bf5277f5', NETWORK: 'eip155:8453', PAYWALL: 'on', TRIALS_ENABLED: 'on', FACILITATOR_URL: 'https://fixture.invalid', BASE_RPC_URL: 'https://fixture.invalid' },
    outboundService: async (r) => (new URL(r.url).hostname === 'fixture.invalid'
      ? Response.json({ kinds: [{ x402Version: 2, scheme: 'exact', network: 'eip155:8453', extra: { name: 'USD Coin', version: '2' } }], extensions: [] })
      : new Response('no network in this test', { status: 500 })) }));
});
after(async () => { await mf?.dispose(); });
const quote = async (res) => JSON.parse(Buffer.from(res.headers.get('PAYMENT-REQUIRED'), 'base64').toString());
const post = (body, headers = {}) => mf.dispatchFetch(`${O}/v1/audio/speech`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

test('/v1/audio/speech quotes under its own name, at the price of the tool the input needs', async () => {
  const { ENDPOINTS } = await load('src/endpoints.ts');
  const atomic = (path) => String(Math.round(Number(ENDPOINTS.find((e) => e.path === path).price.replace('$', '')) * 1e6));
  const short = await post({ model: 'tts-1', input: 'Hello there.', voice: 'nova' });
  assert.equal(short.status, 402);
  const q = await quote(short);
  assert.equal(q.resource.url, `${O}/v1/audio/speech`);
  assert.match(q.resource.description, /text to speech/i);
  assert.equal(q.accepts[0].amount, atomic('/ai/speech'));
  assert.equal(short.headers.get('X-Tool'), '/ai/speech');
  // Longer input is the long tool's price; the quote says which tool it maps to.
  const long = await post({ input: 'A sentence that is read aloud. '.repeat(20), voice: 'alloy' });
  assert.equal(long.status, 402);
  assert.equal((await quote(long)).accepts[0].amount, atomic('/text-to-speech'));
  assert.equal(long.headers.get('X-Tool'), '/text-to-speech');
  // An empty probe (what validators and marketplace consoles send) still gets a real quote; so does a GET.
  const empty = await mf.dispatchFetch(`${O}/v1/audio/speech`, { method: 'POST' });
  assert.equal(empty.status, 402);
  assert.equal((await quote(empty)).accepts[0].amount, atomic('/ai/speech'));
  const get = await mf.dispatchFetch(`${O}/v1/audio/speech?input=Hello%20there.&voice=nova`);
  assert.equal(get.status, 402);
  assert.equal((await quote(get)).resource.url, `${O}/v1/audio/speech`);
});

test('/v1/audio/speech refuses what it cannot return before any payment is used, and is in the OpenAPI document', async () => {
  for (const body of [{ input: 'Hi', response_format: 'wav' }, { input: 'x'.repeat(2001) }, { voice: 'nova' }]) {
    const res = await post(body, { 'x-payment': 'not-a-real-payment' });
    assert.equal(res.status, 400, JSON.stringify(body).slice(0, 60));
    assert.equal((await res.json()).error.type, 'invalid_request_error');
  }
  const doc = await (await mf.dispatchFetch(`${O}/openapi.json`)).json();
  const path = doc.paths['/v1/audio/speech'];
  assert.ok(path.post && path.get);
  assert.equal(path.post['x-payment-info'].price.mode, 'dynamic');
  assert.ok(path.post.responses['200'].content['audio/mpeg']);
  assert.match(path.post.description, /alloy/);
});
