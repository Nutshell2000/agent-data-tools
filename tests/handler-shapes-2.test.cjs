// Tool handler robustness, round two (21 Nov 2026). Why each test exists is said at the test. Network, the moderation
// model, the key-value store and the clock are stand-ins: nothing here leaves the machine.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { build } = require('esbuild');

const plugins = [{ name: 'shims', setup(p) {
  p.onResolve({ filter: /^url$/ }, () => ({ path: 'node:url', external: true }));
  p.onResolve({ filter: /^cloudflare:/ }, (a) => ({ path: a.path, namespace: 'cf' }));
  p.onLoad({ filter: /.*/, namespace: 'cf' }, () => ({ contents: 'export class DurableObject {}; export class WorkerEntrypoint {}; export const env = {};', loader: 'js' }));
} }];
const cache = new Map();
async function load(entry) {
  if (cache.has(entry)) return cache.get(entry);
  const b = await build({ entryPoints: [entry], bundle: true, format: 'cjs', platform: 'node', write: false, logLevel: 'silent', plugins });
  const m = { exports: {} };
  new Function('module', 'exports', 'require', b.outputFiles[0].text)(m, m.exports, require);
  cache.set(entry, m.exports);
  return m.exports;
}
/** The whole catalogue, bundled once, with its own HttpError class (instanceof must be asked of the same bundle). */
async function catalogue() {
  if (cache.has('#all')) return cache.get('#all');
  const b = await build({ stdin: { contents: 'export { TOOLS } from "./src/tools"; export { ENDPOINTS } from "./src/endpoints"; export { HttpError } from "./src/lib/env";', resolveDir: path.resolve(__dirname, '..'), sourcefile: 'all.ts', loader: 'ts' }, bundle: true, format: 'cjs', platform: 'node', write: false, logLevel: 'silent', plugins });
  const m = { exports: {} };
  new Function('module', 'exports', 'require', b.outputFiles[0].text)(m, m.exports, require);
  cache.set('#all', m.exports);
  return m.exports;
}
const q = (values) => (name) => values[name];
const json = (body, status = 200) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
async function withFetch(handler, fn) {
  const real = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input, init) => { const url = String(input instanceof Request ? input.url : input); calls.push({ url, init }); return handler(url, init); };
  try { return await fn(calls); } finally { globalThis.fetch = real; }
}
/** Retry waits inside the handlers are cut to a few milliseconds so a refused source does not slow the file down. */
async function fastTimers(fn) {
  const real = globalThis.setTimeout;
  globalThis.setTimeout = (f, ms, ...a) => real(f, Math.min(Number(ms) || 0, 3), ...a);
  try { return await fn(); } finally { globalThis.setTimeout = real; }
}
const status = async (promise) => { try { await promise; return 'ok'; } catch (e) { return typeof e?.status === 'number' && e.constructor?.name === 'HttpError' ? e.status : `THROW ${e?.name}: ${e?.message}`; } };

// ---------- 1. the shared shape check ----------

test('the shape check: a list must be a list, an object must be an object with the fields the handler reads', async () => {
  const S = await load('src/lib/source-json.ts');
  const is502 = (e) => e.status === 502 && /^USGS sent an answer that could not be read; nothing was charged/.test(e.message);
  assert.deepEqual(S.sourceList([1, 2], 'USGS'), [1, 2]);
  for (const bad of [null, undefined, {}, 'x', 3, { length: 2 }]) assert.throws(() => S.sourceList(bad, 'USGS'), is502);
  const body = { features: [], daily: { max: [1], note: null }, n: 0, s: '' };
  assert.equal(S.sourceShape(body, 'USGS', { features: 'array', 'daily.max': 'array', daily: 'object', n: 'number', s: 'string' }), body);
  for (const bad of [null, undefined, [], 'x', 3]) assert.throws(() => S.sourceShape(bad, 'USGS'), is502);
  assert.throws(() => S.sourceShape(body, 'USGS', { features: 'object' }), is502, 'a list is not an object');
  assert.throws(() => S.sourceShape(body, 'USGS', { 'daily.note': 'any' }), is502, 'null is not present');
  assert.throws(() => S.sourceShape(body, 'USGS', { 'daily.missing.deeper': 'any' }), is502);
  assert.throws(() => S.sourceShape({ n: NaN }, 'USGS', { n: 'number' }), is502);
  // Only own keys count: a field name that exists on every object is not "present".
  assert.throws(() => S.sourceShape({}, 'USGS', { constructor: 'any' }), is502);
  assert.throws(() => S.sourceShape({}, 'USGS', { 'toString.length': 'number' }), is502);
});

