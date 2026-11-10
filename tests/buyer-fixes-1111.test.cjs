// 1.111.0 (11 Nov 2026): the IP tools answer for the caller's own address, VIES is asked again when it is busy, long text
// is spoken as one MP3, and /status shows each day.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { build } = require('esbuild');

async function load(entry) {
  const b = await build({ entryPoints: [entry], bundle: true, format: 'cjs', platform: 'node', write: false, logLevel: 'silent' });
  const m = { exports: {} };
  new Function('module', 'exports', 'require', b.outputFiles[0].text)(m, m.exports, require);
  return m.exports;
}
const input = (o) => (n) => o[n];

test('ip tools: the address sent wins; without one the caller\'s public address is used; private callers and MCP still need ip', async () => {
  const { ipOrCaller, CALLER_IP_INPUT, GEO_IP } = await load('src/routes/geo-ip.ts');
  assert.deepEqual(ipOrCaller(input({ ip: ' 8.8.8.8 ', [CALLER_IP_INPUT]: '1.1.1.1' })), { ip: '8.8.8.8', own: false });
  assert.deepEqual(ipOrCaller(input({ ip: '[2001:4860:4860::8888]' })), { ip: '2001:4860:4860::8888', own: false });
  assert.deepEqual(ipOrCaller(input({ [CALLER_IP_INPUT]: '1.1.1.1' })), { ip: '1.1.1.1', own: true });
  assert.deepEqual(ipOrCaller(input({ [CALLER_IP_INPUT]: '2606:4700:4700::1111' })), { ip: '2606:4700:4700::1111', own: true });
  // No address at all (MCP, packs), a private caller (local development) or junk in the header: the plain refusal.
  for (const q of [{}, { [CALLER_IP_INPUT]: '10.0.0.7' }, { [CALLER_IP_INPUT]: '127.0.0.1' }, { [CALLER_IP_INPUT]: 'not-an-ip' }, { ip: '' }]) {
    assert.throws(() => ipOrCaller(input(q)), (e) => e.status === 400 && e.message === 'ip is required');
  }
  // The reserved name cannot be a query parameter a tool declares.
  for (const e of GEO_IP) assert.ok(!Object.hasOwn(e.endpoint.params, CALLER_IP_INPUT));
  // Both tools say what they do without ip, and neither marks ip required any more.
  for (const path of ['/ip/lookup', '/ip/geolocate']) {
    const e = GEO_IP.find((x) => x.endpoint.path === path).endpoint;
    assert.ok(!e.params.ip.required, path);
    assert.match(e.description, /without ip answers for the caller's own address/, path);
  }
});

test('ip geolocation: a missing ip is refused before the data is read; the caller\'s address goes on to the lookup', async () => {
  const { GEO_IP, CALLER_IP_INPUT } = await load('src/routes/geo-ip.ts');
  const tool = GEO_IP.find((x) => x.endpoint.path === '/ip/geolocate');
  // Without the data set the tool answers 503 either way; the refusal for a missing ip must come first.
  await assert.rejects(tool.run({ TRIALS: null }, input({})), (e) => e.status === 400);
  await assert.rejects(tool.run({ TRIALS: null }, input({ [CALLER_IP_INPUT]: '1.1.1.1' })), (e) => e.status === 503);
});

test('vat: a busy VIES is asked again and then answers; a clear answer is kept; a lasting outage is an uncharged 502', async () => {
  const { viesCheck } = await load('src/routes/registries.ts');
  const parts = { country: 'SE', number: '556703748501' };
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const waits = [];
  const sleep = async (ms) => { waits.push(ms); };
  // Two busy answers, then the real one.
  let calls = 0;
  const busyTwice = async () => (++calls <= 2 ? json({ isValid: false, userError: 'MS_MAX_CONCURRENT_REQ' }) : json({ isValid: true, userError: 'VALID', name: 'Spotify AB', address: 'REGERINGSGATAN 19\n111 53 STOCKHOLM', requestDate: '2026-11-11T08:00:00.000Z' }));
  const stored = new Map();
  const store = { match: async (k) => (stored.has(k) ? new Response(stored.get(k)) : undefined), put: async (k, res) => { stored.set(k, await res.text()); } };
  const a = await viesCheck(parts, busyTwice, sleep, store);
  assert.equal(calls, 3);
  assert.deepEqual(waits, [500, 1300]);
  assert.deepEqual(a, { vat: 'SE556703748501', country: 'SE', number: '556703748501', valid: true, name: 'Spotify AB', address: 'REGERINGSGATAN 19, 111 53 STOCKHOLM', checkedAt: '2026-11-11T08:00:00.000Z', source: 'EU VIES (European Commission)' });
  // The same number again does not go to VIES, and keeps the time it was checked.
  const b = await viesCheck(parts, async () => { throw new Error('must not be called'); }, sleep, store);
  assert.deepEqual(b, a);
  // An invalid number is a clear answer too (one call, no retry).
  calls = 0;
  const invalid = await viesCheck({ country: 'DE', number: '000000000' }, async () => { calls++; return json({ isValid: false, userError: 'INVALID', name: '---', address: '---' }); }, sleep, undefined);
  assert.equal(calls, 1);
  assert.equal(invalid.valid, false);
  assert.equal(invalid.name, null);
  // Busy every time: three tries, then a 502 that names the reason.
  calls = 0;
  await assert.rejects(viesCheck(parts, async () => { calls++; return json({ isValid: false, userError: 'MS_MAX_CONCURRENT_REQ' }); }, sleep, undefined), (e) => e.status === 502 && /MS_MAX_CONCURRENT_REQ/.test(e.message) && /nothing was charged/.test(e.message));
  assert.equal(calls, 3);
  // A network error is retried as well; an input VIES rejects is not.
  calls = 0;
  const flaky = await viesCheck(parts, async () => { if (++calls === 1) throw new Error('timeout'); return json({ isValid: true, userError: 'VALID' }); }, sleep, undefined);
  assert.equal(flaky.valid, true);
  calls = 0;
  await assert.rejects(viesCheck(parts, async () => { calls++; return json({ isValid: false, userError: 'INVALID_INPUT' }, 400); }, sleep, undefined), (e) => e.status === 502);
  assert.equal(calls, 1);
});

test('long speech: text is cut at sentence ends without losing a word, and MP3 parts join into one file', async () => {
  const { speechParts, joinMp3, id3Length, SPEECH_LONG_MAX, SPEECH_PART_MAX, SPEECH_VOICES, OPENAI_VOICES, AI_TEXT } = await load('src/routes/ai-text.ts');
  assert.deepEqual(speechParts('Short text.'), ['Short text.']);
  const sentence = 'The parcel leaves our warehouse today and should reach you within three working days. ';
  const long = sentence.repeat(23).trim(); // about 1,980 characters
  assert.ok(long.length <= SPEECH_LONG_MAX && long.length > 2 * SPEECH_PART_MAX);
  const parts = speechParts(long);
  assert.ok(parts.length >= Math.ceil(long.length / SPEECH_PART_MAX) && parts.length <= 5, String(parts.length));
  for (const p of parts) { assert.ok(p.length <= SPEECH_PART_MAX, String(p.length)); assert.match(p, /\.$/, 'each part ends at a sentence end'); }
  assert.equal(parts.join(' '), long, 'no word lost or added');
  // No sentence end: a comma, then a space, then a hard cut.
  assert.deepEqual(speechParts('aaaa bbbb, cccc dddd eeee', 12), ['aaaa bbbb,', 'cccc dddd', 'eeee']);
  assert.deepEqual(speechParts('abcdefghijklmnop', 6), ['abcdef', 'ghijkl', 'mnop']);
  // ID3v2: 10-byte header, syncsafe size.
  const id3 = (size) => Uint8Array.from([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, (size >> 7) & 0x7f, size & 0x7f, ...new Array(size).fill(0)]);
  assert.equal(id3Length(id3(35)), 45);
  assert.equal(id3Length(id3(300)), 310);
  assert.equal(id3Length(Uint8Array.from([0xff, 0xfb, 0x90, 0, 0, 0, 0, 0, 0, 0])), 0);
  const b64 = (bytes) => Buffer.from(bytes).toString('base64');
  const frame = (n) => [0xff, 0xfb, 0x90, n];
  const one = Uint8Array.from([...id3(35), ...frame(1), ...frame(2)]);
  const two = Uint8Array.from([...id3(20), ...frame(3)]);
  const three = Uint8Array.from([...frame(4), ...frame(5)]);
  const joined = Buffer.from(joinMp3([b64(one), b64(two), b64(three)]), 'base64');
  assert.deepEqual([...joined], [...one, ...frame(3), ...frame(4), ...frame(5)], 'first tag kept, later tags dropped, frames in order');
  assert.throws(() => joinMp3([b64(one), b64(Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0, 0]))]), (e) => e.status === 502);
  // The tool: every part is spoken with the chosen voice, in order; one failed part fails the call.
  const tool = AI_TEXT.find((e) => e.endpoint.path === '/text-to-speech');
  assert.equal(tool.endpoint.price, '$0.08');
  const seen = [];
  const env = { AI: { run: async (model, body) => { seen.push({ model, ...body }); return Uint8Array.from([...(seen.length === 1 ? id3(35) : []), ...frame(seen.length)]); } } };
  const out = await tool.run(env, input({ text: long, voice: 'Orion' }));
  assert.equal(out.parts, parts.length);
  assert.equal(out.voice, 'orion');
  assert.equal(out.characters, long.length);
  assert.equal(out.contentType, 'audio/mpeg');
  assert.deepEqual(seen.map((s) => s.text), parts);
  assert.ok(seen.every((s) => s.speaker === 'orion' && s.encoding === 'mp3'));
  assert.equal(out.bytes, Buffer.from(out.audioBase64, 'base64').length);
  await assert.rejects(tool.run({ AI: { run: async () => { throw new Error('model down'); } } }, input({ text: long })));
  await assert.rejects(tool.run(env, input({ text: 'x'.repeat(SPEECH_LONG_MAX + 1) })), (e) => e.status === 400);
  await assert.rejects(tool.run(env, input({ text: 'Hello.', voice: 'nobody' })), (e) => e.status === 400);
  // OpenAI's voice names speak with an Aura-2 voice; every mapped voice exists.
  for (const v of Object.values(OPENAI_VOICES)) assert.ok(SPEECH_VOICES.en.includes(v), v);
  assert.equal((await tool.run(env, input({ text: 'Hello there.', voice: 'alloy' }))).voice, 'luna');
  await assert.rejects(tool.run(env, input({ text: 'Hola.', lang: 'es', voice: 'alloy' })), (e) => e.status === 400);
  // The short tool's refusal of a long text names this one.
  const short = AI_TEXT.find((e) => e.endpoint.path === '/ai/speech');
  await assert.rejects(short.run(env, input({ text: long })), (e) => e.status === 400 && /\/text-to-speech reads up to 2000 characters \(\$0\.08\)/.test(e.message));
  assert.match(short.endpoint.description, /text_to_speech/);
  assert.ok(short.endpoint.description.length <= 450);
});

