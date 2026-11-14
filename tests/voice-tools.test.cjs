// Glyphcall Voice tools (src/routes/voice.ts): /transcribe/long cuts MP3 and WAV into parts and joins the timings;
// /text-to-speech/lite speaks with Aura-1. Audio here is synthetic (valid frame headers, silent payload).
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

// MPEG-1 Layer III, 128 kbps, 44.1 kHz, no padding: 417 bytes and 1152/44100 s a frame.
const FRAME = 417;
const FRAME_SECONDS = 1152 / 44100;
function mp3(frames, { id3 = true, tail = false } = {}) {
  const head = id3 ? Buffer.from([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 10, ...new Array(10).fill(0)]) : Buffer.alloc(0);
  const body = Buffer.alloc(frames * FRAME);
  for (let i = 0; i < frames; i++) body.set([0xff, 0xfb, 0x90, 0x00], i * FRAME);
  const tag = tail ? Buffer.concat([Buffer.from('TAG'), Buffer.alloc(125)]) : Buffer.alloc(0);
  return new Uint8Array(Buffer.concat([head, body, tag]));
}
function wav(seconds, rate = 16000) {
  const pcm = Buffer.alloc(seconds * rate * 2);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  return new Uint8Array(Buffer.concat([h, pcm]));
}

test('MP3 frames are found after an ID3 tag, before ID3v1, and across junk bytes', async () => {
  const v = await load('src/routes/voice.ts');
  assert.deepEqual(v.mp3FrameAt(mp3(1, { id3: false }), 0), { length: FRAME, seconds: FRAME_SECONDS });
  assert.equal(v.mp3Frames(mp3(50)).length, 50);
  assert.equal(v.mp3Frames(mp3(50, { tail: true })).length, 50);
  const junk = mp3(20, { id3: false });
  const withJunk = new Uint8Array(Buffer.concat([Buffer.from(junk.subarray(0, 10 * FRAME)), Buffer.from([1, 2, 3, 0xff, 0x00]), Buffer.from(junk.subarray(10 * FRAME))]));
  assert.equal(v.mp3Frames(withJunk).length, 20);
  assert.equal(v.mp3FrameAt(new Uint8Array([0xff, 0xfb, 0xf0, 0]), 0), null, 'bitrate index 15 is not a frame');
});

test('audio is planned into parts Whisper takes in one call, with each part\'s start time', async () => {
  const v = await load('src/routes/voice.ts');
  const one = v.planAudio(mp3(100));
  assert.equal(one.format, 'mp3');
  assert.equal(one.parts.length, 1);
  assert.ok(Math.abs(one.seconds - 100 * FRAME_SECONDS) < 1e-9);
  // Small limits: 30 frames a part by bytes.
  const many = v.planAudio(mp3(100), 30 * FRAME, 9999);
  assert.deepEqual(many.parts.map((p) => p.bytes.length / FRAME), [30, 30, 30, 10]);
  assert.ok(Math.abs(many.parts[2].start - 60 * FRAME_SECONDS) < 1e-9);
  assert.equal(many.parts[0].bytes[0], 0xff, 'a part starts on a frame header');
  // ...and by seconds.
  assert.equal(v.planAudio(mp3(100), 1e9, 1).parts.length, Math.ceil(100 / Math.floor(1 / FRAME_SECONDS)));
  // WAV: parts are standalone WAV files cut on sample boundaries.
  const w = v.planAudio(wav(25), 1e9, 10);
  assert.equal(w.format, 'wav');
  assert.equal(w.seconds, 25);
  assert.deepEqual(w.parts.map((p) => p.seconds), [10, 10, 5]);
  assert.deepEqual(w.parts.map((p) => p.start), [0, 10, 20]);
  const info = v.wavInfo(w.parts[1].bytes);
  assert.equal(info.dataLength, 10 * 16000 * 2);
  assert.equal(info.byteRate, 32000);
  assert.throws(() => v.planAudio(new Uint8Array(Buffer.from('OggS' + 'x'.repeat(5000)))), /MP3 or WAV/);
});