test('a counted read answers like json() and text(), and refuses a body over its ceiling with a 502', async () => {
  const S = await load('src/lib/source-json.ts');
  assert.deepEqual(await S.jsonWithin(json({ a: [1] })), { a: [1] });
  assert.equal(await S.jsonWithin(json('null')), null);
  await assert.rejects(S.jsonWithin(new Response('<html>')), SyntaxError, 'not JSON rejects as json() does, so a caller\'s own catch still works');
  await assert.rejects(S.jsonWithin(new Response('')), SyntaxError);
  await assert.rejects(S.jsonWithin(json({ a: 'x'.repeat(5000) }), 1000), (e) => e.status === 502 && /nothing was charged/.test(e.message));
  assert.equal(await S.textWithin(new Response('héllo')), 'héllo');
  await assert.rejects(S.textWithin(new Response('x'.repeat(5000)), 1000), (e) => e.status === 502);
  // An endless body is stopped at the ceiling instead of being read to its end.
  let sent = 0;
  const endless = new Response(new ReadableStream({ pull(c) { sent++; c.enqueue(new Uint8Array(65536).fill(32)); } }));
  await assert.rejects(S.jsonWithin(endless, 1024 * 1024), (e) => e.status === 502);
  assert.ok(sent < 40, `read ${sent} chunks of 64 KB for a 1 MB ceiling`);
  // A stand-in without a stream body keeps its own reader.
  assert.deepEqual(await S.jsonWithin({ json: async () => ({ ok: 1 }) }), { ok: 1 });
  // sourceJson: over the ceiling, not JSON and null are all the source's failure.
  await assert.rejects(S.sourceJson(json('null'), 'GitHub'), (e) => e.status === 502 && /^GitHub sent an answer/.test(e.message));
  await assert.rejects(S.sourceJson(new Response('<html>'), 'GitHub'), (e) => e.status === 502 && /^GitHub sent an answer/.test(e.message));
  await assert.rejects(S.sourceJson(json({ a: 'x'.repeat(5000) }), 'GitHub', 1000), (e) => e.status === 502);
});

test('getJson refuses a null body as the source\'s failure, and still reads a list or an object', async () => {
  const F = await load('src/family.ts');
  await withFetch(() => json('null'), async () => {
    await assert.rejects(F.getJson('https://source.example/a'), (e) => e.status === 502 && /unreadable answer; nothing was charged/.test(e.message));
  });
  await withFetch(() => json([1, 2]), async () => assert.deepEqual(await F.getJson('https://source.example/a'), [1, 2]));
  await withFetch(() => json({ a: 1 }), async () => assert.deepEqual(await F.getJson('https://source.example/a'), { a: 1 }));
  await withFetch(() => new Response('<html>', { status: 200 }), async () => {
    await assert.rejects(F.getJson('https://source.example/a'), (e) => e.status === 502);
  });
  await withFetch(() => json({ a: 'x'.repeat(5000) }), async () => {
    await assert.rejects(F.getJson('https://source.example/a', { maxBytes: 1000 }), (e) => e.status === 502 && /more than/.test(e.message));
  });
  await withFetch(() => json({ error: 'gone' }, 404), async () => {
    await assert.rejects(F.getJson('https://source.example/a', { notFound: 'no such thing' }), (e) => e.status === 404 && e.message === 'no such thing');
  });
});

// ---------- 2. one test per pattern ----------

const run = async (file, list, toolPath, input, respond) => {
  const m = await load(file);
  const entry = m[list].find((e) => e.endpoint.path === toolPath);
  assert.ok(entry, `${toolPath} is in ${list}`);
  return fastTimers(() => withFetch(respond, async () => entry.run({}, q(input))));
};

test('pattern "a list is expected": an object, a string or null where the list belongs is a 502 that names the source', async () => {
  const P = 'src/routes/public-data.ts';
  for (const body of [{}, 'null', '"x"', { message: 'rate limited' }]) {
    await assert.rejects(run(P, 'PUBLIC_DATA', '/hackernews/top', { count: '3' }, () => json(body)), (e) => e.status === 502, JSON.stringify(body));
  }
  await assert.rejects(run(P, 'PUBLIC_DATA', '/hackernews/top', {}, () => json({})), (e) => /^Hacker News sent an answer that could not be read; nothing was charged/.test(e.message));
  // An empty front page is not an answer to sell either.
  await assert.rejects(run(P, 'PUBLIC_DATA', '/hackernews/top', {}, () => json([])), (e) => e.status === 502);
  // A story that is not a story (the source answers null for a removed one).
  await assert.rejects(run(P, 'PUBLIC_DATA', '/hackernews/top', { count: '2' }, (url) => json(/topstories/.test(url) ? [1, 2] : /item\/1/.test(url) ? { id: 1, title: 'A', score: 3, by: 'u', time: 1763700000 } : {})), (e) => e.status === 502);
  // And the real shape still answers, with the same keys as before.
  const ok = await run(P, 'PUBLIC_DATA', '/hackernews/top', { count: '2' }, (url) => json(/topstories/.test(url) ? [1, 2, 3] : { id: Number(/item\/(\d+)/.exec(url)[1]), title: 'A', score: 3, by: 'u', time: 1763700000 }));
  assert.equal(ok.count, 2);
  assert.deepEqual(Object.keys(ok.stories[0]), ['id', 'title', 'url', 'points', 'comments', 'by', 'time', 'discussion']);
});

