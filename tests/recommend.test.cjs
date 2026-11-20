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

test('recommend: named inputs from the job replace canned example values (20 Nov conformance audit)', async () => {
  const { recommend } = await load();
  // An agent that follows the finder's call URL must not pay for the canned example that contradicts its job.
  const es = (await recommend({}, 'translate text to Spanish', 3, null)).picks.find((p) => p.tool === '/ai/translate');
  assert.ok(es && new URL(es.call.url).searchParams.get('to') === 'es', `to=es: ${es && es.call.url}`);
  const tokyo = (await recommend({}, 'what is the time in Tokyo', 3, null)).picks.find((p) => p.tool === '/time');
  assert.ok(tokyo && new URL(tokyo.call.url).searchParams.get('zone') === 'Asia/Tokyo', `zone: ${tokyo && tokyo.call.url}`);
  const paris = (await recommend({}, 'weather in Paris tomorrow', 3, null)).picks.find((p) => p.tool === '/weather');
  assert.ok(paris && new URL(paris.call.url).searchParams.get('city') === 'Paris', `city: ${paris && paris.call.url}`);
  // Every pick is still explicitly an example, so an agent knows to substitute its own values.
  for (const p of (await recommend({}, 'price of ETH', 3, null)).picks) {
    assert.equal(p.call.exampleOnly, true);
    assert.match(p.call.note, /replace them with your own inputs/);
  }
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
  // 1.257.0: a short token must not prefix-match a longer word ("no" -> "nonce"), and filler words are not jobs.
  await assert.rejects(recommend({}, 'qqqzxx no such thing in this catalog', 3, null), (e) => e.status === 404);
  const nonce = await recommend({}, 'nonce of an account', 3, null);
  assert.ok(nonce.picks.some((p) => p.tool.includes('/nonce')), nonce.picks.map((p) => p.tool).join(' '));
  for (const [need, tool] of Object.entries({ 'fees on base': '/base-gas', 'is a wallet sanctioned': '/sanctions/check', 'usdc balance': '/wallet/balances' })) {
    const r = await recommend({}, need, 3, null);
    assert.ok(r.picks.some((p) => p.tool === tool), `${need}: ${r.picks.map((p) => p.tool).join(' ')}`);
  }
});

test('finder: a job named as buyers name it gets its tool first, and every job points at a tool we sell', async () => {
  const { recommend, JOBS, jobTool } = await load();
  // 10 Nov 2026 (base-bots/buyer-next.mjs): these jobs, bought elsewhere by our paying wallets, landed on the wrong tool.
  const first = { 'text to speech': '/ai/speech', 'tts elevenlabs': '/ai/speech', 'speech to text': '/transcribe', 'audit bundle': '/audit/website', 'website audit': '/audit/website', 'exa search': '/search', 'brave search': '/search', 'hunter email verifier': '/email', 'token preflight': '/token/verdict', 'chain erc20 balance': '/base/token-balance', 'what is my ip': '/ip/geolocate', 'narrate this article': '/text-to-speech', 'read contract balance': '/base/call',
    // 19 Nov 2026: these used to misroute to a wrong, sometimes pricier tool through forced synonyms.
    'iban': '/validate/iban', 'validate iban': '/validate/iban', 'iban check': '/validate/iban', 'validate vat': '/vat/validate', 'llm pricing': '/llm/prices', 'model prices': '/llm/prices', 'block explorer': '/base/block', 'block height': '/base/block',
    // 19 Nov 2026: plain-language TTS requests were hijacked by generic synonyms (article->news, text->document,
    // read->extract), sending them to /page/publish, /document/text or /transcribe (the wrong direction) instead of a
    // paid speech tool. These are voice-call sales lost at the free finder.
    'turn my article into an mp3 so I can put it on my site': '/ai/speech', 'make an mp3 from text': '/ai/speech', 'read this article aloud as audio': '/ai/speech', 'text to audio for my video': '/ai/speech',
    // 20 Nov 2026: these used to land on /document/extract (needs an extra `fields` arg -> 400 uncharged) or
    // /pdf/text (415 on HTML). They now reach the URL-only tool that actually returns a result.
    'read a pdf': '/pdf/text', 'read a document': '/document/text', 'full text of webpage': '/extract' };
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

test('market recommend: ranks the whole Bazaar by capability then evidence, marks ours, charges nothing on no match', async () => {
  const { marketRecommend } = await load();
  const item = (name, path, payers, calls, mine = false) => ({
    resource: `https://example.com${path}`, serviceName: name,
    accepts: [{ amount: String(1000 * (mine ? 1 : 2)), network: 'eip155:8453', payTo: mine ? '0xOURS' : '0xTHEM' }],
    quality: { l30DaysUniquePayers: payers, l30DaysTotalCalls: calls, lastCalledAt: '2026-11-19T00:00:00Z' },
  });
  const rows = [
    item('Other high-volume API', '/other', 40, 800),
    item('Our token check', '/ours', 4, 120, true),
    item('Low volume API', '/low', 1, 2),
  ];
  const env = { PAY_TO: '0xOURS' };
  const a = await marketRecommend(env, 'token safety', 3, undefined, undefined, async () => rows);
  assert.equal(a.method, 'market+evidence');
  assert.equal(a.market.source, 'bazaar');
  assert.equal(a.picks.length, 3);
  assert.equal(a.picks[0].name, 'Other high-volume API', 'evidence orders inside the first capability band');
  assert.equal(a.picks[1].ours, true);
  assert.ok(a.picks[1].evidence.some((e) => e.includes('marked not boosted')));
  assert.equal(a.picks[2].priceUsd, 0.002, 'price is in USD, not atomic units');
  const b = await marketRecommend(env, 'token safety', 3, undefined, undefined, async () => rows);
  assert.deepEqual(a.picks.map((p) => p.resource), b.picks.map((p) => p.resource), 'deterministic order');
  const cheap = await marketRecommend(env, 'token safety', 3, 0.005, undefined, async () => rows);
  assert.ok(cheap.picks.every((p) => p.priceUsd <= 0.005), 'maxPrice filters');
  await assert.rejects(marketRecommend(env, 'zzqx vvbn', 3, undefined, undefined, async () => []),
    (e) => e.status === 404, 'no market row and no own tool: 404, nothing charged');
});
