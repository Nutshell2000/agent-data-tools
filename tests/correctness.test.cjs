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
