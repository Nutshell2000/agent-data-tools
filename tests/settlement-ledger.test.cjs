const assert = require('node:assert/strict');
const Module = require('node:module');
const { before, test } = require('node:test');
const esbuild = require('esbuild');
async function load(entry, plugins = []) {
  const result = await esbuild.build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'cjs', write: false, plugins });
  const m = new Module(entry, module); m.filename = entry; m.paths = Module._nodeModulePaths(process.cwd());
  m._compile(result.outputFiles[0].text, entry); return m.exports;
}
let settlementRecord, saveSettlement, ledgerSummary;
before(async () => ({ settlementRecord, saveSettlement, ledgerSummary } = await load(require.resolve('../src/lib/settlement-ledger.ts'))));
const recipient = '0x2074c40346ae2a90e0e4a391bcee6f16bf5277f5';
const payer = '0x' + '1'.repeat(40), tx = '0x' + '2'.repeat(64), nonce = '0x' + '3'.repeat(64);
const asset = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
function context() {
  const requirements = { scheme: 'exact', network: 'eip155:8453', asset, payTo: recipient, amount: '2000', maxTimeoutSeconds: 300 };
  return { phase: 'after-handler', requirements, declaredExtensions: {},
    result: { success: true, transaction: tx, payer, network: requirements.network, amount: '2000' },
    paymentPayload: { x402Version: 2, accepted: requirements,
      resource: { url: 'https://agent-data-tools.revmesh2074.workers.dev/btc-fees' },
      payload: { signature: 'fixture-never-stored', authorization: { from: payer, to: recipient, value: '2000', nonce } } },
    transportContext: { request: { path: '/btc-fees', method: 'GET' } },
  };
}
function storageFixture(records = new Map()) {
  let pending = Promise.resolve();
  return { records, storage: {
    async list({ prefix, start }) { return new Map([...records].filter(([k]) => k.startsWith(prefix) && k >= start).sort(([a], [b]) => a.localeCompare(b))); },
    transaction(callback) {
      const next = pending.then(async () => {
        const draft = new Map([...records].map(([k, v]) => [k, structuredClone(v)]));
        const result = await callback({ get: async key => structuredClone(draft.get(key)), put: async (key, value) => draft.set(key, structuredClone(value)) });
        records.clear(); for (const [k, v] of draft) records.set(k, v); return result;
      });
      pending = next.catch(() => {}); return next;
    },
  } };
}

test('receipt amounts preserve settlement evidence rather than today\'s catalog price', async () => {
  const c = context(), record = await settlementRecord(c, recipient);
  assert.equal(record.amountAtomic, '2000'); // Current /btc-fees catalog is 200 atomic units.
  assert.equal(record.amountEvidence, 'facilitator-result');
  assert.equal(record.reconciliation, 'pending');
  delete c.result.amount;
  assert.equal((await settlementRecord(c, recipient)).amountEvidence, 'accepted-requirements');
  const serialized = JSON.stringify(record);
  assert.ok(!serialized.includes('signature')); assert.ok(!serialized.includes('fixture-never-stored'));
});

test('invalid, failed, wrong-chain and unsupported authorization receipts are not income evidence', async () => {
  const cases = [c => c.phase = 'cancel', c => c.result.success = false, c => c.result.network = 'eip155:1',
    c => c.requirements.asset = recipient, c => c.requirements.payTo = payer,
    c => c.result.transaction = 'invalid', c => c.result.amount = '-1', c => c.result.amount = '0',
    c => delete c.paymentPayload.payload.authorization, c => c.transportContext.request.path = '/unknown',
    c => c.paymentPayload.payload.authorization.from = recipient, c => c.paymentPayload.payload.authorization.value = '1'];
  for (const change of cases) { const c = context(); change(c); assert.equal(await settlementRecord(c, recipient), null); }
});

test('HTTP and MCP share payment identity; batched transactions retain separate authorizations', async () => {
  const http = context(), mcp = context();
  delete mcp.transportContext; mcp.paymentPayload.resource.url = 'mcp://tool/btc-fees';
  const first = await settlementRecord(http, recipient), same = await settlementRecord(mcp, recipient);
  assert.equal(first.id, same.id); assert.equal(same.transport, 'mcp'); assert.equal(same.path, '/btc-fees');
  mcp.paymentPayload.payload.authorization.nonce = '0x' + '4'.repeat(64);
  assert.notEqual(first.id, (await settlementRecord(mcp, recipient)).id);
});