test('pattern "an object with these fields": a missing section is a 502, not a 500 and not an answer with holes', async () => {
  const P = 'src/routes/public-data.ts';
  const at = { lat: '59.33', lon: '18.07' };
  // /uv reads current.uv_index and daily.uv_index_max.
  for (const body of [{}, [], { current: {} }, { current: { uv_index: 2 } }, { current: { uv_index: 2 }, daily: {} }, { current: { uv_index: null }, daily: { uv_index_max: [3] } }, { current: { uv_index: 2 }, daily: { uv_index_max: [null] } }]) {
    await assert.rejects(run(P, 'PUBLIC_DATA', '/uv', at, () => json(body)), (e) => e.status === 502 && /^Open-Meteo sent an answer/.test(e.message), JSON.stringify(body));
  }
  assert.deepEqual(await run(P, 'PUBLIC_DATA', '/uv', at, () => json({ current: { uv_index: 2.4 }, daily: { uv_index_max: [3.1] } })),
    { uvIndex: 2.4, category: 'low', todayMax: 3.1, todayMaxCategory: 'moderate', advice: 'Protection is advisable around midday.' });
  // /earthquakes reads features; /iss five numbers; /pypi info and releases; /npm/downloads a number; /elevation a list.
  await assert.rejects(run(P, 'PUBLIC_DATA', '/earthquakes', {}, () => json({ type: 'FeatureCollection' })), (e) => e.status === 502 && /^USGS/.test(e.message));
  assert.equal((await run(P, 'PUBLIC_DATA', '/earthquakes', {}, () => json({ features: [] }))).count, 0, 'a quiet day is still an answer');
  await assert.rejects(run(P, 'PUBLIC_DATA', '/iss', {}, () => json({})), (e) => e.status === 502);
  await assert.rejects(run(P, 'PUBLIC_DATA', '/pypi', { package: 'requests' }, () => json({ info: {} })), (e) => e.status === 502 && /^PyPI/.test(e.message));
  await assert.rejects(run(P, 'PUBLIC_DATA', '/npm/downloads', { package: 'hono' }, () => json({})), (e) => e.status === 502);
  assert.deepEqual(await run(P, 'PUBLIC_DATA', '/npm/downloads', { package: 'hono' }, () => json({ downloads: 7 })), { package: 'hono', lastDay: 7, lastWeek: 7, lastMonth: 7 });
  await assert.rejects(run(P, 'PUBLIC_DATA', '/elevation', at, () => json({})), (e) => e.status === 502);
  assert.deepEqual(await run(P, 'PUBLIC_DATA', '/elevation', at, () => json({ elevation: [28] })), { lat: 59.33, lon: 18.07, elevationM: 28 });
  await assert.rejects(run(P, 'PUBLIC_DATA', '/air-quality', at, () => json({ current: null })), (e) => e.status === 502);
  await assert.rejects(run(P, 'PUBLIC_DATA', '/wikipedia', { title: 'Stockholm' }, () => json({})), (e) => e.status === 502 && /^Wikipedia/.test(e.message));
  // /dictionary: no English section is the word missing (404); an English section that is not a list is the source.
  await assert.rejects(run(P, 'PUBLIC_DATA', '/dictionary', { word: 'hej' }, () => json({ sv: [] })), (e) => e.status === 404);
  await assert.rejects(run(P, 'PUBLIC_DATA', '/dictionary', { word: 'hej' }, () => json({ en: 'x' })), (e) => e.status === 502 && /^Wiktionary/.test(e.message));
});

test('pattern "a JSON-RPC answer": Solana tools treat an answer with no result and no error as the node failing', async () => {
  const S = await load('src/routes/solana.ts');
  const tool = (p) => S.SOLANA.find((e) => e.endpoint.path === p);
  const wallet = tool('/solana/balance').endpoint.params.address.example;
  const mint = tool('/solana/token').endpoint.params.mint.example;
  for (const body of [{}, [], 'null', '"x"', { result: null }, { jsonrpc: '2.0', id: 1 }]) {
    const label = JSON.stringify(body);
    assert.equal(await status(fastTimers(() => withFetch(() => json(body), () => tool('/solana/balance').run({}, q({ address: wallet }))))), 502, `/solana/balance ${label}`);
    assert.equal(await status(fastTimers(() => withFetch(() => json(body), () => tool('/solana/token').run({}, q({ mint }))))), 502, `/solana/token ${label}`);
  }
  // A transaction lookup: "no result" used to read as "no such transaction", a 404 that blamed the caller.
  const txTool = S.SOLANA.find((e) => e.endpoint.path === '/solana/tx') ?? S.SOLANA.find((e) => /signature/.test(Object.keys(e.endpoint.params).join()));
  const sig = txTool.endpoint.params.signature.example;
  assert.equal(await status(fastTimers(() => withFetch(() => json({}), () => txTool.run({}, q({ signature: sig }))))), 502);
  assert.equal(await status(fastTimers(() => withFetch(() => json({ jsonrpc: '2.0', id: 1, result: null }), () => txTool.run({}, q({ signature: sig }))))), 404, 'a null result is the node saying it has no such transaction');
  // The real shape still answers.
  const ok = await withFetch((_u, init) => json({ jsonrpc: '2.0', id: 1, result: JSON.parse(init.body).method === 'getBalance' ? { context: { slot: 5 }, value: 39869364 } : { value: [] } }), () => tool('/solana/balance').run({}, q({ address: wallet })));
  assert.equal(ok.lamports, '39869364');
  assert.equal(ok.sol, '0.039869364');
  assert.equal(ok.slot, 5);
});

test('pattern "a DNS answer": an answer without a status is a resolver that did not answer', async () => {
  const W = await load('src/routes/web-checks.ts');
  for (const body of [{}, [], 'null', { Status: '0' }, { Status: 0, Answer: {} }]) {
    await withFetch(() => json(body), async () => { await assert.rejects(W.dohQuery('https://dns.example/q', 'example.com', 'A'), Error, JSON.stringify(body)); });
    await assert.rejects(run('src/routes/web-checks.ts', 'WEB_CHECKS', '/dns/lookup', { name: 'example.com' }, () => json(body)), (e) => e.status === 502, JSON.stringify(body));
    await assert.rejects(run('src/routes/web-checks.ts', 'WEB_CHECKS', '/dns/propagation', { name: 'example.com' }, () => json(body)), (e) => e.status === 502, JSON.stringify(body));
  }
  const ok = await run('src/routes/web-checks.ts', 'WEB_CHECKS', '/dns/lookup', { name: 'example.com' }, () => json({ Status: 0, AD: true, Answer: [{ name: 'example.com', type: 1, TTL: 60, data: '93.184.215.14' }] }));
  assert.deepEqual(ok, { name: 'example.com', type: 'A', status: 'NOERROR', dnssec: true, answers: [{ data: '93.184.215.14', ttl: 60 }], resolver: 'Cloudflare' });
  // No records at all is an answer (NXDOMAIN and NOERROR without an Answer key).
  assert.equal((await run('src/routes/web-checks.ts', 'WEB_CHECKS', '/dns/lookup', { name: 'example.com' }, () => json({ Status: 3 }))).status, 'NXDOMAIN');
});

