// Prepaid credits bought with USDC over x402 (lib/usdc-credits.ts): quote, purchase, the key pays tools, top-up of an
// existing key, and the rule that nothing is granted unless the payment settled.
const assert = require('node:assert/strict');
const { before, after, test } = require('node:test');
const { build } = require('esbuild');
const { Miniflare, convertV4MiniflareOptions } = require('miniflare');

let mf;
const recipient = '0x2074c40346ae2a90e0e4a391bcee6f16bf5277f5', asset = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', payer = '0x' + '1'.repeat(40);

before(async () => {
  // The facilitator fixture: verification fails for a nonce ending eeee, settlement for one ending ffff; the settlement
  // transaction is the nonce, so every purchase has its own transaction like on chain.
  const b = await build({ entryPoints: ['src/index.ts'], bundle: true, format: 'esm', platform: 'browser', write: false, external: ['cloudflare:workers', 'node:*'], plugins: [{ name: 'fixture-facilitator', setup(b) {
    b.onResolve({ filter: /^url$/ }, () => ({ path: 'node:url', external: true }));
    b.onResolve({ filter: /^\.\/facilitator$/ }, () => ({ path: 'fixture', namespace: 'fixture' }));
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ loader: 'js', contents: `export function buildFacilitator(){return {
      getSupported:async()=>({kinds:[{x402Version:2,scheme:'exact',network:'eip155:8453',extra:{name:'USD Coin',version:'2',asset:'${asset}',assetTransferMethod:'eip3009'}}],extensions:[]}),
      verify:async p=>({isValid:!p.payload.authorization.nonce.endsWith('eeee'),payer:'${payer}',invalidReason:'fixture-invalid'}),
      settle:async (p,r)=>({success:!p.payload.authorization.nonce.endsWith('ffff'),network:'eip155:8453',transaction:p.payload.authorization.nonce,payer:'${payer}',amount:r.amount,errorReason:'fixture-failure'})
    }}` }));
  } }] });
  mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: b.outputFiles[0].text, compatibilityDate: '2026-09-01', compatibilityFlags: ['nodejs_compat'], durableObjects: { METRICS: { className: 'Metrics', useSQLite: true } }, kvNamespaces: ['TRIALS'], bindings: { PAY_TO: recipient, NETWORK: 'eip155:8453', PAYWALL: 'on', TRIALS_ENABLED: 'off', FACILITATOR_URL: 'https://fixture.invalid', BASE_RPC_URL: 'https://fixture.invalid' }, outboundService: async () => new Response('no network in this test', { status: 500 }) }));
});
after(async () => { await mf?.dispose(); });

const get = (path, headers = {}) => mf.dispatchFetch('https://api.test' + path, { headers: { accept: 'application/json', ...headers } });
const terms = (res) => JSON.parse(Buffer.from(res.headers.get('PAYMENT-REQUIRED'), 'base64')).accepts[0];
const signed = (requirements, nonce, path) => ({ 'PAYMENT-SIGNATURE': Buffer.from(JSON.stringify({ x402Version: 2, resource: { url: 'https://api.test' + path }, accepted: requirements,
  payload: { signature: '0x' + 'a'.repeat(130), authorization: { from: payer, to: recipient, value: requirements.amount, validAfter: '0', validBefore: String(Math.floor(Date.now() / 1000) + 300), nonce: '0x' + nonce } } })).toString('base64') });
const balance = async (key) => (await get('/credits/balance', { authorization: `Bearer ${key}` })).json();
const revenue = async () => (await get('/revenue')).json();

test('a wallet prepays with one x402 payment, gets a key, and the key pays tools', async () => {
  const quote = await get('/credits/usdc/5');
  assert.equal(quote.status, 402);
  const requirements = terms(quote);
  assert.equal(requirements.amount, '5000000');
  assert.equal(requirements.payTo.toLowerCase(), recipient);
  const offer = await quote.json();
  assert.equal(offer.price, '$5'); assert.equal(offer.credits, 5000);
  assert.match(offer.pay, /PAYMENT-REQUIRED/); assert.ok(offer.what.length <= 500, 'the listing description fits the Bazaar limit');
  assert.deepEqual(offer.otherPacks.map((p) => p.price), ['$1', '$20']);

  const bought = await get('/credits/usdc/5', signed(requirements, '5'.repeat(64), '/credits/usdc/5'));
  assert.equal(bought.status, 200);
  assert.ok(bought.headers.has('PAYMENT-RESPONSE'));
  assert.match(bought.headers.get('cache-control'), /no-store/);
  const purchase = await bought.json();
  assert.match(purchase.apiKey, /^adt_[A-Za-z0-9_-]{32,64}$/);
  assert.equal(purchase.creditsAdded, 5000); assert.equal(purchase.balanceCredits, 5000); assert.equal(purchase.toppedUp, false);
  assert.equal(purchase.paid.transaction, '0x' + '5'.repeat(64));
  assert.equal(purchase.mcpUrl, `https://api.test/mcp/k/${purchase.apiKey}`);
  assert.equal((await balance(purchase.apiKey)).balanceCredits, 5000);

  // The key pays a tool with no payment on the call.
  const call = await get('/uuid?count=1', { authorization: `Bearer ${purchase.apiKey}` });
  assert.equal(call.status, 200);
  const charged = Number(call.headers.get('X-Credits-Charged'));
  assert.ok(charged > 0);
  assert.equal((await call.json()).uuids.length, 1);
  assert.equal(Number(call.headers.get('X-Credits-Remaining')), 5000 - charged);

  // Top-up: the $1 pack into the same key; no new key is issued.
  const q1 = terms(await get('/credits/usdc/1'));
  assert.equal(q1.amount, '1000000');
  const top = await get('/credits/usdc/1', { ...signed(q1, '6'.repeat(64), '/credits/usdc/1'), 'x-api-key': purchase.apiKey });
  assert.equal(top.status, 200);
  const added = await top.json();
  assert.equal(added.toppedUp, true); assert.equal(added.apiKey, undefined); assert.equal(added.creditsAdded, 1000);
  assert.equal(added.balanceCredits, 6000 - charged);

  // The $20 pack carries the card pack's bonus.
  assert.equal((await (await get('/credits/usdc/20')).json()).credits, 22000);

  // Both purchases are income in the settlement ledger, under their own paths.
  const ledger = await revenue();
  assert.equal(ledger.byEndpoint['/credits/usdc/5'].grossAtomic, '5000000');
  assert.equal(ledger.byEndpoint['/credits/usdc/1'].grossAtomic, '1000000');
});

