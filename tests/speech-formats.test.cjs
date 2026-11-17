// Speech audio formats (lib/speech-formats.ts, 17 Nov 2026): mp3, wav, pcm, ulaw, alaw, opus, flac for the speech tools
// and the ElevenLabs / OpenAI fronts. Formats were probed on Workers AI that day (AAC came back in a non-standard wrapper).
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { build } = require('esbuild');

async function load(entry) {
  const b = await build({ entryPoints: [entry], bundle: true, format: 'cjs', platform: 'node', write: false, logLevel: 'silent' });
  const m = { exports: {} };
  new Function('module', 'exports', 'require', b.outputFiles[0].text)(m, m.exports, require);
  return m.exports;
}

test('format names, sample rates and the Aura-2 parameters for each', async () => {
  const f = await load('src/lib/speech-formats.ts');
  assert.deepEqual(f.parseFormat(undefined, undefined), { name: 'mp3' });
  assert.deepEqual(f.parseFormat('WAV', undefined), { name: 'wav', sampleRate: 24000 });
  assert.deepEqual(f.parseFormat('ulaw', '16000'), { name: 'ulaw', sampleRate: 16000 });
  assert.match(f.parseFormat('ulaw', '24000').error, /8000, 16000/);
  assert.match(f.parseFormat('mp3', '8000').error, /sample_rate applies/);
  assert.match(f.parseFormat('aac', undefined).error, /format must be/);
  assert.deepEqual(f.auraParams({ name: 'ulaw', sampleRate: 8000 }), { encoding: 'mulaw', container: 'none', sample_rate: 8000 });
  assert.deepEqual(f.auraParams({ name: 'wav', sampleRate: 16000 }), { encoding: 'linear16', container: 'none', sample_rate: 16000 }, 'WAV is asked for raw and wrapped here');
  assert.equal(f.joinable({ name: 'opus' }), false);
  assert.equal(f.joinable({ name: 'pcm', sampleRate: 24000 }), true);
  assert.match(f.formatType({ name: 'pcm', sampleRate: 16000 }), /audio\/L16; rate=16000/);
});

test('raw parts join in order and WAV gets one correct header over the joined PCM', async () => {
  const f = await load('src/lib/speech-formats.ts');
  const a = Uint8Array.from([1, 2, 3, 4]); const b = Uint8Array.from([5, 6]);
  assert.deepEqual([...f.joinRaw([a, b], { name: 'pcm', sampleRate: 24000 })], [1, 2, 3, 4, 5, 6]);
  const wav = f.joinRaw([a, b], { name: 'wav', sampleRate: 16000 });
  assert.equal(wav.length, 50);
  const v = new DataView(wav.buffer);
  assert.equal(Buffer.from(wav.subarray(0, 4)).toString(), 'RIFF');
  assert.equal(v.getUint32(4, true), 36 + 6);
  assert.equal(v.getUint32(24, true), 16000);
  assert.equal(v.getUint32(28, true), 32000, 'byte rate = rate x 2 for 16-bit mono');
  assert.equal(v.getUint32(40, true), 6);
  assert.equal(f.rawSeconds(16000, { name: 'ulaw', sampleRate: 8000 }), 2);
});

test('ElevenLabs output_format and OpenAI response_format map to formats', async () => {
  const f = await load('src/lib/speech-formats.ts');
  assert.deepEqual(f.fromElevenFormat('mp3_44100_128'), { name: 'mp3' });
  assert.deepEqual(f.fromElevenFormat(''), { name: 'mp3' });
  assert.deepEqual(f.fromElevenFormat('ulaw_8000'), { name: 'ulaw', sampleRate: 8000 });
  assert.deepEqual(f.fromElevenFormat('alaw_8000'), { name: 'alaw', sampleRate: 8000 });
  assert.deepEqual(f.fromElevenFormat('pcm_48000'), { name: 'pcm', sampleRate: 48000 });
  assert.deepEqual(f.fromElevenFormat('opus_48000_64'), { name: 'opus' });
  assert.match(f.fromElevenFormat('pcm_22050').error, /pcm_22050/);
  assert.match(f.fromElevenFormat('webm').error, /output_format/);
  assert.deepEqual(f.fromOpenAiFormat('pcm'), { name: 'pcm', sampleRate: 24000 });
  assert.deepEqual(f.fromOpenAiFormat(undefined), { name: 'mp3' });
  assert.match(f.fromOpenAiFormat('aac').error, /aac/);
});

