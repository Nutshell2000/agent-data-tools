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
