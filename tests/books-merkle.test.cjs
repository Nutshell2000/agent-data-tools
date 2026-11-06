// Book lookups (Open Library, mocked) and OpenZeppelin-compatible Merkle trees (6 Nov 2026). The Merkle roots and proofs
// below were checked against @openzeppelin/merkle-tree 1.0.8 (StandardMerkleTree / SimpleMerkleTree) for 1-257 entries.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { build } = require('esbuild');

async function load(entry) {
  const b = await build({ entryPoints: [entry], bundle: true, format: 'cjs', platform: 'node', write: false, logLevel: 'silent' });
  const m = { exports: {} };
  new Function('module', 'exports', 'require', b.outputFiles[0].text)(m, m.exports, require);
  return m.exports;
}
const run = (e, q) => e.run({}, (n) => q[n]);

test('ISBNs are read with hyphens and checked by their check digit', async () => {
  const b = await load('src/routes/books.ts');
  assert.equal(b.isbnOf('978-0-14-032872-1'), '9780140328721');
  assert.equal(b.isbnOf('ISBN 0-14-032872-6'), '0140328726');
  assert.equal(b.isbnOf('080442957X'), '080442957X');
  assert.equal(b.isbnOf('9780140328722'), null);
  assert.equal(b.isbnOf('hello'), null);
  assert.equal(b.isbn13('0140328726'), '9780140328721');
});

