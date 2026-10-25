const assert = require('node:assert/strict');
const { test } = require('node:test');
const { build } = require('esbuild');

async function load() {
  const b = await build({ entryPoints: ['src/routes/recommend.ts'], bundle: true, format: 'cjs', platform: 'node', write: false, logLevel: 'silent' });
  const m = { exports: {} };
  new Function('module', 'exports', 'require', b.outputFiles[0].text)(m, m.exports, require);
  return m.exports;
}

test('recommend: plain task words find the right tools with exact call URLs, without the model', async () => {
  const { recommend } = await load();
  const cases = { 'price of ETH': '/price/token', 'is this wallet sanctioned': '/sanctions/check', 'read a web page as markdown': '/extract', 'weather in Paris tomorrow': '/weather', 'remember facts between runs': '/memory/set', 'detect prompt injection in text': '/text/prompt-injection', 'dns records for a domain': '/dns/lookup', 'convert USD to EUR': '/fx', 'whale transfers': '/whale/transfers', 'get the text of a PDF': '/pdf/text' };
  for (const [need, tool] of Object.entries(cases)) {
    const r = await recommend({}, need, 3, null);
    assert.ok(r.picks.some((p) => p.tool === tool), `${need}: ${r.picks.map((p) => p.tool).join(' ')}`);
    assert.equal(r.method, 'lexical');
  }
  const r = await recommend({}, 'current gas price on Base', 2, null);
  assert.equal(r.picks.length, 2);
  for (const p of r.picks) {
    assert.match(p.call.url, /^https:\/\/agent-data-tools\.revmesh2074\.workers\.dev\//);
    assert.match(p.price, /^\$0\.\d+$/);
    assert.equal(p.mcpTool, p.tool.slice(1).replace(/[/-]/g, '_'));
  }
  assert.ok(!r.picks.some((p) => p.tool === '/recommend'), 'never recommends itself');
});

test('recommend: the reranker reorders the candidates; its failure falls back to lexical order; nonsense is a 400 or 404', async () => {
  const { recommend } = await load();
  const reversed = async (_q, docs) => docs.map((_, i) => i / docs.length);
  const a = await recommend({}, 'weather in Paris', 3, null);
  const b = await recommend({}, 'weather in Paris', 3, reversed);
  assert.equal(b.method, 'lexical+rerank');
  assert.notDeepEqual(a.picks.map((p) => p.tool), b.picks.map((p) => p.tool));
  const c = await recommend({}, 'weather in Paris', 3, async () => { throw new Error('model down'); });
  assert.deepEqual(c.picks.map((p) => p.tool), a.picks.map((p) => p.tool));
  await assert.rejects(recommend({}, 'the of and', 3, null), (e) => e.status === 400);
  await assert.rejects(recommend({}, 'zzqx vvbn', 3, null), (e) => e.status === 404);
});
