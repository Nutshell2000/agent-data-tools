const assert = require('node:assert/strict');
const { test } = require('node:test');
const { build } = require('esbuild');

async function load(entry) {
  const b = await build({ entryPoints: [entry], bundle: true, format: 'cjs', platform: 'node', write: false, logLevel: 'silent' });
  const m = { exports: {} };
  new Function('module', 'exports', 'require', b.outputFiles[0].text)(m, m.exports, require);
  return m.exports;
}

/** A KV holding a tiny list built the way scripts/build-phishing-list.mjs builds it. */
function fakeKv(lib, entries, meta = {}) {
  const ver = '20261118';
  const shards = new Map();
  for (const [d, bits] of entries) {
    const k = lib.shardKey(ver, lib.shardOf(d));
    shards.set(k, [...(shards.get(k) ?? []), `${d}\t${bits}`]);
  }
  const store = new Map([...shards].map(([k, lines]) => [k, `\n${lines.sort().join('\n')}\n`]));
  store.set(lib.META_KEY, JSON.stringify({ ver, builtAt: '2026-11-18T10:00:00Z', counts: { phishingDatabase: 1, metamask: 1, total: 2 }, whitelist: ['metamask.io'], fuzzylist: ['etherscan.io', 'opensea.io'], ...meta }));
  const reads = [];
  return { reads, get: async (k) => { reads.push(k); return store.get(k) ?? null; } };
}

test('phishing list: hashing, parent domains, shard lines and edit distance', async () => {
  const lib = await load('src/lib/phishing-list.ts');
  assert.equal(lib.fnv1a(''), 0x811c9dc5);
  assert.ok(lib.shardOf('example.com') >= 0 && lib.shardOf('example.com') < lib.SHARDS);
  assert.deepEqual(lib.candidates('a.b.example.com'), ['a.b.example.com', 'b.example.com', 'example.com']);
  assert.equal(lib.normalizeDomain('WWW.Example.COM.'), 'example.com');
  assert.equal(lib.normalizeDomain('localhost'), null);
  assert.equal(lib.normalizeDomain('a..b.com'), null);
  const shard = '\nevil.example\t3\nother.example\t1\n';
  assert.equal(lib.bitsInShard(shard, 'evil.example'), 3);
  assert.equal(lib.bitsInShard(shard, 'vil.example'), 0, 'a line must match whole, not as a suffix');
  assert.equal(lib.editDistance('etherscam.io', 'etherscan.io', 1), 1);
  assert.equal(lib.editDistance('github.com', 'etherscan.io', 1), 2);
});

test('phishing lookup: listed hosts and their subdomains, sources, whitelist and look-alikes', async () => {
  const lib = await load('src/lib/phishing-list.ts');
  const kv = fakeKv(lib, [['evil.example', 1], ['wallet-drain.example', 3], ['metamask.io', 2]]);
  const sub = await lib.phishingLookup(kv, 'login.evil.example');
  assert.equal(sub.listed, true);
  assert.equal(sub.matchedOn, 'evil.example');
  assert.deepEqual(sub.sources, ['Phishing.Database (active phishing domains)']);
  assert.equal((await lib.phishingLookup(kv, 'wallet-drain.example')).sources.length, 2);
  const clean = await lib.phishingLookup(kv, 'github.com');
  assert.equal(clean.listed, false);
  assert.equal(clean.lookalikeOf, null);
  assert.equal((await lib.phishingLookup(kv, 'metamask.io')).listed, false, 'the whitelist wins over both lists');
  assert.equal((await lib.phishingLookup(kv, 'etherscam.io')).lookalikeOf, 'etherscan.io');
  assert.equal((await lib.phishingLookup(kv, 'etherscan.io')).lookalikeOf, null, 'the brand itself is not its own look-alike');
  await assert.rejects(lib.phishingLookup(null, 'github.com'), /unavailable/);
  await assert.rejects(lib.phishingLookup({ get: async () => null }, 'github.com'), /unavailable/);
});

test('/phishing/check: verdicts, a link is never requested, uncharged errors', async () => {
  const lib = await load('src/lib/phishing-list.ts');
  const { PACKS_RESEARCH, hostOf } = await load('src/routes/packs-research.ts');
  const tool = PACKS_RESEARCH.find((e) => e.endpoint.path === '/phishing/check');
  assert.equal(tool.endpoint.price, '$0.002');
  assert.ok(tool.endpoint.description.length <= 450);
  assert.ok(tool.endpoint.summary.split(':')[0].length <= 32);
  assert.equal(hostOf('https://Login.Evil.example/path?q=1'), 'login.evil.example');
  assert.equal(hostOf('evil.example/path'), 'evil.example');
  const kv = fakeKv(lib, [['evil.example', 2]]);
  const realFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('the checked link must never be requested'); };
  try {
    const q = (url) => (n) => (n === 'url' ? url : undefined);
    const hit = await tool.run({ TRIALS: kv }, q('https://login.evil.example/claim'));
    assert.equal(hit.verdict, 'block');
    assert.deepEqual(hit.sources, ['MetaMask eth-phishing-detect']);
    assert.equal((await tool.run({ TRIALS: kv }, q('etherscam.io'))).verdict, 'warn');
    const ok = await tool.run({ TRIALS: kv }, q(tool.endpoint.params.url.example));
    assert.equal(ok.verdict, 'not_listed');
    assert.deepEqual(Object.keys(ok).sort(), Object.keys(tool.endpoint.outputExample).sort(), 'the answer has the published example shape');
    await assert.rejects(tool.run({}, q('github.com')), (e) => e.status === 503);
    await assert.rejects(tool.run({ TRIALS: kv }, q('localhost')), (e) => e.status === 400);
  } finally { globalThis.fetch = realFetch; }
});
