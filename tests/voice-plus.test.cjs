const assert = require('node:assert/strict');
const { before, test } = require('node:test');
const { build } = require('esbuild');

// 1.204.0: /transcribe/speakers (Nova-3 speaker labels, redaction) and /subtitles/translate (M2M100, timings kept).
// The handlers run against a fake Workers AI binding, so these tests need no network and no account.
let m;
before(async () => {
  const d = await build({ stdin: { contents: 'export * from "./src/routes/voice-plus"; export { holdFile, FILE_REF_INPUT } from "./src/lib/file-input";', resolveDir: process.cwd(), loader: 'ts' }, bundle: true, format: 'cjs', platform: 'node', write: false,
    plugins: [{ name: 'stub', setup(b) {
      b.onResolve({ filter: /^(cloudflare:workers|@cloudflare\/puppeteer)$/ }, (a) => ({ path: a.path, namespace: 'stub' }));
      b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'module.exports = { DurableObject: class {} };', loader: 'js' }));
    } }] });
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', d.outputFiles[0].text)(mod, mod.exports, require);
  m = mod.exports;
});

const SRT = '1\n00:00:00,000 --> 00:00:02,500\nWelcome to the course.\n\n2\n00:00:02,600 --> 00:00:05,000\nToday we start\nwith the basics.\n';
const VTT = 'WEBVTT\n\n00:00.000 --> 00:02.500 align:start\nHello there.\n\n00:02.600 --> 00:05.000\nGoodbye.\n';
const q = (o) => (k) => o[k];
const kv = () => { const store = new Map(); return { get: async (k) => store.get(k) ?? null, put: async (k, v) => { store.set(k, v); }, delete: async (k) => { store.delete(k); } }; };
const env = (run) => ({ AI: { run }, TRIALS: kv() });
const tool = (path) => m.VOICE_PLUS.find((e) => e.endpoint.path === path);

test('SRT and VTT parse and write back with every timing kept', () => {
  const s = m.parseSubtitles(SRT);
  assert.equal(s.format, 'srt');
  assert.equal(s.cues.length, 2);
  assert.equal(s.cues[1].text, 'Today we start\nwith the basics.');
  assert.equal(s.cues[1].start, 2.6);
  assert.equal(m.writeSubtitles('srt', s.cues).trim(), SRT.trim());
  const v = m.parseSubtitles(VTT);
  assert.equal(v.format, 'vtt');
  assert.equal(v.cues[0].timing, '00:00.000 --> 00:02.500 align:start', 'VTT cue settings survive');
  assert.match(m.writeSubtitles('vtt', v.cues), /^WEBVTT\n\n00:00\.000 --> 00:02\.500 align:start\nHello there\./);
  assert.equal(m.parseSubtitles('just some text').cues.length, 0);
});

test('/subtitles/translate translates each cue, keeps the format and the timings', async () => {
  const seen = [];
  const run = async (model, input) => { seen.push(input); return { translated_text: `[${input.target_lang}] ${input.text}` }; };
  const out = await tool('/subtitles/translate').run(env(run), q({ subtitles: SRT, to: 'sv' }));
  assert.equal(out.format, 'srt');
  assert.equal(out.from, 'en', 'English detected');
  assert.equal(out.cues, 2);
  assert.equal(seen.length, 2);
  assert.ok(seen.every((i) => i.source_lang === 'en' && i.target_lang === 'sv'));
  assert.match(out.subtitles, /00:00:02,600 --> 00:00:05,000\n\[sv\] Today we start/);
});

test('/subtitles/translate refuses bad input before any model call', async () => {
  let calls = 0;
  const e = env(async () => { calls++; return { translated_text: 'x' }; });
  await assert.rejects(tool('/subtitles/translate').run(e, q({ subtitles: SRT })), /to is required/);
  await assert.rejects(tool('/subtitles/translate').run(e, q({ subtitles: 'no cues here', to: 'sv' })), /no subtitle cues/);
  await assert.rejects(tool('/subtitles/translate').run(e, q({ subtitles: SRT, to: 'en' })), /already look like en/);
  const many = Array.from({ length: m.SUBTITLE_MAX_CUES + 1 }, (_, i) => `${i + 1}\n00:00:0${i % 10},000 --> 00:00:0${i % 10},500\nLine ${i}.\n`).join('\n');
  await assert.rejects(tool('/subtitles/translate').run(e, q({ subtitles: many, to: 'sv' })), /up to 400/);
  assert.equal(calls, 0);
});