test('contract call: a function signature is encoded and its result decoded; calldata still passes through', async () => {
  const { callFromSignature, isSignature, hexInput } = await load('src/routes/chain-reads.ts');
  assert.equal(isSignature('0x18160ddd'), false);
  assert.equal(isSignature('18160ddd'), false);
  assert.equal(isSignature('totalSupply()'), true);
  assert.equal(isSignature('function balanceOf(address) view returns (uint256)'), true);
  assert.equal(isSignature(undefined), false);
  assert.equal(hexInput('18160ddd', 'data', 8192), '0x18160ddd');
  // Selectors every ERC-20 reader knows.
  assert.equal(callFromSignature('totalSupply()').data, '0x18160ddd');
  const who = '0x4200000000000000000000000000000000000006';
  const bal = callFromSignature('balanceOf(address) returns (uint256)', who);
  assert.equal(bal.data, '0x70a08231' + who.slice(2).padStart(64, '0'));
  assert.equal(bal.signature, 'balanceOf(address)');
  assert.deepEqual(bal.decode('0x' + (1000000n).toString(16).padStart(64, '0')), { decoded: '1000000' });
  // The result types can come in their own input; several results are a list; without them the raw result stands.
  assert.deepEqual(callFromSignature('decimals()', undefined, 'uint8').decode('0x' + '6'.padStart(64, '0')), { decoded: 6 });
  const two = callFromSignature('function pair() external view returns (address, uint8)');
  assert.deepEqual(two.decode('0x' + who.slice(2).padStart(64, '0') + '12'.padStart(64, '0')), { decoded: ['0x4200000000000000000000000000000000000006', 18] });
  // The standard getters decode without result types; an unknown function without them keeps the raw result and says how.
  assert.deepEqual(callFromSignature('decimals()').decode('0x' + '12'.padStart(64, '0')), { decoded: 18 });
  assert.match(callFromSignature('poolFee()').decode('0x00').decodeNote, /returns/);
  assert.match(bal.decode('0x').decodeNote, /does not decode/);
  // Arguments: numbers with separators, booleans, an upper-case address, a JSON array for array types.
  const allowance = callFromSignature('allowance(address,address)', `${who.toUpperCase().replace('0X', '0x')}, ${who}`);
  assert.equal(allowance.data.length, 2 + 8 + 128);
  assert.equal(callFromSignature('f(uint256,bool)', '1,000,true'.replace('1,000', '1_000')).data.slice(-64), '1'.padStart(64, '0'));
  assert.equal(callFromSignature('sum(uint256[])', '[[1,2,3]]').data.slice(0, 10).length, 10);
  // Refusals are 400s that say what to send.
  assert.throws(() => callFromSignature('balanceOf(address)'), (e) => e.status === 400 && /takes 1 argument/.test(e.message));
  assert.throws(() => callFromSignature('balanceOf(address)', 'not-an-address'), (e) => e.status === 400);
  assert.throws(() => callFromSignature('f(uint256)', 'abc'), (e) => e.status === 400 && /whole number/.test(e.message));
  assert.throws(() => callFromSignature('f(notatype)', '1'), (e) => e.status === 400 && /function signature/.test(e.message));
  assert.throws(() => callFromSignature('f(uint256[])', '1'), (e) => e.status === 400 && /JSON array/.test(e.message));
});