test('pattern "a record": Bitcoin address, Norwegian company, CVE, order book and SEC answers that are not the record', async () => {
  const B = await load('src/routes/bitcoin.ts');
  for (const body of [{}, [], 'null', { chain_stats: {}, mempool_stats: {} }, { chain_stats: { funded_txo_sum: 1, spent_txo_sum: 0, tx_count: 1 } }]) {
    assert.equal(await status(fastTimers(() => withFetch(() => json(body), () => B.bitcoinAddress('bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh')))), 502, JSON.stringify(body));
  }
  const stats = { funded_txo_sum: 500, spent_txo_sum: 200, tx_count: 3 };
  const btc = await withFetch(() => json({ chain_stats: stats, mempool_stats: { funded_txo_sum: 0, spent_txo_sum: 0, tx_count: 0 } }), () => B.bitcoinAddress('bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh'));
  assert.equal(btc.balanceSats, 300);

  const N = await load('src/routes/nordic-company.ts');
  for (const body of [{}, [], 'null']) assert.equal(await status(fastTimers(() => withFetch(() => json(body), () => N.noLookup('923609016')))), 502, `Norway ${JSON.stringify(body)}`);
  assert.equal(await status(fastTimers(() => withFetch(() => json({ error: 'x' }, 404), () => N.noLookup('923609016')))), 404, 'the register\'s own 404 is still "no such company"');

  const C = await load('src/routes/cve.ts');
  const cve = (respond) => fastTimers(() => withFetch(respond, () => C.CVE[0].run({}, q({ cve: 'CVE-2021-44228' }))));
  for (const body of [{}, [], 'null', { cveMetadata: {} }]) assert.equal(await status(cve((url) => (/cve\.org|cveawg/.test(url) ? json(body) : json({ data: [] })))), 502, `CVE ${JSON.stringify(body)}`);

  const PM = await load('src/routes/polymarket.ts');
  const book = PM.POLYMARKET.find((e) => e.endpoint.path === '/polymarket/orderbook');
  const input = Object.fromEntries(Object.entries(book.endpoint.params).filter(([, v]) => v.example !== undefined).map(([k, v]) => [k, String(v.example)]));
  for (const body of [{}, [], 'null', { bids: {} }]) {
    const got = await status(fastTimers(() => withFetch((url) => (/\/book\?/.test(url) ? json(body) : json([])), () => book.run({}, q(input)))));
    assert.ok(got === 502 || got === 404, `order book ${JSON.stringify(body)} gave ${got}`);
  }

  const G = await load('src/routes/gov-data.ts');
  const filings = G.GOV_DATA.find((e) => e.endpoint.path === '/sec/filings');
  for (const body of [{}, [], 'null', { filings: {} }, { filings: { recent: {} } }]) {
    assert.equal(await status(fastTimers(() => withFetch(() => json(body), () => filings.run({}, q({ cik: '320193' }))))), 502, `SEC ${JSON.stringify(body)}`);
  }
  const fine = await withFetch(() => json({ name: 'Apple Inc.', cik: '320193', filings: { recent: { form: [] } } }), () => filings.run({}, q({ cik: '320193' })));
  assert.equal(fine.count, 0, 'a filer with no filings is an answer');
});

// ---------- 3. the catalogue-wide sweep ----------

// The 65 tools (49 handlers and the entry paths that run the same code) that threw an unhandled error in the sweep of
// 21 Nov 2026 when their source answered JSON of another shape. Each is fed null, {} and [] as every answer of every
// request it makes. Nothing may come out as an unhandled error (our 500), and nothing may be sold: the answer is a
// 502 (the source), or a 404/422 where the handler reads the shape as "no such thing".
const SWEPT = ['/polymarket/markets', '/polymarket/events', '/polymarket/price-history', '/stock/quote', '/stock/history', '/stock/search', '/stock/brief', '/commodity/price', '/company', '/x402/find', '/book/isbn', '/book/search', '/pack/location-brief', '/dictionary', '/lei/lookup', '/fi/company', '/fr/company', '/polymarket/search', '/company/lookup', '/ee/company', '/crypto/trending', '/stock/screen', '/market/trending', '/se/company', '/polymarket/orderbook', '/cve', '/dns/lookup', '/wikipedia', '/geocode', '/elevation', '/npm/downloads', '/geocode/address', '/dns/records', '/cve/lookup', '/wiki/summary', '/btc-address', '/fx', '/weather', '/solana/balance', '/solana/token', '/fx/all', '/github/repo', '/github/releases', '/github/user', '/sec/8k', '/sec/insider', '/sec/13f', '/sec/financials', '/earthquakes', '/air-quality', '/uv', '/pypi', '/hackernews/top', '/iss', '/sec/filings', '/no/company', '/weather/forecast', '/weather-api', '/live-weather', '/48-hour-forecast', '/fx/rates', '/weather/current', '/sec/edgar', '/stock/fundamentals', '/income-statement'];
// Answers that are allowed to differ, each with its reason.
const ALLOWED = {
  // The Swedish register file is ours to publish; its handler answers 503 "being rebuilt" for a manifest it cannot use.
  '/se/company': { null: [503], '{}': [503], '[]': [503] },
  // An empty list IS the answer for a repository without releases and an account without repositories.
  '/github/releases': { '[]': ['ok'] },
  '/github/user': { '[]': ['ok'] },
  // Not fixed in this round: the Wikidata search helper (lib/wikidata.ts, outside this stream's files) reads a missing
  // result list as "no matches", so these two still sell an empty result for {} and []. Reported, with this line as
  // the reminder: delete it when that helper checks its answer.
  '/geocode': { '{}': ['ok'], '[]': ['ok'] },
  '/geocode/address': { '{}': ['ok'], '[]': ['ok'] },
};

