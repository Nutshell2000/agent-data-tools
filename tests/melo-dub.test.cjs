// MeloTTS is retired (Workers AI, 20 Nov 2026): /dub, /voice/agent and the speech tools refuse fr, zh, ja and ko with
// a 422 that names en and es. The WAV helpers still run in unit tests (dead at runtime after the retirement).
const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const { build } = require('esbuild');

let M, V, AI_TEXT;
const load = async (entry) => {
  const b = await build({ entryPoints: [entry], bundle: true, format: 'cjs', platform: 'node', write: false, logLevel: 'silent', external: ['cloudflare:workers'] });
  const m = { exports: {} };
  new Function('module', 'exports', 'require', b.outputFiles[0].text)(m, m.exports, require);
  return m.exports;
};
before(async () => { M = await load('src/lib/melo.ts'); V = await load('src/routes/voice-plus.ts'); AI_TEXT = (await load('src/routes/ai-text.ts')).AI_TEXT; });

// A WAV as MeloTTS returned: RIFF, LIST chunk before data, 44.1 kHz mono 16-bit.
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

test('dub target: en and es answer codes; retired fr/zh/ja/ko are a 422 naming en and es; other languages are a 400 naming them', () => {
  for (const [sent, code] of [['en', 'en'], ['es', 'es']]) assert.equal(V.dubTarget(sent), code);
  for (const retired of ['fr', 'FR', 'french', 'français', 'zh', 'mandarin', 'zh-cn', 'ja', 'jp', 'japanese', 'ko', 'kr', 'korean'])
    assert.throws(() => V.dubTarget(retired), (e) => e.status === 422 && /en or es/.test(e.message), retired);
  assert.throws(() => V.dubTarget('sv'), (e) => e.status === 400 && /en, es/.test(e.message));
  assert.throws(() => V.dubTarget('constructor'), (e) => e.status === 400);
});

test('speech tools: fr/zh/ja/ko are refused with a 422 that names en and es; en and es still answer', async () => {
  const tool = (p) => AI_TEXT.find((e) => e.endpoint.path === p);
  const env = { AI: { run: async () => ({ audio: Buffer.from(wav(new Array(441).fill(100))).toString('base64') }) } };
  const q = (o) => (n) => o[n];
  for (const [lang, code] of [['fr', 'fr'], ['ja', 'ja'], ['ko', 'ko']])
    await assert.rejects(tool('/ai/speech').run(env, q({ text: 'Bonjour.', lang })), (e) => e.status === 422 && e.message.includes(code) && /en or es/.test(e.message));
  for (const p of ['/ai/speech', '/text-to-speech'])
    await assert.rejects(tool(p).run(env, q({ text: 'Hallo', lang: 'fr' })), (e) => e.status === 422 && /retired/.test(e.message));
  for (const p of ['/ai/speech', '/text-to-speech'])
    await assert.rejects(tool(p).run(env, q({ text: 'Hallo', lang: 'de' })), (e) => e.status === 400 && /en, es/.test(e.message));
  const ok = await tool('/ai/speech').run(env, q({ text: 'Hello.', lang: 'en' }));
  assert.equal(ok.lang, 'en');
  for (const p of ['/ai/speech', '/text-to-speech'])
    assert.deepEqual(tool(p).endpoint.params.lang.enum, ['en', 'es']);
});

test('voice agent: fr/zh/ja/ko are refused before any model call, unknown languages are a 400', async () => {
  const q = (o) => (n) => o[n];
  const e = { AI: { run: async () => { throw new Error('model must not run'); } } };
  const tool = V.VOICE_PLUS.find((t) => t.endpoint.path === '/voice/agent');
  for (const lang of ['fr', 'ja', 'ko', 'zh'])
    await assert.rejects(tool.run(e, q({ text: 'hi', lang })), (err) => err.status === 422 && /en or es/.test(err.message));
  await assert.rejects(tool.run(e, q({ text: 'hi', lang: 'sv' })), (err) => err.status === 400);
});
