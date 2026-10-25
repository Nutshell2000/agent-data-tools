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

test('chain tools: names within 32 characters, descriptions within 450, "Use" guidance, one cent', async () => {
  const { CHAIN_MORE } = await load();
  assert.deepEqual(CHAIN_MORE.map((e) => e.endpoint.path), ['/stablecoin/supply', '/token/supply', '/contract/abi', '/uniswap/pool']);
  for (const { endpoint: e } of CHAIN_MORE) {
    assert.ok(e.summary.split(':')[0].length <= 32, e.summary);
    assert.ok(e.description.length <= 450, `${e.path} ${e.description.length}`);
    assert.match(e.description, /(^|\. )Use (when|to|for|before|as) /, e.path);
    assert.equal(e.price, '$0.01');
  }
});
