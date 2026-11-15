const assert = require('node:assert/strict');
const { before, after, test } = require('node:test');
const { build } = require('esbuild');
const { Miniflare, convertV4MiniflareOptions } = require('miniflare');

// 1.199.0 (15 Nov 2026, "start selling more voice calls"): the drop-in voice fronts are in /openapi.json, their 402
// quotes carry an "ElevenLabs-compatible API" name and tags after the task words (never "ElevenLabs text to speech"
// first: the voices are Deepgram Aura), and /mcp/voice is a small voice-only MCP server.
let mf;
const O = 'https://api.test';
before(async () => {
  const b = await build({ entryPoints: ['src/index.ts'], bundle: true, format: 'esm', platform: 'browser', write: false, external: ['cloudflare:workers', 'node:*'],
    plugins: [{ name: 'url', setup(b) { b.onResolve({ filter: /^url$/ }, () => ({ path: 'node:url', external: true })); } }] });
  mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: b.outputFiles[0].text, compatibilityDate: '2026-09-01', compatibilityFlags: ['nodejs_compat'],
    durableObjects: { METRICS: { className: 'Metrics', useSQLite: true } },
    bindings: { PAY_TO: '0x2074c40346ae2a90e0e4a391bcee6f16bf5277f5', NETWORK: 'eip155:8453', PAYWALL: 'on', TRIALS_ENABLED: 'on', FACILITATOR_URL: 'https://fixture.invalid', BASE_RPC_URL: 'https://fixture.invalid' },
    outboundService: async () => Response.json({ kinds: [{ x402Version: 2, scheme: 'exact', network: 'eip155:8453', extra: { name: 'USD Coin', version: '2' } }], extensions: [] }) }));
});
after(async () => { await mf?.dispose(); });

const quote = (r) => JSON.parse(Buffer.from(r.headers.get('payment-required'), 'base64').toString('utf8'));

test('/openapi.json lists the three voice fronts with prices, GET variants and honest names', async () => {
  const doc = await (await mf.dispatchFetch(`${O}/openapi.json`)).json();
  for (const p of ['/v1/text-to-speech/{voice_id}', '/v1/speech-to-text', '/v1/audio/transcriptions']) {
    const item = doc.paths[p];
    assert.ok(item, `${p} missing from /openapi.json`);
    for (const m of ['get', 'post']) {
      assert.ok(item[m]['x-payment-info'], `${p} ${m} has no x-payment-info`);
      assert.ok(item[m].responses['200'], `${p} ${m} has no 200 response`);
      assert.doesNotMatch(item[m].summary, /^ElevenLabs/i, `${p} ${m} summary must start with the task, not the rival's name`);
    }
  }
  const tts = doc.paths['/v1/text-to-speech/{voice_id}'];
  assert.ok(tts.post.parameters.some((x) => x.name === 'voice_id' && x.in === 'path' && x.required));
  assert.ok(tts.get.parameters.some((x) => x.name === 'voice_id' && x.in === 'path'));
  assert.match(tts.post.summary, /ElevenLabs-compatible/);
  assert.match(tts.post.description, /Deepgram Aura-2/);
});

test('the ElevenLabs fronts quote under a compatible-API name and tags; the extension stays the tool\'s', async () => {
  const tts = await mf.dispatchFetch(`${O}/v1/text-to-speech/21m00Tcm4TlvDq8ikWAM`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(tts.status, 402);
  const t = quote(tts);
  assert.equal(t.resource.serviceName, 'Text to speech, ElevenLabs-compatible API');
  assert.ok(t.resource.tags.includes('elevenlabs-compatible'));
  assert.ok(!t.resource.tags.includes('elevenlabs'), 'a bare elevenlabs tag would read as their product');
  assert.match(t.resource.url, /\/v1\/text-to-speech\/21m00Tcm4TlvDq8ikWAM$/);
  assert.ok(t.extensions?.bazaar, 'the tool\'s Bazaar extension must pass through unchanged');

  const stt = await mf.dispatchFetch(`${O}/v1/speech-to-text`, { method: 'POST' });
  assert.equal(stt.status, 402);
  assert.equal(quote(stt).resource.serviceName, 'Speech to text, ElevenLabs-compatible API');

  const oa = await mf.dispatchFetch(`${O}/v1/audio/transcriptions`, { method: 'POST' });
  assert.equal(oa.status, 402);
  assert.match(quote(oa).resource.serviceName, /OpenAI Whisper-compatible/);
});

test('the OpenAI speech front keeps the tool\'s own name (no meta passed)', async () => {
  const r = await mf.dispatchFetch(`${O}/v1/audio/speech`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(r.status, 402);
  assert.doesNotMatch(String(quote(r).resource.serviceName ?? ''), /ElevenLabs/);
});