test('audio types are read from the bytes', () => {
  const b = (s, at = 0) => { const a = new Uint8Array(16); for (let i = 0; i < s.length; i++) a[at + i] = s.charCodeAt(i); return a; };
  const wav = b('RIFF'); wav.set(b('WAVE').subarray(0, 4), 8);
  assert.equal(m.audioType(wav), 'audio/wav');
  assert.equal(m.audioType(b('ID3')), 'audio/mpeg');
  assert.equal(m.audioType(b('OggS')), 'audio/ogg');
  assert.equal(m.audioType(b('ftyp', 4)), 'audio/mp4');
  assert.equal(m.audioType(b('%PDF')), null);
});

test('speaker turns are numbered from 1 and neighbouring turns of one speaker are joined', () => {
  const turns = m.speakerTurns({ results: { utterances: [
    { start: 0, end: 1, transcript: 'Hi.', speaker: 0 },
    { start: 1.2, end: 2, transcript: 'How are you?', speaker: 0 },
    { start: 2.5, end: 3.5, transcript: 'Fine, thanks.', speaker: 1 },
  ] } });
  assert.deepEqual(turns, [{ speaker: 1, start: 0, end: 2, text: 'Hi. How are you?' }, { speaker: 2, start: 2.5, end: 3.5, text: 'Fine, thanks.' }]);
});

// An Ogg voice note under 2 MB takes the unmeasured path (no frame count), so the size cap guards its cost.
const ogg = (n = 4000) => { const a = new Uint8Array(n); a.set([0x4f, 0x67, 0x67, 0x53]); return a; };

test('/transcribe/speakers sends Nova-3 the uploaded audio with speaker labels and returns turns and subtitles', async () => {
  let sent;
  const run = async (model, input) => { sent = { model, input }; return { results: { channels: [{ alternatives: [{ transcript: 'Hi. Fine, thanks.', languages: ['en'] }] }], utterances: [{ start: 0, end: 1, transcript: 'Hi.', speaker: 0 }, { start: 1.5, end: 2.5, transcript: 'Fine, thanks.', speaker: 1 }] } }; };
  const ref = await m.holdFile(ogg());
  const out = await tool('/transcribe/speakers').run(env(run), q({ [m.FILE_REF_INPUT]: ref, subtitles: 'srt', redact: 'pii' }));
  assert.equal(sent.model, '@cf/deepgram/nova-3');
  assert.equal(sent.input.diarize, true);
  assert.equal(sent.input.utterances, true);
  assert.equal(sent.input.redact, 'pii');
  assert.equal(sent.input.detect_language, undefined, 'never with redaction: Nova-3 fails on the pair');
  assert.equal(sent.input.language, 'en');
  assert.equal(sent.input.audio.contentType, 'audio/ogg');
  assert.ok(sent.input.audio.body, 'audio body is a stream');
  assert.equal(out.speakers, 2);
  assert.deepEqual(out.turns.map((t) => t.speaker), [1, 2]);
  assert.equal(out.language, 'en');
  assert.equal(out.redacted, 'pii');
  assert.match(out.subtitles, /Speaker 1: Hi\./);
  assert.match(out.subtitles, /Speaker 2: Fine, thanks\./);
});

