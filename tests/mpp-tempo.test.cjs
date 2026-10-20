const assert = require('node:assert/strict');
const { before, after, test } = require('node:test');
const { build } = require('esbuild');
const { Miniflare, convertV4MiniflareOptions } = require('miniflare');

// Per-call MPP on Tempo with the Worker in Miniflare and the Tempo RPC mocked on both sides: no network,
// no real wallet, no real transaction. The buyer key is generated per run and never funded anywhere.
const TEMPO_PAY_TO = '0x00000000000000000000000000000000000a11ce';
const USDC_E = '0x20c000000000000000000000b9537d11c60e8b50';
let mf, mfOff, viem, tempoViem, chains, accounts;
const rpcCalls = [];
const broadcasts = [];
const mined = new Map();

async function rpc(body) {
  const one = async ({ id, method, params }) => {
    rpcCalls.push(method);
    const ok = (result) => ({ jsonrpc: '2.0', id, result });
    switch (method) {
      case 'eth_chainId': return ok('0x1079');
      case 'eth_call': return ok('0x'); // the pre-broadcast simulation succeeds
      case 'eth_sendRawTransactionSync': {
        const raw = params[0];
        const tx = tempoViem.Transaction.deserialize(raw);
        const hash = viem.keccak256(await tempoViem.Transaction.serialize(tx));
        broadcasts.push(hash);
        const logs = tx.calls.map((call, i) => {
          const { args } = viem.decodeFunctionData({ abi: tempoViem.Abis.tip20, data: call.data });
          const [to, amount, memo] = args;
          return {
            address: call.to, blockHash: '0x' + '1'.repeat(64), blockNumber: '0x10', logIndex: viem.toHex(i), transactionHash: hash, transactionIndex: '0x0', removed: false,
            topics: viem.encodeEventTopics({ abi: tempoViem.Abis.tip20, eventName: 'TransferWithMemo', args: { from: tx.from, to, memo } }),
            data: viem.encodeAbiParameters([{ type: 'uint256' }], [amount]),
          };
        });
        const receipt = {
          transactionHash: hash, blockHash: '0x' + '1'.repeat(64), blockNumber: '0x10', transactionIndex: '0x0', from: tx.from, to: tx.calls[0].to,
          status: '0x1', cumulativeGasUsed: '0x5208', gasUsed: '0x5208', effectiveGasPrice: '0x1', logs, logsBloom: '0x' + '0'.repeat(512), type: '0x76', contractAddress: null,
        };
        mined.set(hash, receipt);
        return ok(receipt);
      }
      case 'eth_getTransactionReceipt': return ok(mined.get(params[0]) ?? null);
      default: return { jsonrpc: '2.0', id, error: { code: -32601, message: `fixture has no ${method}` } };
    }
  };
  return Array.isArray(body) ? Promise.all(body.map(one)) : one(body);
}

async function worker(bindings) {
  const b = await build({ entryPoints: ['src/index.ts'], bundle: true, format: 'esm', platform: 'browser', write: false, external: ['cloudflare:workers', 'node:*'],
    plugins: [{ name: 'url', setup(b) { b.onResolve({ filter: /^url$/ }, () => ({ path: 'node:url', external: true })); } }] });
  return new Miniflare(convertV4MiniflareOptions({ modules: true, script: b.outputFiles[0].text, compatibilityDate: '2026-09-01', compatibilityFlags: ['nodejs_compat'],
    durableObjects: { METRICS: { className: 'Metrics', useSQLite: true } },
    bindings: { PAY_TO: '0x2074c40346ae2a90e0e4a391bcee6f16bf5277f5', NETWORK: 'eip155:8453', PAYWALL: 'on', TRIALS_ENABLED: 'off', FACILITATOR_URL: 'https://fixture.invalid', BASE_RPC_URL: 'https://fixture.invalid', ...bindings },
    outboundService: async (r) => {
      if (new URL(r.url).hostname === 'rpc.tempo.xyz') return Response.json(await rpc(await r.json()));
      // The x402 facilitator's supported kinds, read when the x402 paywall starts; nothing settles over x402 here.
      if (new URL(r.url).hostname === 'fixture.invalid') return Response.json({ kinds: [{ x402Version: 2, scheme: 'exact', network: 'eip155:8453', extra: { name: 'USD Coin', version: '2' } }], extensions: [] });
      return new Response('unexpected outbound request', { status: 599 });
    } }));
}

/** An mppx buyer with a throwaway key; its own RPC calls (nonce, fees, gas) are answered locally. */
async function buyer(target) {
  const { Mppx, tempo } = await import('mppx/client');
  const account = accounts.privateKeyToAccount(accounts.generatePrivateKey());
  const transport = viem.custom({ request: async ({ method }) => {
    switch (method) {
      case 'eth_chainId': return '0x1079';
      case 'eth_getTransactionCount': return '0x0';
      case 'eth_getBlockByNumber': return { number: '0x10', baseFeePerGas: '0x1', timestamp: viem.toHex(Math.floor(Date.now() / 1000)), hash: '0x' + '1'.repeat(64), transactions: [] };
      case 'eth_maxPriorityFeePerGas': return '0x1';
      case 'eth_gasPrice': return '0x2';
      case 'eth_estimateGas': return '0x30000';
      case 'eth_call': return '0x' + '0'.repeat(64);
      default: throw new Error(`buyer fixture has no ${method}`);
    }
  } });
  const client = Mppx.create({
    polyfill: false,
    fetch: (u, i) => target.dispatchFetch(u, i),
    methods: [tempo.charge({ account, mode: 'pull', getClient: () => viem.createClient({ chain: chains.tempo, transport }) })],
  });
  return { client, address: account.address.toLowerCase() };
}