test('catalogue sweep: the 65 tools that threw on JSON of another shape answer 502, 404 or 422 for null, {} and []', async () => {
  const { TOOLS, ENDPOINTS } = await catalogue();
  const env = { AI: { run: async () => { throw new TypeError('no model in this test'); } }, PAYWALL: 'on', NETWORK: 'eip155:8453', PAY_TO: '0x0000000000000000000000000000000000000001' };
  const bad = [];
  let ran = 0;
  await fastTimers(async () => {
    for (const p of SWEPT) {
      const ep = ENDPOINTS.find((e) => e.path === p);
      assert.ok(ep && TOOLS[p], `${p} is in the catalogue`);
      const input = Object.fromEntries(Object.entries(ep.params).filter(([, v]) => v.example !== undefined).map(([k, v]) => [k, String(v.example)]));
      for (const [label, body] of [['null', 'null'], ['{}', {}], ['[]', []]]) {
        const got = await withFetch(() => json(body), () => status(Promise.resolve().then(() => TOOLS[p](env, q(input)))));
        ran++;
        const allowed = ALLOWED[p]?.[label] ?? [502, 404, 422];
        if (!allowed.includes(got)) bad.push(`${p} with ${label}: ${got}`);
      }
    }
  });
  assert.equal(ran, SWEPT.length * 3);
  assert.deepEqual(bad, []);
});

// ---------- 4. the outbound User-Agent ----------

test('every outbound User-Agent carries the contact address of the public site, from one constant', async () => {
  const U = await load('src/lib/outbound-ua.ts');
  const P = await load('src/routes/pages.ts');
  assert.equal(U.CONTACT_URL, P.PUBLIC_ORIGIN, 'the contact address is the service\'s public site, not a new address');
  assert.equal(U.FETCH_UA, `Mozilla/5.0 (compatible; AgentDataTools/1.0; +${P.PUBLIC_ORIGIN})`);
  assert.equal(U.API_UA, `AgentDataTools/1.0 (+${P.PUBLIC_ORIGIN})`);
  // What is really sent: the page fetcher, the shared JSON reader, the archive lookup and the DexScreener client.
  const sent = async (fn) => withFetch(() => json({ ok: true }), async (calls) => { await fn().catch(() => {}); return new Headers(calls[0].init.headers).get('user-agent'); });
  const F = await load('src/lib/fetch.ts');
  assert.equal(await sent(() => F.fetchPublic(new URL('https://site.example/a'), 'text/html')), U.FETCH_UA);
  const Fam = await load('src/family.ts');
  assert.equal(await sent(() => Fam.getJson('https://api.example/a')), U.API_UA);
  const A = await load('src/lib/archive.ts');
  assert.equal(await sent(() => A.archivedCopy(new URL('https://site.example/a'), 'text/html', { fetcher: globalThis.fetch })), U.FETCH_UA);
  const D = await load('src/lib/dexscreener.ts');
  assert.equal(await sent(() => D.dexscreener('/latest/dex/tokens/0x0')), U.FETCH_UA);
  // No source file names the software without a contact, except the ones that must (see lib/outbound-ua.ts).
  const root = path.resolve(__dirname, '../src');
  const files = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(path.join(dir, e.name)) : e.name.endsWith('.ts') ? [path.join(dir, e.name)] : []));
  const bare = [];
  for (const f of files(root)) {
    const rel = path.relative(root, f).replaceAll('\\', '/');
    if (rel.startsWith('front/') || rel === 'lib/outbound-ua.ts') continue;
    fs.readFileSync(f, 'utf8').split(/\r?\n/).forEach((line, i) => {
      if (/["'`](?:Mozilla\/5\.0 \(compatible; )?AgentDataTools\/1\.0\)?["'`]/.test(line)) bare.push(`${rel}:${i + 1}`);
    });
  }
  // routes/domain.ts is shared with the domain report, which is frozen in this round; routes/keywords.ts reads search
  // suggestions whose format depends on the browser name sent.
  assert.deepEqual(bare.map((b) => b.replace(/:\d+$/, '')).sort(), ['routes/domain.ts', 'routes/keywords.ts']);
});

// ---------- 5. the redirect walker and our own hosts ----------

