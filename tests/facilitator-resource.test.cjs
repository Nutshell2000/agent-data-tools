const assert = require('node:assert/strict');
const { test } = require('node:test');
const { build } = require('esbuild');

async function load() {
  const b = await build({ entryPoints: ['src/lib/facilitator.ts'], bundle: true, format: 'cjs', platform: 'node', write: false });
  const m = { exports: {} };
  new Function('module', 'exports', 'require', b.outputFiles[0].text)(m, m.exports, require);
  return m.exports;
}

test('settlements name the tool without the caller query (Bazaar listing), quotes are untouched', async () => {
  const { buildFacilitator, withoutQuery } = await load();
  const sent = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    sent.push({ url: String(url), body: JSON.parse(init.body) });
    return Response.json({ success: true, transaction: '0x' + '2'.repeat(64), network: 'eip155:8453', payer: '0x' + '1'.repeat(40) });
  };
  try {
    const payload = { x402Version: 2, resource: { url: 'https://api.test/eth/balance?address=0xabc', description: 'd' }, accepted: { network: 'eip155:8453' }, payload: { signature: '0x' } };
    const requirements = { scheme: 'exact', network: 'eip155:8453', amount: '3000' };
    const result = await buildFacilitator({ FACILITATOR_URL: 'https://fac.test' }).settle(payload, requirements);
    assert.equal(result.success, true);
    assert.equal(sent.length, 1);
    assert.match(sent[0].url, /\/settle$/);
    assert.equal(sent[0].body.paymentPayload.resource.url, 'https://api.test/eth/balance');
    assert.equal(sent[0].body.paymentPayload.resource.description, 'd');
    // The caller's own objects are not mutated: the quote and the ledger keep the exact URL.
    assert.equal(payload.resource.url, 'https://api.test/eth/balance?address=0xabc');
  } finally {
    globalThis.fetch = realFetch;
  }
  // v1 carries the resource in the requirements; URLs without a query, and odd shapes, pass through unchanged.
  assert.deepEqual(withoutQuery({ x402Version: 1 }, { resource: 'https://api.test/ens?name=vitalik.eth' })[1], { resource: 'https://api.test/ens' });
  assert.deepEqual(withoutQuery({ resource: { url: 'https://api.test/btc-fees' } }, undefined)[0], { resource: { url: 'https://api.test/btc-fees' } });
  assert.deepEqual(withoutQuery(undefined, { resource: 'not a url' }), [undefined, { resource: 'not a url' }]);
});

test('/supported: the last good answer is kept in KV and quotes from it when the facilitator refuses our key', async () => {
  // 7 Nov 2026: an IP allowlist on the CDP key made /supported answer 401; cold isolates then answered quotes with 500.
  const supported = { kinds: [{ x402Version: 2, scheme: 'exact', network: 'eip155:8453' }], extensions: [] };
  const kv = new Map(); let writes = 0;
  const TRIALS = { get: async (k) => kv.get(k) ?? null, put: async (k, v) => { writes++; kv.set(k, v); } };
  const realFetch = globalThis.fetch;
  let calls = 0, refuse = false;
  globalThis.fetch = async () => { calls++; return refuse ? Response.json({ errorMessage: 'Unauthorized' }, { status: 401 }) : Response.json(supported); };
  try {
    const first = await load();
    assert.deepEqual((await first.buildFacilitator({ FACILITATOR_URL: 'https://fac.test', TRIALS }).getSupported()).kinds, supported.kinds);
    assert.equal(writes, 1, 'stored once');
    await (await load()).buildFacilitator({ FACILITATOR_URL: 'https://fac.test', TRIALS }).getSupported();
    assert.equal(writes, 1, 'an unchanged answer is not written again');
    refuse = true; calls = 0;
    const cold = await load();
    assert.deepEqual((await cold.buildFacilitator({ FACILITATOR_URL: 'https://fac.test', TRIALS }).getSupported()).kinds, supported.kinds);
    assert.equal(calls, 1, 'a 401 is our credentials: no six retries');
    // Without a stored copy the refusal still surfaces.
    await assert.rejects((await load()).buildFacilitator({ FACILITATOR_URL: 'https://fac.test' }).getSupported());
  } finally {
    globalThis.fetch = realFetch;
  }
});
