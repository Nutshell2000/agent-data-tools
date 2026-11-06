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