test('/transcribe/speakers caps unmeasured formats at 2 MB and refuses non-audio, before the model runs', async () => {
  const e = env(async () => { throw new Error('model must not run'); });
  const big = await m.holdFile(ogg(m.SPEAKERS_OTHER_MAX_BYTES + 1));
  await assert.rejects(tool('/transcribe/speakers').run(e, q({ [m.FILE_REF_INPUT]: big })), /MP3 or WAV file for recordings over 2 MB/);
  const pdf = new Uint8Array(100); pdf.set([0x25, 0x50, 0x44, 0x46]);
  const notAudio = await m.holdFile(pdf);
  await assert.rejects(tool('/transcribe/speakers').run(e, q({ [m.FILE_REF_INPUT]: notAudio })), /send an audio file/);
});
test('/transcribe/speakers refuses an unknown redact mode and a bad subtitle format before reading audio', async () => {
  const e = env(async () => { throw new Error('model must not run'); });
  await assert.rejects(tool('/transcribe/speakers').run(e, q({ url: 'https://example.com/a.mp3', redact: 'all' })), /redact must be one of/);
  await assert.rejects(tool('/transcribe/speakers').run(e, q({ url: 'https://example.com/a.mp3', subtitles: 'txt' })), /subtitles must be srt or vtt/);
});

test('the price covers the worst case: 15 minutes of Nova-3 at $0.0052 a minute', () => {
  const cost = (m.SPEAKERS_MAX_SECONDS / 60) * 0.0052;
  assert.ok(cost < Number(m.SPEAKERS_PRICE.slice(1)), `cost ${cost} must stay under the price`);
});

test('/transcribe/speakers without redaction asks Nova-3 to detect the language and reports it', async () => {
  let sent;
  const run = async (model, input) => { sent = input; return { results: { channels: [{ alternatives: [{ transcript: 'Hola.', languages: ['es'] }] }], utterances: [{ start: 0, end: 1, transcript: 'Hola.', speaker: 0 }] } }; };
  const ref = await m.holdFile(ogg(3000));
  const out = await tool('/transcribe/speakers').run(env(run), q({ [m.FILE_REF_INPUT]: ref }));
  assert.equal(sent.detect_language, true);
  assert.equal(sent.language, undefined);
  assert.equal(out.language, 'es');
  assert.equal(out.note, undefined);
});
test('/dub transcribes, translates each segment, speaks Spanish with Aura-2 and returns subtitles on the original timings', async () => {
  const calls = [];
  const run = async (model, input) => {
    calls.push(model);
    if (model.includes('whisper')) return { text: 'Hello there. Thanks for watching.', transcription_info: { language: 'en' }, segments: [{ start: 0, end: 1.2, text: 'Hello there.' }, { start: 1.4, end: 3, text: 'Thanks for watching.' }] };
    if (model.includes('m2m100')) return { translated_text: input.text === 'Hello there.' ? 'Hola.' : 'Gracias por mirar.' };
    if (model.includes('aura-2-es')) { assert.equal(input.speaker, 'aquila'); return new Uint8Array([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 0]); }
    throw new Error(`unexpected model ${model}`);
  };
  const ref = await m.holdFile(ogg(5000));
  const out = await tool('/dub').run(env(run), q({ [m.FILE_REF_INPUT]: ref, to: 'es' }));
  assert.equal(out.from, 'en');
  assert.equal(out.to, 'es');
  assert.equal(out.text, 'Hola. Gracias por mirar.');
  assert.equal(out.contentType, 'audio/mpeg');
  assert.ok(out.audioBase64.length > 0);
  assert.match(out.subtitles, /00:00:01,400 --> 00:00:03,000\nGracias por mirar\./);
  assert.deepEqual(calls.filter((c) => c.includes('m2m100')).length, 2);
});

test('/dub refuses a retired voice language, an unknown language and a bad voice, before any model call', async () => {
  const e = env(async () => { throw new Error('model must not run'); });
  const ref = await m.holdFile(ogg(5000));
  await assert.rejects(tool('/dub').run(e, q({ [m.FILE_REF_INPUT]: ref, to: 'fr' })), (err) => err.status === 422 && /en or es/.test(err.message));
  await assert.rejects(tool('/dub').run(e, q({ [m.FILE_REF_INPUT]: ref, to: 'sv' })), (err) => err.status === 400 && /to must be one of en, es/.test(err.message));
  await assert.rejects(tool('/dub').run(e, q({ [m.FILE_REF_INPUT]: ref, to: 'es', voice: 'luna' })), /voice must be one of the es voices/);
});

