const assert = require('node:assert/strict');
const { before, after, test } = require('node:test');
const { build } = require('esbuild');
const { Miniflare, convertV4MiniflareOptions } = require('miniflare');

// Per-call MPP with USDC on Base (method evm, intent charge) with the Worker in Miniflare and the x402 facilitator
// mocked: no network, no real wallet, no real transaction. The buyer key is generated per run and never funded.
const PAY_TO = '0x2074c40346ae2a90e0e4a391bcee6f16bf5277f5';
const BASE_USDC = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
let mf, mfOff, accounts;
const facilitatorCalls = []; // { path, body }
let settlements = 0;

/** The x402 facilitator as the Worker sees it: supported kinds, verify and settle. */
async function facilitator(r) {
  const path = new URL(r.url).pathname;
  const body = r.method === 'POST' ? await r.json() : undefined;
  facilitatorCalls.push({ path, body });
  if (path.endsWith('/supported')) return Response.json({ kinds: [{ x402Version: 2, scheme: 'exact', network: 'eip155:8453', extra: { name: 'USD Coin', version: '2' } }], extensions: [] });
  const auth = body?.paymentPayload?.payload?.authorization ?? {};
  if (path.endsWith('/verify')) {
    if (String(auth.nonce).endsWith('eeee')) return Response.json({ isValid: false, invalidReason: 'insufficient_funds', payer: auth.from });
    return Response.json({ isValid: true, payer: auth.from });
  }
  if (path.endsWith('/settle')) {
    settlements++;
    return Response.json({ success: true, transaction: '0x' + settlements.toString(16).padStart(64, 'a'), network: body.paymentRequirements.network, payer: auth.from });
  }
  return new Response('unexpected facilitator path', { status: 599 });
}

async function worker(bindings) {
  const b = await build({ entryPoints: ['src/index.ts'], bundle: true, format: 'esm', platform: 'browser', write: false, external: ['cloudflare:workers', 'node:*'],
    plugins: [{ name: 'url', setup(b) { b.onResolve({ filter: /^url$/ }, () => ({ path: 'node:url', external: true })); } }] });
  return new Miniflare(convertV4MiniflareOptions({ modules: true, script: b.outputFiles[0].text, compatibilityDate: '2026-09-01', compatibilityFlags: ['nodejs_compat'],
    durableObjects: { METRICS: { className: 'Metrics', useSQLite: true } },
    bindings: { PAY_TO, NETWORK: 'eip155:8453', PAYWALL: 'on', TRIALS_ENABLED: 'off', FACILITATOR_URL: 'https://fixture.invalid', BASE_RPC_URL: 'https://rpc.invalid', ...bindings },
    outboundService: async (r) => {
      if (new URL(r.url).hostname === 'fixture.invalid') return facilitator(r);
      return new Response('unexpected outbound request', { status: 599 });
    } }));
}

/** An mppx buyer with a throwaway key: it signs EIP-3009 authorizations locally and needs no RPC. */
async function buyer(target, options = {}) {
  const { Mppx, evm } = await import('mppx/client');
  const account = accounts.privateKeyToAccount(accounts.generatePrivateKey());
  const client = Mppx.create({
    polyfill: false,
    fetch: (u, i) => target.dispatchFetch(u, i),
    methods: [evm.charge({ account, currencies: [evm.assets.base.USDC], networks: [8453], ...options })],
  });
  return { client, account, address: account.address.toLowerCase() };
}

before(async () => {
  accounts = await import('viem/accounts');
  mf = await worker({ MPP_SECRET_KEY: 'mpp-test-secret-fixture' });
  mfOff = await worker({ MPP_SECRET_KEY: 'mpp-test-secret-fixture', MPP_EVM: 'off' });
});
after(async () => { await mf?.dispose(); await mfOff?.dispose(); });

test('MPP_EVM=off: no challenge, no OpenAPI entry, credentials not read', async () => {
  const quote = await mfOff.dispatchFetch('https://api.test/time?zone=Europe/Stockholm');
  assert.equal(quote.status, 402);
  assert.ok(quote.headers.get('payment-required'));
  assert.doesNotMatch(quote.headers.get('www-authenticate') ?? '', /Payment/);
  await quote.arrayBuffer();
  const api = await (await mfOff.dispatchFetch('https://api.test/openapi.json')).json();
  assert.deepEqual(api.paths['/time'].get['x-payment-info'].protocols, [{ x402: {} }]);
  const before = facilitatorCalls.length;
  const sent = await mfOff.dispatchFetch('https://api.test/time?zone=Europe/Stockholm', { headers: { authorization: 'Payment eyJmYWtlIjp0cnVlfQ' } });
  assert.equal(sent.status, 402);
  await sent.arrayBuffer();
  assert.equal(facilitatorCalls.filter((c) => c.path.endsWith('/verify') || c.path.endsWith('/settle')).length, 0);
  assert.ok(facilitatorCalls.length >= before);
});

