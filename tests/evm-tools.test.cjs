const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const { build } = require('esbuild');

let E;
before(async () => {
  const b = await build({ entryPoints: ['src/routes/evm-tools.ts'], bundle: true, format: 'cjs', platform: 'node', write: false, logLevel: 'silent' });
  const m = { exports: {} };
  new Function('module', 'exports', 'require', b.outputFiles[0].text)(m, m.exports, require);
  E = m.exports;
});
const run = async (path, params = {}) => E.EVM_TOOLS.find((f) => f.endpoint.path === path).run({}, (n) => params[n]);
const TRANSFER = '0xa9059cbb000000000000000000000000d8da6bf26964af9d7eed9e03e53415d37aa960450000000000000000000000000000000000000000000000000000000000989680';

test('calldata: common selectors without a signature, given signatures, mismatches and unknown selectors', async () => {
  const d = await run('/evm/decode-calldata', { data: TRANSFER });
  assert.equal(d.function, 'transfer(address,uint256)');
  assert.deepEqual(d.args, [{ type: 'address', value: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045' }, { type: 'uint256', value: '10000000' }]);
  const s = await run('/evm/decode-calldata', { data: TRANSFER, signature: 'function transfer(address to, uint256 amount)' });
  assert.equal(s.decoded, true);
  await assert.rejects(run('/evm/decode-calldata', { data: TRANSFER, signature: 'approve(address,uint256)' }), (e) => e.status === 422);
  await assert.rejects(run('/evm/decode-calldata', { data: TRANSFER.slice(0, 40), signature: 'transfer(address,uint256)' }), (e) => e.status === 400 || e.status === 422);
  const unknown = await run('/evm/decode-calldata', { data: '0xdeadbeef' });
  assert.equal(unknown.decoded, false);
  await assert.rejects(run('/evm/decode-calldata', { data: 'a9059cbb' }), (e) => e.status === 400);
  await assert.rejects(run('/evm/decode-calldata', { data: TRANSFER, signature: 'not a signature' }), (e) => e.status === 400);
  for (const sig of E.COMMON_SIGNATURES) assert.ok(/^\w+\(.*\)$/.test(sig), sig);
});

test('signature: recovers the Hardhat #0 signer, compares case-insensitively, refuses malformed input', async () => {
  const sig = E.EVM_TOOLS.find((f) => f.endpoint.path === '/evm/verify-signature').endpoint.params.signature.example;
  const ok = await run('/evm/verify-signature', { message: 'hello', signature: sig, address: '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266' });
  assert.equal(ok.recovered, '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266');
  assert.equal(ok.valid, true);
  const other = await run('/evm/verify-signature', { message: 'hello!', signature: sig, address: '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266' });
  assert.equal(other.valid, false);
  const noAddr = await run('/evm/verify-signature', { message: 'hello', signature: sig });
  assert.equal(noAddr.valid, null);
  await assert.rejects(run('/evm/verify-signature', { message: 'hello', signature: '0x1234' }), (e) => e.status === 400);
  await assert.rejects(run('/evm/verify-signature', { message: 'plain', signature: sig, raw: 'true' }), (e) => e.status === 400);
});

test('checksum: lower, upper, correct and wrong mixed case', async () => {
  const lower = await run('/evm/checksum', { address: '0xd8da6bf26964af9d7eed9e03e53415d37aa96045' });
  assert.equal(lower.checksummed, '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045');
  assert.equal(lower.inputCase, 'lower');
  const good = await run('/evm/checksum', { address: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045' });
  assert.equal(good.checksumMatches, true);
  const bad = await run('/evm/checksum', { address: '0xD8dA6BF26964aF9D7eEd9e03E53415D37aA96045' });
  assert.equal(bad.valid, false);
  assert.equal((await run('/evm/checksum', { address: '0x123' })).valid, false);
});
