// Drop-in voice APIs (lib/voice-fronts.ts): ElevenLabs text to speech and speech to text, OpenAI transcription, and
// /transcribe taking an uploaded file with subtitles and timestamps.
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

test('subtitle text from timed segments: SRT and WebVTT timestamps', async () => {
  const ai = await load('src/routes/ai.ts');
  assert.equal(ai.subtitleTime(62.3456, ','), '00:01:02,346');
  assert.equal(ai.subtitleTime(3723.5, '.'), '01:02:03.500');
  assert.equal(ai.subtitleTime(-1, ','), '00:00:00,000');
  const segs = [{ start: 0, end: 1.5, text: ' Hello there. ' }, { start: 1.5, end: 2, text: '' }, { start: 2, end: 3.25, text: 'Second line.' }];
  assert.equal(ai.toSubtitles(segs, 'srt'), '1\n00:00:00,000 --> 00:00:01,500\nHello there.\n\n2\n00:00:02,000 --> 00:00:03,250\nSecond line.\n');
  assert.match(ai.toSubtitles(segs, 'vtt'), /^WEBVTT\n\n00:00:00\.000 --> 00:00:01\.500\nHello there\.\n/);
});

test('ElevenLabs voices and text-to-speech bodies map onto the speech tools', async () => {
  const v = await load('src/lib/voice-fronts.ts');
  // Premade IDs and names map to an Aura-2 voice of the same gender; Aura-2 and OpenAI names pass; unknown means default.
  const rachel = v.elevenVoice('21m00Tcm4TlvDq8ikWAM');
  assert.equal(rachel, v.elevenVoice('Rachel'));
  assert.ok(['luna', 'asteria', 'thalia', 'athena', 'aurora', 'hera', 'iris', 'juno', 'cora', 'helena', 'ophelia', 'phoebe', 'vesta'].includes(rachel));
  assert.ok(['orion', 'zeus', 'apollo', 'arcas', 'draco', 'orpheus', 'atlas', 'hermes', 'jupiter', 'mars', 'odysseus', 'saturn', 'neptune'].includes(v.elevenVoice('pNInz6obpgDQGcFmaJgB')));
  assert.equal(v.elevenVoice('Orion'), 'orion');
  assert.equal(v.elevenVoice('nova'), 'nova');
  assert.equal(v.elevenVoice('someCustomVoiceId123'), undefined);
  assert.equal(v.elevenVoice('constructor'), undefined);
  assert.deepEqual(v.elevenSpeechRequest({ text: ' Hello. ', model_id: 'eleven_flash_v2_5' }, 'Orion', null), { text: 'Hello.', voice: 'orion', tool: '/ai/speech' });
  assert.equal(v.elevenSpeechRequest({ text: 'x'.repeat(301) }, '', 'mp3_44100_128').tool, '/text-to-speech');
  assert.match(v.elevenSpeechRequest({ text: 'x'.repeat(2001) }, '', null).error, /at most 2000/);
  assert.match(v.elevenSpeechRequest({ text: 'Hi' }, '', 'pcm_16000').error, /mp3/);
  assert.match(v.elevenSpeechRequest({ text: 'Hallo', language_code: 'de' }, '', null).error, /en or es/);
  assert.equal(v.elevenSpeechRequest({ text: 'Hola', language_code: 'es' }, '', null).lang, 'es');
  assert.match(v.elevenSpeechRequest({}, '', null).error, /text is required/);
});