test('each tool offers evm/charge next to x402 by default: USDC on Base to PAY_TO, and OpenAPI declares both', async () => {
  const quote = await mf.dispatchFetch('https://api.test/time?zone=Europe/Stockholm');
  assert.equal(quote.status, 402);
  assert.ok(quote.headers.get('payment-required'), 'x402 v2 terms stay');
  const body = await quote.json();
  assert.equal(body.x402Version, 1, 'x402 v1 body stays');
  const { Challenge } = await import('mppx');
  const challenges = Challenge.fromResponseList(new Response(null, { status: 402, headers: quote.headers }));
  const challenge = challenges.find((ch) => ch.method === 'evm');
  assert.ok(challenge, 'an evm challenge is offered');
  assert.equal(challenge.intent, 'charge');
  assert.equal(challenge.realm, 'api.test');
  assert.ok(challenge.id && challenge.expires);
  assert.equal(challenge.request.amount, '3000');
  assert.equal(challenge.request.currency.toLowerCase(), BASE_USDC);
  assert.equal(challenge.request.recipient.toLowerCase(), PAY_TO);
  assert.equal(challenge.request.methodDetails.chainId, 8453);
  assert.deepEqual(challenge.request.methodDetails.credentialTypes, ['authorization']);
  const api = await (await mf.dispatchFetch('https://api.test/openapi.json')).json();
  assert.deepEqual(api.paths['/time'].get['x-payment-info'].protocols, [{ x402: {} }, { mpp: { method: 'evm', intent: 'charge', currency: BASE_USDC } }]);
  const head = await mf.dispatchFetch('https://api.test/time?zone=Europe/Stockholm', { method: 'HEAD' });
  assert.equal(head.status, 402);
  assert.match(head.headers.get('www-authenticate') ?? '', /method="evm"/);
});

test('an MPP agent pays one call with USDC on Base: verify, run, settle after success, receipt, ledger, Bazaar metadata', async () => {
  const { client, address } = await buyer(mf);
  const settled = settlements;
  const paid = await client.fetch('https://api.test/time?zone=Europe/Stockholm');
  assert.equal(paid.status, 200);
  const result = await paid.json();
  assert.equal(result.zone, 'Europe/Stockholm');
  assert.equal(settlements, settled + 1);
  const { Receipt } = await import('mppx');
  const receipt = Receipt.fromResponse(paid);
  assert.equal(receipt.status, 'success');
  assert.equal(receipt.method, 'evm');
  assert.match(receipt.reference, /^0xa+1$/, 'the facilitator transaction hash is the receipt reference');
  // The facilitator saw an ordinary x402 v2 exact payment, plus the resource and its Bazaar discovery metadata.
  const verify = facilitatorCalls.findLast((c) => c.path.endsWith('/verify'));
  const settle = facilitatorCalls.findLast((c) => c.path.endsWith('/settle'));
  for (const call of [verify, settle]) {
    assert.equal(call.body.x402Version, 2);
    assert.deepEqual(call.body.paymentRequirements, { scheme: 'exact', network: 'eip155:8453', amount: '3000', asset: BASE_USDC, payTo: PAY_TO, maxTimeoutSeconds: 300, extra: { name: 'USD Coin', version: '2' } });
    assert.equal(call.body.paymentPayload.payload.authorization.from.toLowerCase(), address);
    assert.equal(call.body.paymentPayload.payload.authorization.value, '3000');
    assert.match(call.body.paymentPayload.payload.signature, /^0x[0-9a-f]{130}$/);
  }
  assert.equal(settle.body.paymentPayload.resource.url, 'https://api.test/time');
  assert.equal(settle.body.paymentPayload.extensions.bazaar.info.input.queryParams.zone, 'Europe/Stockholm');
  assert.ok(settle.body.paymentPayload.extensions.bazaar.info.output.example.zone);
  assert.deepEqual(settle.body.paymentPayload.extensions['builder-code'].info, { a: 'bc_09e30bdm' }, 'the settlement carries our Base Builder Code');
  await new Promise((r) => setTimeout(r, 200)); // the ledger write runs in waitUntil
  const revenue = await (await mf.dispatchFetch('https://api.test/revenue')).json();
  assert.equal(revenue.byEndpoint['/time'].settlements, 1);
  assert.equal(revenue.byEndpoint['/time'].grossAtomic, '3000');
  assert.equal(revenue.payerActivity.distinctExternalWallets, 1);
  const metrics = await (await mf.dispatchFetch('https://api.test/metrics')).json();
  const today = Object.values(metrics)[0];
  assert.equal(today['/time'].paid, 1);
  assert.equal(today['/time'].revenueUsdMicros, 3000);
});

