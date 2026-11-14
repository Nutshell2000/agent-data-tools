const assert = require('node:assert/strict');
const { before, after, test } = require('node:test');
const { build } = require('esbuild');
const { Miniflare, convertV4MiniflareOptions } = require('miniflare');

// Unpaid quotes from the edge cache (src/lib/quote-cache.ts): a repeat quote must be the same quote, with fresh MPP
// challenges, and nothing that carries a payment, a key, a free-call request or a browser may ever be served from it.
const asset = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
let verifies = 0;
let on, off;
before(async () => {
  const b = await build({ entryPoints: ['src/index.ts'], bundle: true, format: 'esm', platform: 'browser', write: false, external: ['cloudflare:workers', 'node:*'], logLevel: 'silent', plugins: [{ name: 'fixture-facilitator', setup(b) {
    b.onResolve({ filter: /^url$/ }, () => ({ path: 'node:url', external: true }));
    b.onResolve({ filter: /^\.\/facilitator$/ }, () => ({ path: 'fixture', namespace: 'fixture' }));
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ loader: 'js', contents: `export function buildFacilitator(){return {
      getSupported:async()=>({kinds:[{x402Version:2,scheme:'exact',network:'eip155:8453',extra:{name:'USD Coin',version:'2',asset:'${asset}',assetTransferMethod:'eip3009'}}],extensions:[]}),
      verify:async()=>{ await fetch('https://verify-counter.invalid/hit'); return {isValid:false,invalidReason:'fixture'}; }, settle:async()=>({success:false,errorReason:'fixture'})
    }}` }));
  } }] });
  const worker = (extra) => new Miniflare(convertV4MiniflareOptions({ modules: true, script: b.outputFiles[0].text, compatibilityDate: '2026-09-01', compatibilityFlags: ['nodejs_compat'],
    durableObjects: { METRICS: { className: 'Metrics', useSQLite: true } }, kvNamespaces: ['TRIALS'],
    bindings: { PAY_TO: '0x6293ded2684f1a76e26becef87c137d691fbf800', NETWORK: 'eip155:8453', PAYWALL: 'on', TRIALS_ENABLED: 'on', MPP_EVM: 'on', MPP_SECRET_KEY: 'mpp-test-secret-fixture', FACILITATOR_URL: 'https://fixture.invalid', BASE_RPC_URL: 'https://fixture.invalid', ...extra },
    outboundService: async (req) => { if (new URL(req.url).host === 'verify-counter.invalid') { verifies++; return new Response('ok'); } return new Response('not used', { status: 500 }); } }));
  on = worker({});
  off = worker({ QUOTE_CACHE: 'off' });
});
after(async () => { await Promise.all([on, off].map((m) => m?.dispose())); });

const bot = { accept: 'application/json', 'user-agent': 'x402station/1.0' };
const get = async (mf, url, headers = bot, method = 'GET') => {
  const res = await mf.dispatchFetch(url, { headers, method });
  return { status: res.status, cache: res.headers.get('x-quote-cache'), terms: res.headers.get('payment-required'), mpp: res.headers.get('www-authenticate'), body: method === 'HEAD' ? '' : await res.text(), headers: res.headers };
};
const PER_ANSWER = new Set(['www-authenticate', 'x-request-id', 'date', 'content-length', 'x-quote-cache']);
const stable = (h) => JSON.stringify([...h.entries()].filter(([k]) => !PER_ANSWER.has(k)).sort());
// The cache write happens after the answer has gone out; give it a moment before asking again.
const settle = () => new Promise((r) => setTimeout(r, 150));

test('a repeat quote is the same quote from the cache, with MPP challenges made fresh', async () => {
  const url = 'https://api.test/weather/forecast?city=Lima';
  const first = await get(on, url);
  assert.equal(first.status, 402);
  assert.equal(first.cache, null);
  await settle();
  const second = await get(on, url);
  assert.equal(second.status, 402);
  assert.equal(second.cache, 'hit');
  assert.equal(second.terms, first.terms);
  assert.equal(second.body, first.body);
  assert.equal(stable(second.headers), stable(first.headers), 'every header except the per-answer ones');
  assert.ok(first.mpp && second.mpp, 'both answers carry an MPP challenge');
  assert.notEqual(second.mpp, first.mpp, 'the challenge is new each time: it expires');
  assert.notEqual(second.headers.get('x-request-id'), first.headers.get('x-request-id'));
});