before(async () => {
  viem = await import('viem');
  tempoViem = await import('viem/tempo');
  chains = await import('viem/tempo/chains');
  accounts = await import('viem/accounts');
  mf = await worker({ TEMPO_PAY_TO, MPP_SECRET_KEY: 'mpp-test-secret-fixture' });
  mfOff = await worker({});
});
after(async () => { await mf?.dispose(); await mfOff?.dispose(); });

test('per-call MPP stays off without TEMPO_PAY_TO: no challenge, no OpenAPI entry, credentials not read', async () => {
  const quote = await mfOff.dispatchFetch('https://api.test/time?zone=Europe/Stockholm');
  assert.equal(quote.status, 402);
  assert.ok(quote.headers.get('payment-required'));
  assert.doesNotMatch(quote.headers.get('www-authenticate') ?? '', /Payment/);
  await quote.arrayBuffer();
  const api = await (await mfOff.dispatchFetch('https://api.test/openapi.json')).json();
  assert.deepEqual(api.paths['/time'].get['x-payment-info'].protocols, [{ x402: {} }]);
  const before = rpcCalls.length;
  const sent = await mfOff.dispatchFetch('https://api.test/time?zone=Europe/Stockholm', { headers: { authorization: 'Payment eyJmYWtlIjp0cnVlfQ' } });
  assert.equal(sent.status, 402);
  await sent.arrayBuffer();
  assert.equal(rpcCalls.length, before);
});