test('a failed call is never settled, a rejected verification never runs the tool, and a credential works once', async () => {
  const { Challenge } = await import('mppx');
  const { evm } = await import('mppx/client');
  const account = accounts.privateKeyToAccount(accounts.generatePrivateKey());
  const method = evm.charge({ account, currencies: [evm.assets.base.USDC], networks: [8453] });
  const credentialFor = async (url) => {
    const quote = await mf.dispatchFetch(url);
    await quote.arrayBuffer();
    return method.createCredential({ challenge: Challenge.fromResponseList(new Response(null, { status: 402, headers: quote.headers })).find((ch) => ch.method === 'evm'), context: {} });
  };

  // Invalid input: the tool answers 400 after verification and the authorization is never settled.
  const settled = settlements;
  const bad = await credentialFor('https://api.test/time?zone=Not/AZone');
  const failed = await mf.dispatchFetch('https://api.test/time?zone=Not/AZone', { headers: { authorization: bad } });
  assert.equal(failed.status, 400);
  assert.equal(failed.headers.get('payment-receipt'), null);
  await failed.arrayBuffer();
  assert.equal(settlements, settled);

  // Another tool at a different price refuses a credential issued for /time, before the facilitator is asked.
  const verifies = facilitatorCalls.filter((c) => c.path.endsWith('/verify')).length;
  const other = await mf.dispatchFetch('https://api.test/domain?domain=example.com', { headers: { authorization: bad } });
  assert.equal(other.status, 402);
  assert.match((await other.json()).error, /payment invalid/);
  assert.equal(facilitatorCalls.filter((c) => c.path.endsWith('/verify')).length, verifies);
  assert.equal(settlements, settled);

  // The same credential pays once; a replay is refused before the tool runs and before the facilitator is asked.
  const good = await credentialFor('https://api.test/time?zone=Europe/Stockholm');
  const first = await mf.dispatchFetch('https://api.test/time?zone=Europe/Stockholm', { headers: { authorization: good } });
  assert.equal(first.status, 200);
  await first.arrayBuffer();
  assert.equal(settlements, settled + 1);
  const verifiesAfterFirst = facilitatorCalls.filter((c) => c.path.endsWith('/verify')).length;
  const replay = await mf.dispatchFetch('https://api.test/time?zone=Europe/Stockholm', { headers: { authorization: good } });
  assert.equal(replay.status, 402);
  assert.match((await replay.json()).error, /already used/);
  assert.match(replay.headers.get('www-authenticate') ?? '', /method="evm"/, 'a fresh challenge comes with the refusal');
  assert.equal(facilitatorCalls.filter((c) => c.path.endsWith('/verify')).length, verifiesAfterFirst);
  assert.equal(settlements, settled + 1);
  await new Promise((r) => setTimeout(r, 200));
  const revenue = await (await mf.dispatchFetch('https://api.test/revenue')).json();
  assert.equal(revenue.byEndpoint['/time'].settlements, 2, 'one more settlement, not two');
});

test('the facilitator rejecting the authorization (no funds) means a 402 with the reason, no tool run, no settlement', async () => {
  // The fixture facilitator refuses any authorization whose nonce ends in "eeee"; the nonce is the challenge hash,
  // so we sign our own payload with such a nonce instead of going through the mppx client.
  const { Challenge, Credential } = await import('mppx');
  const viem = await import('viem');
  const account = accounts.privateKeyToAccount(accounts.generatePrivateKey());
  const quote = await mf.dispatchFetch('https://api.test/time?zone=Europe/Stockholm');
  await quote.arrayBuffer();
  const challenge = Challenge.fromResponseList(new Response(null, { status: 402, headers: quote.headers })).find((ch) => ch.method === 'evm');
  // A wrong nonce fails mppx's own challenge-hash check first, which is a refusal without a facilitator call.
  const nonce = '0x' + 'e'.repeat(64);
  const validBefore = String(Math.floor(Date.now() / 1000) + 300);
  const message = { from: account.address, to: viem.getAddress(challenge.request.recipient), value: BigInt(challenge.request.amount), validAfter: 0n, validBefore: BigInt(validBefore), nonce };
  const signature = await account.signTypedData({
    domain: { name: 'USD Coin', version: '2', chainId: 8453, verifyingContract: viem.getAddress(challenge.request.currency) },
    types: { TransferWithAuthorization: [{ name: 'from', type: 'address' }, { name: 'to', type: 'address' }, { name: 'value', type: 'uint256' }, { name: 'validAfter', type: 'uint256' }, { name: 'validBefore', type: 'uint256' }, { name: 'nonce', type: 'bytes32' }] },
    primaryType: 'TransferWithAuthorization', message,
  });
  const credential = Credential.serialize(Credential.from({ challenge, payload: { type: 'authorization', from: account.address, to: message.to, value: challenge.request.amount, validAfter: '0', validBefore, nonce, signature } }));
  const settled = settlements;
  const verifies = facilitatorCalls.filter((c) => c.path.endsWith('/verify')).length;
  const refused = await mf.dispatchFetch('https://api.test/time?zone=Europe/Stockholm', { headers: { authorization: credential } });
  assert.equal(refused.status, 402);
  assert.match((await refused.json()).error, /challenge hash mismatch/);
  assert.equal(facilitatorCalls.filter((c) => c.path.endsWith('/verify')).length, verifies, 'refused before the facilitator');
  assert.equal(settlements, settled);
});
