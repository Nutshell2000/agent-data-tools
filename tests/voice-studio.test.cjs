const assert = require('node:assert/strict');
const { before, test } = require('node:test');
const { build } = require('esbuild');

// 1.206.0: /dialogue and /text-to-speech/captions. The fake Aura-2 returns real MPEG-1 Layer III frames (128 kbps,
// 44.1 kHz: 417 bytes and 1152/44100 s each), so the timings are computed from audio exactly as in production.
let m;
before(async () => {
  const d = await build({ entryPoints: ['src/routes/voice-studio.ts'], bundle: true, format: 'cjs', platform: 'node', write: false,
    plugins: [{ name: 'stub', setup(b) {
      b.onResolve({ filter: /^(cloudflare:workers|@cloudflare\/puppeteer)$/ }, (a) => ({ path: a.path, namespace: 'stub' }));
      b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'module.exports = { DurableObject: class {} };', loader: 'js' }));
    } }] });
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', d.outputFiles[0].text)(mod, mod.exports, require);
  m = mod.exports;
});

const FRAME = 1152 / 44100;
const mp3 = (frames) => { const b = new Uint8Array(frames * 417); for (let i = 0; i < frames; i++) b.set([0xff, 0xfb, 0x90, 0x00], i * 417); return b; };
const q = (o) => (k) => o[k];
const kv = () => { const s = new Map(); return { get: async (k) => s.get(k) ?? null, put: async (k, v) => { s.set(k, v); }, delete: async (k) => { s.delete(k); } }; };
const env = (run) => ({ AI: { run }, TRIALS: kv() });
const tool = (path) => m.VOICE_STUDIO.find((e) => e.endpoint.path === path);
const close = (a, b) => Math.abs(a - b) < 0.01;

test('scripts parse into turns; unnamed lines continue the last speaker', () => {
  assert.deepEqual(m.parseScript('Anna: Hello!\nBen: Hi Anna.\nHow are you?\n\nAnna: Fine.'), [
    { speaker: 'Anna', text: 'Hello!' }, { speaker: 'Ben', text: 'Hi Anna. How are you?' }, { speaker: 'Anna', text: 'Fine.' }]);
  assert.deepEqual(m.parseScript('Just a line.'), [{ speaker: 'Narrator', text: 'Just a line.' }]);
});

test('voices: the caller map wins, then distinct defaults; unknown voices are refused', () => {
  assert.deepEqual(m.castVoices(['Anna', 'Ben'], 'en', undefined), { Anna: 'luna', Ben: 'orion' });
  assert.deepEqual(m.castVoices(['Anna', 'Ben'], 'en', 'ben=zeus'), { Anna: 'luna', Ben: 'zeus' });
  assert.deepEqual(m.castVoices(['Anna'], 'en', '{"Anna":"Athena"}'), { Anna: 'athena' });
  assert.throws(() => m.castVoices(['Anna'], 'en', 'Anna=nobody'), /not one of the en voices/);
  assert.throws(() => m.castVoices(['Anna'], 'en', '{bad'), /voices must be JSON/);
});

test('/dialogue speaks each turn with its voice and times the captions from the frames', async () => {
  const seen = [];
  const run = async (model, input) => { seen.push(input.speaker); return mp3(input.speaker === 'luna' ? 40 : 60); };
  const out = await tool('/dialogue').run(env(run), q({ script: 'Anna: Welcome back to the show!\nBen: Thanks, it is great to be here.' }));
  assert.deepEqual(seen, ['luna', 'orion']);
  assert.deepEqual(out.speakers, { Anna: 'luna', Ben: 'orion' });
  assert.ok(close(out.lines[0].end, 40 * FRAME));
  assert.ok(close(out.lines[1].start, 40 * FRAME) && close(out.lines[1].end, 100 * FRAME));
  assert.match(out.captions, /^1\n00:00:00,000 --> 00:00:01,04\d\nAnna: Welcome back to the show!/);
  assert.match(out.captions, /\nBen: Thanks, it is great to be here\./);
  assert.equal(out.durationSeconds, Math.round(100 * FRAME * 10) / 10, 'rounded to a tenth');
  // The joined MP3 holds every frame of both turns.
  assert.equal(Buffer.from(out.audioBase64, 'base64').length, 100 * 417);
});

test('/dialogue refuses too many speakers, too much text and bad options before speaking', async () => {
  const e = env(async () => { throw new Error('model must not run'); });
  const seven = Array.from({ length: 7 }, (_, i) => `S${i}: Line ${i}.`).join('\n');
  await assert.rejects(tool('/dialogue').run(e, q({ script: seven })), /up to 6/);
  await assert.rejects(tool('/dialogue').run(e, q({ script: `A: ${'word '.repeat(600)}` })), /up to 2,500/);
  await assert.rejects(tool('/dialogue').run(e, q({ script: '' })), /script is required/);
  await assert.rejects(tool('/dialogue').run(e, q({ script: 'A: hi', lang: 'sv' })), /lang must be en or es/);
  await assert.rejects(tool('/dialogue').run(e, q({ script: 'A: hi', captions: 'txt' })), /captions must be srt or vtt/);
});

test('caption cues follow sentences, split long ones at commas, and join very short ones', () => {
  assert.deepEqual(m.captionCues('Hi. Welcome to the course. Today we start with the basics.'), ['Hi. Welcome to the course.', 'Today we start with the basics.']);
  const long = 'This sentence is deliberately long, so that it has to be split at a comma somewhere sensible, and it keeps going well past the limit of one caption line.';
  const cues = m.captionCues(long);
  assert.ok(cues.length >= 2 && cues.every((c) => c.length <= 120));
  assert.equal(cues.join(' '), long);
});

test('/text-to-speech/captions returns one MP3 and SRT cues timed to each sentence', async () => {
  const run = async (model, input) => mp3(input.text.length);
  const text = 'Welcome to the course. Today we start with the basics, and by the end of the hour you will build your first project.';
  const out = await tool('/text-to-speech/captions').run(env(run), q({ text, captions: 'vtt' }));
  assert.equal(out.cues.length, 2);
  assert.ok(close(out.cues[0].end, 'Welcome to the course.'.length * FRAME));
  assert.ok(close(out.cues[1].start, out.cues[0].end));
  assert.match(out.captions, /^WEBVTT/);
  assert.equal(out.voice, 'luna');
  assert.equal(out.captionFormat, 'vtt');
});

test('prices cover the worst case of Aura-2 at $0.030 per 1,000 characters', () => {
  assert.ok((m.DIALOGUE_MAX_CHARS / 1000) * 0.03 < Number(m.DIALOGUE_PRICE.slice(1)));
  assert.ok((m.CAPTIONS_MAX_CHARS / 1000) * 0.03 < Number(m.CAPTIONS_PRICE.slice(1)));
});
