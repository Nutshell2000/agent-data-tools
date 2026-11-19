// The voice API for apps leaving OpenAI's tts-1 and whisper-1 (16 Nov 2026): what a prepaid key pays on the /v1 voice
// fronts (lib/voice-billing.ts), the free voice test key and the free trial key (lib/voice-keys.ts), the model list and
// the key refusals a person can read. Run against the whole Worker in Miniflare with a fake AI binding, a KV namespace
// and the real Metrics object, so the counters and the ledger are the ones production uses.
const assert = require('node:assert/strict');
const Module = require('node:module');
const { before, after, test } = require('node:test');
const { build } = require('esbuild');
const { Miniflare, convertV4MiniflareOptions } = require('miniflare');

async function load(entry) {
  const result = await build({ entryPoints: [require.resolve(entry)], bundle: true, platform: 'node', format: 'cjs', write: false, logLevel: 'silent' });
  const m = new Module(entry, module); m.filename = entry; m.paths = Module._nodeModulePaths(process.cwd());
  m._compile(result.outputFiles[0].text, entry); return m.exports;
}

// ---- Audio fixtures ------------------------------------------------------------------------------------------------
/** A PCM WAV of `seconds` at `byteRate` bytes a second (8-bit mono). */
function wav(seconds, byteRate = 1000) {
  const data = Buffer.alloc(Math.round(seconds * byteRate), 0x80);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8); h.write('fmt ', 12); h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(byteRate, 24); h.writeUInt32LE(byteRate, 28); h.writeUInt16LE(1, 32); h.writeUInt16LE(8, 34);
  h.write('data', 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}
/** An MP3 of about `seconds`: MPEG-1 Layer III frames at 128 kbit/s, 44.1 kHz (417 bytes and 1152 samples each). */
function mp3(seconds) {
  const frames = Math.round(seconds * 44100 / 1152);
  const out = Buffer.alloc(frames * 417);
  for (let i = 0; i < frames; i++) out.set([0xff, 0xfb, 0x90, 0x00], i * 417);
  return out;
}
/** A file in a format that cannot be measured; the fake model reports `duration` for it ("none": no length, "fail": an error). The fake model also fails for language=zz. */
const ogg = (duration, bytes = 2000) => Buffer.concat([Buffer.from(`OggS:${duration}:`, 'latin1'), Buffer.alloc(bytes, 1)]);

const FAKE_AI = `import { WorkerEntrypoint } from 'cloudflare:workers';
export class FakeAi extends WorkerEntrypoint {
  async run(model, input) {
    if (!model.includes('whisper')) return { audio: 'SUQzAwAAAAAAAP/7kGQA' };
    const m = /^OggS:([a-z0-9]+):/.exec(atob(String(input.audio).slice(0, 32)));
    if ((m && m[1] === 'fail') || input.language === 'zz') throw new Error('model failed');
    const duration = !m ? 5 : m[1] === 'none' ? undefined : Number(m[1]);
    return { text: 'Hello there.', transcription_info: { language: 'en', ...(duration === undefined ? {} : { duration }) }, segments: [] };
  }
}
export default { fetch() { return new Response('fake ai'); } };`;

let mf, key;
const O = 'https://api.test';
const SESSION = 'cs_live_VoiceApi0000001';
const TEST_KEYS_PER_DAY = 4, TRIAL_MINUTES = 8;
before(async () => {
  const b = await build({ entryPoints: ['src/index.ts'], bundle: true, format: 'esm', platform: 'browser', write: false, external: ['cloudflare:workers', 'node:*'],
    plugins: [{ name: 'url', setup(b) { b.onResolve({ filter: /^url$/ }, () => ({ path: 'node:url', external: true })); } }] });
  mf = new Miniflare(convertV4MiniflareOptions({ workers: [{ name: 'main', modules: true, script: b.outputFiles[0].text, compatibilityDate: '2026-09-01', compatibilityFlags: ['nodejs_compat'],
    durableObjects: { METRICS: { className: 'Metrics', useSQLite: true } }, kvNamespaces: ['TRIALS'], serviceBindings: { AI: { name: 'fake-ai', entrypoint: 'FakeAi' } },
    bindings: { PAY_TO: '0x2074c40346ae2a90e0e4a391bcee6f16bf5277f5', NETWORK: 'eip155:8453', PAYWALL: 'on', TRIALS_ENABLED: 'on', FACILITATOR_URL: 'https://fixture.invalid', BASE_RPC_URL: 'https://fixture.invalid', STRIPE_READ_KEY: 'rk_test_fixture',
      VOICE_TEST_KEYS: 'on', VOICE_TEST_KEYS_PER_DAY: String(TEST_KEYS_PER_DAY), CREDITS_TRIAL: 'on', CREDITS_TRIAL_MINUTES: String(TRIAL_MINUTES) },
    outboundService: async (r) => {
      const u = new URL(r.url);
      if (u.hostname === 'fixture.invalid') return Response.json({ kinds: [{ x402Version: 2, scheme: 'exact', network: 'eip155:8453', extra: { name: 'USD Coin', version: '2' } }], extensions: [] });
      // The $1 pack bought by card: the claim reads this checkout session.
      if (u.hostname === 'api.stripe.com') return Response.json({ mode: 'payment', status: 'complete', payment_status: 'paid', currency: 'usd', amount_total: 100, metadata: { adt_credits: '1000' } });
      return new Response('no network in this test', { status: 500 });
    } }, { name: 'fake-ai', modules: true, compatibilityDate: '2026-09-01', script: FAKE_AI }] }));
  const claim = await (await mf.dispatchFetch(`${O}/credits/claim?session_id=${SESSION}`, { headers: { accept: 'application/json' } })).json();
  key = claim.apiKey;
  assert.match(key, /^adt_[A-Za-z0-9_-]{43}$/);
});
after(async () => { await mf?.dispose(); });