test('nothing is granted unless the payment settled, and refusals come before any payment', async () => {
  const requirements = terms(await get('/credits/usdc/5'));
  const first = await (await get('/credits/usdc/5', signed(requirements, '7'.repeat(64), '/credits/usdc/5'))).json();
  const before = (await balance(first.apiKey)).balanceCredits;
  const settlementsBefore = (await revenue()).settlements;

  // A payment that verifies and then fails to settle must not top up the key the buyer named.
  for (const suffix of ['eeee', 'ffff']) {
    const refused = await get('/credits/usdc/5', { ...signed(requirements, '8'.repeat(60) + suffix, '/credits/usdc/5'), 'x-api-key': first.apiKey });
    assert.equal(refused.status, 402, suffix);
    const body = await refused.json();
    assert.equal(body.apiKey, undefined);
    assert.match(body.error, /not accepted|payment required/);
  }
  assert.equal((await balance(first.apiKey)).balanceCredits, before);

  // An unknown key is refused before the payment is looked at.
  const unknown = await get('/credits/usdc/5', { ...signed(requirements, '9'.repeat(64), '/credits/usdc/5'), 'x-api-key': 'adt_' + 'Z'.repeat(43) });
  assert.equal(unknown.status, 401);
  assert.match((await unknown.json()).error, /unknown API key/);
  assert.equal((await revenue()).settlements, settlementsBefore);

  // Credits paid for but not written when the payment settled wait in KV and are applied, once, at the next balance check.
  const keyHash = require('node:crypto').createHash('sha256').update(first.apiKey).digest('hex');
  const kv = await mf.getKVNamespace('TRIALS');
  await kv.put(`credit-unsaved:${keyHash}:x402:eip155:8453:0xparked`, JSON.stringify({ sessionId: 'x402:eip155:8453:0xparked', credits: 1000 }));
  assert.equal((await balance(first.apiKey)).balanceCredits, before + 1000);
  assert.equal((await balance(first.apiKey)).balanceCredits, before + 1000);
  assert.equal((await kv.list({ prefix: 'credit-unsaved:' })).keys.length, 0);

  // Packs that do not exist, and methods other than GET.
  assert.equal((await get('/credits/usdc/100')).status, 404);
  assert.equal((await get('/credits/usdc/3')).status, 404);
  const post = await mf.dispatchFetch('https://api.test/credits/usdc/5', { method: 'POST' });
  assert.equal(post.status, 405); await post.arrayBuffer();
});

test('buyers are told about prepaying where they look: tool quotes, /credits, OpenAPI', async () => {
  const quote = await (await get('/uuid?count=1')).json();
  assert.match(quote.prepay, /Prepay once: GET https:\/\/api\.test\/credits\/usdc\/5 /);
  assert.match(quote.prepay, /5,000 credits/);
  const info = await (await get('/credits')).json();
  assert.deepEqual(info.usdc.packs.map((p) => [p.price, p.credits, p.buy]), [['$1', 1000, 'https://api.test/credits/usdc/1'], ['$5', 5000, 'https://api.test/credits/usdc/5'], ['$20', 22000, 'https://api.test/credits/usdc/20']]);
  const api = await (await get('/openapi.json')).json();
  for (const usd of [1, 5, 20]) {
    const op = api.paths[`/credits/usdc/${usd}`].get;
    assert.deepEqual(op['x-payment-info'].protocols, [{ x402: {} }]);
    assert.equal(op['x-payment-info'].price.amount, usd.toFixed(2));
    assert.ok(op.description.length <= 500);
  }
  assert.equal(api.paths['/credits/usdc/100'], undefined);
});
