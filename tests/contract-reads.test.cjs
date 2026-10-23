const assert = require('node:assert/strict');
const { test } = require('node:test');
const { build } = require('esbuild');
const { keccak256, toHex } = require('viem');

let mod;
async function load() {
  if (mod) return mod;
  const b = await build({ entryPoints: ['src/routes/chain-reads.ts'], bundle: true, format: 'cjs', platform: 'node', write: false, logLevel: 'silent' });
  const m = { exports: {} };
  new Function('module', 'exports', 'require', b.outputFiles[0].text)(m, m.exports, require);
  return (mod = m.exports);
}
const minus1 = (label) => `0x${(BigInt(keccak256(toHex(label))) - 1n).toString(16).padStart(64, '0')}`;

test('proxy slots are the standard ones (EIP-1967 minus one, EIP-1822 and the OpenZeppelin legacy keys)', async () => {
  const { PROXY_SLOTS } = await load();
  assert.equal(PROXY_SLOTS.eip1967, minus1('eip1967.proxy.implementation'));
  assert.equal(PROXY_SLOTS.beacon, minus1('eip1967.proxy.beacon'));
  assert.equal(PROXY_SLOTS.admin, minus1('eip1967.proxy.admin'));
  assert.equal(PROXY_SLOTS.eip1822, keccak256(toHex('PROXIABLE')));
  assert.equal(PROXY_SLOTS.zos, keccak256(toHex('org.zeppelinos.proxy.implementation')));
  assert.equal(PROXY_SLOTS.zosAdmin, keccak256(toHex('org.zeppelinos.proxy.admin')));
});

test('a storage word reads as an address only when it holds one', async () => {
  const { wordAddress } = await load();
  assert.equal(wordAddress('0x0000000000000000000000002ce6311ddae708829bc0784c967b7d77d19fd779'), '0x2ce6311ddae708829bc0784c967b7d77d19fd779');
  assert.equal(wordAddress(`0x${'0'.repeat(64)}`), null);
  assert.equal(wordAddress('0x'), null);
  assert.equal(wordAddress(`0x${'f'.repeat(64)}`), null);
});

test('NFT metadata: data URIs decode locally, long strings are shortened, odd URIs are reported, not thrown', async () => {
  const { readMetadata } = await load();
  const json = { name: 'Position', image: `data:image/svg+xml;base64,${'A'.repeat(5000)}`, attributes: [{ trait_type: 'fee', value: '0.3%' }] };
  const b64 = await readMetadata(`data:application/json;base64,${Buffer.from(JSON.stringify(json)).toString('base64')}`);
  assert.equal(b64.metadata.name, 'Position');
  assert.match(b64.metadata.image, /shortened\)$/);
  assert.ok(b64.metadata.image.length < 200);
  assert.deepEqual(b64.metadata.attributes, json.attributes);
  assert.equal(b64.error, null);
  const plain = await readMetadata(`data:application/json,${encodeURIComponent('{"name":"Plain"}')}`);
  assert.equal(plain.metadata.name, 'Plain');
  const bad = await readMetadata('data:application/json,{nope');
  assert.equal(bad.metadata, null);
  assert.match(bad.error, /not valid JSON/);
  const ar = await readMetadata('ar://abc');
  assert.equal(ar.metadata, null);
  assert.match(ar.error, /not a data:, http\(s\) or ipfs/);
  // Private and local targets are refused by the public-URL fetcher before any request.
  const local = await readMetadata('http://127.0.0.1/meta.json');
  assert.equal(local.metadata, null);
  assert.ok(local.error);
});

test('new chain reads: 8 per network (7 on Base, which keeps /base-allowance), bounded names, inputs checked before any RPC', async () => {
  const { CHAIN_READS } = await load();
  const added = ['nft-owner', 'nft-balance', 'nft-metadata', 'storage', 'proxy', 'call', 'estimate-gas', 'allowance'];
  const paths = new Set(CHAIN_READS.map((e) => e.endpoint.path));
  for (const slug of ['base', 'eth', 'arb', 'op', 'polygon']) {
    for (const op of added) assert.equal(paths.has(`/${slug}/${op}`), !(slug === 'base' && op === 'allowance'), `/${slug}/${op}`);
  }
  for (const e of CHAIN_READS.filter((f) => added.some((op) => f.endpoint.path.endsWith(`/${op}`)))) {
    assert.ok(e.endpoint.summary.split(':')[0].length <= 32, e.endpoint.summary);
    assert.ok(e.endpoint.description.length <= 450, `${e.endpoint.path} description ${e.endpoint.description.length}`);
  }
  const run = (path, params) => CHAIN_READS.find((f) => f.endpoint.path === path).run({}, (n) => params[n]);
  const nft = '0xC36442b4a4522E871399CD717aBDD847Ab11FE88';
  await assert.rejects(run('/eth/nft-owner', { contract: nft, tokenId: '1.5' }), (e) => e.status === 400);
  await assert.rejects(run('/eth/nft-owner', { contract: 'nope', tokenId: '1' }), (e) => e.status === 400);
  await assert.rejects(run('/eth/storage', { address: nft, slot: 'zz' }), (e) => e.status === 400);
  await assert.rejects(run('/eth/call', { to: nft, data: '0x123' }), (e) => e.status === 400);
  await assert.rejects(run('/eth/call', { to: nft, data: `0x${'00'.repeat(8193)}` }), (e) => e.status === 400);
  await assert.rejects(run('/eth/estimate-gas', { to: nft, value: '-1' }), (e) => e.status === 400);
  await assert.rejects(run('/eth/allowance', { token: 'USDC', owner: nft, spender: 'x' }), (e) => e.status === 400);
});
