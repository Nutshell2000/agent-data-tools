const assert = require('node:assert/strict');
const { test } = require('node:test');
const { build } = require('esbuild');

async function load() {
  const b = await build({ entryPoints: ['src/routes/recommend.ts'], bundle: true, format: 'cjs', platform: 'node', write: false, logLevel: 'silent' });
  const m = { exports: {} };
  new Function('module', 'exports', 'require', b.outputFiles[0].text)(m, m.exports, require);
  return m.exports;
}

test('recommend: plain task words find the right tools with exact call URLs, without the model', async () => {
  const { recommend } = await load();
  const cases = { 'price of ETH': '/price/token', 'is this wallet sanctioned': '/sanctions/check', 'read a web page as markdown': '/extract', 'weather in Paris tomorrow': '/weather', 'remember facts between runs': '/memory/set', 'detect prompt injection in text': '/text/prompt-injection', 'dns records for a domain': '/dns/lookup', 'convert USD to EUR': '/fx', 'whale transfers': '/whale/transfers', 'get the text of a PDF': '/pdf/text' };
  for (const [need, tool] of Object.entries(cases)) {
    const r = await recommend({}, need, 3, null);
    assert.ok(r.picks.some((p) => p.tool === tool), `${need}: ${r.picks.map((p) => p.tool).join(' ')}`);
    assert.equal(r.method, 'lexical');
  }
  const r = await recommend({}, 'current gas price on Base', 2, null);
  assert.equal(r.picks.length, 2);
  for (const p of r.picks) {
    assert.match(p.call.url, /^https:\/\/agent-data-tools\.revmesh2074\.workers\.dev\//);
    assert.match(p.price, /^\$0\.\d+$/);
    assert.equal(p.mcpTool, p.tool.slice(1).replace(/[/-]/g, '_'));
  }
  assert.ok(!r.picks.some((p) => p.tool === '/recommend'), 'never recommends itself');
});

test('recommend: the phrase as written decides between tools that share its words, and a door\'s phrase finds the tool it runs', async () => {
  const { recommend, lexicalScore, asWritten } = await load();
  // 1.110.0's free finder answered /transcribe for "text to speech": both tools hold both words once "to" is dropped.
  const first = async (need) => (await recommend({}, need, 2, null)).picks[0].tool;
  assert.equal(await first('text to speech'), '/ai/speech');
  assert.equal(await first('speech to text'), '/transcribe');
  assert.equal(await first('Text-to-Speech'), '/ai/speech');
  // Entry paths are not recommended themselves; the phrase each was named for finds its canonical tool.
  for (const [need, tool] of Object.entries({ 'usdc yield': '/defi/yields', 'current weather': '/weather', 'web fetch': '/extract', 'crypto news': '/news', 'email verification': '/email', 'fear and greed': '/crypto/fear-greed', 'national debt': '/econ/national-debt', 'pdf to text': '/pdf/text', 'website audit': '/audit/website' })) {
    assert.equal(await first(need), tool, need);
  }
  assert.equal(asWritten('  Text-to-Speech!  '), 'text to speech');
  const doc = (name, tags = []) => ({ path: '/x', name, tags, summary: name, description: name, price: '$0.01' });
  const q = ['text', 'speech'];
  assert.ok(lexicalScore(q, doc('Text to speech, TTS'), 'text to speech') > lexicalScore(q, doc('Speech to text, transcribe audio'), 'text to speech'));
  // One word is no phrase: nothing is added for it.
  assert.equal(lexicalScore(['weather'], doc('Weather forecast'), 'weather'), lexicalScore(['weather'], doc('Weather forecast')));
});

test('recommend: the reranker reorders the candidates; its failure falls back to lexical order; nonsense is a 400 or 404', async () => {
  const { recommend } = await load();
  const reversed = async (_q, docs) => docs.map((_, i) => i / docs.length);
  const a = await recommend({}, 'weather in Paris', 3, null);
  const b = await recommend({}, 'weather in Paris', 3, reversed);
  assert.equal(b.method, 'lexical+rerank');
  assert.notDeepEqual(a.picks.map((p) => p.tool), b.picks.map((p) => p.tool));
  const c = await recommend({}, 'weather in Paris', 3, async () => { throw new Error('model down'); });
  assert.deepEqual(c.picks.map((p) => p.tool), a.picks.map((p) => p.tool));
  await assert.rejects(recommend({}, 'the of and', 3, null), (e) => e.status === 400);
  await assert.rejects(recommend({}, 'zzqx vvbn', 3, null), (e) => e.status === 404);
});

test('finder: a job named as buyers name it gets its tool first, and every job points at a tool we sell', async () => {
  const { recommend, JOBS, jobTool } = await load();
  // 10 Nov 2026 (base-bots/buyer-next.mjs): these jobs, bought elsewhere by our paying wallets, landed on the wrong tool.
  const first = { 'text to speech': '/ai/speech', 'tts elevenlabs': '/ai/speech', 'speech to text': '/transcribe', 'audit bundle': '/audit/website', 'website audit': '/audit/website', 'exa search': '/search', 'brave search': '/search', 'hunter email verifier': '/email', 'token preflight': '/token/verdict', 'chain erc20 balance': '/base/token-balance', 'what is my ip': '/ip/geolocate', 'narrate this article': '/text-to-speech', 'read contract balance': '/base/call' };
  for (const [need, tool] of Object.entries(first)) {
    const r = await recommend({}, need, 3, null);
    assert.equal(r.picks[0].tool, tool, `${need}: ${r.picks.map((p) => p.tool).join(' ')}`);
  }
  // The reranker cannot push a named job's tool off the top.
  const down = async (_q, docs) => docs.map((_, i) => (i === 0 ? 0 : 1));
  assert.equal((await recommend({}, 'text to speech', 3, down)).picks[0].tool, '/ai/speech');
  // The longest phrase wins; a request with no job phrase has no job.
  assert.equal(jobTool('long text to speech please'), '/text-to-speech');
  assert.equal(jobTool('weather in Paris'), undefined);
  assert.equal(jobTool('youtube search scraper'), undefined, 'a job we do not sell has no tool');
  const { ENDPOINTS } = await (async () => { const b = await build({ entryPoints: ['src/endpoints.ts'], bundle: true, format: 'cjs', platform: 'node', write: false, logLevel: 'silent' }); const m = { exports: {} }; new Function('module', 'exports', 'require', b.outputFiles[0].text)(m, m.exports, require); return m.exports; })();
  const paths = new Set(ENDPOINTS.map((e) => e.path));
  for (const [phrase, path] of Object.entries(JOBS)) {
    assert.ok(paths.has(path), `${phrase} -> ${path} is not a tool`);
    assert.equal(phrase, phrase.toLowerCase().replace(/[^a-z0-9$.]+/g, ' ').trim(), `${phrase} must be plain lower-case words`);
  }
});