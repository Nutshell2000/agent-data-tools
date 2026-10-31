const assert = require('node:assert/strict');
const { test } = require('node:test');
const { build } = require('esbuild');

async function load() {
  const b = await build({ entryPoints: ['src/routes/chain-more.ts'], bundle: true, format: 'cjs', platform: 'node', write: false, logLevel: 'silent' });
  const m = { exports: {} };
  new Function('module', 'exports', 'require', b.outputFiles[0].text)(m, m.exports, require);
  return m.exports;
}

test('ABI summary lists function, event and error signatures', async () => {
  const { abiSummary } = await load();
  const s = abiSummary([
    { type: 'function', name: 'transfer', inputs: [{ type: 'address' }, { type: 'uint256' }], stateMutability: 'nonpayable' },
    { type: 'function', name: 'totalSupply', inputs: [], stateMutability: 'view' },
    { type: 'event', name: 'Transfer', inputs: [{ type: 'address' }, { type: 'address' }, { type: 'uint256' }] },
    { type: 'error', name: 'Unauthorized', inputs: [] },
    { type: 'constructor', inputs: [] },
  ]);
  assert.deepEqual(s.functions, [{ signature: 'transfer(address,uint256)', stateMutability: 'nonpayable' }, { signature: 'totalSupply()', stateMutability: 'view' }]);
  assert.deepEqual(s.events, ['Transfer(address,address,uint256)']);
  assert.deepEqual(s.errors, ['Unauthorized()']);
});

test('chain tools: names within 32 characters, descriptions within 450, "Use" guidance, price', async () => {
  const { CHAIN_MORE } = await load();
  assert.deepEqual(CHAIN_MORE.map((e) => e.endpoint.path), ['/stablecoin/supply', '/token/supply', '/contract/abi', '/uniswap/pool', '/dex/new-pools']);
  for (const { endpoint: e } of CHAIN_MORE) {
    assert.ok(e.summary.split(':')[0].length <= 32, e.summary);
    assert.ok(e.description.length <= 450, `${e.path} ${e.description.length}`);
    assert.match(e.description, /(^|\. )Use (when|to|for|before|as) /, e.path);
    assert.equal(e.price, e.path === '/dex/new-pools' ? '$0.05' : '$0.01'); // price test until 14 Nov 2026
  }
});

const pad = (hex) => '0x' + hex.replace(/^0x/, '').padStart(64, '0');
const WETH = '0x4200000000000000000000000000000000000006', TOK = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', POOL = '0xd0b53d9277642d899df5c87a3966a349a798f224';
const base = { blockNumber: '0x10', transactionHash: '0xtx', logIndex: '0x0' };

test('new pools: factory events decode per DEX, odd shapes are dropped, Aerodrome is Base only', async () => {
  const { decodePoolCreated, DEX_FACTORIES } = await load();
  const v3 = decodePoolCreated({ ...base, topics: ['0x783c', pad(WETH), pad(TOK), pad('0x1f4')], data: pad('0xa') + pad(POOL).slice(2) }, 'uniswap-v3');
  assert.deepEqual(v3, { dex: 'uniswap-v3', block: 16, txHash: '0xtx', token0: '0x4200000000000000000000000000000000000006', token1: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', feeTier: 500, stable: null, pool: '0xd0b53D9277642d899DF5C87A3966A349A798F224' });
  const v2 = decodePoolCreated({ ...base, topics: ['0x0d36', pad(WETH), pad(TOK)], data: pad(POOL) + pad('0x2a').slice(2) }, 'uniswap-v2');
  assert.equal(v2.pool, '0xd0b53D9277642d899DF5C87A3966A349A798F224');
  assert.equal(v2.feeTier, 3000);
  const aero = decodePoolCreated({ ...base, topics: ['0x2128', pad(WETH), pad(TOK), pad('0x1')], data: pad(POOL) + pad('0x3').slice(2) }, 'aerodrome');
  assert.equal(aero.stable, true);
  assert.equal(aero.feeTier, null);
  assert.equal(decodePoolCreated({ ...base, topics: ['0x783c', pad(WETH)], data: '0x' }, 'uniswap-v3'), null);
  assert.deepEqual(Object.keys(DEX_FACTORIES).sort(), ['arb', 'base', 'eth', 'op', 'polygon']);
  assert.deepEqual(DEX_FACTORIES.base.map((f) => f.dex), ['uniswap-v3', 'uniswap-v2', 'aerodrome']);
  assert.deepEqual(DEX_FACTORIES.eth.map((f) => f.dex), ['uniswap-v3', 'uniswap-v2']);
  for (const list of Object.values(DEX_FACTORIES)) for (const f of list) assert.match(f.address, /^0x[0-9a-fA-F]{40}$/);
});
