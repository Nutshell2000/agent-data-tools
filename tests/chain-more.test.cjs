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
  assert.deepEqual(CHAIN_MORE.map((e) => e.endpoint.path), ['/stablecoin/supply', '/token/supply', '/contract/abi', '/uniswap/pool', '/dex/new-pools', '/token/buyers', '/dex/trending']);
  for (const { endpoint: e } of CHAIN_MORE) {
    assert.ok(e.summary.split(':')[0].length <= 32, e.summary);
    assert.ok(e.description.length <= 450, `${e.path} ${e.description.length}`);
    assert.match(e.description, /(^|\. )Use (when|to|for|before|as) /, e.path);
    assert.equal(e.price, '$0.01');
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

test('hex inputs: calldata without 0x, with 0X or spaces is accepted; odd digits and non-hex stay refused', async () => {
  const b = await build({ entryPoints: ['src/routes/chain-reads.ts'], bundle: true, format: 'cjs', platform: 'node', write: false, logLevel: 'silent' });
  const m = { exports: {} };
  new Function('module', 'exports', 'require', b.outputFiles[0].text)(m, m.exports, require);
  const { hexInput } = m.exports;
  assert.equal(hexInput('0x18160DDD', 'data', 100), '0x18160ddd');
  assert.equal(hexInput('18160ddd', 'data', 100), '0x18160ddd');
  assert.equal(hexInput('0X18160ddd', 'data', 100), '0x18160ddd');
  assert.equal(hexInput(' 0x18 16 0d dd\n', 'data', 100), '0x18160ddd');
  assert.equal(hexInput('0x', 'data', 100), '0x');
  assert.equal(hexInput(undefined, 'data', 100, false), undefined);
  assert.throws(() => hexInput('0x123', 'data', 100), /whole bytes/);
  assert.throws(() => hexInput('totalSupply()', 'data', 100), /0x-prefixed hex/);
  assert.throws(() => hexInput('', 'data', 100), /required/);
});

test('contract ABI: the pre-1.178 listing pair (Ethereum USDC with chain=base) reads Ethereum and says so; other misses stay 404', async () => {
  const { CHAIN_MORE } = await load();
  const abi = CHAIN_MORE.find((x) => x.endpoint.path === '/contract/abi');
  const real = globalThis.fetch; const asked = [];
  globalThis.fetch = async (url) => { asked.push(String(url)); return String(url).includes('/contract/1/') ? Response.json({ match: 'exact_match', compilation: { name: 'FiatTokenProxy' }, abi: [] }) : new Response('', { status: 404 }); };
  try {
    const q = (o) => (k) => o[k];
    const r = await abi.run({}, q({ address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', chain: 'base' }));
    assert.equal(r.chain, 'Ethereum'); assert.match(r.note, /no contract on Base/); assert.equal(r.name, 'FiatTokenProxy');
    await assert.rejects(abi.run({}, q({ address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', chain: 'base' })), (e) => e.status === 404);
  } finally { globalThis.fetch = real; }
});
