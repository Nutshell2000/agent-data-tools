const assert = require('node:assert/strict');
const { test, before, after } = require('node:test');
const { build } = require('esbuild');

const load = async (file) => {
  const b = await build({ entryPoints: [file], bundle: true, format: 'cjs', platform: 'node', write: false, logLevel: 'silent' });
  const m = { exports: {} };
  new Function('module', 'exports', 'require', b.outputFiles[0].text)(m, m.exports, require);
  return m.exports;
};
let S, B;
const realFetch = globalThis.fetch;
let rpc;
before(async () => {
  S = await load('src/routes/solana.ts');
  B = await load('src/routes/bic.ts');
  globalThis.fetch = async (url, init) => { const { method, params } = JSON.parse(init.body); return rpc(method, params, url); };
});
after(() => { globalThis.fetch = realFetch; });
const ok = (result) => new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result }));
const run = async (mod, path, params) => mod.find((f) => f.endpoint.path === path).run({}, (n) => params[n]);

test('base58: 32-byte keys and 64-byte signatures, bad characters refused before any request', async () => {
  assert.equal(S.base58Length('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'), 32);
  assert.equal(S.base58Length('11111111111111111111111111111111'), 32);
  assert.equal(S.base58Length('3vsCBRhEzKZ5gkQ59x9qkzVFddwVNFtz5HUW7G1JvMqEaYABtJH1Parn84FAUF2dct2viSXHVVDDRKSbytSSdMU'), 64);
  assert.equal(S.base58Length('0OIl'), -1);
  rpc = () => { throw new Error('no request expected'); };
  await assert.rejects(run(S.SOLANA, '/solana/balance', { address: '0x' + 'a'.repeat(40) }), (e) => e.status === 400);
  await assert.rejects(run(S.SOLANA, '/solana/token', { mint: 'abc' }), (e) => e.status === 400);
  await assert.rejects(run(S.SOLANA, '/solana/tx', { signature: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' }), (e) => e.status === 400);
});

test('balance: exact SOL, known tokens first, empty accounts dropped', async () => {
  const acct = (mint, amount, decimals, ui) => ({ pubkey: 'x', account: { owner: 'x', data: { parsed: { info: { mint, tokenAmount: { amount, decimals, uiAmountString: ui } } } } } });
  rpc = (method, params) => {
    if (method === 'getBalance') return new Response('{"jsonrpc":"2.0","id":1,"result":{"context":{"slot":7},"value":11175975387143367}}');
    if (params[1].programId.startsWith('Tokenz')) return ok({ value: [] });
    return ok({ value: [acct('SpamMint1111111111111111111111111111111111', '999999999999', 0, '999999999999'), acct('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', '12500000', 6, '12.5'), acct('EmptyMint111111111111111111111111111111111', '0', 6, '0')] });
  };
  const out = await run(S.SOLANA, '/solana/balance', { address: 'vines1vzrYbzLMRdu58ou5XTby4qAqVRLmqo36NKPTg' });
  assert.equal(out.lamports, '11175975387143367');
  assert.equal(out.sol, '11175975.387143367');
  assert.equal(out.tokenCount, 2);
  assert.equal(out.tokens[0].symbol, 'USDC');
});

test('token: authorities flag risk, missing mint 404, non-mint 422, rate-limited holders become null', async () => {
  rpc = (method) => method === 'getAccountInfo'
    ? ok({ context: { slot: 9 }, value: { owner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', data: { parsed: { type: 'mint', info: { decimals: 6, supply: '1000000000', mintAuthority: null, freezeAuthority: 'Frz1111111111111111111111111111111111111111' } } } } })
    : new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: 429, message: 'Too many requests for a specific RPC call' } }));
  const t = await run(S.SOLANA, '/solana/token', { mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', holders: '3' });
  assert.equal(t.supply, '1000');
  assert.equal(t.mintable, false);
  assert.equal(t.freezable, true);
  assert.equal(t.topHolders, null);
  rpc = () => ok({ context: { slot: 9 }, value: null });
  await assert.rejects(run(S.SOLANA, '/solana/token', { mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' }), (e) => e.status === 404);
  rpc = () => ok({ context: { slot: 9 }, value: { owner: '11111111111111111111111111111111', data: ['', 'base64'] } });
  await assert.rejects(run(S.SOLANA, '/solana/token', { mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' }), (e) => e.status === 422);
  rpc = () => new Response('busy', { status: 503 });
  await assert.rejects(run(S.SOLANA, '/solana/token', { mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' }), (e) => e.status === 502);
});

test('BIC: structure, real country, head office, test BIC and refusals', () => {
  const d = B.bicInfo('deut de ff 500');
  assert.equal(d.valid, true);
  assert.equal(d.country, 'Germany');
  assert.equal(d.headOffice, false);
  assert.equal(B.bicInfo('NDEASESS').bic11, 'NDEASESSXXX');
  assert.equal(B.bicInfo('NDEASESS').headOffice, true);
  assert.equal(B.bicInfo('ABCDSE20').testBic, true);
  assert.equal(B.bicInfo('ABCDQQ22').valid, false);
  assert.equal(B.bicInfo('ABCDEU22').valid, false);
  assert.equal(B.bicInfo('AB1DSESS').valid, false);
  assert.equal(B.bicInfo('SHORT').valid, false);
  assert.equal(B.bicInfo('ABCDXK22').country, 'Kosovo');
});