test('concurrent and restarted receipt recording is idempotent, detects conflicts and exposes aggregates only', async () => {
  const { storage, records } = storageFixture();
  const record = await settlementRecord(context(), recipient);
  assert.deepEqual(await Promise.all([saveSettlement(storage, record), saveSettlement(storage, record)]), [true, false]);
  const restart = storageFixture(records).storage;
  assert.equal(await saveSettlement(restart, record), false);
  await assert.rejects(() => saveSettlement(restart, { ...record, amountAtomic: '200' }), /identity conflict/);
  const summary = await ledgerSummary(restart);
  assert.equal(summary.settlements, 1); assert.equal(summary.grossAtomic, '2000');
  assert.equal(summary.netIncome, null); assert.match(summary.evidence, /reconciliation pending/);
  for (const value of [payer, recipient, tx, nonce, record.id]) assert.ok(!JSON.stringify(summary).includes(value));
});

test('known self-payments are excluded even if a caller supplies a false classification', async () => {
  const { storage } = storageFixture();
  for (const address of [recipient, '0x60c51dd9c16fdad84165474279c70cc91eb7b15f', '0x279bdcc64cee279dcd2ca0e4cc45ec2d8950ae66']) {
    const c = context(); c.result.payer = address; c.paymentPayload.payload.authorization.from = address;
    const record = await settlementRecord(c, recipient);
    await saveSettlement(storage, { ...record, selfPayment: false });
  }
  const summary = await ledgerSummary(storage);
  assert.equal(summary.settlements, 0); assert.equal(summary.grossAtomic, '0'); assert.equal(summary.selfPayments, 3);
});

test('repeat wallet and payer-tool counts require settlements on different days and exclude self-payments', async () => {
  const { storage } = storageFixture();
  const record = await settlementRecord(context(), recipient);
  await saveSettlement(storage, record);
  await saveSettlement(storage, { ...record, id: 'a'.repeat(64), authorizationNonce: '0x'+'a'.repeat(64), recordedAt: new Date(Date.now()-86400000).toISOString() });
  const summary = await ledgerSummary(storage);
  assert.equal(summary.payerActivity.distinctExternalWallets, 1);
  assert.equal(summary.payerActivity.returningOnAnotherUtcDay, 1);
  assert.equal(summary.payerActivity.repeatPayerToolPairs, 1);
});

test('actual resource-server settle hook records receipts and never requests another payment after a write failure', async () => {
  const plugin = { name: 'facilitator-fixture', setup(build) {
    build.onResolve({ filter: /^\.\/facilitator$/ }, () => ({ path: 'facilitator', namespace: 'fixture' }));
    build.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'export const buildFacilitator = () => globalThis.__ledgerFacilitator;', loader: 'js' }));
  } };
  const original = global.__ledgerFacilitator, originalError = console.error;
  let settled = 0, stored = [], failWrite = false;
  global.__ledgerFacilitator = {
    getSupported: async () => ({ kinds: [{ x402Version: 2, scheme: 'exact', network: 'eip155:8453', extra: { name: 'USD Coin', version: '2', asset, assetTransferMethod: 'eip3009' } }], extensions: [] }),
    settle: async () => { settled++; return context().result; },
  };
  console.error = () => {};
  try {
    const { resourceServer } = await load(require.resolve('../src/lib/payments.ts'), [plugin]);
    const env = { NETWORK: 'eip155:8453', PAY_TO: recipient, METRICS: { idFromName: () => 'global', get: () => ({
      recordSettlement: async record => { if (failWrite) throw new Error('fixture storage outage'); stored.push(record); return true; },
    }) } };
    const server = resourceServer(env); await server.initialize(); const c = context();
    let result = await server.settlePayment(c.paymentPayload, c.requirements, {}, c.transportContext);
    assert.equal(result.success, true); assert.equal(stored.length, 1); assert.equal(stored[0].amountAtomic, '2000');
    failWrite = true;
    result = await server.settlePayment(c.paymentPayload, c.requirements, {}, c.transportContext);
    assert.equal(result.success, true); assert.equal(settled, 2); assert.equal(stored.length, 1);
  } finally { global.__ledgerFacilitator = original; console.error = originalError; }
});

