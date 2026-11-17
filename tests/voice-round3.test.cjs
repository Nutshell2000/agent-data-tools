// Glyphcall Voice round 3 (1.192.0): /transcribe/summary, short non-MP3 voice notes in one Whisper call, the voice
// comparison pages, voice jobs in the finder and the AI category for the voice tools.
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
const FRAME = 417;
function mp3(frames) {
  const body = Buffer.alloc(frames * FRAME);
  for (let i = 0; i < frames; i++) body.set([0xff, 0xfb, 0x90, 0x00], i * FRAME);
  return new Uint8Array(body);
}

test('the summary reader takes clean JSON, fenced JSON and plain text', async () => {
  const v = await load('src/routes/voice.ts');
  const s = v.readSummary('```json\n{"title":"Budget call","summary":"We agreed the budget.","keyPoints":["Budget 10k"],"actionItems":[{"task":"Send the plan","owner":"Sam","due":"Friday"},{"task":"","owner":null},"Book a room"],"questions":["null"]}\n```');
  assert.equal(s.title, 'Budget call');
  assert.equal(s.summary, 'We agreed the budget.');
  assert.deepEqual(s.keyPoints, ['Budget 10k']);
  assert.deepEqual(s.actionItems, [{ task: 'Send the plan', owner: 'Sam', due: 'Friday' }, { task: 'Book a room', owner: null, due: null }]);
  assert.deepEqual(s.questions, [], '"null" strings are dropped');
  const plain = v.readSummary('The speaker says hello.');
  assert.equal(plain.summary, 'The speaker says hello.');
  assert.deepEqual(plain.actionItems, []);
});

function fakeEnv(calls) {
  return { AI: { run: async (model, input) => {
    calls.push({ model, input });
    if (/whisper/.test(model)) return { text: 'Call Sam about the budget on Friday.', transcription_info: { language: 'en' }, segments: [{ start: 0, end: 4.2, text: 'Call Sam about the budget on Friday.' }] };
    return { response: '{"title":"Budget reminder","summary":"A reminder to call Sam.","keyPoints":["Budget"],"actionItems":[{"task":"Call Sam about the budget","owner":null,"due":"Friday"}],"questions":[]}' };
  } } };
}

test('a short file that is neither MP3 nor WAV goes to Whisper in one call; a large one is refused uncharged', async () => {
  const v = await load('src/routes/voice.ts');
  const calls = [];
  const ogg = new Uint8Array(Buffer.concat([Buffer.from('OggS'), Buffer.alloc(2000)]));
  const t = await v.transcribeAudio(fakeEnv(calls), ogg, '');
  assert.equal(t.format, 'other');
  assert.equal(t.parts, 1);
  assert.equal(t.seconds, 4.2, 'length read from the last segment');
  assert.equal(calls.length, 1);
  const big = new Uint8Array(6 * 1024 * 1024);
  await assert.rejects(() => v.transcribeAudio(fakeEnv([]), big, ''), (e) => e.status === 415);
});

test('/transcribe/summary transcribes, then summarises with the transcript fenced as untrusted content', async () => {
  const v = await load('src/routes/voice.ts');
  const tool = v.VOICE.find((e) => e.endpoint.path === '/transcribe/summary');
  assert.equal(tool.endpoint.price, '$0.05');
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(Buffer.from(mp3(60)), { headers: { 'content-type': 'audio/mpeg' } });
  try {
    const calls = [];
    const q = (n) => ({ url: 'https://example.com/note.mp3', transcript: 'false' })[n];
    const out = await tool.run(fakeEnv(calls), q);
    assert.equal(out.title, 'Budget reminder');
    assert.deepEqual(out.actionItems, [{ task: 'Call Sam about the budget', owner: null, due: 'Friday' }]);
    assert.equal(out.text, undefined, 'transcript=false leaves the transcript out');
    assert.equal(out.language, 'en');
    const llm = calls.find((c) => !/whisper/.test(c.model));
    assert.match(llm.input.messages[1].content, /<transcript>\nCall Sam/);
    assert.match(llm.input.messages[0].content, /untrusted content/);
  } finally { globalThis.fetch = realFetch; }
});

