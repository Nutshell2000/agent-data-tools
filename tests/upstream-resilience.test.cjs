const assert = require('node:assert/strict');
const { test } = require('node:test');
const { build } = require('esbuild');

async function load() {
  const b = await build({ entryPoints: ['src/routes/chain-reads.ts'], bundle: true, format: 'cjs', platform: 'node', write: false, logLevel: 'silent' });
  const m = { exports: {} };
  new Function('module', 'exports', 'require', b.outputFiles[0].text)(m, m.exports, require);
  return m.exports;
}

// A node with `perBlock` logs in every block; records the ranges it was asked for.
const fakeNode = (perBlock) => {
  const calls = [];
  return { calls, request: async ({ params: [f] }) => {
    const from = BigInt(f.fromBlock), to = BigInt(f.toBlock);
    calls.push([Number(from), Number(to)]);
    const out = [];
    for (let b = from; b <= to; b++) for (let i = 0; i < perBlock; i++) out.push({ blockNumber: `0x${b.toString(16)}`, transactionHash: '0x', logIndex: `0x${i.toString(16)}`, topics: [], data: '0x' });
    return out;
  } };
};

test('recent logs: a busy contract stops after the first small window, newest logs, oldest first', async () => {
  const { recentLogs } = await load();
  const node = fakeNode(270);
  const r = await recentLogs(node, { address: '0x' + '1'.repeat(40) }, 1000n, 50n, 100);
  assert.deepEqual(node.calls, [[991, 1000]]);
  assert.equal(r.complete, false);
  assert.equal(Number(r.fromBlock), 991);
  assert.equal(r.logs.length, 2700);
  assert.ok(Number(r.logs[0].blockNumber) <= Number(r.logs.at(-1).blockNumber));
});

test('recent logs: a quiet contract covers the whole span in growing windows', async () => {
  const { recentLogs } = await load();
  const node = fakeNode(0);
  const r = await recentLogs(node, { address: '0x' + '1'.repeat(40) }, 10_000n, 1000n, 100);
  assert.deepEqual(node.calls, [[9991, 10000], [9951, 9990], [9791, 9950], [9151, 9790], [9001, 9150]]);
  assert.equal(r.complete, true);
  assert.equal(Number(r.fromBlock), 9001);
});

test('recent logs: windows never reach below the requested span', async () => {
  const { recentLogs } = await load();
  const node = fakeNode(1);
  const r = await recentLogs(node, { address: '0x' + '1'.repeat(40) }, 100n, 30n, 100);
  assert.deepEqual(node.calls, [[91, 100], [71, 90]]);
  assert.equal(r.logs.length, 30);
  assert.equal(r.complete, true);
});

test('recent logs: a node that lags behind the newest block is stepped past, not reported as 404', async () => {
  const { recentLogs } = await load();
  const node = fakeNode(0);
  const request = node.request;
  // Production, 25 Oct 2026: a Base log node a few blocks behind answered "header not found" for the newest range.
  node.request = async (args) => { if (BigInt(args.params[0].toBlock) > 997n) { node.calls.push(['lag']); throw new Error('header not found'); } return request(args); };
  const r = await recentLogs(node, { address: '0x' + '1'.repeat(40) }, 1000n, 100n, 100);
  assert.equal(r.complete, true);
  assert.deepEqual(node.calls[0], ['lag']);
  assert.ok(node.calls.slice(1).every((c) => c[1] <= 995), JSON.stringify(node.calls));
});

test('outside sources: one retry after a short 429/503, none when told to wait long', async () => {
  const b = await build({ entryPoints: ['src/family.ts'], bundle: true, format: 'cjs', platform: 'node', write: false, logLevel: 'silent' });
  const m = { exports: {} };
  new Function('module', 'exports', 'require', b.outputFiles[0].text)(m, m.exports, require);
  const { getJson, retryDelayMs } = m.exports;
  assert.equal(retryDelayMs(new Response(null, { status: 429 })), 700);
  assert.equal(retryDelayMs(new Response(null, { status: 429, headers: { 'retry-after': '1' } })), 1000);
  assert.equal(retryDelayMs(new Response(null, { status: 429, headers: { 'retry-after': '60' } })), null);
  const realFetch = globalThis.fetch;
  try {
    let calls = 0;
    globalThis.fetch = async () => (++calls === 1 ? new Response('slow down', { status: 429, headers: { 'retry-after': '0' } }) : Response.json({ ok: true }));
    assert.deepEqual(await getJson('https://source.test/x'), { ok: true });
    assert.equal(calls, 2);
    calls = 0;
    globalThis.fetch = async () => { calls++; return new Response('busy', { status: 429, headers: { 'retry-after': '120' } }); };
    await assert.rejects(getJson('https://source.test/x'), /HTTP 429/);
    assert.equal(calls, 1);
    calls = 0;
    globalThis.fetch = async () => { calls++; return new Response('gone', { status: 500 }); };
    await assert.rejects(getJson('https://source.test/x'), /HTTP 500/);
    assert.equal(calls, 1, 'other errors are not retried');
  } finally {
    globalThis.fetch = realFetch;
  }
});
