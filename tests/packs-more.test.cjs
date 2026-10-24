const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const { build } = require('esbuild');

const load = async (file) => {
  const b = await build({ entryPoints: [file], bundle: true, format: 'cjs', platform: 'node', write: false, logLevel: 'silent' });
  const m = { exports: {} };
  new Function('module', 'exports', 'require', b.outputFiles[0].text)(m, m.exports, require);
  return m.exports;
};
let P, E, W;
before(async () => { P = await load('src/routes/packs-more.ts'); E = await load('src/routes/evm-tools.ts'); W = await load('src/routes/web-checks.ts'); });

test('event lines: transfers, mints, burns, NFT moves and unlimited approvals', () => {
  const usdc = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
  const meta = new Map([[usdc, { symbol: 'USDC', decimals: 6 }]]);
  const zero = '0x0000000000000000000000000000000000000000', a = '0x1111111111111111111111111111111111111111', b = '0x2222222222222222222222222222222222222222';
  const lines = P.describeEvents([
    { kind: 'transfer', token: usdc, from: a, to: b, value: 10_000_000n },
    { kind: 'transfer', token: usdc, from: zero, to: b, value: 1_000_000n },
    { kind: 'transfer', token: usdc, from: a, to: zero, value: 500_000n },
    { kind: 'approval', token: usdc, from: a, to: b, value: 2n ** 256n - 1n },
    { kind: 'nft-transfer', token: b, from: zero, to: a, tokenId: 7n },
  ], meta);
  assert.equal(lines[0], '10 USDC sent from 0x1111…1111 to 0x2222…2222');
  assert.match(lines[1], /^1 USDC minted/);
  assert.match(lines[2], /^0\.5 USDC burned/);
  assert.match(lines[3], /unlimited USDC/);
  assert.match(lines[4], /#7 moved .* \(minted\)$/);
});

test('EIP-3009 transferWithAuthorization (x402 settlements) decodes without a signature', () => {
  const sel = '0xe3ee160e';
  const word = (hex) => hex.replace(/^0x/, '').padStart(64, '0');
  const data = sel + word('0x1111111111111111111111111111111111111111') + word('0x2222222222222222222222222222222222222222') + word('2710') + word('0') + word('ffffffff') + word('ab'.repeat(32)) + word('1b') + word('cd'.repeat(32)) + word('ef'.repeat(32));
  const d = E.decodeCalldata(data);
  assert.equal(d.decoded, true);
  assert.match(d.function, /^transferWithAuthorization\(/);
  assert.equal(d.args[2].value, '10000');
});

test('country names map to ISO codes; keyword density ignores links and e-mail addresses', () => {
  assert.equal(P.countryCode('Sweden'), 'SE');
  assert.equal(P.countryCode('United States'), 'US');
  assert.equal(P.countryCode('Nowhere Land'), null);
  const k = W.keywordDensity('Visit https://example.com/page or mail sales@example.com about agents', 10);
  assert.ok(!k.keywords.some((x) => ['https', 'com', 'example'].includes(x.word)));
});

test('pack inputs are checked before any request', async () => {
  const run = async (path, params) => P.PACKS_MORE.find((f) => f.endpoint.path === path).run({}, (n) => params[n]);
  await assert.rejects(run('/pack/tx-explain', { hash: '0x1234' }), (e) => e.status === 400);
  await assert.rejects(run('/pack/tx-explain', { hash: '0x' + 'a'.repeat(64), chain: 'solana' }), (e) => e.status === 400);
  await assert.rejects(run('/pack/nft-analysis', { contract: 'nope', tokenId: '1' }), (e) => e.status === 400);
  for (const { endpoint: e } of P.PACKS_MORE) assert.ok(e.summary.split(':')[0].length <= 32, e.summary);
});