test('transcription options and answer shapes for OpenAI and ElevenLabs clients', async () => {
  const v = await load('src/lib/voice-fronts.ts');
  assert.deepEqual(v.transcriptionOptions({ model: 'whisper-1' }, 'openai'), { format: 'json' });
  assert.deepEqual(v.transcriptionOptions({ response_format: 'SRT', language: 'sv' }, 'openai'), { format: 'srt', language: 'sv' });
  assert.match(v.transcriptionOptions({ response_format: 'docx' }, 'openai').error, /response_format/);
  assert.deepEqual(v.transcriptionOptions({ model_id: 'scribe_v1', cloud_storage_url: 'https://x.test/a.mp3', language_code: 'en' }, 'eleven'), { format: 'eleven', language: 'en', url: 'https://x.test/a.mp3' });
  assert.match(v.transcriptionOptions({ diarize: 'true' }, 'eleven').error, /diarize/);
  assert.match(v.transcriptionOptions({ language: 'en; drop' }, 'openai').error, /language/);
  const t = { text: 'Hello there.', language: 'en', languageProbability: 0.98, durationSeconds: 1.2, segments: [{ start: 0, end: 1.2, text: 'Hello there.' }], words: [{ word: 'Hello', start: 0, end: 0.5 }, { word: 'there.', start: 0.5, end: 1.2 }], subtitles: '1\n00:00:00,000 --> 00:00:01,200\nHello there.\n' };
  assert.deepEqual(v.shapeTranscript(t, 'openai', 'json'), { json: { text: 'Hello there.' } });
  assert.deepEqual(v.shapeTranscript(t, 'openai', 'text'), { text: 'Hello there.', type: 'text/plain; charset=utf-8' });
  assert.equal(v.shapeTranscript(t, 'openai', 'srt').text, t.subtitles);
  const verbose = v.shapeTranscript(t, 'openai', 'verbose_json').json;
  assert.equal(verbose.task, 'transcribe');
  assert.equal(verbose.duration, 1.2);
  assert.deepEqual(verbose.segments[0], { id: 0, start: 0, end: 1.2, text: 'Hello there.' });
  const eleven = v.shapeTranscript(t, 'eleven', 'eleven').json;
  assert.equal(eleven.language_code, 'en');
  assert.equal(eleven.language_probability, 0.98);
  assert.deepEqual(eleven.words[1], { text: 'there.', start: 0.5, end: 1.2, type: 'word' });
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
const atomicOf = async (path) => {
  const { ENDPOINTS } = await load('src/endpoints.ts');
  return String(Math.round(Number(ENDPOINTS.find((e) => e.path === path).price.replace('$', '')) * 1e6));
};
const fakeMp3Bytes = () => Buffer.from([0x49, 0x44, 0x33, 3, 0, 0, 0, 0, 0, 0, 0xff, 0xfb, 0x90, 0x64, ...new Array(200).fill(0)]);
const fakeMp3 = () => new Blob([fakeMp3Bytes()], { type: 'audio/mpeg' });
// The multipart body is written out by hand: Miniflare's fetch does not take Node's own FormData.
const BOUNDARY = 'x-voice-boundary-41c2';
const multipart = (fields, withFile = true) => {
  const parts = Object.entries(fields).map(([k, v]) => Buffer.from(`--${BOUNDARY}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`, 'latin1'));
  if (withFile) parts.push(Buffer.from(`--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="note.mp3"\r\nContent-Type: audio/mpeg\r\n\r\n`, 'latin1'), fakeMp3Bytes(), Buffer.from('\r\n', 'latin1'));
  parts.push(Buffer.from(`--${BOUNDARY}--\r\n`, 'latin1'));
  return { body: Buffer.concat(parts), headers: { 'content-type': `multipart/form-data; boundary=${BOUNDARY}` } };
};
const postForm = (path, fields, extra = {}) => { const m = multipart(fields); return mf.dispatchFetch(`${O}${path}`, { method: 'POST', headers: { ...m.headers, ...extra }, body: m.body }); };

test('ElevenLabs text to speech quotes under its own path at the price of the tool the text needs', async () => {
  const post = (voice, body, headers = {}) => mf.dispatchFetch(`${O}/v1/text-to-speech/${voice}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  const short = await post('21m00Tcm4TlvDq8ikWAM', { text: 'Hello there.', model_id: 'eleven_flash_v2_5' });
  assert.equal(short.status, 402);
  const q = await quote(short);
  assert.equal(q.resource.url, `${O}/v1/text-to-speech/21m00Tcm4TlvDq8ikWAM`);
  assert.match(q.resource.description, /ElevenLabs-compatible/);
  assert.equal(q.accepts[0].amount, await atomicOf('/ai/speech'));
  assert.equal(short.headers.get('X-Tool'), '/ai/speech');
  const long = await post('Rachel', { text: 'A sentence that is read aloud. '.repeat(20) });
  assert.equal((await quote(long)).accepts[0].amount, await atomicOf('/text-to-speech'));
  const stream = await mf.dispatchFetch(`${O}/v1/text-to-speech/Rachel/stream`, { method: 'POST' });
  assert.equal(stream.status, 402);
  // An unknown prepaid key sent as xi-api-key reaches the key check (read as X-API-Key) and is never served.
  const unknownKey = await post('Rachel', { text: 'Hi' }, { 'xi-api-key': 'adt_notreal' });
  assert.notEqual(unknownKey.status, 200);
  // Invalid input with a payment attached is refused before anything is used.
  const badFormat = await mf.dispatchFetch(`${O}/v1/text-to-speech/Rachel?output_format=pcm_16000`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-payment': 'not-real' }, body: JSON.stringify({ text: 'Hi' }) });
  assert.equal(badFormat.status, 400);
  assert.match((await badFormat.json()).detail.message, /mp3/);
});

test('OpenAI transcriptions and ElevenLabs speech to text quote an uploaded file at the /transcribe price', async () => {
  const amount = await atomicOf('/transcribe');
  const res = await postForm('/v1/audio/transcriptions', { model: 'whisper-1', response_format: 'srt' });
  assert.equal(res.status, 402);
  const q = await quote(res);
  assert.equal(q.resource.url, `${O}/v1/audio/transcriptions`);
  assert.match(q.resource.description, /OpenAI-compatible audio transcription/);
  assert.equal(q.accepts[0].amount, amount);
  assert.equal(res.headers.get('X-Tool'), '/transcribe');
  // Probes without audio still get a real quote (what validators and directory crawlers send).
  for (const r of [await mf.dispatchFetch(`${O}/v1/audio/transcriptions`, { method: 'POST' }), await mf.dispatchFetch(`${O}/v1/speech-to-text`), await mf.dispatchFetch(`${O}/v1/speech-to-text`, { method: 'POST' })]) {
    assert.equal(r.status, 402);
    assert.equal((await quote(r)).accepts[0].amount, amount);
  }
  const er = await postForm('/v1/speech-to-text', { model_id: 'scribe_v1' });
  assert.equal(er.status, 402);
  assert.equal((await quote(er)).resource.url, `${O}/v1/speech-to-text`);
  // A paying caller is told what is wrong before any payment is used.
  const noFile = await mf.dispatchFetch(`${O}/v1/audio/transcriptions`, { method: 'POST', headers: { 'x-payment': 'not-real' } });
  assert.equal(noFile.status, 400);
  assert.equal((await noFile.json()).error.type, 'invalid_request_error');
  const bf = await postForm('/v1/audio/transcriptions', { response_format: 'docx' }, { 'x-payment': 'not-real' });
  assert.equal(bf.status, 400);
  assert.match((await bf.json()).error.message, /response_format/);
  const dr = await postForm('/v1/speech-to-text', { diarize: 'true' }, { 'xi-api-key': 'adt_notreal' });
  assert.equal(dr.status, 400);
  assert.match((await dr.json()).detail.message, /diarize/);
});

test('/transcribe takes the audio file itself in a POST body', async () => {
  // Raw bytes as application/octet-stream (raw audio/* bodies wait for 1.182.0, which edits the same line), or multipart.
  const raw = await mf.dispatchFetch(`${O}/transcribe`, { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: fakeMp3Bytes() });
  assert.equal(raw.status, 402);
  assert.match((await quote(raw)).resource.url, /file=(%40|@)file(%3A|:)[0-9a-f]{64}/);
  const form = await postForm('/transcribe', { subtitles: 'srt' });
  assert.equal(form.status, 402);
  assert.match((await quote(form)).resource.url, /subtitles=srt/);
  const big = await mf.dispatchFetch(`${O}/transcribe`, { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: new Uint8Array(5 * 1024 * 1024 + 10) });
  assert.equal(big.status, 413);
});