test('the speech tools speak each part in the asked format, join raw audio, and refuse Opus for long text before running', async () => {
  const t = await load('src/routes/ai-text.ts');
  const calls = [];
  const env = { AI: { run: async (model, input) => { calls.push(input); return new Uint8Array([input.text.length % 256, 7]); } } };
  const pcm = await t.speakFormatted(env, '@cf/deepgram/aura-2-en', 'luna', ['one', 'three'], { name: 'pcm', sampleRate: 24000 });
  assert.deepEqual([...Buffer.from(pcm, 'base64')], [3, 7, 5, 7]);
  assert.equal(calls[0].encoding, 'linear16'); assert.equal(calls[0].container, 'none'); assert.equal(calls[0].speaker, 'luna');
  const wav = Buffer.from(await t.speakFormatted(env, '@cf/deepgram/aura-2-en', 'luna', ['a', 'bb'], { name: 'wav', sampleRate: 8000 }), 'base64');
  assert.equal(wav.subarray(0, 4).toString(), 'RIFF'); assert.equal(wav.length, 44 + 4);
  calls.length = 0;
  await assert.rejects(t.speakFormatted(env, '@cf/deepgram/aura-2-en', 'luna', ['a', 'b'], { name: 'opus' }), /one part/);
  assert.equal(calls.length, 0, 'nothing ran');
  const opus = await t.speakFormatted(env, '@cf/deepgram/aura-2-en', 'luna', ['a'], { name: 'opus' });
  assert.ok(opus.length > 0); assert.equal(calls[0].encoding, 'opus');
});

test('pronunciations: whole words in any case, longest first, JSON or word=say, and both fronts pass them on', async () => {
  const f = await load('src/lib/speech-formats.ts');
  const pairs = f.parsePronunciations('Nginx=engine x, GIF=jif');
  assert.equal(f.applyPronunciations('Run nginx; send a GIF, not GIFs.', pairs), 'Run engine x; send a jif, not GIFs.');
  assert.deepEqual(f.parsePronunciations({ SQL: 'sequel' }), [['SQL', 'sequel']]);
  assert.deepEqual(f.parsePronunciations('{"Åsa":"Oh-sa"}'), [['Åsa', 'Oh-sa']]);
  assert.equal(f.applyPronunciations('Hej Åsa!', f.parsePronunciations('{"Åsa":"Oh-sa"}')), 'Hej Oh-sa!');
  assert.equal(f.applyPronunciations('a.b axb', [['a.b', 'dot']]), 'dot axb', 'the word is matched literally, not as a pattern');
  assert.match(f.parsePronunciations('{bad').error, /JSON/);
  assert.match(f.parsePronunciations(Object.fromEntries(Array.from({ length: 51 }, (_, i) => [`w${i}`, 'x']))).error, /up to 50/);
  assert.deepEqual(f.parsePronunciations(undefined), []);
  const s = await load('src/lib/openai-speech.ts');
  assert.equal(s.toSpeechRequest({ input: 'Hi', pronunciations: { GIF: 'jif' } }).pronunciations, '{"GIF":"jif"}');
  assert.match(s.toSpeechRequest({ input: 'Hi', pronunciations: '{oops' }).error, /JSON/);
  const v = await load('src/lib/voice-fronts.ts');
  assert.equal(v.elevenSpeechRequest({ text: 'Hi', pronunciations: 'GIF=jif' }, 'luna', null).pronunciations, '{"GIF":"jif"}');
});

test('the speech tool speaks the text as the pronunciations say', async () => {
  const t = await load('src/routes/ai-text.ts');
  const q = (k) => ({ pronunciations: 'Nginx=engine x' })[k];
  assert.equal(t.sayAs(q, 'Restart Nginx now.', 300), 'Restart engine x now.');
  assert.throws(() => t.sayAs((k) => (k === 'pronunciations' ? 'a=' + 'b'.repeat(61) : undefined), 'a', 300), /at most 60/);
});