test('the web checks refuse this service\'s own hosts at the first URL and at every redirect; the redirect checker is unchanged', async () => {
  const W = await load('src/routes/web-checks.ts');
  const own = 'https://agent-data-tools.revmesh2074.workers.dev/weather';
  const page = () => new Response('<html><head><title>T</title></head><body>hello world</body></html>', { status: 200, headers: { 'content-type': 'text/html' } });
  const redirectToOwn = (url) => (url.startsWith('https://elsewhere.example') ? new Response(null, { status: 302, headers: { location: own } }) : page());
  const refused = (e) => e.status === 400 && /own host/.test(e.message) && /nothing was charged/.test(e.message);
  // The walker itself, with the flag.
  await withFetch(page, async (calls) => { await assert.rejects(W.walk(own, 10, 'GET', { refuseOwn: true }), refused); assert.equal(calls.length, 0, 'nothing is requested'); });
  await withFetch(redirectToOwn, async (calls) => {
    await assert.rejects(W.walk('https://elsewhere.example/go', 10, 'GET', { refuseOwn: true }), refused);
    assert.deepEqual(calls.map((c) => c.url), ['https://elsewhere.example/go'], 'the hop to our own host is never requested');
  });
  for (const host of ['api.glyphcall.com', 'mcp.glyphcall.com', 'tools.funwords.eu', 'agent-data-tools-staging.revmesh2074.workers.dev']) {
    await withFetch(page, async () => { await assert.rejects(W.walk(`https://${host}/`, 10, 'GET', { refuseOwn: true }), refused, host); });
  }
  // The three tools that pass the flag.
  const tool = (p) => W.WEB_CHECKS.find((e) => e.endpoint.path === p);
  for (const p of ['/url/uptime', '/seo/audit', '/text/keyword-density']) {
    await withFetch(page, async (calls) => { await assert.rejects(Promise.resolve().then(() => tool(p).run({}, q({ url: own }))), refused, p); assert.equal(calls.length, 0, p); });
    await withFetch(redirectToOwn, async () => { await assert.rejects(Promise.resolve().then(() => tool(p).run({}, q({ url: 'https://elsewhere.example/go' }))), refused, `${p} by redirect`); });
    // Anybody else's page is read as before.
    await withFetch(page, async () => { assert.equal(typeof (await tool(p).run({}, q({ url: 'https://elsewhere.example/' }))), 'object', p); });
  }
  // /url/uptime must not report "down" for a refused target.
  await withFetch(redirectToOwn, async () => { await assert.rejects(Promise.resolve().then(() => tool('/url/uptime').run({}, q({ url: 'https://elsewhere.example/go' }))), refused); });
  // Without the flag (the redirect checker): exactly the old behaviour, hop for hop.
  await withFetch(redirectToOwn, async (calls) => {
    const r = await tool('/url/redirects').run({}, q({ url: 'https://elsewhere.example/go' }));
    assert.equal(r.finalUrl, own);
    assert.equal(r.redirects, 1);
    assert.equal(r.error, null);
    assert.equal(calls.length, 2);
  });
});

// ---------- 6. hosted pages: all of the text is screened, and links are checked ----------

const fakeKv = (extra = {}) => { const data = new Map(Object.entries(extra)); return { data, puts: 0, async put(k, v) { this.puts++; data.set(k, v); }, async get(k) { return data.has(k) ? data.get(k) : null; } }; };

test('/page/publish screens every character it stores, in bounded pieces, and refuses what it cannot screen', async () => {
  const P = await load('src/routes/pages.ts');
  assert.equal(P.SCREEN_MAX_CALLS, 4);
  assert.equal(P.MAX_SCREENED_TEXT, 8000 + 3 * 7800);
  // The pieces cover the text with nothing left out, overlap by 200, and are never more than four for an accepted page.
  const text = Array.from({ length: P.MAX_SCREENED_TEXT }, (_, i) => String.fromCharCode(97 + (i % 26))).join('');
  const pieces = P.screenChunks(text);
  assert.equal(pieces.length, 4);
  assert.ok(pieces.every((c) => c.length <= 8000));
  let rebuilt = pieces[0];
  for (const c of pieces.slice(1)) { assert.equal(rebuilt.slice(-200), c.slice(0, 200)); rebuilt += c.slice(200); }
  assert.equal(rebuilt, text);
  assert.deepEqual(P.screenChunks('short'), ['short']);
  assert.equal(P.screenChunks('x'.repeat(8000)).length, 1);
  assert.equal(P.screenChunks('x'.repeat(8001)).length, 2);

  // A page whose unwanted text sits after the first 8,000 characters: the old code never showed it to the model.
  const seen = [];
  const model = async (t) => { seen.push(t); return /FORBIDDEN/.test(t) ? { flagged: true, categories: [{ code: 'S10', name: 'Hate' }] } : { flagged: false, categories: [] }; };
  const filler = 'ordinary words here. '.repeat(700); // 14,700 characters
  const kv = fakeKv();
  await assert.rejects(P.publishPage(kv, { html: `<h1>Report</h1><p>${filler}</p><p>FORBIDDEN</p>` }, model), (e) => e.status === 422 && e.code === 'PAGE_REFUSED' && /Hate/.test(e.message) && /nothing was charged/.test(e.message));
  assert.equal(seen.length, 2, 'two pieces for 14,700 characters');
  assert.equal(kv.puts, 0, 'a refused page is not stored');
  // A flagged first piece costs one call, not four.
  seen.length = 0;
  await assert.rejects(P.publishPage(kv, { html: `<p>FORBIDDEN</p><p>${filler}${filler}</p>` }, model), (e) => e.status === 422);
  assert.equal(seen.length, 1);
  // A clean long page is published after every piece was read.
  seen.length = 0;
  const out = await P.publishPage(kv, { html: `<h1>Report</h1><p>${filler}${filler}</p>` }, model, 'https://api.test');
  assert.equal(seen.length, 4);
  assert.equal(kv.puts, 1);
  assert.deepEqual(Object.keys(out), ['id', 'url', 'title', 'bytes', 'expiresAt', 'days', 'removed', 'notice'], 'the answer keeps its keys');
  // A short page is one call, as before.
  seen.length = 0;
  await P.publishPage(kv, { html: '<h1>Report</h1><p>Body</p>' }, model);
  assert.deepEqual(seen, ['Report\n\nReport\nBody']);
  // More visible text than four pieces hold: refused before any model call, uncharged, nothing stored.
  seen.length = 0; kv.puts = 0;
  await assert.rejects(P.publishPage(kv, { html: `<p>${'word '.repeat(7000)}</p>` }, model), (e) => e.status === 400 && /content moderation reads at most 31,400/.test(e.message) && /nothing was charged/.test(e.message));
  assert.equal(seen.length, 0);
  assert.equal(kv.puts, 0);
  // Markup does not count: 190,000 characters of table cells with little text still publish.
  const table = `<table>${'<tr><td colspan="1" rowspan="1">1</td></tr>'.repeat(4300)}</table>`;
  assert.ok(table.length > 180_000);
  seen.length = 0;
  await P.publishPage(kv, { html: table }, model);
  assert.ok(seen.length >= 1 && seen.length <= 4);
  // Text a reader sees that is not body text is screened too.
  seen.length = 0;
  await assert.rejects(P.publishPage(kv, { html: '<p>fine</p><img src="https://img.example/a.png" alt="FORBIDDEN picture"><abbr title="more">x</abbr>' }, model), (e) => e.status === 422);
  assert.match(seen[0], /FORBIDDEN picture/);
  // The model failing is still a failure of the call, never a publish.
  kv.puts = 0;
  await assert.rejects(P.publishPage(kv, { html: '<p>fine</p>' }, async () => { throw Object.assign(new Error('no verdict'), { status: 502 }); }), (e) => e.status === 502);
  assert.equal(kv.puts, 0);
});