const bearer = (k) => ({ authorization: `Bearer ${k}` });
const speak = (input, headers = {}, path = '/v1/audio/speech', body = { model: 'tts-1', input, voice: 'nova' }) =>
  mf.dispatchFetch(`${O}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
const BOUNDARY = 'x-voice-api-boundary-7f1';
// The multipart body is written out by hand: Miniflare's fetch does not take Node's own FormData.
const transcribe = (file, headers = {}, path = '/v1/audio/transcriptions', fields = { model: 'whisper-1' }, name = 'clip.bin') => {
  const parts = Object.entries(fields).map(([k, v]) => Buffer.from(`--${BOUNDARY}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`, 'latin1'));
  parts.push(Buffer.from(`--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: application/octet-stream\r\n\r\n`, 'latin1'), file, Buffer.from(`\r\n--${BOUNDARY}--\r\n`, 'latin1'));
  return mf.dispatchFetch(`${O}${path}`, { method: 'POST', headers: { 'content-type': `multipart/form-data; boundary=${BOUNDARY}`, ...headers }, body: Buffer.concat(parts) });
};
const balance = async (k) => (await mf.dispatchFetch(`${O}/credits/balance`, { headers: bearer(k) })).json();
const charged = (res) => res.headers.get('x-credits-charged');
const quoteOf = (res) => JSON.parse(Buffer.from(res.headers.get('PAYMENT-REQUIRED'), 'base64').toString());

test('speech with a prepaid key: per started 100 characters, above the model cost and never above the flat price', async () => {
  const bill = await load('../src/lib/voice-billing.ts');
  const text = await load('../src/routes/ai-text.ts');
  const front = await load('../src/lib/openai-speech.ts');
  assert.equal(bill.SPEECH_CREDITS_PER_100, 4);
  const flat = (n) => (n <= front.SPEECH_SHORT_LIMIT ? text.SPEECH_PRICE : text.SPEECH_LONG_PRICE);
  const want = { 1: 4, 100: 4, 101: 8, 200: 8, 201: 10, 300: 10, 301: 16, 400: 16, 1000: 40, 1901: 80, 2000: 80 };
  for (const [n, credits] of Object.entries(want)) assert.equal(bill.speechKeyCredits(Number(n), flat(Number(n))), credits, `${n} characters`);
  for (let n = 1; n <= front.SPEECH_INPUT_LIMIT; n++) {
    const credits = bill.speechKeyCredits(n, flat(n));
    // Aura-2: $0.030 per 1,000 characters = 0.03 credits a character.
    assert.ok(credits >= n * 0.03, `${n} characters are billed below the model cost`);
    assert.ok(credits <= Number(flat(n).slice(1)) * 1000, `${n} characters cost more than the flat price`);
  }
  // The rule the OpenAPI description states is built from the same numbers.
  assert.match(front.speechKeyRule({ short: text.SPEECH_PRICE, long: text.SPEECH_LONG_PRICE }), /4 credits \(\$0\.004\) per started 100 characters, never more than \$0\.01 up to 300 characters or \$0\.08 above/);
});

test('POST /v1/audio/speech charges a prepaid key by length and shows it; the tools and the ElevenLabs front charge as before', async () => {
  const start = (await balance(key)).balanceCredits;
  const short = await speak('Hello there.', bearer(key));
  assert.equal(short.status, 200);
  assert.equal(short.headers.get('content-type'), 'audio/mpeg');
  assert.equal(charged(short), '4');
  assert.equal(short.headers.get('x-credits-remaining'), String(start - 4));
  assert.equal(charged(await speak('a'.repeat(150), bearer(key))), '8');
  assert.equal(charged(await speak('a'.repeat(250), bearer(key))), '10', '201-300 characters stay at the /ai/speech price');
  const long = await speak('word '.repeat(70).trim(), bearer(key)); // 349 characters
  assert.equal(long.headers.get('x-tool'), '/text-to-speech');
  assert.equal(charged(long), '16');
  // The speech tool itself, and the ElevenLabs-shaped front, keep the flat price.
  const tool = await mf.dispatchFetch(`${O}/ai/speech?text=Hello%20there.`, { headers: bearer(key) });
  assert.equal(tool.status, 200);
  assert.equal(charged(tool), '10');
  const eleven = await speak(undefined, { 'xi-api-key': key }, '/v1/text-to-speech/Rachel', { text: 'Hello there.' });
  assert.equal(eleven.status, 200);
  assert.equal(charged(eleven), '10');
  assert.equal((await balance(key)).balanceCredits, start - 4 - 8 - 10 - 16 - 10 - 10);
  // A call paid on its own is quoted the tool's price, whatever the length.
  const unpaid = await speak('Hello there.');
  assert.equal(unpaid.status, 402);
  assert.equal(quoteOf(unpaid).accepts[0].amount, '10000');
});

test('POST /v1/audio/transcriptions: 30 seconds or less costs a prepaid key 1 credit; longer or unknown costs the tool price', async () => {
  const fronts = await load('../src/lib/voice-fronts.ts');
  assert.equal(fronts.measuredSeconds(wav(10)), 10);
  assert.ok(Math.abs(fronts.measuredSeconds(mp3(20)) - 20) < 0.05);
  assert.equal(fronts.measuredSeconds(ogg(5)), null);
  const before = await balance(key);
  const run = async (file, path, fields) => { const r = await transcribe(file, bearer(key), path, fields); assert.equal(r.status, 200, await r.clone().text()); return r; };
  // Measured before the charge: MP3 and WAV.
  const shortWav = await run(wav(10));
  assert.deepEqual(await shortWav.json(), { text: 'Hello there.' });
  assert.equal(charged(shortWav), '1');
  assert.equal(charged(await run(wav(30))), '1', 'exactly 30 seconds is short');
  assert.equal(charged(await run(mp3(12))), '1');
  assert.equal(charged(await run(wav(31))), '10');
  assert.equal(charged(await run(mp3(40))), '10');
  // Not measurable: charged the tool price, and the difference comes back only when the model reports a short length.
  const shortOgg = await run(ogg(12));
  assert.equal(charged(shortOgg), '1');
  assert.equal(charged(await run(ogg(45))), '10');
  assert.equal(charged(await run(ogg('none'))), '10', 'no reported length: the tool price stands');
  // The ElevenLabs-shaped front keeps the tool price.
  assert.equal(charged(await run(wav(10), '/v1/speech-to-text', { model_id: 'scribe_v1' })), '10');
  const after = await balance(key);
  assert.equal(after.balanceCredits, before.balanceCredits - (1 + 1 + 1 + 10 + 10 + 1 + 10 + 10 + 10));
  assert.equal(shortOgg.headers.get('x-credits-remaining'), String(before.balanceCredits - 1 - 1 - 1 - 10 - 10 - 1));
  assert.equal(after.calls, before.calls + 9, 'giving the difference back does not undo the call');
  // A failed call costs nothing.
  const failed = await transcribe(ogg('fail'), bearer(key));
  assert.equal(failed.status, 502);
  assert.equal((await balance(key)).balanceCredits, after.balanceCredits);
  // A call paid on its own keeps the tool price for the same short file.
  const unpaid = await transcribe(wav(10));
  assert.equal(unpaid.status, 402);
  assert.equal(quoteOf(unpaid).accepts[0].amount, '10000');
  // The rule is stated where the front's prices are described.
  const openapi = await (await mf.dispatchFetch(`${O}/openapi.json`)).json();
  assert.match(openapi.paths['/v1/audio/transcriptions'].post.description, /audio of 30 seconds or less costs 1 credit \(\$0\.001\)/);
  assert.match(openapi.paths['/v1/audio/speech'].post.description, /4 credits \(\$0\.004\) per started 100 characters/);
});

test('GET /v1/models and GET /v1/audio/voices answer 200 with or without a key, CORS open, with the audio names honestly labelled', async () => {
  const ai = await load('../src/lib/ai.ts');
  for (const headers of [{}, bearer('sk-left-over-openai-key'), bearer('adt_' + 'q'.repeat(43)), bearer(key)]) {
    const models = await mf.dispatchFetch(`${O}/v1/models`, { headers: { ...headers, origin: 'https://app.example' } });
    assert.equal(models.status, 200);
    assert.equal(models.headers.get('access-control-allow-origin'), '*');
    const list = await models.json();
    assert.equal(list.object, 'list');
    const byId = Object.fromEntries(list.data.map((m) => [m.id, m]));
    assert.equal(byId['whisper-1'].alias_of, ai.MODELS.speech);
    assert.match(byId['whisper-1'].note, /not OpenAI's hosted whisper-1/);
    assert.equal(byId['tts-1'].alias_of, '@cf/deepgram/aura-2-en');
    assert.match(byId['tts-1'].note, /Deepgram Aura-2.*not OpenAI's tts-1/);
    assert.ok(byId[ai.MODELS.speech] && byId['@cf/deepgram/aura-2-en']);
    assert.equal(list.audio.freeTestKey, `POST ${O}/keys/voice-test`);
    assert.ok(list.data.every((m) => m.object === 'model' && typeof m.id === 'string'));
    const voices = await mf.dispatchFetch(`${O}/v1/audio/voices`, { headers });
    assert.equal(voices.status, 200);
    assert.equal(voices.headers.get('access-control-allow-origin'), '*');
    assert.ok((await voices.json()).voices.includes('nova'));
  }
  const text = await load('../src/routes/ai-text.ts');
  assert.ok(text.SPEECH_VOICES.en.length > 0); // the speech model named above is the one the speech tools run
  const src = require('node:fs').readFileSync(require.resolve('../src/routes/ai-text.ts'), 'utf8');
  assert.match(src, /speech: "@cf\/deepgram\/aura-2-en"/);
});

test('a key that cannot pay is told so in a sentence, first, in the shape the caller\'s SDK prints', async () => {
  const unknown = 'adt_' + 'q'.repeat(43);
  // OpenAI shape on the OpenAI fronts.
  for (const res of [await speak('Hello there.', bearer(unknown)), await transcribe(wav(5), bearer(unknown))]) {
    assert.equal(res.status, 401);
    const raw = await res.text();
    assert.ok(raw.startsWith('{"error":{"message":"This API key is not recognised, so nothing was charged.'), raw.slice(0, 120));
    const body = JSON.parse(raw);
    assert.equal(body.error.type, 'invalid_request_error');
    assert.equal(body.error.code, 'invalid_api_key');
    assert.match(body.error.message, new RegExp(`${O}/credits .*POST ${O}/keys/voice-test`));
    assert.equal(body.buy, `${O}/credits`);
  }
  // ElevenLabs shape on the ElevenLabs fronts.
  const eleven = await speak(undefined, { 'xi-api-key': unknown }, '/v1/text-to-speech/Rachel', { text: 'Hi' });
  assert.equal(eleven.status, 401);
  const detail = (await eleven.json()).detail;
  assert.equal(detail.status, 'invalid_api_key');
  assert.match(detail.message, /^This API key is not recognised/);
  // The tool itself: the sentence is the first field, the code and the link follow.
  const tool = await mf.dispatchFetch(`${O}/ai/speech?text=Hi`, { headers: bearer(unknown) });
  assert.equal(tool.status, 401);
  const toolRaw = await tool.text();
  assert.ok(toolRaw.startsWith('{"error":"This API key is not recognised, so nothing was charged.'), toolRaw.slice(0, 120));
  assert.equal(JSON.parse(toolRaw).code, 'invalid_api_key');
  assert.equal(JSON.parse(toolRaw).buy, `${O}/credits`);
  const bal = await mf.dispatchFetch(`${O}/credits/balance`, { headers: bearer(unknown) });
  assert.equal(bal.status, 401);
  assert.match((await bal.json()).error, /^This API key is not recognised/);
  // A key from somewhere else (an OpenAI key left in the SDK) is not ours to refuse: the call is quoted as unpaid, and
  // the quote starts with the sentence. Every payment field is unchanged, so an x402 client still pays it.
  const plain = await speak('Hello there.');
  const foreign = await speak('Hello there.', bearer('sk-proj-left-over'));
  assert.equal(foreign.status, 402);
  const foreignRaw = await foreign.text();
  assert.ok(foreignRaw.startsWith('{"error":"The API key sent with this request is not one of this service\'s keys (they start with adt_)'), foreignRaw.slice(0, 140));
  const { error: e1, ...restForeign } = JSON.parse(foreignRaw);
  const { error: e2, ...restPlain } = await plain.json();
  assert.equal(e2, 'Payment required');
  assert.match(e1, /keys\/voice-test.*\(Payment required\.\)$/);
  assert.deepEqual(restForeign, restPlain);
  assert.deepEqual(quoteOf(foreign), quoteOf(plain));
  const foreignStt = await transcribe(wav(5), { 'x-api-key': 'sk-something' });
  assert.equal(foreignStt.status, 402);
  assert.match((await foreignStt.json()).error, /^The API key sent with this request is not one of this service's keys/);
  // An x402 payment sent next to a placeholder key is not given the sentence path at all (it is read as a payment).
  const paying = await speak('Hello there.', { ...bearer('x402'), 'x-payment': 'not-real' });
  assert.notEqual((await paying.text()).slice(0, 30), foreignRaw.slice(0, 30));
});

test('out of credits: the sentence first, then the code and the top-up links (and the OpenAI shape on a front)', async () => {
  const credits = await load('../src/lib/credits.ts');
  const routes = await load('../src/lib/credit-routes.ts');
  const bill = await load('../src/lib/voice-billing.ts');
  const { Hono } = require('hono');
  const records = new Map();
  let pending = Promise.resolve();
  const store = { transaction(callback) {
    const next = pending.then(async () => {
      const draft = new Map([...records].map(([k, v]) => [k, structuredClone(v)]));
      const result = await callback({ get: async (k) => structuredClone(draft.get(k)), put: async (k, v) => draft.set(k, structuredClone(v)), delete: async (k) => draft.delete(k) });
      records.clear(); for (const [k, v] of draft) records.set(k, v); return result;
    });
    pending = next.catch(() => {}); return next;
  } };
  const stub = { issueCredits: (g) => credits.issueCredits(store, g), spendCredits: (h, m, f) => credits.spendCredits(store, h, m, f), refundCredits: (h, m) => credits.refundCredits(store, h, m), rebateCredits: (h, m) => credits.rebateCredits(store, h, m), creditBalance: (h) => credits.creditBalance(store, h) };
  const env = { METRICS: { idFromName: () => 'credits', get: () => stub } };
  const poor = 'adt_' + 'p'.repeat(43);
  const hash = await credits.hashCreditKey(poor);
  await stub.issueCredits({ sessionId: 'cs_test_poor', credits: 5, key: poor, keyHash: hash });
  const app = new Hono();
  app.get('/tool', (c, next) => routes.chargeCredits(c, '$0.01', poor, next), (c) => c.json({ ok: true }));
  const res = await app.request('/tool', {}, env);
  assert.equal(res.status, 402);
  const raw = await res.clone().text();
  assert.ok(raw.startsWith('{"error":"This key does not have enough credits for this call: it costs 10 credits and the key has 5. Nothing was charged. Top up this key'), raw.slice(0, 160));
  const body = JSON.parse(raw);
  assert.equal(body.code, 'insufficient_credits');
  assert.ok(Array.isArray(body.topUp) && body.topUp.length > 0);
  const shaped = await (await bill.asFrontKeyError(res, 'openai')).json();
  assert.deepEqual(Object.keys(shaped), ['error', 'topUp']);
  assert.equal(shaped.error.type, 'insufficient_quota');
  assert.equal(shaped.error.code, 'insufficient_credits');
  assert.match(shaped.error.message, /^This key does not have enough credits/);
  // A tool's own refusal (no key code) is not rewritten.
  assert.equal(await bill.asFrontKeyError(Response.json({ error: 'text is required', code: 'BAD_INPUT' }, { status: 400 }), 'openai'), null);
  // The rebate never gives back more than was spent, and leaves an unknown key alone.
  assert.equal(await stub.rebateCredits(hash, 9000), null);
  assert.equal(await stub.rebateCredits('0'.repeat(64), 1000), null);
});

test('POST /keys/voice-test: a free key for 25 short calls on the voice fronts, bounded per key, per address and per day', async () => {
  const vk = await load('../src/lib/voice-keys.ts');
  const ip = (n) => ({ 'cf-connecting-ip': `198.51.100.${n}` });
  const issue = (n) => mf.dispatchFetch(`${O}/keys/voice-test`, { method: 'POST', headers: ip(n) });
  const first = await issue(1);
  assert.equal(first.status, 200);
  const made = await first.json();
  assert.match(made.apiKey, /^adt_vt_[A-Za-z0-9_-]{43}$/);
  assert.equal(vk.voiceKeyKind(made.apiKey), 'test');
  assert.equal(made.limits, vk.VOICE_TEST_LIMITS);
  assert.match(made.limits, /25 successful calls within 24 hours.*up to 100 characters.*up to 30 seconds/);
  assert.equal(made.calls, 25);
  assert.ok(Date.parse(made.expires) - Date.now() <= 24 * 3600_000 + 5000 && Date.parse(made.expires) > Date.now());
  assert.match(made.models, /Deepgram Aura-2.*Whisper large-v3-turbo.*accepted as model names only/);
  // One key per address per day: the refusal is a sentence with the limits and the paid options.
  const again = await issue(1);
  assert.equal(again.status, 429);
  const refused = await again.json();
  assert.match(refused.error, /^This network address already got a free voice test key today/);
  assert.equal(refused.code, 'one_key_per_day');
  assert.equal(refused.limits, vk.VOICE_TEST_LIMITS);
  assert.equal(refused.more.credits, `${O}/credits`);
  // An IPv6 caller is one caller per /64.
  assert.equal(vk.addressBucket('2a01:4f8:c0c:1234::1'), vk.addressBucket('2a01:4f8:c0c:1234:ffff::9'));
  assert.notEqual(vk.addressBucket('2a01:4f8:c0c:1234::1'), vk.addressBucket('2a01:4f8:c0c:1235::1'));
  const k = made.apiKey;
  // The key is described at /credits/balance and has no ledger account.
  const info = await balance(k);
  assert.equal(info.voiceTestKey, true);
  assert.equal(info.balanceCredits, undefined);
  // A short speech call and a short transcription run, uncharged, and count down.
  const hello = await speak('Hello from the new endpoint.', bearer(k));
  assert.equal(hello.status, 200);
  assert.equal(hello.headers.get('content-type'), 'audio/mpeg');
  assert.equal(charged(hello), '0');
  assert.equal(hello.headers.get('x-test-calls-left'), '24');
  assert.equal(hello.headers.get('x-key-limits'), vk.VOICE_TEST_LIMITS);
  const heard = await transcribe(wav(10), bearer(k));
  assert.equal(heard.status, 200);
  assert.equal(heard.headers.get('x-test-calls-left'), '23');
  assert.equal((await speak(undefined, { 'xi-api-key': k }, '/v1/text-to-speech/Rachel', { text: 'Hi there.' })).headers.get('x-test-calls-left'), '22');
  // Beyond a limit: refused before anything runs, in a sentence, with the paid options; nothing is counted.
  const refusals = [
    [await speak('a'.repeat(101), bearer(k)), /^A free voice test key speaks up to 100 characters a call; this text has 101\. Nothing was charged\. For more, buy a prepaid key from \$1 at /],
    [await transcribe(wav(31), bearer(k)), /^A free voice test key transcribes up to 30 seconds of audio a call; this file is 31 seconds long\./],
    [await transcribe(ogg(5), bearer(k)), /^A free voice test key transcribes MP3 or WAV files of up to 30 seconds/],
  ];
  for (const [res, sentence] of refusals) {
    assert.equal(res.status, 402);
    const body = await res.json();
    assert.match(body.error.message, sentence);
    assert.equal(body.error.code, 'test_key_limit');
    assert.equal(body.more.credits, `${O}/credits`);
  }
  // Only through the fronts: the tools themselves, and every other tool, refuse the key.
  for (const path of ['/ai/speech?text=Hi', '/text-to-speech?text=Hi', '/hash?text=abc']) {
    const direct = await mf.dispatchFetch(`${O}${path}`, { headers: bearer(k) });
    assert.equal(direct.status, 402, path);
    const body = await direct.json();
    assert.match(body.error, /^A free voice test key works only on POST /);
    assert.equal(body.code, 'test_key_scope');
  }
  // A failed call is given back.
  const failed = await transcribe(wav(3), bearer(k), '/v1/audio/transcriptions', { model: 'whisper-1', language: 'zz' });
  assert.equal(failed.status, 502);
  assert.equal(failed.headers.get('x-test-calls-left'), '22');
  const next = await speak('Still twenty-two before this one.', bearer(k));
  assert.equal(next.headers.get('x-test-calls-left'), '21');
  // The key stops at 25 successful calls.
  for (let left = 20; left >= 0; left--) assert.equal((await transcribe(wav(2), bearer(k))).headers.get('x-test-calls-left'), String(left));
  const over = await speak('One too many.', bearer(k));
  assert.equal(over.status, 402);
  const overBody = await over.json();
  assert.match(overBody.error.message, /^This free voice test key has used its 25 calls/);
  assert.equal(overBody.error.code, 'test_key_used_up');
  // The day's keys: TEST_KEYS_PER_DAY in all, then a sentence.
  for (let n = 2; n <= TEST_KEYS_PER_DAY; n++) assert.equal((await issue(n)).status, 200, `key ${n}`);
  const none = await issue(99);
  assert.equal(none.status, 429);
  assert.match((await none.json()).error, /^Today's free voice test keys are all given out/);
  // A key that was never issued, or has expired, is told so.
  const stale = await speak('Hello.', bearer('adt_vt_' + 'z'.repeat(43)));
  assert.equal(stale.status, 401);
  assert.match((await stale.json()).error.message, /^This free voice test key is not recognised or has expired/);
  // GET describes the offer; nothing above touched the paid key.
  const about = await (await mf.dispatchFetch(`${O}/keys/voice-test`)).json();
  assert.equal(about.freeVoiceTestKey, true);
  assert.equal(about.limits, vk.VOICE_TEST_LIMITS);
});

test('POST /credits/trial: one file a day per address, at most 30 minutes, within the day\'s minutes', async () => {
  const vk = await load('../src/lib/voice-keys.ts');
  const ip = (n) => ({ 'cf-connecting-ip': `192.0.2.${n}` });
  const issue = (n, extra = {}) => mf.dispatchFetch(`${O}/credits/trial`, { method: 'POST', headers: { ...ip(n), ...extra } });
  // The voice site may ask from the browser.
  for (const site of ['https://voice.glyphcall.com', 'https://glyphcall-voice.pages.dev']) {
    const preflight = await mf.dispatchFetch(`${O}/credits/trial`, { method: 'OPTIONS', headers: { origin: site, 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type' } });
    assert.ok(preflight.status === 204 || preflight.status === 200);
    assert.ok(['*', site].includes(preflight.headers.get('access-control-allow-origin')));
    assert.match(preflight.headers.get('access-control-allow-methods') ?? '', /POST/);
    const upload = await mf.dispatchFetch(`${O}/v1/audio/transcriptions`, { method: 'OPTIONS', headers: { origin: site, 'access-control-request-method': 'POST', 'access-control-request-headers': 'authorization' } });
    assert.match(upload.headers.get('access-control-allow-headers') ?? '', /authorization/i);
  }
  const first = await issue(1, { origin: 'https://voice.glyphcall.com' });
  assert.equal(first.status, 200);
  assert.ok(['*', 'https://voice.glyphcall.com'].includes(first.headers.get('access-control-allow-origin')));
  assert.equal(first.headers.get('cache-control'), 'no-store');
  const made = await first.json();
  assert.match(made.apiKey, /^adt_tr_[A-Za-z0-9_-]{43}$/);
  assert.equal(made.limits, vk.TRIAL_LIMITS);
  assert.equal(made.maxMinutes, 30);
  assert.equal(made.transcribe, `${O}/v1/audio/transcriptions`);
  const end = Date.parse(new Date().toISOString().slice(0, 10) + 'T00:00:00Z') + 86_400_000;
  assert.ok(Date.parse(made.expires) <= Math.min(Date.now() + 2 * 3600_000 + 5000, end) && Date.parse(made.expires) > Date.now());
  const k = made.apiKey;
  assert.equal((await balance(k)).trialKey, true);
  // Longer than 30 minutes: refused before any model call, uncharged, and the file of the day is still there.
  const tooLong = await transcribe(wav(31 * 60), bearer(k));
  assert.equal(tooLong.status, 402);
  const tl = await tooLong.json();
  assert.match(tl.error.message, /^The free trial reads recordings of up to 30 minutes; this one is 31 minutes long\. Nothing was charged\. For longer or more recordings, Transcribe Pro is \$9 a month at /);
  assert.equal(tl.error.code, 'trial_key_limit');
  assert.equal(tl.more.transcribePro, `${O}/transcribe-pro`);
  // Only transcription, only through the front.
  const speech = await speak('Hello.', bearer(k));
  assert.equal(speech.status, 402);
  assert.match((await speech.json()).error.message, /^A free trial key transcribes one audio file; it does not make speech\./);
  const direct = await mf.dispatchFetch(`${O}/transcribe/long?url=https://example.com/a.mp3`, { headers: bearer(k) });
  assert.equal(direct.status, 402);
  assert.equal((await direct.json()).code, 'trial_key_scope');
  // A failed call gives the file and its minutes back.
  const failed = await transcribe(wav(240), bearer(k), '/v1/audio/transcriptions', { language: 'zz' });
  assert.equal(failed.status, 502);
  assert.equal(failed.headers.get('x-trial-files-left'), '1');
  // The one file: two minutes, run the way Transcribe Pro runs it.
  const ok = await transcribe(wav(110), bearer(k), '/v1/audio/transcriptions', { response_format: 'verbose_json' });
  assert.equal(ok.status, 200, await ok.clone().text());
  assert.equal(ok.headers.get('x-tool'), '/transcribe/long');
  assert.equal(charged(ok), '0');
  assert.equal(ok.headers.get('x-trial-minutes'), '2');
  assert.equal(ok.headers.get('x-trial-files-left'), '0');
  assert.equal((await ok.json()).text, 'Hello there.');
  // The same address has had its file today, with this key or with a new one.
  const second = await transcribe(wav(10), bearer(k));
  assert.equal(second.status, 402);
  assert.match((await second.json()).error.message, /^Today's free trial file for this network address has been used/);
  const newKey = (await (await issue(1)).json()).apiKey;
  assert.notEqual(newKey, k);
  assert.equal((await transcribe(wav(10), bearer(newKey))).status, 402);
  // Another address: a format that cannot be measured is counted after it ran (the model reports 150 s = 3 minutes).
  const k2 = (await (await issue(2)).json()).apiKey;
  const voiceNote = await transcribe(ogg(150), bearer(k2));
  assert.equal(voiceNote.status, 200);
  assert.equal(voiceNote.headers.get('x-tool'), '/transcribe');
  assert.equal(voiceNote.headers.get('x-trial-minutes'), '3');
  // The voice site's Pro mode uploads straight to the tools: a trial key takes that too, measured the same way.
  const k5 = (await (await issue(5)).json()).apiKey;
  const raw = (path, file, k) => mf.dispatchFetch(`${O}${path}`, { method: 'POST', headers: { ...bearer(k), 'content-type': 'application/octet-stream' }, body: file });
  const directLong = await raw('/transcribe/long?timestamps=true', wav(31 * 60), k5);
  assert.equal(directLong.status, 402);
  const dl = await directLong.json();
  assert.match(dl.error, /^The free trial reads recordings of up to 30 minutes; this one is 31 minutes long\./);
  assert.equal(dl.code, 'trial_key_limit');
  const directOk = await raw('/transcribe/long?timestamps=true', wav(50), k5);
  assert.equal(directOk.status, 200, await directOk.clone().text());
  assert.equal(directOk.headers.get('x-trial-minutes'), '1');
  assert.equal(charged(directOk), '0');
  const directBody = await directOk.json();
  assert.equal(directBody.text, 'Hello there.');
  assert.equal(directBody.durationSeconds, 50);
  assert.equal((await raw('/transcribe', wav(5), k5)).status, 402, 'the one file of the day is used');
  // Uploads to any other tool are out of scope.
  assert.equal((await (await raw('/transcribe/summary', wav(5), (await (await issue(6)).json()).apiKey)).json()).code, 'trial_key_scope');
  // 6 of the day's 8 minutes are used: a 3-minute file does not fit, a 2-minute file does, and then the day is over.
  const k3 = (await (await issue(3)).json()).apiKey;
  const noRoom = await transcribe(wav(170), bearer(k3));
  assert.equal(noRoom.status, 402);
  const nr = await noRoom.json();
  assert.match(nr.error.message, /^Today's free trial minutes are used up; they come back at 00:00 UTC\./);
  assert.equal(nr.error.code, 'daily_trial_used_up');
  const fits = await transcribe(wav(100), bearer(k3));
  assert.equal(fits.status, 200);
  assert.equal(fits.headers.get('x-trial-minutes'), '2');
  const closed = await issue(4);
  assert.equal(closed.status, 429);
  const cb = await closed.json();
  assert.match(cb.error, /^Today's free trial minutes are used up; they come back at 00:00 UTC\. For longer or more recordings, Transcribe Pro is \$9 a month/);
  assert.equal(cb.code, 'daily_trial_used_up');
  // One address may ask a few times (a reloaded page), not without end.
  for (let i = 0; i < vk.TRIAL_KEYS_PER_CALLER; i++) await issue(1);
  const asked = await issue(1);
  assert.equal(asked.status, 429);
});

test('both free key routes are off unless their switch is on, and neither writes to the credit ledger', async () => {
  const vk = await load('../src/lib/voice-keys.ts');
  const credits = await load('../src/lib/credits.ts');
  const free = await load('../src/lib/free-calls.ts');
  const { Hono } = require('hono');
  const kvStore = new Map();
  const kv = { get: async (k, type) => { const v = kvStore.get(k); return v === undefined ? null : type === 'json' ? JSON.parse(v) : v; }, put: async (k, v) => { kvStore.set(k, v); } };
  const records = new Map();
  let pending = Promise.resolve();
  const store = { transaction(callback) {
    const next = pending.then(async () => {
      const draft = new Map([...records].map(([k, v]) => [k, structuredClone(v)]));
      const result = await callback({ get: async (k) => structuredClone(draft.get(k)), put: async (k, v) => draft.set(k, structuredClone(v)), delete: async (k) => draft.delete(k) });
      records.clear(); for (const [k, v] of draft) records.set(k, v); return result;
    });
    pending = next.catch(() => {}); return next;
  } };
  const stub = { takeFreeCall: (c, d, l) => free.takeFreeCall(store, c, d, l), refundFreeCall: (c, d) => free.refundFreeCall(store, c, d) };
  const METRICS = { idFromName: () => 'credits', get: () => stub };
  const off = { TRIALS: kv, METRICS };
  for (const env of [off, { ...off, VOICE_TEST_KEYS: 'yes', CREDITS_TRIAL: 'true' }, { VOICE_TEST_KEYS: 'on', CREDITS_TRIAL: 'on' }]) {
    for (const path of ['/keys/voice-test', '/credits/trial']) {
      for (const method of ['GET', 'POST']) {
        const res = await vk.voiceKeys.request(`https://api.test${path}`, { method }, env);
        assert.equal(res.status, 404, `${method} ${path}`);
        const body = await res.json();
        assert.match(body.error, /not offered right now\. For /);
        assert.equal(body.apiKey, undefined);
      }
    }
  }
  assert.equal(kvStore.size, 0, 'nothing is stored while the routes are off');
  // On: a key runs a call a front admitted; the ledger holds no account, no purchase and no call for it.
  const on = { ...off, VOICE_TEST_KEYS: 'on' };
  const issued = await (await vk.voiceKeys.request('https://api.test/keys/voice-test', { method: 'POST', headers: { 'cf-connecting-ip': '203.0.113.5' } }, on)).json();
  assert.ok([...kvStore.keys()].every((k) => !k.includes('203.0.113.5')), 'only a hash of the address is stored');
  assert.ok([...kvStore.values()].every((v) => !String(v).includes(issued.apiKey)), 'only a hash of the key is stored');
  const app = new Hono();
  app.get('/tool', async (c, next) => {
    const refusal = await vk.admitVoiceKey(c.env, issued.apiKey, { what: 'speech', characters: Number(c.req.query('n')) }, c.req.raw, 'https://api.test');
    return refusal ? c.json(refusal, refusal.status) : vk.chargeVoiceKey(c, issued.apiKey, next);
  }, (c) => c.json({ ok: true }));
  app.get('/unadmitted', (c, next) => vk.chargeVoiceKey(c, issued.apiKey, next), (c) => c.json({ ok: true }));
  const ok = await app.request('https://api.test/tool?n=20', {}, on);
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('X-Test-Calls-Left'), String(vk.VOICE_TEST_CALLS - 1));
  assert.equal((await app.request('https://api.test/tool?n=101', {}, on)).status, 402);
  assert.equal((await app.request('https://api.test/unadmitted', {}, on)).status, 402);
  // Switched off again, an issued key stops at once.
  assert.equal((await app.request('https://api.test/tool?n=20', {}, off)).status, 401);
  assert.equal([...records.keys()].filter((k) => k.startsWith('credit:')).length, 0);
  const summary = await credits.creditSummary({ list: async ({ prefix }) => new Map([...records].filter(([k]) => k.startsWith(prefix))) });
  assert.equal(summary.purchases, 0); assert.equal(summary.buyers, 0); assert.equal(summary.creditCalls, 0);
  // The worst day, from the constants: speech calls at 100 characters of Aura-2 ($0.030 per 1,000) and the rest as 30 s of Whisper ($0.000513 a minute).
  const speech = vk.VOICE_TEST_SPEECH_CALLS_PER_DAY * (vk.VOICE_TEST_SPEECH_CHARS / 1000) * 0.03;
  const audio = free.FREE_CALLS_PER_DAY * (vk.VOICE_TEST_AUDIO_SECONDS / 60) * 0.000513;
  assert.ok(speech + audio < 4, `test keys: $${(speech + audio).toFixed(2)} a day at every limit`);
  assert.ok(free.FREE_CALLS_PER_DAY * (vk.VOICE_TEST_SPEECH_CHARS / 1000) * 0.03 <= 6, 'and never above $6: the call count is exact');
  assert.ok(vk.TRIAL_MINUTES_PER_DAY * 0.000513 < 0.2, 'trial keys: about 10 cents a day');
  // The privacy page says what the two routes keep.
  const legal = await load('../src/lib/legal.ts');
  const page = await (await legal.legal.request('https://api.test/privacy')).text();
  assert.match(page, /Free voice test keys and the free transcription trial\..*one-way hash of your network address.*up to two days/);
});

test('GET /keys/voice-test is a human page for a browser; POST answers with the key in HTML', async () => {
  const shown = await mf.dispatchFetch(`${O}/keys/voice-test`, { headers: { accept: 'text/html' } });
  assert.equal(shown.status, 200);
  const html = await shown.text();
  assert.match(html, /<title>Free voice API test key/);
  assert.match(html, /Get a free test key/);
  assert.match(html, /href="\/credits"/);
  assert.match(html, /<meta name="robots" content="noindex">/);
  // JSON clients still get the machine-readable answer.
  const json = await (await mf.dispatchFetch(`${O}/keys/voice-test`, { headers: { accept: 'application/json' } })).json();
  assert.equal(json.freeVoiceTestKey, true);

  // A browser POST gets an HTML answer (key issued, or the daily-cap refusal — both are pages, never raw JSON).
  const issued = await mf.dispatchFetch(`${O}/keys/voice-test`, {
    method: 'POST', headers: { accept: 'text/html', 'cf-connecting-ip': '198.51.100.222' },
  });
  assert.ok([200, 429].includes(issued.status));
  const body = await issued.text();
  assert.match(body, /<title>Your free test key<\/title>/);
  assert.match(body, /<h1>(Your free test key|No key this time)<\/h1>/);
  assert.match(body, /href="\/credits"/);
});