test('thirty tools: the cached quote equals the gateway quote', async () => {
  const api = await (await on.dispatchFetch('https://api.test/openapi.json')).json();
  const paths = Object.entries(api.paths).filter(([p, v]) => v.get?.['x-payment-info'] && !p.startsWith('/v1/') && !p.startsWith('/credits/')).map(([p]) => p);
  const sample = paths.filter((_, i) => i % Math.ceil(paths.length / 30) === 0);
  assert.ok(sample.length >= 25);
  const firsts = [];
  for (const p of sample) firsts.push(await get(on, `https://api.test${p}`));
  await settle();
  for (const [i, p] of sample.entries()) {
    const again = await get(on, `https://api.test${p}`);
    assert.equal(again.cache, 'hit', p);
    assert.equal(again.terms, firsts[i].terms, p);
    assert.equal(again.body, firsts[i].body, p);
    const uncached = await get(off, `https://api.test${p}`);
    assert.equal(again.terms, uncached.terms, `${p} against a Worker with the cache switched off`);
    assert.equal(again.body, uncached.body, p);
  }
});

test('another query is another quote; the same path without the query is a third', async () => {
  const a = await get(on, 'https://api.test/time?zone=UTC');
  const b = await get(on, 'https://api.test/time?zone=Europe%2FLisbon');
  await settle();
  const a2 = await get(on, 'https://api.test/time?zone=UTC');
  const bare = await get(on, 'https://api.test/time');
  assert.equal(a2.cache, 'hit');
  assert.equal(a2.terms, a.terms);
  assert.notEqual(a.terms, b.terms);
  assert.equal(bare.cache, null);
  assert.match(Buffer.from(a2.terms, 'base64').toString('utf8'), /zone=UTC/);
});

test('a payment is never answered from the cache: it reaches the facilitator', async () => {
  const url = 'https://api.test/hash?text=abc';
  const quote = await get(on, url);
  await settle();
  assert.equal((await get(on, url)).cache, 'hit');
  const terms = JSON.parse(Buffer.from(quote.terms, 'base64').toString('utf8'));
  const payload = Buffer.from(JSON.stringify({ x402Version: 2, resource: terms.resource, accepted: terms.accepts[0], payload: { signature: '0x' + '11'.repeat(65), authorization: { from: '0x' + '22'.repeat(20), to: terms.accepts[0].payTo, value: terms.accepts[0].amount, validAfter: '0', validBefore: '9999999999', nonce: '0x' + '33'.repeat(32) } } })).toString('base64');
  const before = verifies;
  const paid = await get(on, url, { ...bot, 'payment-signature': payload });
  assert.equal(paid.cache, null);
  assert.equal(verifies, before + 1, 'the payment was sent to verification');
});

test('never from the cache: a browser, a free-call request, a key, an x402 v1 payment header', async () => {
  const url = 'https://api.test/uuid';
  await get(on, url);
  await settle();
  assert.equal((await get(on, url)).cache, 'hit');
  const browser = await get(on, url, { accept: 'text/html,application/xhtml+xml', 'user-agent': 'Mozilla/5.0 (Windows NT 10.0) Chrome/130.0' });
  assert.equal(browser.cache, null);
  assert.match(browser.headers.get('content-type'), /text\/html/);
  const trial = await get(on, `${url}?trial=1`, { ...bot, 'cf-connecting-ip': '198.51.100.90' });
  assert.equal(trial.status, 200, 'the free call runs the tool');
  assert.equal(trial.cache, null);
  assert.equal((await get(on, url, { ...bot, authorization: 'Bearer adt_not_a_real_key_000000000000' })).cache, null);
  assert.equal((await get(on, url, { ...bot, 'x-payment': 'not-a-payment' })).cache, null);
});

test('HEAD probes still answer 402 with the terms, and the off switch disables the cache', async () => {
  const head = await get(on, 'https://api.test/ping', bot, 'HEAD');
  assert.equal(head.status, 402);
  assert.ok(head.terms);
  await get(off, 'https://api.test/ping');
  await settle();
  assert.equal((await get(off, 'https://api.test/ping')).cache, null);
});