test('/page/publish refuses a page that links to a host on the phishing lists, and publishes when the lists are not loaded', async () => {
  const P = await load('src/routes/pages.ts');
  const L = await load('src/lib/phishing-list.ts');
  const safe = async () => ({ flagged: false, categories: [] });
  assert.deepEqual(P.pageExtras('<a href="https://a.example/x?y=1&amp;z=2" title="T &amp; t">l</a><img src="https://IMG.example/p.png" alt="An &quot;alt&quot;"><a href="#top">up</a><a href="mailto:x@y.example">m</a>'),
    { attributeText: 'T & t\nAn "alt"', hosts: ['a.example', 'img.example'] });
  // A key-value store that holds the lists as the service builds them (lib/phishing-list.ts): one listed domain.
  const listed = 'login-wallet-verify.example';
  const meta = { ver: 't1', builtAt: '2026-11-20T00:00:00.000Z', counts: { phishingDatabase: 1, metamask: 0 }, whitelist: ['good.example'], fuzzylist: [] };
  const kv = fakeKv({ [L.META_KEY]: JSON.stringify(meta), [L.shardKey('t1', L.shardOf(listed))]: `\n${listed}\t1\n` });
  let modelCalls = 0;
  const model = async () => { modelCalls++; return { flagged: false, categories: [] }; };
  await assert.rejects(P.publishPage(kv, { html: `<p>Claim your prize</p><a href="https://secure.${listed}/claim">here</a>` }, model),
    (e) => e.status === 422 && e.code === 'PAGE_REFUSED' && e.message.includes(`secure.${listed}`) && /listed as phishing/.test(e.message) && /nothing was charged/.test(e.message));
  assert.equal(modelCalls, 0, 'a page refused for its links costs no model call');
  assert.equal(kv.puts, 0);
  // An image on a listed host is refused the same way.
  await assert.rejects(P.publishPage(kv, { html: `<p>x</p><img src="https://${listed}/a.png" alt="a">` }, model), (e) => e.status === 422);
  // Other links publish; so does a page with no links at all.
  await P.publishPage(kv, { html: '<p>Sources</p><a href="https://en.wikipedia.org/wiki/Report">w</a><a href="https://good.example/">g</a>' }, model);
  assert.equal(kv.puts, 1);
  // The lists not loaded (no meta key): the page goes on to moderation and is published.
  const empty = fakeKv();
  await P.publishPage(empty, { html: `<p>x</p><a href="https://${listed}/">l</a>` }, safe);
  assert.equal(empty.puts, 1);
  // A lookup that throws is "not known", never a failed call.
  await P.publishPage(empty, { html: '<p>x</p><a href="https://a.example/">l</a>' }, safe, 'https://api.test', async () => { throw new Error('store down'); });
  assert.equal(empty.puts, 2);
  // More different sites than can be checked: refused, uncharged, nothing asked of the model.
  modelCalls = 0;
  const many = Array.from({ length: P.MAX_LINK_HOSTS + 1 }, (_, i) => `<a href="https://site${i}.example/">s</a>`).join('');
  await assert.rejects(P.publishPage(kv, { html: `<p>x</p>${many}` }, model), (e) => e.status === 400 && /51 different sites/.test(e.message) && /nothing was charged/.test(e.message));
  assert.equal(modelCalls, 0);
  // Fifty is still checked and published; many links to one site count once.
  const fifty = Array.from({ length: P.MAX_LINK_HOSTS }, (_, i) => `<a href="https://site${i}.example/a">s</a><a href="https://site${i}.example/b">t</a>`).join('');
  const checked = [];
  await P.publishPage(fakeKv(), { html: `<p>x</p>${fifty}` }, safe, 'https://api.test', async (host) => { checked.push(host); return { listed: false }; });
  assert.equal(checked.length, 50);
});

