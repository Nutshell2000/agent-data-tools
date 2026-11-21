// src/lib/v2-claim.ts: one signed x402 v2 payment is claimed before the tool runs and released when nothing settled.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { build } = require('esbuild');

let cached;
async function load() {
  if (cached) return cached;
  const b = await build({ entryPoints: ['src/lib/v2-claim.ts'], bundle: true, format: 'cjs', platform: 'node', write: false, logLevel: 'silent' });
  const m = { exports: {} };
  new Function('module', 'exports', 'require', b.outputFiles[0].text)(m, m.exports, require);
  return (cached = m.exports);
}
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64');
const soon = () => String(Math.floor(Date.now() / 1000) + 300);
const pay = (nonce, more = {}) => b64({ x402Version: 2, accepted: { scheme: 'exact', network: 'eip155:8453', amount: '10000' }, payload: { signature: '0xabc', authorization: { nonce, validBefore: soon(), ...more } } });

/** A ledger like the Metrics object's replay store. */
const ledger = () => {
  const live = new Map();
  return { live, mppClaim: async (key, expires) => { if (live.has(key)) return false; live.set(key, expires); return true; }, mppDelete: async (key) => { live.delete(key); } };
};
const envWith = (store) => ({ METRICS: { idFromName: () => 'global', get: () => store } });

test('the first use of a payment claims it, a second is told it is taken, and a release frees it', async () => {
  const { claimV2Payment } = await load();
  const store = ledger();
  const header = pay('0x01');
  const first = await claimV2Payment(envWith(store), header);
  assert.equal(first.taken, false);
  assert.equal(store.live.size, 1);
  const second = await claimV2Payment(envWith(store), header);
  assert.equal(second.taken, true);
  await second.release();
  assert.equal(store.live.size, 1, 'the refused copy cannot free the first one');
  await first.release();
  assert.equal(store.live.size, 0);
  assert.equal((await claimV2Payment(envWith(store), header)).taken, false, 'after a release the same payment runs again');
});

test('the key is the network and the signed payload: another nonce or network is another payment, an aligned accepted is the same one', async () => {
  const { v2ClaimKey } = await load();
  const base = { x402Version: 2, accepted: { scheme: 'exact', network: 'eip155:8453', amount: '10000' }, payload: { signature: '0xabc', authorization: { nonce: '0x01', validBefore: soon() } } };
  const k = async (o) => (await v2ClaimKey(b64(o))).key;
  assert.match(await k(base), /^x402v2:[0-9a-f]{64}$/);
  assert.equal(await k(base), await k({ ...base, accepted: { ...base.accepted, maxTimeoutSeconds: 300, payTo: '0xabc' } }), 'rewriting accepted does not change the claim');
  assert.notEqual(await k(base), await k({ ...base, payload: { ...base.payload, authorization: { ...base.payload.authorization, nonce: '0x02' } } }));
  assert.notEqual(await k(base), await k({ ...base, accepted: { ...base.accepted, network: 'eip155:137' } }));
});

test('the claim never outlives the authorization or ten minutes, and an expired payment is not claimed', async () => {
  const { v2ClaimKey } = await load();
  const now = Date.now();
  const short = await v2ClaimKey(pay('0x01', { validBefore: String(Math.floor(now / 1000) + 30) }));
  assert.ok(short.expires <= now + 31_000 && short.expires > now);
  const long = await v2ClaimKey(pay('0x01', { validBefore: '9999999999' }));
  assert.ok(long.expires <= Date.now() + 600_000);
  assert.equal(await v2ClaimKey(pay('0x01', { validBefore: '1' })), undefined);
  const solana = await v2ClaimKey(b64({ x402Version: 2, accepted: { network: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp' }, payload: { transaction: 'AAAA' } }));
  assert.ok(solana.expires <= Date.now() + 600_000, 'a payload without an authorization is held ten minutes at most');
});

test('nothing to claim, or a store that fails, lets the payment go on without a claim', async () => {
  const { claimV2Payment } = await load();
  assert.equal(await claimV2Payment(envWith(ledger()), undefined), undefined);
  assert.equal(await claimV2Payment(envWith(ledger()), 'not a payment'), undefined);
  assert.equal(await claimV2Payment({}, pay('0x01')), undefined, 'no storage binding');
  const broken = { mppClaim: async () => { throw new Error('storage unavailable'); }, mppDelete: async () => {} };
  assert.equal(await claimV2Payment(envWith(broken), pay('0x01')), undefined, 'a storage failure must not fail a paying buyer');
  const stuck = ledger(); stuck.mppDelete = async () => { throw new Error('storage unavailable'); };
  const c = await claimV2Payment(envWith(stuck), pay('0x02'));
  await c.release();
});