test('book lookup and search map Open Library answers and refuse unknown books uncharged', async () => {
  const realFetch = globalThis.fetch;
  const asked = [];
  globalThis.fetch = async (input) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    asked.push(url.href);
    if (url.pathname === '/api/books') {
      const key = url.searchParams.get('bibkeys');
      if (key === 'ISBN:9780140328721') return Response.json({ [key]: { url: 'http://openlibrary.org/books/OL7353617M/Fantastic_Mr._Fox', title: 'Fantastic Mr. Fox', authors: [{ name: 'Roald Dahl' }], publishers: [{ name: 'Puffin' }], publish_date: 'October 1, 1988', number_of_pages: 96, subjects: [{ name: 'Animals' }], languages: [{ key: '/languages/eng' }], cover: { large: 'https://covers.openlibrary.org/b/id/8739161-L.jpg' }, identifiers: { isbn_13: ['9780140328721'], isbn_10: ['0140328726'], goodreads: ['1507552'] } } });
      return Response.json({});
    }
    if (url.pathname === '/search.json') return Response.json({ numFound: 279, docs: [{ key: '/works/OL893415W', title: 'Dune', author_name: ['Frank Herbert'], first_publish_year: 1965, edition_count: 155, isbn: ['0441172717', '9780425043769'], publisher: ['Ace Books'], language: ['eng'], cover_i: 11481354 }] });
    return new Response('?', { status: 404 });
  };
  try {
    const { BOOKS } = await load('src/routes/books.ts');
    const [isbn, search] = BOOKS;
    const book = await run(isbn, { isbn: '0-14-032872-6' });
    assert.equal(book.title, 'Fantastic Mr. Fox');
    assert.deepEqual(book.authors, ['Roald Dahl']);
    assert.equal(book.isbn13, '9780140328721');
    assert.deepEqual(book.languages, ['eng']);
    assert.deepEqual(book.otherIds, { goodreads: '1507552' });
    // The ISBN-10 was not filed, so the ISBN-13 form was asked for next.
    assert.ok(asked.some((u) => u.includes('ISBN%3A0140328726')) && asked.some((u) => u.includes('ISBN%3A9780140328721')));
    await assert.rejects(run(isbn, { isbn: '9780140328722' }), (e) => e.status === 400);
    await assert.rejects(run(isbn, { isbn: '9781234567897' }), (e) => e.status === 404);
    const found = await run(search, { author: 'Frank Herbert', limit: '3' });
    assert.equal(found.results[0].title, 'Dune');
    assert.deepEqual(found.results[0].isbns, ['9780425043769', '0441172717']);
    assert.equal(found.results[0].cover, 'https://covers.openlibrary.org/b/id/11481354-L.jpg');
    assert.deepEqual(found.query, { author: 'Frank Herbert' });
    await assert.rejects(run(search, {}), (e) => e.status === 400);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('Merkle trees match OpenZeppelin, and proofs verify', async () => {
  const { MERKLE } = await load('src/routes/merkle.ts');
  const [tree, verify] = MERKLE;
  const values = [['0x1111111111111111111111111111111111111111', '5000000000000000000'], ['0x2222222222222222222222222222222222222222', '2500000000000000000']];
  const out = run(tree, { values: JSON.stringify(values) });
  // Types read from the rows; root as @openzeppelin/merkle-tree computes it.
  assert.deepEqual(out.leafEncoding, ['address', 'uint256']);
  assert.equal(out.root, '0xd4dee0beab2d53f2cc83e567171bd2820e49898130a22622b10ead383e90bd77');
  assert.equal(out.entries[0].leaf, '0xeb02c421cfa48976e66dfb29120745909ea3a0f843456c263cf8f1253483e283');
  assert.deepEqual(out.entries[0].proof, ['0xb92c48e9d7abe27fd8dfd6b5dfdbfb1c9a463f80c712b66f3a5180a090cccafc']);
  assert.equal(out.dump.values[0].treeIndex, 1);
  // The same list as lines; one proof by address.
  const one = run(tree, { values: values.map((r) => r.join(',')).join('\n'), types: 'address,uint256', proofFor: '0x2222222222222222222222222222222222222222' });
  assert.equal(one.root, out.root);
  assert.equal(one.entries.length, 1);
  assert.equal(one.entries[0].index, 1);
  assert.equal(run(verify, { root: out.root, proof: JSON.stringify(out.entries[0].proof), value: values[0].join(',') }).valid, true);
  // The fields can also go in leaf (the published example carries only required inputs).
  assert.equal(run(verify, { root: out.root, proof: JSON.stringify(out.entries[0].proof), leaf: values[0].join(','), types: 'address,uint256' }).valid, true);
  assert.equal(run(verify, { root: out.root, proof: JSON.stringify(out.entries[0].proof), leaf: values[0].join(',') }).valid, true);
  assert.equal(run(verify, { root: out.root, proof: out.entries[0].proof.join(','), leaf: out.entries[0].leaf }).valid, true);
  assert.equal(run(verify, { root: out.root, proof: JSON.stringify(out.entries[0].proof), value: `${values[0][0]},1` }).valid, false);
  // Bad inputs are named.
  assert.throws(() => run(tree, { values: '[["hello", "world"]]' }), /types/);
  assert.throws(() => run(tree, { values: '[["0x1111111111111111111111111111111111111111","-1"]]', types: 'address,uint256' }), /not a valid uint256/);
  assert.throws(() => run(tree, { values: '[[1]]', types: 'uint7' }), /unsupported type/);
  assert.throws(() => run(verify, { root: '0x12', proof: '[]', leaf: out.root }), /root/);
  // A ready bytes32 list is a SimpleMerkleTree.
  const leaves = ['0x' + 'aa'.repeat(32), '0x' + 'bb'.repeat(32), '0x' + 'cc'.repeat(32)];
  const simple = run(tree, { values: JSON.stringify(leaves) });
  assert.equal(simple.format, 'simple-v1');
  assert.equal(run(verify, { root: simple.root, proof: JSON.stringify(simple.entries[2].proof), leaf: leaves[2] }).valid, true);
});

test('the x402 service finder lists Bazaar results honestly, with filters and sorting', async () => {
  const realFetch = globalThis.fetch;
  const ours = '0x2074C40346Ae2A90e0E4A391bceE6F16BF5277f5';
  globalThis.fetch = async (input) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    assert.equal(url.searchParams.get('query'), 'email verification');
    assert.equal(url.searchParams.get('limit'), '20');
    return Response.json({ resources: [
      { resource: 'https://a.example/verify', serviceName: 'A', accepts: [{ amount: '30000', network: 'eip155:8453', payTo: '0x1' }], quality: { l30DaysUniquePayers: 9, l30DaysTotalCalls: 400 } },
      { resource: 'https://ours.example/email', serviceName: 'Ours', accepts: [{ amount: '10000', network: 'eip155:8453', payTo: ours.toLowerCase() }, { amount: '10000', network: 'eip155:137', payTo: ours }], quality: { l30DaysUniquePayers: 2, l30DaysTotalCalls: 7 } },
      { resource: 'https://c.example/old', serviceName: 'C', accepts: [{ amount: '1000', network: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp', payTo: 'x' }], quality: { l30DaysUniquePayers: 0, l30DaysTotalCalls: 0 } },
    ] });
  };
  try {
    const { X402_FIND } = await load('src/routes/x402-find.ts');
    const find = (q) => X402_FIND[0].run({ PAY_TO: ours }, (n) => q[n]);
    const plain = await find({ q: 'email verification' });
    assert.deepEqual(plain.results.map((r) => r.name), ['A', 'Ours', 'C']);
    assert.equal(plain.results[1].ours, true);
    assert.deepEqual(plain.results[1].networks, ['base', 'polygon']);
    assert.equal(plain.results[0].priceUsd, 0.03);
    assert.deepEqual((await find({ q: 'email verification', sort: 'price' })).results.map((r) => r.name), ['C', 'Ours', 'A']);
    assert.deepEqual((await find({ q: 'email verification', maxPrice: '0.01', active: 'true' })).results.map((r) => r.name), ['Ours']);
    assert.deepEqual((await find({ q: 'email verification', network: 'solana' })).results.map((r) => r.name), ['C']);
    await assert.rejects(find({ q: 'email verification', sort: 'best' }), (e) => e.status === 400);
    await assert.rejects(find({ q: 'email verification', maxPrice: '0.0001' }), (e) => e.status === 404);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('option pricing matches the textbook Black-Scholes case and inverts to implied volatility', async () => {
  const { OPTIONS, normCdf } = await load('src/routes/options.ts');
  const price = (q) => OPTIONS[0].run({}, (n) => q[n]);
  // Hull's standard case: S = K = 100, T = 1, r = 5%, sigma = 20%.
  const out = price({ spot: '100', strike: '100', years: '1', vol: '20', rate: '5' });
  assert.equal(out.call.price, 10.450584);
  assert.equal(out.put.price, 5.573526);
  assert.equal(out.call.delta, 0.636831);
  assert.equal(out.call.gamma, 0.018762);
  assert.equal(out.call.vega, 0.37524);
  // Put-call parity: C - P = S - K e^{-rT}.
  assert.ok(Math.abs(out.call.price - out.put.price - (100 - 100 * Math.exp(-0.05))) < 1e-5);
  // Volatility given as a fraction means the same; the rate is always percent.
  assert.equal(price({ spot: '100', strike: '100', years: '1', vol: '0.2', rate: '5' }).call.price, 10.450584);
  const iv = price({ spot: '100', strike: '100', years: '1', rate: '5', price: '10.450584' });
  assert.equal(iv.impliedVolPercent, 20);
  assert.equal(price({ spot: '100', strike: '90', days: '30', rate: '0', price: '12', type: 'put' }).impliedVol > 0, true);
  assert.throws(() => price({ spot: '100', strike: '100', years: '1', price: '150' }), /no volatility/);
  assert.throws(() => price({ spot: '100', strike: '100', expiry: '2001-01-01' }), /past/);
  assert.ok(Math.abs(normCdf(1.96) - 0.9750021048517795) < 1e-12);
});

test('Hyperliquid account view sums positions, spot and orders', async () => {
  const { accountView } = await load('src/routes/hl-account.ts');
  const v = accountView('0xabc', {
    marginSummary: { accountValue: '1000', totalNtlPos: '2500', totalMarginUsed: '125' }, withdrawable: '875', crossMaintenanceMarginUsed: '25', time: 1762400000000,
    assetPositions: [
      { position: { coin: 'BTC', szi: '0.01', entryPx: '75000', positionValue: '760', unrealizedPnl: '10.5', returnOnEquity: '0.1', liquidationPx: null, marginUsed: '38', leverage: { type: 'cross', value: 20 }, cumFunding: { sinceOpen: '-1.2' } } },
      { position: { coin: 'ETH', szi: '-0.5', entryPx: '2400', positionValue: '1200', unrealizedPnl: '-4', liquidationPx: '3100', leverage: { type: 'isolated', value: 5 } } },
    ],
  }, { balances: [{ coin: 'USDC', total: '50.5', hold: '0', entryNtl: '0' }, { coin: 'DUST', total: '0', hold: '0' }] }, [{ coin: 'ETH', side: 'A', limitPx: '2500', sz: '0.5', oid: 7, timestamp: 1762400000000, orderType: 'Limit' }]);
  assert.equal(v.perps.leverage, 2.5);
  assert.equal(v.perps.unrealizedPnlUsd, 6.5);
  assert.deepEqual(v.perps.positions.map((p) => [p.coin, p.side, p.size]), [['BTC', 'long', 0.01], ['ETH', 'short', 0.5]]);
  assert.equal(v.perps.positions[0].cumFundingSinceOpen, -1.2);
  assert.equal(v.perps.positions[1].liquidationPrice, 3100);
  assert.deepEqual(v.spot, [{ coin: 'USDC', total: 50.5, onHold: 0, entryNotionalUsd: 0 }]);
  assert.equal(v.openOrders.orders[0].side, 'sell');
});

test('holidays and business days cover countries beyond our rules through Nager.Date', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    if (url.hostname !== 'date.nager.at') return new Response('?', { status: 404 });
    const [, , , , year, cc] = url.pathname.split('/');
    if (cc === 'JP') return Response.json([
      { date: `${year}-01-01`, localName: '元日', name: "New Year's Day", global: true, types: ['Public'] },
      { date: `${year}-01-12`, localName: '成人の日', name: 'Coming of Age Day', global: true, types: ['Public'] },
      { date: `${year}-03-01`, localName: 'x', name: 'Regional Day', global: false, types: ['Public'] },
    ]);
    return new Response(null, { status: 204 });
  };
  try {
    const { PUBLIC_DATA } = await load('src/routes/public-data.ts');
    const { MATH_DATE } = await load('src/routes/math-date.ts');
    const holidays = PUBLIC_DATA.find((e) => e.endpoint.path === '/holidays');
    const bd = MATH_DATE.find((e) => e.endpoint.path === '/date/business-days');
    const jp = await holidays.run({}, (n) => ({ country: 'Japan', year: '2026' })[n]);
    assert.equal(jp.country, 'JP');
    assert.equal(jp.count, 3);
    assert.equal(jp.source, 'Nager.Date');
    await assert.rejects(holidays.run({}, (n) => ({ country: 'AQ', year: '2026' })[n]), (e) => e.status === 404);
    // Our own rules still answer Sweden without a request.
    assert.equal((await holidays.run({}, (n) => ({ country: 'SE', year: '2026' })[n])).country, 'SE');
    // 2026-01-12 is a Monday holiday in Japan; the regional day on 3 March is not skipped.
    const jan = await bd.run({}, (n) => ({ from: '2026-01-05', to: '2026-01-16', country: 'JP' })[n]);
    assert.equal(jan.holidaySource, 'Nager.Date');
    assert.equal(jan.businessDays, 9);
    assert.deepEqual(jan.holidays, [{ date: '2026-01-12', name: 'Coming of Age Day' }]);
    assert.equal((await bd.run({}, (n) => ({ from: '2026-01-09', add: '1', country: 'jp' })[n])).date, '2026-01-13');
    const none = await bd.run({}, (n) => ({ from: '2026-01-05', to: '2026-01-16', country: 'Antarctica' })[n]);
    assert.equal(none.holidayRules, false);
    assert.match(none.note, /weekends only/);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('LLM prices filter, sort and estimate the cost of a call', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ data: [
    { id: 'meta-llama/llama-3.3-70b-instruct', name: 'Meta: Llama 3.3 70B', context_length: 131072, pricing: { prompt: '0.0000001', completion: '0.00000025' }, architecture: { input_modalities: ['text'] } },
    { id: 'openai/gpt-5', name: 'OpenAI: GPT-5', context_length: 400000, pricing: { prompt: '0.00000125', completion: '0.00001' }, architecture: { input_modalities: ['text', 'image'] } },
    { id: 'meta-llama/llama-4-scout:free', name: 'Meta: Llama 4 Scout (free)', context_length: 64000, pricing: { prompt: '0', completion: '0' }, architecture: { input_modalities: ['text', 'image'] } },
    { id: 'router/auto', name: 'Auto', pricing: { prompt: '-1', completion: '-1' } },
  ] });
  try {
    const { LLM_PRICES } = await load('src/routes/llm-prices.ts');
    const run2 = (q) => LLM_PRICES[0].run({}, (n) => q[n]);
    const all = await run2({});
    assert.deepEqual(all.models.map((m) => m.id), ['meta-llama/llama-4-scout:free', 'meta-llama/llama-3.3-70b-instruct', 'openai/gpt-5']);
    const llama = await run2({ q: 'llama 70b', inputTokens: '2000', outputTokens: '500' });
    assert.equal(llama.count, 1);
    assert.equal(llama.models[0].inputPerMillionUsd, 0.1);
    assert.equal(llama.models[0].estimatedCostUsd, 0.000325);
    assert.deepEqual((await run2({ vision: 'true', minContext: '100000' })).models.map((m) => m.id), ['openai/gpt-5']);
    assert.deepEqual((await run2({ provider: 'openai' })).models.map((m) => m.provider), ['openai']);
    assert.equal((await run2({ sort: 'context' })).models[0].id, 'openai/gpt-5');
    await assert.rejects(run2({ maxInputPrice: '0.01', provider: 'openai' }), (e) => e.status === 404);
    await assert.rejects(run2({ sort: 'best' }), (e) => e.status === 400);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('DeFi yields filter, sort and history summaries', async () => {
  const realFetch = globalThis.fetch;
  const pool = (o) => ({ chain: 'Base', project: 'aave-v3', symbol: 'USDC', tvlUsd: 5e7, apy: 5, apyBase: 5, apyReward: null, pool: '11111111-1111-1111-1111-111111111111', apyPct1D: 0, apyPct7D: 0, apyPct30D: 0, stablecoin: true, ilRisk: 'no', exposure: 'single', apyMean30d: 4.8, poolMeta: null, rewardTokens: null, underlyingTokens: null, outlier: false, ...o });
  globalThis.fetch = async (input) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    if (url.pathname === '/pools') return Response.json({ status: 'success', data: [
      pool({}), pool({ project: 'morpho-blue', apy: 7.4, pool: '22222222-2222-2222-2222-222222222222' }),
      pool({ chain: 'Ethereum', symbol: 'WETH-USDC', stablecoin: false, ilRisk: 'yes', exposure: 'multi', apy: 18, tvlUsd: 9e6, pool: '33333333-3333-3333-3333-333333333333' }),
      pool({ apy: 900, outlier: true, pool: '44444444-4444-4444-4444-444444444444' }), pool({ apy: 30, tvlUsd: 2e5, pool: '55555555-5555-5555-5555-555555555555' }),
    ] });
    if (url.pathname.startsWith('/chart/')) return Response.json({ status: 'success', data: [1, 2, 3, 4].map((i) => ({ timestamp: `2026-11-0${i}T00:00:00.000Z`, tvlUsd: 1e6 * i, apy: 2 + i / 10, apyBase: 2 + i / 10, apyReward: null })) });
    return new Response('?', { status: 404 });
  };
  try {
    const { DEFI_YIELDS } = await load('src/routes/defi-yields.ts');
    const [yields, history] = DEFI_YIELDS;
    const run2 = (e, q) => e.run({}, (n) => q[n]);
    const base = await run2(yields, { chain: 'base', stablecoin: 'true' });
    // The outlier and the pool under $1M TVL are left out; highest APY first.
    assert.deepEqual(base.pools.map((p) => p.project), ['morpho-blue', 'aave-v3']);
    assert.equal(base.pools[0].url, 'https://defillama.com/yields/pool/22222222-2222-2222-2222-222222222222');
    assert.deepEqual((await run2(yields, { symbol: 'usdc', noIl: 'true', sort: 'tvl' })).pools.map((p) => p.chain), ['Base', 'Base']);
    assert.equal((await run2(yields, { symbol: 'weth' })).pools[0].chain, 'Ethereum');
    assert.equal((await run2(yields, { minTvl: '0', maxApy: '50' })).pools[0].apy, 30);
    await assert.rejects(run2(yields, { project: 'nope' }), (e) => e.status === 404);
    await assert.rejects(run2(yields, { sort: 'risk' }), (e) => e.status === 400);
    const h = await run2(history, { pool: 'https://defillama.com/yields/pool/747C1D2A-c668-4682-b9f9-296708a3dd90', days: '3' });
    assert.equal(h.pool, '747c1d2a-c668-4682-b9f9-296708a3dd90');
    assert.deepEqual(h.history.map((r) => r.date), ['2026-11-02', '2026-11-03', '2026-11-04']);
    assert.deepEqual(h.summary, { avgApy: 2.3, minApy: 2.2, maxApy: 2.4, latestApy: 2.4, latestTvlUsd: 4000000 });
    await assert.rejects(run2(history, { pool: 'lido' }), (e) => e.status === 400);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('DeFi TVL: one protocol, rankings by category and chain, change rankings without dust, chain TVL', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    if (url.pathname === '/protocols') return Response.json([
      { name: 'Binance CEX', slug: 'binance-cex', category: 'CEX', tvl: 1.2e11, chainTvls: { Bitcoin: 4e10 } },
      { name: 'Aave V3', slug: 'aave-v3', category: 'Lending', tvl: 1.5e10, change_1d: -5, change_7d: 4, chainTvls: { Ethereum: 1.2e10, Base: 5e8, 'Ethereum-borrowed': 9e9, staking: 1e8 } },
      { name: 'Aave V2', slug: 'aave-v2', category: 'Lending', tvl: 1e9, change_7d: 1, chainTvls: { Ethereum: 1e9 } },
      { name: 'Morpho Blue', slug: 'morpho-blue', category: 'Lending', tvl: 1.1e10, change_7d: 6, chainTvls: { Ethereum: 5e9, Base: 4.3e9 } },
      { name: 'Dust Vault', slug: 'dust', category: 'Yield', tvl: 1.7e7, change_7d: 135285, chainTvls: { Sui: 1.7e7 } },
      { name: 'Tiny', slug: 'tiny', category: 'Yield', tvl: 5e5, change_7d: 300, chainTvls: { Base: 5e5 } },
    ]);
    if (url.pathname === '/v2/chains') return Response.json([{ name: 'Ethereum', tvl: 6e10, tokenSymbol: 'ETH', chainId: 1 }, { name: 'Base', tvl: 2e10, tokenSymbol: null, chainId: 8453 }, { name: 'Dead', tvl: 0 }]);
    return new Response('?', { status: 404 });
  };
  try {
    const { DEFI_TVL, findProtocol } = await load('src/routes/defi-tvl.ts');
    const run2 = (i, q) => DEFI_TVL[i].run({}, (n) => q[n]);
    const aave = await run2(0, { protocol: 'Aave' });
    assert.equal(aave.protocols[0].slug, 'aave-v3');
    assert.deepEqual(aave.protocols[0].topChains.map((c) => c.chain), ['Ethereum', 'Base']);
    assert.deepEqual(aave.related.map((r) => r.slug), ['aave-v2']);
    assert.equal(findProtocol([{ name: 'Lido', slug: 'lido' }], 'LIDO').slug, 'lido');
    // CEXs only when asked; ranking on a chain uses that chain's TVL.
    assert.deepEqual((await run2(0, {})).protocols.map((p) => p.slug), ['aave-v3', 'morpho-blue', 'aave-v2', 'dust', 'tiny']);
    assert.deepEqual((await run2(0, { category: 'cex' })).protocols.map((p) => p.slug), ['binance-cex']);
    const base = await run2(0, { chain: 'base' });
    assert.equal(base.chain, 'Base');
    assert.deepEqual(base.protocols.map((p) => [p.slug, p.tvlUsd]), [['morpho-blue', 4.3e9], ['aave-v3', 5e8], ['tiny', 5e5]]);
    assert.deepEqual((await run2(0, { sort: 'change_7d' })).protocols.map((p) => p.slug), ['morpho-blue', 'aave-v3', 'aave-v2']);
    await assert.rejects(run2(0, { protocol: 'zzzz' }), (e) => e.status === 404);
    const chains = await run2(1, {});
    assert.deepEqual(chains.chains.map((c) => [c.rank, c.name, c.share]), [[1, 'Ethereum', 75], [2, 'Base', 25]]);
    assert.equal((await run2(1, { chain: 'BASE' })).chains[0].rank, 2);
  } finally {
    globalThis.fetch = realFetch;
  }
});
