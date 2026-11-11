// The six faults left open by the 11 Nov 2026 truth audit (base-bots/data/truth-audit-2026-11-11-demand.txt, findings 3, 4,
// 6, 8, 11 and 14). Each case is an input the audit sent, or a production answer of that evening.
const assert = require('node:assert/strict');
const Module = require('node:module');
const { before, test } = require('node:test');
const esbuild = require('esbuild');
async function load(entry) {
  const result = await esbuild.build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'cjs', write: false, external: ['cloudflare:workers'] });
  const m = new Module(entry, module); m.filename = entry; m.paths = Module._nodeModulePaths(process.cwd());
  m._compile(result.outputFiles[0].text, entry); return m.exports;
}
let places, keywords, tickers, geo, ai, report;
before(async () => {
  places = await load(require.resolve('../src/lib/place-names.ts'));
  keywords = await load(require.resolve('../src/routes/keywords.ts'));
  tickers = await load(require.resolve('../src/lib/tickers.ts'));
  geo = await load(require.resolve('../src/routes/geo-more.ts'));
  ai = await load(require.resolve('../src/routes/ai-text.ts'));
  report = await load(require.resolve('../src/routes/token-report.ts'));
});

test('keyword suggestions that only add the requester\'s location are recognised; real keywords and in-country places are not', () => {
  const foreign = (seed, k, country, lang) => places.addsForeignPlace(seed, k, country, lang);
  // Production answers of 11 Nov 2026 (Cloudflare egress near Stockholm and Paris).
  assert.equal(foreign('running shoes', 'running shoes stockholm', 'gb'), true);
  assert.equal(foreign('running shoes', 'running shoes sweden', 'gb'), true);
  assert.equal(foreign('crm software', 'crm software 11e arr.', 'us'), true);
  assert.equal(foreign('crm software', 'crm software in india', 'us'), true);
  assert.equal(foreign('plumber', 'plumbers london', 'us'), true, 'a plural seed word still matches');
  // Kept: in-country places, ordinary words that are also city names, and real modifiers.
  assert.equal(foreign('running shoes', 'running shoes uk', 'gb'), false);
  assert.equal(foreign('running shoes', 'running shoes london', 'gb'), false);
  assert.equal(foreign('cykel', 'cykel stockholm', 'se', 'sv'), false);
  for (const k of ['crm software free', 'crm software for small business', 'running shoes nice', 'running shoes jordan', 'crm software page', 'running shoes mobile']) assert.equal(foreign(k.split(' ').slice(0, 2).join(' '), k, 'us'), false, k);
  assert.equal(places.seedNamesPlace('hotels paris'), true, 'a seed with a place keeps its place suggestions');
  assert.equal(places.seedNamesPlace('crm software'), false);
});

test('keyword ideas use the requested country\'s Amazon store, skip Amazon where there is none, and list what was removed', async () => {
  const seen = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url) => {
    seen.push(String(url));
    const u = new URL(String(url));
    if (u.hostname.startsWith('completion.amazon')) return Response.json({ suggestions: [{ value: 'cykelhjälm' }] });
    if (u.hostname === 'duckduckgo.com') return Response.json(['cykel', ['cykel', 'cykel paris', 'cykelpump']]);
    return Response.json(['cykel', ['cykel', 'cykel stockholm']]);
  };
  try {
    const se = await keywords.keywordIdeas('cykel', { lang: 'sv', country: 'se' });
    assert.ok(seen.some((u) => u.startsWith('https://completion.amazon.se/') && u.includes('mid=A2NODRKZP88ZB9')), seen.join('\n'));
    assert.ok(seen.some((u) => u.includes('kl=se-sv')));
    assert.deepEqual(se.removedAsLocation, ['cykel paris']);
    assert.ok(se.keywords.some((k) => k.keyword === 'cykel stockholm'), 'an in-country city stays');
    seen.length = 0;
    const gb = await keywords.keywordIdeas('cykel', { country: 'gb' });
    assert.ok(seen.some((u) => u.includes('kl=uk-en')), 'DuckDuckGo calls the United Kingdom uk');
    assert.ok(seen.some((u) => u.startsWith('https://completion.amazon.co.uk/')));
    const za = await keywords.keywordIdeas('cykel', { country: 'za' });
    assert.deepEqual(za.enginesSkipped, [{ engine: 'amazon', reason: 'no Amazon marketplace for country za' }]);
    await assert.rejects(keywords.keywordIdeas('cykel', { country: 'za', engines: 'amazon' }), /no engine can answer/);
  } finally { globalThis.fetch = real; }
});