// ---------- 7. the log scan's time budget ----------

test('log scans: what a caller gets, and after how long, when every node hangs (fake clock, fake nodes)', async () => {
  const R = await load('src/lib/rpc.ts');
  const C = await load('src/routes/chain-reads.ts');
  // The arithmetic from the node lists and the transport options themselves.
  const expected = (slug) => R.LOG_RPCS[slug].reduce((ms, url) => { const t = R.logTransport(url); let waits = 0; for (let i = 0; i < t.retryCount; i++) waits += 2 ** i * t.retryDelay; return ms + t.timeout * (t.retryCount + 1) + waits; }, 0);
  for (const slug of Object.keys(R.LOG_RPCS)) assert.equal(R.logCallWorstMs(slug), expected(slug), slug);
  assert.deepEqual(Object.fromEntries(Object.keys(R.LOG_RPCS).map((s) => [s, R.logCallWorstMs(s)])), { base: 18_350, eth: 22_350, arb: 22_350, op: 18_350, polygon: 18_350 });
  assert.equal(C.LOG_SCAN_BUDGET_MS, 20_000);

  // A client whose every node hangs: each eth_getLogs uses the chain's whole worst case on the fake clock, then fails
  // the way the transport does when all of its nodes timed out.
  const hang = (slug) => {
    const state = { clock: 0, sizes: [] };
    const cl = { request: async ({ params: [{ fromBlock, toBlock }] }) => {
      state.sizes.push(Number(BigInt(toBlock) - BigInt(fromBlock) + 1n));
      state.clock += R.logCallWorstMs(slug);
      throw Object.assign(new Error('The request took too long to respond.'), { name: 'TimeoutError' });
    } };
    return { state, cl };
  };
  const scan = (h) => C.recentLogs(h.cl, { address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' }, 1_000_000n, 10_000n, 50, { first: C.SPARSE_FIRST_WINDOW, now: () => h.state.clock });
  const nodes502 = (e) => e.status === 502 && /public nodes did not answer/.test(e.message);

  // Ethereum and Arbitrum: one failure is longer than the budget, so the smaller window is never tried.
  for (const slug of ['eth', 'arb']) {
    const h = hang(slug);
    await assert.rejects(scan(h), nodes502, slug);
    assert.deepEqual(h.state.sizes, [500], `${slug}: one call, no smaller window`);
    assert.equal(h.state.clock, 22_350, `${slug}: the caller waits 22.35 s for the 502`);
    assert.ok(R.logCallWorstMs(slug) > C.LOG_SCAN_BUDGET_MS);
  }
  // Base, Optimism and Polygon: one failure fits, one quarter window is tried, and the 502 comes after two.
  for (const slug of ['base', 'op', 'polygon']) {
    const h = hang(slug);
    await assert.rejects(scan(h), nodes502, slug);
    assert.deepEqual(h.state.sizes, [500, 125], `${slug}: the first window and one quarter of it`);
    assert.equal(h.state.clock, 36_700, `${slug}: the caller waits 36.7 s for the 502`);
    assert.ok(R.logCallWorstMs(slug) <= C.LOG_SCAN_BUDGET_MS && 2 * R.logCallWorstMs(slug) > C.LOG_SCAN_BUDGET_MS);
  }
  // Nodes that REFUSE a wide range at once (what the retry was written for): the quarter window is tried and serves.
  const refusing = { clock: 0, sizes: [] };
  const cl = { request: async ({ params: [{ fromBlock, toBlock }] }) => {
    const n = Number(BigInt(toBlock) - BigInt(fromBlock) + 1n);
    refusing.sizes.push(n); refusing.clock += 300;
    if (n > 200) throw Object.assign(new Error('query exceeds max block range'), { name: 'RpcRequestError' });
    return [];
  } };
  const r = await C.recentLogs(cl, { address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' }, 1_000_000n, 1_000n, 50, { first: C.SPARSE_FIRST_WINDOW, now: () => refusing.clock });
  assert.deepEqual(refusing.sizes.slice(0, 2), [500, 125], 'refused at 500 blocks, read at a quarter of that');
  assert.ok(refusing.sizes.slice(1).every((n) => n <= 125), 'later windows stay at the size that worked');
  assert.equal(refusing.sizes.slice(1).reduce((x, y) => x + y, 0), 1_000, 'the whole span is read');
  assert.equal(r.complete, true);
});

// ---------- 8. /ai/translate and Traditional Chinese ----------

test('/ai/translate still refuses zh-TW and zh-Hant: neither translation model has a code for Traditional Chinese', async () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../src/routes/ai-text.ts'), 'utf8');
  // The list the handler routes by, and the translation model behind the rest: one "zh", no script or region.
  const list = /const TRANSLATE_LANGUAGES = new Set\("([^"]+)"/.exec(source)[1].split(' ');
  assert.ok(list.includes('zh'));
  assert.ok(!list.some((c) => /^zh.|^yue$|hant|tw/i.test(c)), 'when a distinct code is added here, accept zh-TW and delete this test');
  const A = await load('src/routes/ai-text.ts');
  const tool = A.AI_TEXT.find((e) => e.endpoint.path === '/ai/translate');
  let calls = 0;
  const env = { AI: { run: async () => { calls++; return { response: 'x' }; } } };
  for (const to of ['zh-TW', 'zh-Hant', 'zh_HK']) {
    await assert.rejects(Promise.resolve().then(() => tool.run(env, q({ text: 'Payment received, thank you!', to }))), (e) => e.status === 400, to);
  }
  assert.equal(calls, 0, 'refused before any model call');
});