test('receipts on Polygon, Arbitrum and Monad count with their own USDC; a token from another network is refused', async () => {
  const usdc = { 'eip155:137': '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359', 'eip155:42161': '0xaf88d065e77c8cc2239327c5edb3a432268e5831', 'eip155:143': '0x754704bc059f8c67012fed69bc8a327a5aafb603', 'eip155:480': '0x79a02482a880bce3f13e09da970dc34db4cd24d1' };
  const fixture = storageFixture();
  for (const [network, token] of Object.entries(usdc)) {
    const c = context(); c.requirements.network = network; c.requirements.asset = token; c.result.network = network;
    const record = await settlementRecord(c, recipient);
    assert.equal(record.network, network); assert.equal(record.asset, token);
    assert.equal(await saveSettlement(fixture.storage, record), true);
    const wrong = context(); wrong.requirements.network = network; wrong.result.network = network; // still Base USDC
    assert.equal(await settlementRecord(wrong, recipient), null, network);
  }
  const unknown = context(); unknown.requirements.network = 'eip155:1'; unknown.result.network = 'eip155:1';
  assert.equal(await settlementRecord(unknown, recipient), null);
  const base = await settlementRecord(context(), recipient);
  assert.equal(base.network, 'eip155:8453');
});

test('payment networks: Base first, then each known extra network once; unknown ones are ignored', async () => {
  const { paymentNetworks } = await load(require.resolve('../src/lib/networks.ts'));
  assert.deepEqual(paymentNetworks({ NETWORK: 'eip155:8453' }), ['eip155:8453']);
  assert.deepEqual(paymentNetworks({ NETWORK: 'eip155:8453', EXTRA_NETWORKS: 'eip155:137, eip155:42161,eip155:137,eip155:1,eip155:8453,eip155:143' }), ['eip155:8453', 'eip155:137', 'eip155:42161', 'eip155:143']);
  const { priceOn } = await load(require.resolve('../src/lib/networks.ts'));
  assert.equal(priceOn('eip155:8453', '$0.001'), '$0.001');
  assert.deepEqual(priceOn('eip155:480', '$0.001'), { asset: '0x79A02482A880bCE3F13e09Da970dC34db4CD24d1', amount: '1000', extra: { name: 'USDC', version: '2' } });
  assert.equal(priceOn('eip155:480', '$0.20').amount, '200000');
  assert.equal(priceOn('eip155:480', '$1').amount, '1000000');
});

test('Solana: offered only with a valid SOLANA_PAY_TO; receipts must match Solana USDC and our Solana address', async () => {
  const { paymentOptions, SOLANA_NETWORK, SOLANA_USDC } = await load(require.resolve('../src/lib/networks.ts'));
  const sol = '82wfSCZhCmZA7zwqqt6Q3FG8nqYBwUvbThP6M97fa9Q6';
  const base = { NETWORK: 'eip155:8453', PAY_TO: recipient };
  assert.deepEqual(paymentOptions(base).map(o => o.network), ['eip155:8453']);
  assert.deepEqual(paymentOptions({ ...base, SOLANA_PAY_TO: '0xnot-solana' }).map(o => o.network), ['eip155:8453']);
  assert.deepEqual(paymentOptions({ ...base, SOLANA_PAY_TO: sol }).at(-1), { network: SOLANA_NETWORK, payTo: sol });

  const signature = '5'.repeat(88), payerSol = '7'.repeat(44);
  const c = context();
  c.requirements = { ...c.requirements, network: SOLANA_NETWORK, asset: SOLANA_USDC, payTo: sol, amount: '1000' };
  c.result = { success: true, transaction: signature, payer: payerSol, network: SOLANA_NETWORK, amount: '1000' };
  c.paymentPayload = { ...c.paymentPayload, accepted: c.requirements, payload: { transaction: 'base64-fixture' } };
  const record = await settlementRecord(c, recipient, sol);
  assert.equal(record.network, SOLANA_NETWORK); assert.equal(record.payer, payerSol); assert.equal(record.authorizationNonce, signature);
  const fixture = storageFixture(); assert.equal(await saveSettlement(fixture.storage, record), true);
  assert.equal(await saveSettlement(fixture.storage, record), false, 'the same signature counts once');
  assert.equal(await settlementRecord(c, recipient, undefined), null, 'no Solana address configured');
  assert.equal(await settlementRecord(c, recipient, '9'.repeat(44)), null, 'paid to another Solana address');
  const wrongMint = structuredClone(c); wrongMint.requirements.asset = 'So11111111111111111111111111111111111111112';
  assert.equal(await settlementRecord(wrongMint, recipient, sol), null, 'not USDC');
});