test('token tickers: the main Ethereum tokens and coin names resolve, and coins without an ERC-20 are pointed elsewhere', () => {
  const SLUGS = ['base', 'eth', 'arb', 'op'];
  assert.equal(tickers.tokenAddress('pepe', 'eth'), '0x6982508145454Ce325dDbE47a25d4ec3d2311933');
  assert.equal(tickers.tokenAddress('shiba inu', 'eth'), '0x95aD61b0a150d79219dCF64E1E6Cc01f0B64C4cE');
  for (const [t, net] of [['PEPE', 'eth'], ['LINK', 'eth'], ['UNI', 'eth'], ['ARB', 'arb'], ['OP', 'op'], ['ETH', 'base'], ['lido-dao', 'eth']]) assert.equal(tickers.tickerNetwork(t, 'base', SLUGS), net, t);
  assert.throws(() => tickers.tokenAddress('dogecoin', 'base'), /no ERC-20 on Base, Ethereum, Arbitrum or Optimism: \/hyperliquid\/prices/);
  assert.throws(() => tickers.tokenAddress('HYPE', 'eth'), /\/hyperliquid\/prices/);
  assert.throws(() => tickers.tokenAddress('NOTACOIN', 'eth'), (e) => !/hyperliquid/.test(e.message));
});

test('reverse geocoding: largest is a town or city, never a diocese, an urban area or a dissolved state', () => {
  const row = (id, name, description, pop, dist, extra = {}) => ({ place: { value: `http://www.wikidata.org/entity/${id}` }, placeLabel: { value: name }, placeDescription: { value: description }, pop: { value: String(pop) }, dist: { value: String(dist) }, ...extra });
  const city = { settled: { value: 'http://www.wikidata.org/entity/Q515' } };
  // New York and Paris as Wikidata answered on 11 Nov 2026.
  const nyc = geo.shapePlaces([
    row('Q1', 'Armenian Catholic Eparchy of Our Lady of Nareg', 'eparchy', 342260000, 0.1),
    row('Q2', 'New York–Jersey City–Newark urban area', 'urban area in New York and New Jersey', 19426449, 0.2),
    row('Q60', 'New York City', 'most populous city in the United States', 8804190, 0.3), row('Q60', 'New York City', 'most populous city in the United States', 8804190, 0.3, city),
  ]);
  assert.equal(nyc.largest.name, 'New York City');
  assert.equal(nyc.nearest.name, 'New York City', 'the eparchy is not the nearest place either');
  const paris = geo.shapePlaces([
    row('Q71084', 'First French Empire', 'empire in Europe (1804-1815)', 44000000, 0.5, { ended: { value: '1815' } }),
    row('Q90', 'Paris', 'capital and most populous city in France', 2103778, 0.1, city),
  ]);
  assert.equal(paris.largest.name, 'Paris');
  assert.ok(!paris.places.some((p) => p.name === 'First French Empire'), 'dissolved items are dropped');
  // A Swedish town is typed as an urban area in Sweden and described with its municipality: still a place.
  const se = geo.shapePlaces([
    row('Q3', 'Häverö-Edebo församling', 'parish in Sweden', 6650, 2),
    row('Q4', 'Hallstavik', 'urban area in Norrtälje Municipality, Sweden', 4598, 8, { settled: { value: 'http://www.wikidata.org/entity/Q12813115' } }),
  ]);
  assert.equal(se.largest.name, 'Hallstavik');
  assert.match(geo.sparqlAround(59, 18, 10, 80), /OPTIONAL \{ \?place wdt:P576 \?ended/);
  assert.doesNotMatch(geo.sparqlAround(59, 18, 10, 80), /FILTER NOT EXISTS/, 'the filter form timed out on dense cities');
});

test('/ai/chat reports the model\'s own token counts on the prompt path, and marks an estimate as one', async () => {
  const tool = ai.AI_TEXT.find((e) => e.endpoint.path === '/ai/chat');
  const input = (p) => (n) => p[n];
  let sent;
  const counted = await tool.run({ AI: { run: async (model, body) => { sent = body; return { response: 'Payment required.', usage: { prompt_tokens: 31, completion_tokens: 4, total_tokens: 35 } }; } } }, input({ prompt: 'Explain 402.' }));
  assert.deepEqual(counted.usage, { prompt_tokens: 31, completion_tokens: 4, total_tokens: 35 });
  assert.equal(counted.usageEstimated, undefined);
  assert.deepEqual(sent.messages.map((m) => m.role), ['system', 'user']);
  const estimated = await tool.run({ AI: { run: async () => ({ response: 'Payment required.' }) } }, input({ prompt: 'Explain 402.' }));
  assert.equal(estimated.usageEstimated, true);
  assert.ok(estimated.usage.total_tokens > 0);
});

test('stablecoins and wrapped assets are quote assets in the token report; an ordinary token is not', () => {
  assert.equal(report.isQuoteAsset('0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'), true);
  assert.equal(report.isQuoteAsset('0x4200000000000000000000000000000000000006'), true);
  assert.equal(report.isQuoteAsset('0x940181a94A35A4569E4529A3CDfB74e38FD98631'), false, 'AERO');
});
