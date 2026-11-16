// MeloTTS voices for /dub in fr, zh, ja and ko (16 Nov 2026): WAV parsing, resampling to 16 kHz, joining, and the
// target-language input. Workers AI is not called here.
const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const { build } = require('esbuild');

let M, V;
const load = async (entry) => {
  const b = await build({ entryPoints: [entry], bundle: true, format: 'cjs', platform: 'node', write: false, logLevel: 'silent', external: ['cloudflare:workers'] });
  const m = { exports: {} };
  new Function('module', 'exports', 'require', b.outputFiles[0].text)(m, m.exports, require);
  return m.exports;
};
before(async () => { M = await load('src/lib/melo.ts'); V = await load('src/routes/voice-plus.ts'); });

// A WAV as MeloTTS returns it: RIFF, a LIST chunk before data, 44.1 kHz mono 16-bit.
function wav(samples, rate = 44100, extra = true) {
  const list = extra ? Buffer.concat([Buffer.from('LIST'), Buffer.from([4, 0, 0, 0]), Buffer.from('INFO')]) : Buffer.alloc(0);
  const fmt = Buffer.alloc(24); fmt.write('fmt ', 0); fmt.writeUInt32LE(16, 4); fmt.writeUInt16LE(1, 8); fmt.writeUInt16LE(1, 10); fmt.writeUInt32LE(rate, 12); fmt.writeUInt32LE(rate * 2, 16); fmt.writeUInt16LE(2, 20); fmt.writeUInt16LE(16, 22);
  const data = Buffer.alloc(8 + samples.length * 2); data.write('data', 0); data.writeUInt32LE(samples.length * 2, 4); samples.forEach((s, i) => data.writeInt16LE(s, 8 + i * 2));
  const body = Buffer.concat([Buffer.from('WAVE'), fmt, list, data]);
  const head = Buffer.alloc(8); head.write('RIFF', 0); head.writeUInt32LE(body.length, 4);
  return new Uint8Array(Buffer.concat([head, body]));
}

test('wav: samples and rate are read past other chunks; anything else is a 502', () => {
  const { samples, rate } = M.wavSamples(wav([1, -2, 3, 32767, -32768]));
  assert.equal(rate, 44100);
  assert.deepEqual([...samples], [1, -2, 3, 32767, -32768]);
  assert.throws(() => M.wavSamples(new Uint8Array(Buffer.from('ID3' + 'x'.repeat(60)))), (e) => e.status === 502);
});

test('wav: 44.1 kHz to 16 kHz keeps the length in time and the level of a steady signal', () => {
  const second = new Int16Array(44100).fill(1000);
  const out = M.resample(second, 44100);
  assert.equal(out.length, 16000);
  assert.ok(out.every((s) => s === 1000));
  const low = new Int16Array(10);
  assert.equal(M.resample(low, 16000), low);
});

test('wav: parts join into one valid 16 kHz file with a pause between them', () => {
  const joined = M.joinWav([new Int16Array([5, 6]), new Int16Array([7])], 16000, 1);
  const back = M.wavSamples(joined);
  assert.equal(back.rate, 16000);
  assert.deepEqual([...back.samples], [5, 6, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 7]);
  assert.equal(Buffer.from(joined).readUInt32LE(4), joined.length - 8);
});

test('dub target: codes and English names for six languages; others are a 400 naming them', () => {
  for (const [sent, code] of [['es', 'es'], ['FR', 'fr'], ['French', 'fr'], ['japanese', 'ja'], ['jp', 'ja'], ['kr', 'ko'], ['Mandarin', 'zh']]) assert.equal(V.dubTarget(sent), code);
  assert.throws(() => V.dubTarget('de'), (e) => e.status === 400 && /en, es, fr, zh, ja, ko/.test(e.message));
  assert.throws(() => V.dubTarget('constructor'), (e) => e.status === 400);
  assert.deepEqual(Object.keys(M.MELO_LANGS).sort(), ['fr', 'ja', 'ko', 'zh']);
});

// The speech tools in fr, zh, ja and ko (16 Nov 2026): MeloTTS with its own language codes, one WAV, limits stated.
test('speech tools: fr/zh/ja/ko go to MeloTTS as one 16 kHz WAV; unknown languages are a 400 naming all six', async () => {
  const { AI_TEXT } = await load('src/routes/ai-text.ts');
  const tool = (p) => AI_TEXT.find((e) => e.endpoint.path === p);
  const seen = [];
  const env = { AI: { run: async (model, body) => { seen.push({ model, ...body }); return { audio: Buffer.from(wav(new Array(441).fill(100))).toString('base64') }; } } };
  const q = (o) => (n) => o[n];
  const short = await tool('/ai/speech').run(env, q({ text: 'Bonjour à tous.', lang: 'French' }));
  assert.equal(short.contentType, 'audio/wav');
  assert.equal(short.lang, 'fr');
  assert.deepEqual(seen.map((s) => [s.model, s.lang, s.prompt]), [['@cf/myshell-ai/melotts', 'fr', 'Bonjour à tous.']]);
  assert.equal(M.wavSamples(Uint8Array.from(Buffer.from(short.audioBase64, 'base64'))).rate, 16000);
  seen.length = 0;
  const ja = await tool('/text-to-speech').run(env, q({ text: 'こんにちは。'.repeat(60), lang: 'ja' }));
  assert.ok(ja.parts >= 2 && seen.every((s) => s.lang === 'jp' && s.prompt.length <= 200), JSON.stringify(seen.map((s) => s.prompt.length)));
  await assert.rejects(tool('/text-to-speech').run(env, q({ text: 'a'.repeat(1201), lang: 'ko' })), (e) => e.status === 400 && /1,200/.test(e.message));
  await assert.rejects(tool('/ai/speech').run(env, q({ text: 'Hallo', lang: 'de' })), (e) => e.status === 400 && /en, es, fr, zh, ja, ko/.test(e.message));
  for (const p of ['/ai/speech', '/text-to-speech']) assert.deepEqual(tool(p).endpoint.params.lang.enum, ['en', 'es', 'fr', 'zh', 'ja', 'ko']);
});