test('/dub price covers its worst case: 2,500 characters of Aura-2 plus transcription and translation', () => {
  const cost = (m.DUB_MAX_CHARS / 1000) * 0.03 + (m.DUB_MAX_SECONDS / 60) * 0.0005 + 0.01;
  assert.ok(cost < Number(m.DUB_PRICE.slice(1)));
});

test('/voice/agent answers a typed turn with the operator instructions and history, speaks it, and returns the new history', async () => {
  let prompt;
  const run = async (model, input) => {
    if (model.includes('llama-4-scout')) { prompt = input.messages; return { response: '**On Saturday** we open at seven and close at five.' }; }
    if (model.includes('aura-2-en')) return new Uint8Array([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 0]);
    throw new Error(`unexpected model ${model}`);
  };
  const history = JSON.stringify([{ role: 'user', content: 'Hi' }, { role: 'assistant', content: 'Hello! How can I help?' }]);
  const out = await tool('/voice/agent').run(env(run), q({ text: 'When do you open on Saturday?', instructions: 'You answer for a bakery. Open 7-17.', history }));
  const userMsg = prompt.find((p) => p.role === 'user').content;
  assert.match(userMsg, /<instructions>\nYou answer for a bakery/);
  assert.match(userMsg, /User: Hi\nAssistant: Hello! How can I help\?\nUser: When do you open on Saturday\?/);
  assert.equal(out.heard, 'When do you open on Saturday?');
  assert.equal(out.reply, 'On Saturday we open at seven and close at five.', 'markdown is stripped for speech');
  assert.equal(out.history.length, 4);
  assert.deepEqual(out.history.at(-1), { role: 'assistant', content: out.reply });
  assert.equal(out.contentType, 'audio/mpeg');
});

test('/voice/agent hears a voice note through Whisper before answering', async () => {
  const run = async (model) => {
    if (model.includes('whisper')) return { text: ' Is the shop open today? ', segments: [] };
    if (model.includes('llama-4-scout')) return { response: 'Yes, until five.' };
    return new Uint8Array([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 0]);
  };
  const ref = await m.holdFile(ogg(2000));
  const out = await tool('/voice/agent').run(env(run), q({ [m.FILE_REF_INPUT]: ref }));
  assert.equal(out.heard, 'Is the shop open today?');
  assert.equal(out.reply, 'Yes, until five.');
  assert.equal(out.heardFrom, undefined);
});

test('/voice/agent refuses bad input before any model call', async () => {
  const e = env(async () => { throw new Error('model must not run'); });
  await assert.rejects(tool('/voice/agent').run(e, q({})), /send the user's turn/);
  await assert.rejects(tool('/voice/agent').run(e, q({ text: 'hi', lang: 'sv' })), (err) => err.status === 400 && /lang must be one of en, es/.test(err.message));
  await assert.rejects(tool('/voice/agent').run(e, q({ text: 'hi', lang: 'fr' })), (err) => err.status === 422 && /en or es/.test(err.message));
  await assert.rejects(tool('/voice/agent').run(e, q({ text: 'hi', history: '{nope' })), /history must be a JSON array/);
});

test('history is capped at 10 turns and spoken replies end at a sentence', () => {
  const many = JSON.stringify(Array.from({ length: 14 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `turn ${i}` })));
  const h = m.readHistory(many);
  assert.equal(h.length, 10);
  assert.equal(h[0].content, 'turn 4');
  const long = 'First sentence here. ' + 'word '.repeat(200);
  assert.equal(m.spokenReply(long, 40), 'First sentence here.');
  assert.ok(m.spokenReply(long, 100).length <= 100, 'never longer than the limit');
  assert.ok(Number(m.VOICE_AGENT_PRICE.slice(1)) > (m.VOICE_AGENT_REPLY_MAX / 1000) * 0.03 + 0.005, 'price covers the worst case');
});