test('mcp: audio and images are media blocks, never base64 inside the text', async () => {
  const { toContent } = await load('src/mcp.ts');
  const audio = toContent({ contentType: 'audio/mpeg', audioBase64: 'SUQz'.repeat(1000), bytes: 3000, voice: 'luna', characters: 37 });
  assert.equal(audio.length, 2);
  assert.deepEqual(JSON.parse(audio[0].text), { contentType: 'audio/mpeg', bytes: 3000, voice: 'luna', characters: 37 });
  assert.ok(audio[0].text.length < 200, 'the text block stays small');
  assert.deepEqual({ type: audio[1].type, mimeType: audio[1].mimeType, size: audio[1].data.length }, { type: 'audio', mimeType: 'audio/mpeg', size: 4000 });
  const image = toContent({ contentType: 'image/png', imageBase64: 'AAAA', model: 'm' });
  assert.deepEqual(image[1], { type: 'image', data: 'AAAA', mimeType: 'image/png' });
  assert.deepEqual(toContent({ pong: true }), [{ type: 'text', text: '{"pong":true}' }]);
});

test('empty call: a price call with no input at all answers for BTC with a note; anything sent is used or refused as before', async () => {
  const T = await load('src/tools.ts');
  const B = await load('src/lib/bazaar-extension.ts');
  const { ENDPOINTS } = await load('src/endpoints.ts');
  for (const [path, d] of Object.entries(T.EMPTY_CALL_DEFAULTS)) {
    const e = ENDPOINTS.find((x) => x.path === path);
    assert.ok(e, `${path} is a tool`);
    // The listing still names an input (a router plans a real one), and the default is one of the tool's own inputs.
    assert.ok(B.requiredInputs(e).length >= 1, `${path} lists a required input`);
    for (const k of Object.keys(d.input)) assert.ok(Object.hasOwn(e.params, k), `${path} has the input ${k}`);
    assert.match(d.note, /^No input was sent/);
    // The default is written where a buyer reads the inputs.
    assert.match(Object.values(e.params).map((p) => p.description).join(' '), /no input at all/, path);
  }
  // The wrapper swaps the default in only on the route's flag. The price handler reaches the network, which is cut here:
  // the flagged call gets past the input check (it fails later, on the network), the unflagged one is the plain 400.
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('NET'); };
  try {
    const env = new Proxy({}, { get: () => undefined });
    await assert.rejects(T.TOOLS['/price/crypto'](env, () => undefined), (e) => e.status === 400 && /symbol/.test(e.message));
    await assert.rejects(Promise.race([T.TOOLS['/price/crypto'](env, (n) => (n === T.NO_INPUT ? '1' : undefined)), new Promise((_, r) => setTimeout(() => r(Object.assign(new Error('NET timeout'), { status: 599 })), 1500))]), (e) => e.status !== 400);
    // A tool without a default ignores the flag.
    await assert.rejects(T.TOOLS['/sanctions/check'](env, (n) => (n === T.NO_INPUT ? '1' : undefined)), (e) => e.status === 400);
  } finally { globalThis.fetch = realFetch; }
});