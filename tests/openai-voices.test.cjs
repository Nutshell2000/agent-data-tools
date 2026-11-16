// GET /v1/audio/voices: the voice names the speech front accepts, free. Home Assistant's openai_tts integration
// (voice_listing.py / catalogue_parsers.py) reads `data` [{id, name}] or `voices` [string] from it.
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

// The selector options Home Assistant's openai_tts builds from a voice listing (catalogue_parsers.voice_options_from_payload).
function haOptions(payload) {
  const items = Array.isArray(payload) ? payload : (payload.items || payload.data || payload.voices || []);
  return items.map((v) => (typeof v === 'string' ? { value: v, label: v } : { value: String(v.id || v.voice_id || v.value), label: String(v.name || v.label || v.id) })).filter((o) => o.value);
}

test('the voice list holds exactly the voices the speech tools accept, default first', async () => {
  const lib = await load('src/lib/openai-voices.ts');
  const ai = await load('src/routes/ai-text.ts');
  const en = lib.openAiVoiceList();
  assert.equal(en.language, 'en');
  assert.equal(en.data[0].id, 'luna');
  assert.equal(en.data[0].default, true);
  assert.equal(en.default, 'luna');
  const own = en.data.filter((v) => !v.alias_of).map((v) => v.id);
  assert.deepEqual([...own].sort(), [...ai.SPEECH_VOICES.en].sort());
  // Every OpenAI name is listed and names a real English voice.
  for (const [alias, voice] of Object.entries(ai.OPENAI_VOICES)) {
    const item = en.data.find((v) => v.id === alias);
    assert.equal(item.alias_of, voice);
    assert.ok(ai.SPEECH_VOICES.en.includes(voice), voice);
  }
  assert.deepEqual(en.voices, en.data.map((v) => v.id));
  assert.equal(new Set(en.voices).size, en.voices.length, 'no voice listed twice');
  // Spanish only when asked: a Spanish voice also needs language=es on the speech request.
  const es = lib.openAiVoiceList('es-ES');
  assert.equal(es.language, 'es');
  assert.equal(es.data[0].id, 'aquila');
  assert.deepEqual([...es.voices].sort(), [...ai.SPEECH_VOICES.es].sort());
  assert.ok(!en.voices.some((v) => ai.SPEECH_VOICES.es.includes(v)));
  assert.match(lib.openAiVoiceList('de').error, /en or es/);
  // What Home Assistant makes of it: one option per voice, the default first.
  const opts = haOptions(en);
  assert.equal(opts.length, en.data.length);
  assert.deepEqual(opts[0], { value: 'luna', label: 'Luna (default)' });
});

let mf;
const O = 'https://api.test';
before(async () => {
  const b = await build({ entryPoints: ['src/index.ts'], bundle: true, format: 'esm', platform: 'browser', write: false, external: ['cloudflare:workers', 'node:*'],
    plugins: [{ name: 'url', setup(b) { b.onResolve({ filter: /^url$/ }, () => ({ path: 'node:url', external: true })); } }] });
  mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: b.outputFiles[0].text, compatibilityDate: '2026-09-01', compatibilityFlags: ['nodejs_compat'],
    durableObjects: { METRICS: { className: 'Metrics', useSQLite: true } },
    bindings: { PAY_TO: '0x2074c40346ae2a90e0e4a391bcee6f16bf5277f5', NETWORK: 'eip155:8453', PAYWALL: 'on', TRIALS_ENABLED: 'on', FACILITATOR_URL: 'https://fixture.invalid', BASE_RPC_URL: 'https://fixture.invalid' },
    outboundService: async () => new Response('no network in this test', { status: 500 }) }));
});
after(async () => { await mf?.dispose(); });

test('GET /v1/audio/voices answers free, with a bearer key or without, and is in the OpenAPI document', async () => {
  for (const headers of [{}, { authorization: 'Bearer adt_not_a_real_key', 'user-agent': 'HomeAssistant-OpenAI-TTS' }]) {
    const res = await mf.dispatchFetch(`${O}/v1/audio/voices?limit=100`, { headers });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('access-control-allow-origin'), '*');
    const body = await res.json();
    assert.equal(body.data[0].id, 'luna');
    assert.ok(body.voices.includes('nova'));
  }
  const es = await (await mf.dispatchFetch(`${O}/v1/audio/voices?language=es`)).json();
  assert.equal(es.data[0].id, 'aquila');
  const bad = await mf.dispatchFetch(`${O}/v1/audio/voices?language=fr`);
  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).error.type, 'invalid_request_error');
  const doc = await (await mf.dispatchFetch(`${O}/openapi.json`)).json();
  const path = doc.paths['/v1/audio/voices'];
  assert.ok(path.get);
  assert.deepEqual(path.get.security, []);
});
