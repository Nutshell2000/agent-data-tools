const assert = require('node:assert/strict');
const { test } = require('node:test');
const { build } = require('esbuild');

async function load() {
  const b = await build({ entryPoints: ['src/routes/memory.ts'], bundle: true, format: 'cjs', platform: 'node', write: false, logLevel: 'silent' });
  const m = { exports: {} };
  new Function('module', 'exports', 'require', b.outputFiles[0].text)(m, m.exports, require);
  return m.exports;
}

function fakeKv() {
  const data = new Map();
  return {
    data,
    async put(k, v, o) { data.set(k, { v, meta: o?.metadata ?? null, ttl: o?.expirationTtl }); },
    async get(k) { return data.has(k) ? data.get(k).v : null; },
    async getWithMetadata(k) { return data.has(k) ? { value: data.get(k).v, metadata: data.get(k).meta } : { value: null, metadata: null }; },
    async delete(k) { data.delete(k); },
    async list({ prefix, limit, cursor }) { if (cursor === 'bad') throw new Error('invalid cursor'); const keys = [...data.keys()].filter((k) => k.startsWith(prefix)).sort().slice(0, limit).map((name) => ({ name, metadata: data.get(name).meta })); return { keys, list_complete: true }; },
  };
}
const NS = 'my-agent-namespace-1234';

test('memory: save, read, list, delete inside one hashed namespace', async () => {
  const m = await load();
  const kv = fakeKv();
  const saved = await m.memorySet(kv, NS, 'prefs', '{"a":1}', 7);
  assert.equal(saved.saved, true);
  assert.equal(saved.size, 7);
  const [stored] = [...kv.data.entries()];
  assert.match(stored[0], /^mem:[0-9a-f]{64}:prefs$/);
  assert.ok(!stored[0].includes(NS), 'the namespace itself is never stored');
  assert.equal(stored[1].ttl, 7 * 86400);
  assert.equal((await m.memoryGet(kv, NS, 'prefs')).value, '{"a":1}');
  await m.memorySet(kv, NS, 'task-1', 'x', 30);
  await m.memorySet(kv, 'another-namespace-5678', 'prefs', 'other', 30);
  assert.deepEqual((await m.memoryList(kv, NS)).keys.map((k) => k.key), ['prefs', 'task-1']);
  assert.deepEqual((await m.memoryList(kv, NS, 'task')).keys.map((k) => k.key), ['task-1']);
  await assert.rejects(m.memoryList(kv, NS, undefined, 'bad'), (e) => e.status === 400);
  assert.equal((await m.memoryDelete(kv, NS, 'prefs')).deleted, true);
  assert.equal((await m.memoryDelete(kv, NS, 'prefs')).deleted, false);
  await assert.rejects(m.memoryGet(kv, NS, 'prefs'), (e) => e.status === 404);
  assert.equal((await m.memoryGet(kv, 'another-namespace-5678', 'prefs')).value, 'other');
});

test('memory: bad namespaces, keys and values are refused; no storage is a 503', async () => {
  const m = await load();
  const kv = fakeKv();
  await assert.rejects(m.memorySet(kv, 'short', 'k', 'v', 1), (e) => e.status === 400);
  await assert.rejects(m.memorySet(kv, 'has spaces in it 123456', 'k', 'v', 1), (e) => e.status === 400);
  await assert.rejects(m.memorySet(kv, NS, 'k\u0001', 'v', 1), (e) => e.status === 400);
  await assert.rejects(m.memorySet(kv, NS, 'k', 'x'.repeat(8001), 1), (e) => e.status === 400);
  await assert.rejects(m.memoryGet(null, NS, 'k'), (e) => e.status === 503);
});

test('memory: the demo namespace from the examples is read-only and always answers', async () => {
  const m = await load();
  const kv = fakeKv();
  assert.equal((await m.memoryGet(null, m.DEMO_NS, 'user-preferences')).demo, true);
  const set = await m.memorySet(kv, m.DEMO_NS, 'user-preferences', 'spam', 30);
  assert.equal(set.saved, false);
  assert.equal(kv.data.size, 0);
  assert.equal((await m.memoryDelete(kv, m.DEMO_NS, 'user-preferences')).deleted, false);
  assert.equal((await m.memoryList(null, m.DEMO_NS)).count, 1);
  await assert.rejects(m.memoryGet(null, m.DEMO_NS, 'constructor'), (e) => e.status === 404);
  for (const { endpoint: e } of m.MEMORY) {
    assert.equal(e.params.namespace.example, m.DEMO_NS);
    assert.ok(e.summary.split(':')[0].length <= 32, e.summary);
    assert.ok(e.description.length <= 450, `${e.path} ${e.description.length}`);
  }
});

test('memory write tools are annotated as writes; every other tool stays read-only', async () => {
  const b = await build({ entryPoints: ['src/mcp-contract.ts'], bundle: true, format: 'cjs', platform: 'node', write: false, logLevel: 'silent' });
  const m = { exports: {} };
  new Function('module', 'exports', 'require', b.outputFiles[0].text)(m, m.exports, require);
  const { annotationsFor } = m.exports;
  assert.deepEqual(annotationsFor('/memory/set'), { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false });
  assert.equal(annotationsFor('/memory/delete').destructiveHint, true);
  assert.equal(annotationsFor('/memory/get').readOnlyHint, true);
  assert.equal(annotationsFor('/eth/gas').readOnlyHint, true);
  assert.equal(annotationsFor('constructor').readOnlyHint, true);
});
