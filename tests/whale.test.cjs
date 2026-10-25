const assert = require('node:assert/strict');
const { test } = require('node:test');
const { build } = require('esbuild');

async function load() {
  const b = await build({ entryPoints: ['src/routes/whale.ts'], bundle: true, format: 'cjs', platform: 'node', write: false, logLevel: 'silent' });
  const m = { exports: {} };
  new Function('module', 'exports', 'require', b.outputFiles[0].text)(m, m.exports, require);
  return m.exports;
}

const T = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const pad = (a) => '0x' + a.replace(/^0x/, '').padStart(64, '0');
const log = (from, to, units, block = 10) => ({ address: '0xusdc', blockNumber: '0x' + block.toString(16), transactionHash: '0xtx' + block, logIndex: '0x0', topics: [T, pad(from), pad(to)], data: '0x' + BigInt(units).toString(16) });

test('whale: chain names, and only transfers at or above the minimum, largest first, mints and burns marked', async () => {
  const { chainSlug, largeTransfers, WHALE } = await load();
  assert.equal(chainSlug(undefined), 'eth');
  assert.equal(chainSlug('Arbitrum'), 'arb');
  assert.equal(chainSlug('matic'), 'polygon');
  assert.throws(() => chainSlug('solana'), (e) => e.status === 400);
  assert.throws(() => chainSlug('constructor'), (e) => e.status === 400);
  const min = 100000n * 1000000n;
  const out = largeTransfers([
    log('0xaa', '0xbb', 50_000n * 1_000_000n),
    log('0xaa', '0xbb', 250_000n * 1_000_000n, 11),
    log('0x0', '0xcc', 1_000_000n * 1_000_000n, 12),
    log('0xdd', '0x0', 100_000n * 1_000_000n, 13),
    { ...log('0xaa', '0xbb', 1n), topics: [T, pad('0xaa'), pad('0xbb'), pad('0x1')] },
  ], () => 'USDC', min);
  assert.deepEqual(out.map((t) => [t.amount, t.kind]), [[1000000, 'mint'], [250000, 'transfer'], [100000, 'burn']]);
  assert.equal(out[1].from, '0x' + '0'.repeat(38) + 'aa');
  assert.equal(out[1].block, 11);
  const e = WHALE[0].endpoint;
  assert.ok(e.summary.split(':')[0].length <= 32 && e.description.length <= 450 && e.price === '$0.01');
});
