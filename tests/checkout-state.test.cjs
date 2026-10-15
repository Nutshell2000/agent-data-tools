const assert = require('node:assert/strict');
const Module = require('node:module');
const { before, test } = require('node:test');
const esbuild = require('esbuild');
async function load(entry, plugins = []) {
  const result = await esbuild.build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'cjs', write: false, plugins });
  const m = new Module(entry, module); m.filename = entry; m.paths = Module._nodeModulePaths(process.cwd());
  m._compile(result.outputFiles[0].text, entry); return m.exports;
}
let reserveAmount, claimTransfer;
before(async () => ({ reserveAmount, claimTransfer } = await load(require.resolve('../src/store/checkout-state.ts'))));
function storageFixture(records = new Map()) {
  let pending = Promise.resolve();
  const storage = {
    get: async key => structuredClone(records.get(key)),
    put: async (key, value) => records.set(key, structuredClone(value)),
    transaction(callback) { const next = pending.then(() => callback(storage)); pending = next.catch(() => {}); return next; },
  };
  return { storage, records };
}
const scope = 'eip155:8453:0x2074c40346ae2a90e0e4a391bcee6f16bf5277f5';
const a = 'a'.repeat(32), b = 'b'.repeat(32), transaction = '0x' + '1'.repeat(64);
const claim = (orderId, logIndex = 1) => ({ scope, amount: '1900001', orderId, transaction, logIndex });

test('concurrent orders reserve one exact amount once; a restart preserves the reservation', async () => {
  const { storage, records } = storageFixture();
  const expiresAt = Date.now() + 60_000;
  const reservations = await Promise.all([a, b].map(orderId => reserveAmount(storage, { scope, amount: '1900001', orderId, expiresAt })));
  assert.deepEqual(reservations, [true, false]);
  const restarted = storageFixture(records).storage;
  assert.equal(await reserveAmount(restarted, { scope, amount: '1900001', orderId: b, expiresAt }), false);
});

test('a single transfer cannot pay two orders, even concurrently without legacy reservations', async () => {
  const { storage, records } = storageFixture();
  assert.deepEqual(await Promise.all([claimTransfer(storage, claim(a)), claimTransfer(storage, claim(b))]), [true, false]);
  const restarted = storageFixture(records).storage;
  assert.equal(await claimTransfer(restarted, claim(a)), true);
  assert.equal(await claimTransfer(restarted, claim(b)), false);
  assert.equal(await claimTransfer(restarted, { ...claim(a), amount: '1900002' }), false);
  // Distinct events in one transaction are different payments.
  assert.equal(await claimTransfer(restarted, claim(b, 2)), true);
});

test('a live amount reservation protects its intended order and malformed claims fail closed', async () => {
  const { storage } = storageFixture();
  await reserveAmount(storage, { scope, amount: '1900001', orderId: a, expiresAt: Date.now() + 60_000 });
  assert.equal(await claimTransfer(storage, claim(b)), false);
  assert.equal(await claimTransfer(storage, claim(a)), true);
  for (const invalid of [{ transaction: 'invalid' }, { logIndex: -1 }, { amount: '-1' }, { orderId: 'unknown' }, { scope: 'eip155:1:wrong' }]) {
    assert.equal(await claimTransfer(storage, { ...claim(a), ...invalid }), false);
  }
});

test('only finalized successful transfers are returned by the chain matcher', async () => {
  const original = global.__checkoutRpc;
  const plugin = { name: 'rpc-fixture', setup(build) {
    build.onResolve({ filter: /lib\/rpc$/ }, () => ({ path: 'rpc', namespace: 'fixture' }));
    build.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'export const baseClient = () => globalThis.__checkoutRpc;', loader: 'js' }));
  } };
  const { findPayment } = await load(require.resolve('../src/store/chain.ts'), [plugin]);
  let receiptStatus = 'success', queries = [];
  global.__checkoutRpc = {
    getBlock: async args => { assert.equal(args.blockTag, 'finalized'); return { number: 100n }; },
    getLogs: async args => { queries.push(args); return [{ args: { value: 1900001n, from: 'fixture-buyer' }, transactionHash: transaction, blockNumber: 100n, logIndex: 1 }]; },
    getTransactionReceipt: async () => ({ status: receiptStatus, blockNumber: 100n }),
  };
  try {
    const result = await findPayment({}, '0x' + '2'.repeat(40), 1900001n, 90n, 200n);
    assert.equal(result.tx, transaction); assert.equal(result.logIndex, 1);
    assert.equal(queries[0].toBlock, 100n);
    receiptStatus = 'reverted';
    assert.equal(await findPayment({}, '0x' + '2'.repeat(40), 1900001n, 90n), null);
    queries = [];
    assert.equal(await findPayment({}, '0x' + '2'.repeat(40), 1900001n, 101n), null);
    assert.equal(queries.length, 0);
  } finally { global.__checkoutRpc = original; }
});

test('order refresh uses atomic claims and recovers after a failed KV order write', async () => {
  const plugin = { name: 'order-payment-fixture', setup(build) {
    build.onResolve({ filter: /lib\/rpc$/ }, () => ({ path: 'rpc', namespace: 'fixture' }));
    build.onResolve({ filter: /^\.\/chain$/ }, () => ({ path: 'chain', namespace: 'fixture' }));
    build.onLoad({ filter: /^rpc$/, namespace: 'fixture' }, () => ({ contents: 'export const baseClient = () => ({ getBlockNumber: async () => 1n });', loader: 'js' }));
    build.onLoad({ filter: /^chain$/, namespace: 'fixture' }, () => ({ contents: `export const findPayment = async () => ({tx:'${transaction}', from:'fixture-buyer', block:10n, logIndex:1});`, loader: 'js' }));
  } };
  const { refreshOrder } = await load(require.resolve('../src/store/orders.ts'), [plugin]);
  const { storage } = storageFixture();
  const kv = new Map(); let failOrderWrite = false;
  const env = { NETWORK: 'eip155:8453', PAY_TO: scope.split(':').at(-1),
    METRICS: { idFromName: () => 'global', get: () => ({ claimCheckoutPayment: value => claimTransfer(storage, value) }) },
    TRIALS: { get: async key => kv.has(key) ? JSON.parse(kv.get(key)) : null, put: async (key, value) => {
      if (failOrderWrite && key.startsWith('order:')) { failOrderWrite = false; throw new Error('fixture KV write unavailable'); }
      kv.set(key, value);
    } },
  };
  const order = { id: a, slug: 'x402-seller-kit', amount: '1900001', createdAt: Date.now(), createdBlock: '1' };
  failOrderWrite = true;
  await assert.rejects(() => refreshOrder(env, order), /KV write unavailable/);
  const recovered = await refreshOrder(env, order);
  assert.ok(recovered.paidAt);
  assert.equal(recovered.paidTx, transaction);
  const second = await refreshOrder(env, { ...order, id: b });
  assert.equal(second.paidAt, undefined);
  assert.equal(kv.has('order:' + b), false);
});