test('voice jobs reach the right tools in the finder; voice tools are in the AI category', async () => {
  const r = await load('src/routes/recommend.ts');
  assert.equal(r.JOBS['meeting notes'], '/transcribe/summary');
  assert.equal(r.JOBS['podcast transcription'], '/transcribe/long');
  assert.equal(r.JOBS['cheap tts'], '/text-to-speech/lite');
  const d = await load('src/discovery.ts');
  for (const p of ['/transcribe/long', '/text-to-speech/lite', '/transcribe/summary']) assert.equal(d.categoryOf(p), 'AI', p);
});

test('no rival figures on the site (owner, 17 Nov 2026): our prices come from the catalog, the home page names no rival', async () => {
  const v = await load('src/lib/voice-prices.ts');
  const us = v.ourVoice();
  assert.equal(us.long, '$0.05');
  assert.equal(us.longPerHour, 0.05);
  const h = await load('src/lib/home-page.ts');
  const html = h.landingPage('Glyphcall', 'https://glyphcall.test', true, { trial: true });
  // Only the request-format facts may name another service ("OpenAI- and ElevenLabs-shaped requests", "ElevenLabs- and OpenAI-compatible").
  const prose = html.replace(/\b(?:OpenAI- and |ElevenLabs- and )?(?:OpenAI|ElevenLabs|Exa)-(?:shaped|compatible)/g, '');
  for (const name of ['ElevenLabs', 'Deepgram', 'AssemblyAI', 'Exa ', "Exa's", 'Whisper API', 'tts-1']) assert.ok(!prose.includes(name), name);
  assert.ok(!/\/compare|\/benchmarks|exa-alternative|cheaper than|cheapest/i.test(html));
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

test('/transcribe/summary is a paid tool at $0.05 and outside the free calls; the removed comparison pages redirect and are not in the sitemap', async () => {
  const res = await mf.dispatchFetch(`${O}/transcribe/summary?url=https://example.com/a.mp3`, { headers: { accept: 'application/json' } });
  assert.equal(res.status, 402);
  const q = JSON.parse(Buffer.from(res.headers.get('PAYMENT-REQUIRED'), 'base64').toString());
  assert.equal(q.accepts[0].amount, '50000');
  const trial = await mf.dispatchFetch(`${O}/transcribe/summary?url=https://example.com/a.mp3&trial=1`, { headers: { accept: 'application/json' } });
  assert.equal(trial.status, 402);
  // 1.195.0: an uploaded file is held and quoted like the long tool's (the Obsidian plugin and fast mode send files).
  const upload = await mf.dispatchFetch(`${O}/transcribe/summary`, { method: 'POST', headers: { 'content-type': 'audio/mpeg' }, body: Buffer.from(mp3(200)) });
  assert.equal(upload.status, 402);
  assert.match((JSON.parse(Buffer.from(upload.headers.get('PAYMENT-REQUIRED'), 'base64').toString())).resource.url, /\/transcribe\/summary\?file=/);
  // 17 Nov 2026: the comparison pages are gone; every old path is a 301 to its product page, query kept.
  const moved = { '/compare': '/invoice-data-extraction-api', '/compare/mindee-alternative': '/invoice-data-extraction-api', '/compare/elevenlabs-alternative': '/text-to-speech-api', '/compare/whisper-api-alternative': '/speech-to-text-api', '/benchmarks': '/eu-law-search-api', '/exa-alternative-api': '/company-check-api', '/compare/anything-new': '/invoice-data-extraction-api' };
  for (const [from, to] of Object.entries(moved)) {
    const r = await mf.dispatchFetch(`${O}${from}?utm=x`, { redirect: 'manual' });
    assert.equal(r.status, 301, from);
    assert.equal(new URL(r.headers.get('location'), O).pathname + new URL(r.headers.get('location'), O).search, `${to}?utm=x`, from);
  }
  const sitemap = await (await mf.dispatchFetch(`${O}/sitemap.xml`)).text();
  assert.ok(!/\/compare|\/benchmarks|exa-alternative/.test(sitemap));
});