test('part transcripts are moved to their place in the whole recording', async () => {
  const v = await load('src/routes/voice.ts');
  const p = v.shiftPart({ text: ' Hello. ', transcription_info: { language: 'en', language_probability: 0.9 }, segments: [{ start: 0.5, end: 1.25, text: ' Hello. ', words: [{ word: ' Hello.', start: 0.5, end: 1.25 }] }] }, 600);
  assert.deepEqual(p, { text: 'Hello.', language: 'en', languageProbability: 0.9, segments: [{ start: 600.5, end: 601.25, text: 'Hello.' }], words: [{ word: 'Hello.', start: 600.5, end: 601.25 }] });
});

test('lite speech voices: Aura-1 names, OpenAI names mapped, others refused', async () => {
  const v = await load('src/routes/voice.ts');
  const q = (voice) => (name) => (name === 'voice' ? voice : undefined);
  assert.equal(v.liteVoice(q(undefined)), 'luna');
  assert.equal(v.liteVoice(q('Helios')), 'helios');
  assert.equal(v.liteVoice(q('aura-orion-en')), 'orion');
  assert.equal(v.liteVoice(q('nova')), 'asteria');
  assert.equal(v.liteVoice(q('coral')), 'luna', 'an OpenAI voice with no Aura-1 twin speaks with the default');
  assert.throws(() => v.liteVoice(q('thalia')), /voice/);
  assert.equal(v.LITE_VOICES.length, 12);
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
const BOUNDARY = 'x-voice-tools-7a1';
const multipart = (bytes, fields = {}) => Buffer.concat([
  ...Object.entries(fields).map(([k, val]) => Buffer.from(`--${BOUNDARY}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${val}\r\n`, 'latin1')),
  Buffer.from(`--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="talk.mp3"\r\nContent-Type: audio/mpeg\r\n\r\n`, 'latin1'), Buffer.from(bytes), Buffer.from(`\r\n--${BOUNDARY}--\r\n`, 'latin1')]);

test('the two voice tools are paid tools at their prices; large uploads to the API fronts go to /transcribe/long', async () => {
  const long = await mf.dispatchFetch(`${O}/transcribe/long`, { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: Buffer.from(mp3(200)) });
  assert.equal(long.status, 402);
  const lq = await quote(long);
  assert.equal(lq.accepts[0].amount, '50000');
  assert.match(lq.resource.url, /\/transcribe\/long\?file=/);
  const lite = await mf.dispatchFetch(`${O}/text-to-speech/lite?text=Hello%20there.`);
  assert.equal(lite.status, 402);
  assert.equal((await quote(lite)).accepts[0].amount, '40000');
  // Not in the free calls.
  const trial = await mf.dispatchFetch(`${O}/text-to-speech/lite?text=Hello&trial=1`, { headers: { accept: 'application/json' } });
  assert.equal(trial.status, 402);
  // A 6 MB MP3 upload to the OpenAI front is quoted at the long tool's price.
  const big = mp3(Math.ceil(6 * 1024 * 1024 / FRAME));
  const res = await mf.dispatchFetch(`${O}/v1/audio/transcriptions`, { method: 'POST', headers: { 'content-type': `multipart/form-data; boundary=${BOUNDARY}` }, body: multipart(big, { model: 'whisper-1' }) });
  assert.equal(res.status, 402);
  assert.equal(res.headers.get('X-Tool'), '/transcribe/long');
  assert.equal((await quote(res)).accepts[0].amount, '50000');
  // A small one stays on /transcribe.
  const small = await mf.dispatchFetch(`${O}/v1/audio/transcriptions`, { method: 'POST', headers: { 'content-type': `multipart/form-data; boundary=${BOUNDARY}` }, body: multipart(mp3(50)) });
  assert.equal(small.headers.get('X-Tool'), '/transcribe');
});
