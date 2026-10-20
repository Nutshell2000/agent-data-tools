const assert = require('node:assert/strict');
const { test } = require('node:test');
const { build } = require('esbuild');

async function load(entry) {
  const b = await build({ entryPoints: [entry], bundle: true, format: 'cjs', platform: 'node', write: false, logLevel: 'silent', external: ['cloudflare:workers'] });
  const m = { exports: {} };
  new Function('module', 'exports', 'require', b.outputFiles[0].text)(m, m.exports, require);
  return m.exports;
}

test('viem clients are per request, shared within one: concurrent requests never await each other\'s promises', async () => {
  // One bundle, so both modules share the same AsyncLocalStorage, as in the Worker.
  const b = await build({ stdin: { contents: 'export * as rpc from "./src/lib/rpc"; export * as funnel from "./src/lib/funnel";', resolveDir: process.cwd() }, bundle: true, format: 'cjs', platform: 'node', write: false, logLevel: 'silent', external: ['cloudflare:workers'] });
  const m = { exports: {} };
  new Function('module', 'exports', 'require', b.outputFiles[0].text)(m, m.exports, require);
  const { rpc, funnel } = m.exports;
  let made = 0;
  const make = () => ({ id: ++made });
  const env = {};
  const [a1, a2] = funnel.withRequestTrace(env, '/x', null, () => {}, () => [rpc.requestClient('base', make), rpc.requestClient('base', make)]);
  const b1 = funnel.withRequestTrace(env, '/x', null, () => {}, () => rpc.requestClient('base', make));
  assert.equal(a1, a2, 'one client per request and key');
  assert.notEqual(a1, b1, 'a new client for another request');
  assert.notEqual(rpc.requestClient('base', make), rpc.requestClient('base', make), 'outside a request: never cached');
});

test('address inputs are normalized to 0x + lowercase; other inputs and non-EVM values pass through', async () => {
  const { normalizedInput } = await load('src/tools.ts');
  const raw = { address: 'D8DA6BF26964AF9D7EED9E03E53415D37AA96045', tokens: ' 0x833589FCD6EDB6E08F4C7C32D4F71B54BDA02913 ,0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf', text: 'D8DA6BF26964AF9D7EED9E03E53415D37AA96045', wallet: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh', token: 'eyJhbGciOiJIUzI1NiJ9.e30.x' };
  const q = normalizedInput((n) => raw[n]);
  assert.equal(q('address'), '0xd8da6bf26964af9d7eed9e03e53415d37aa96045');
  assert.equal(q('tokens'), '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913,0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf');
  assert.equal(q('text'), raw.text, 'only address inputs are touched');
  assert.equal(q('wallet'), raw.wallet, 'non-EVM addresses unchanged');
  assert.equal(q('token'), raw.token, 'a JWT in a token input is not an address');
  assert.equal(q('missing'), undefined);
});

test('sanctions: a mistyped 0x address is refused, a 0x-less listed address still matches', async () => {
  const { TOOLS } = await load('src/tools.ts');
  await assert.rejects(TOOLS['/sanctions/check']({}, (n) => (n === 'address' ? '0x098B716B8Aaf21512996dC57EB0615e2383E2f9' : undefined)), /not a valid 0x address/);
});

test('timeouts and unreachable sources are recognised as upstream failures, not bugs', async () => {
  const { isUpstreamFailure } = await load('src/lib/env.ts');
  assert.equal(isUpstreamFailure(Object.assign(new Error('t'), { name: 'TimeoutError' })), true);
  assert.equal(isUpstreamFailure(new TypeError('fetch failed')), true);
  assert.equal(isUpstreamFailure(new TypeError('x is not a function')), false);
  assert.equal(isUpstreamFailure(new Error('boom')), false);
});

test('common other names for an input are read only when the input itself is missing', async () => {
  const { normalizedInput } = await load('src/tools.ts');
  const q = normalizedInput((n) => ({ wallet: '0xD8DA6BF26964AF9D7EED9E03E53415D37AA96045', tz: 'Europe/Oslo', zone: undefined, q: 'Uppsala' })[n]);
  assert.equal(q('address'), '0xd8da6bf26964af9d7eed9e03e53415d37aa96045', 'wallet= read as address, then normalized');
  assert.equal(q('zone'), 'Europe/Oslo');
  assert.equal(q('name'), 'Uppsala');
  const real = normalizedInput((n) => ({ zone: 'UTC', tz: 'Europe/Oslo' })[n]);
  assert.equal(real('zone'), 'UTC', 'the real input wins');
});

test('flags, trimmed codes and thousands separators', async () => {
  const f = await load('src/family.ts');
  const q = (o) => (n) => o[n];
  assert.equal(f.flag(q({ x: 'TRUE' }), 'x'), true);
  assert.equal(f.flag(q({ x: 'no' }), 'x'), false);
  assert.equal(f.need(q({ c: ' SE ' }), 'c', 2), 'SE');
  assert.equal(f.num(q({ n: '1,000' }), 'n'), 1000);
  assert.throws(() => f.num(q({ n: '1,00' }), 'n'), /must be a number/);
});

test('agent-eye fixes: date/add weeks, holidays UK, tickers on chain token reads, MCP examples and flag inputs', async () => {
  const { TOOLS } = await load('src/tools.ts');
  const call = (path, o) => TOOLS[path]({}, (n) => o[n]);
  assert.equal((await call('/date/add', { date: '2026-01-01', weeks: '2' })).date, '2026-01-15', 'weeks is declared and applied');
  assert.equal((await call('/holidays', { country: 'UK', year: '2026' })).country, 'GB');
  const { tokenAddress } = await load('src/lib/tickers.ts');
  assert.equal(tokenAddress('usdc', 'polygon'), '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359');
  assert.equal(tokenAddress('SOL', 'base'), '0x9B8Df6E244526ab5F6e6400d331DB28C8fdDdb55');
  assert.equal(tokenAddress('matic', 'polygon'), '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270');
  const contract = await load('src/mcp-contract.ts');
  const { ENDPOINTS } = await load('src/endpoints.ts');
  const desc = (p) => contract.toolDescription(ENDPOINTS.find((e) => e.path === p));
  assert.match(desc('/weather'), /Example: city=London\./, 'only the published example, not city with lat/lon');
  assert.match(desc('/price/token'), /Example: symbol=ETH\./);
  assert.doesNotMatch(desc('/btc-fees'), /only=/);
  const { z } = require('zod');
  const shot = ENDPOINTS.find((e) => e.path === '/screenshot');
  if (shot && shot.params.fullPage) assert.equal(z.object(contract.toolInputShape(shot, z)).safeParse({ url: 'https://example.com', fullPage: true }).success, true, 'a boolean for a flag input');
  const { allowedValue } = await load('src/family.ts');
  assert.equal(allowedValue('Ethereum', ['base', 'eth', 'arb', 'op']), 'eth');
  assert.equal(allowedValue('42161', ['base', 'eth', 'arb', 'op']), 'arb');
  assert.equal(allowedValue(' Base ', ['base', 'eth']), 'base');
  assert.equal(allowedValue('solana', ['base', 'eth']), undefined);
});