test('each tool offers tempo/charge next to x402, with recipient, expiry and pull mode, and OpenAPI declares both', async () => {
  const quote = await mf.dispatchFetch('https://api.test/time?zone=Europe/Stockholm');
  assert.equal(quote.status, 402);
  assert.ok(quote.headers.get('payment-required'), 'x402 v2 terms stay');
  const body = await quote.json();
  assert.equal(body.x402Version, 1, 'x402 v1 body stays');
  const { Challenge } = await import('mppx');
  const challenge = Challenge.fromResponseList(new Response(null, { status: 402, headers: quote.headers })).find((ch) => ch.method === 'tempo');
  assert.ok(challenge, 'a tempo challenge is offered next to the evm one');
  assert.equal(challenge.intent, 'charge');
  assert.equal(challenge.realm, 'api.test');
  assert.ok(challenge.id && challenge.expires);
  assert.equal(challenge.request.amount, '3000');
  assert.equal(challenge.request.currency.toLowerCase(), USDC_E);
  assert.equal(challenge.request.recipient.toLowerCase(), TEMPO_PAY_TO);
  assert.equal(challenge.request.methodDetails.chainId, 4217);
  assert.deepEqual(challenge.request.methodDetails.supportedModes, ['pull']);
  assert.equal(challenge.request.methodDetails.feePayer, undefined, 'the server sponsors no fees');
  const api = await (await mf.dispatchFetch('https://api.test/openapi.json')).json();
  // evm/charge (lib/mpp-evm.ts) is on by default in this fixture too (PAY_TO, Base, MPP_SECRET_KEY): both are declared.
  assert.deepEqual(api.paths['/time'].get['x-payment-info'].protocols, [{ x402: {} }, { mpp: { method: 'tempo', intent: 'charge', currency: USDC_E } }, { mpp: { method: 'evm', intent: 'charge', currency: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913' } }]);
  // Clients that read only the first challenge (AgentCash bundles mppx 0.8, which pays only on Tempo) get Tempo.
  assert.equal(Challenge.fromResponseList(new Response(null, { status: 402, headers: quote.headers }))[0].method, 'tempo');
  assert.equal(/method="(\w+)"/.exec(quote.headers.get('www-authenticate') ?? '')?.[1], 'tempo', 'the first challenge in the header is tempo');
  // HEAD probes see the same offer.
  const head = await mf.dispatchFetch('https://api.test/time?zone=Europe/Stockholm', { method: 'HEAD' });
  assert.equal(head.status, 402);
  assert.match(head.headers.get('www-authenticate') ?? '', /method="tempo"/);
});

test('an MPP agent pays one call on Tempo: broadcast after success, receipt header, ledger and revenue', async () => {
  const { client, address } = await buyer(mf);
  const sent = broadcasts.length;
  const paid = await client.fetch('https://api.test/time?zone=Europe/Stockholm');
  assert.equal(paid.status, 200);
  const result = await paid.json();
  assert.equal(result.zone, 'Europe/Stockholm');
  assert.equal(broadcasts.length, sent + 1);
  const { Receipt } = await import('mppx');
  const receipt = Receipt.fromResponse(paid);
  assert.equal(receipt.status, 'success');
  assert.equal(receipt.method, 'tempo');
  assert.equal(receipt.reference, broadcasts.at(-1));
  await new Promise((r) => setTimeout(r, 200)); // the ledger write runs in waitUntil
  const revenue = await (await mf.dispatchFetch('https://api.test/revenue')).json();
  assert.equal(revenue.byEndpoint['/time'].settlements, 1);
  assert.equal(revenue.byEndpoint['/time'].grossAtomic, '3000');
  assert.equal(revenue.payerActivity.distinctExternalWallets, 1);
  const metrics = await (await mf.dispatchFetch('https://api.test/metrics')).json();
  const today = Object.values(metrics)[0];
  assert.equal(today['/time'].paid, 1);
  assert.equal(today['/time'].revenueUsdMicros, 3000);
  assert.ok(address);
});

test('a failed call is never broadcast, and a credential works once, for its own route only', async () => {
  const { Challenge, Credential } = await import('mppx');
  const { tempo } = await import('mppx/client');
  const account = accounts.privateKeyToAccount(accounts.generatePrivateKey());
  const transport = viem.custom({ request: async ({ method }) => ({ eth_chainId: '0x1079', eth_getTransactionCount: '0x0', eth_maxPriorityFeePerGas: '0x1', eth_gasPrice: '0x2', eth_estimateGas: '0x30000', eth_call: '0x' + '0'.repeat(64),
    eth_getBlockByNumber: { number: '0x10', baseFeePerGas: '0x1', timestamp: viem.toHex(Math.floor(Date.now() / 1000)), hash: '0x' + '1'.repeat(64), transactions: [] } })[method] });
  const method = tempo.charge({ account, mode: 'pull', getClient: () => viem.createClient({ chain: chains.tempo, transport }) });
  const credentialFor = async (url) => {
    const quote = await mf.dispatchFetch(url);
    await quote.arrayBuffer();
    return method.createCredential({ challenge: Challenge.fromResponseList(new Response(null, { status: 402, headers: quote.headers })).find((ch) => ch.method === 'tempo'), context: {} });
  };

  // Invalid input: the tool answers 400 and the signed transfer is never sent.
  const sent = broadcasts.length;
  const bad = await credentialFor('https://api.test/time?zone=Not/AZone');
  const failed = await mf.dispatchFetch('https://api.test/time?zone=Not/AZone', { headers: { authorization: bad } });
  assert.equal(failed.status, 400);
  assert.equal(failed.headers.get('payment-receipt'), null);
  await failed.arrayBuffer();
  assert.equal(broadcasts.length, sent);

  // Another tool at a different price refuses a credential issued for /time.
  const other = await mf.dispatchFetch('https://api.test/domain?domain=example.com', { headers: { authorization: bad } });
  assert.equal(other.status, 402);
  assert.match((await other.json()).error, /payment invalid/);
  assert.equal(broadcasts.length, sent);

  // The same credential pays once; a replay is refused before the tool runs, although the transaction is mined
  // and a re-broadcast would recover its receipt.
  const good = await credentialFor('https://api.test/time?zone=Europe/Stockholm');
  assert.equal(Credential.deserialize(good).payload.type, 'transaction', 'pull mode: the buyer signs, the server broadcasts');
  const first = await mf.dispatchFetch('https://api.test/time?zone=Europe/Stockholm', { headers: { authorization: good } });
  assert.equal(first.status, 200);
  await first.arrayBuffer();
  assert.equal(broadcasts.length, sent + 1);
  const replay = await mf.dispatchFetch('https://api.test/time?zone=Europe/Stockholm', { headers: { authorization: good } });
  assert.equal(replay.status, 402);
  assert.match((await replay.json()).error, /already used/);
  assert.match(replay.headers.get('www-authenticate') ?? '', /method="tempo"/, 'a fresh challenge comes with the refusal');
  assert.equal(broadcasts.length, sent + 1);
  await new Promise((r) => setTimeout(r, 200));
  const revenue = await (await mf.dispatchFetch('https://api.test/revenue')).json();
  assert.equal(revenue.byEndpoint['/time'].settlements, 2, 'one more settlement, not two');
});

test('credit packs: recipient in the Stripe challenge, GET only', async () => {
  const on = await worker({ STRIPE_MPP_KEY: 'rk_test_mpp_fixture', STRIPE_PROFILE_ID: 'profile_test_fixture' });
  try {
    const r = await on.dispatchFetch('https://api.test/credits/buy/5');
    assert.equal(r.status, 402);
    await r.arrayBuffer();
    const { Challenge } = await import('mppx');
    assert.equal(Challenge.fromResponse(r).request.recipient, 'profile_test_fixture');
    for (const method of ['POST', 'HEAD']) {
      const refused = await on.dispatchFetch('https://api.test/credits/buy/5', { method });
      assert.equal(refused.status, 405, method);
      assert.equal(refused.headers.get('allow'), 'GET');
      await refused.arrayBuffer();
    }
  } finally { await on.dispose(); }
});
