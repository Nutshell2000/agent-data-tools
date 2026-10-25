const assert = require('node:assert/strict');
const { test } = require('node:test');
const { build } = require('esbuild');

async function load(entry) {
  const b = await build({ entryPoints: [entry], bundle: true, format: 'cjs', platform: 'node', write: false, logLevel: 'silent' });
  const m = { exports: {} };
  new Function('module', 'exports', 'require', b.outputFiles[0].text)(m, m.exports, require);
  return m.exports;
}

test('list inputs: JSON arrays (strings or {text}), one per line, or comma-separated', async () => {
  const { listInput } = await load('src/routes/retrieval.ts');
  assert.deepEqual(listInput('["a, b", "c"]'), ['a, b', 'c']);
  assert.deepEqual(listInput('[{"text":"x"},{"text":"y"}]'), ['x', 'y']);
  assert.deepEqual(listInput('one, two\nthree'), ['one, two', 'three']);
  assert.deepEqual(listInput('https://a.example, https://b.example'), ['https://a.example', 'https://b.example']);
  assert.throws(() => listInput('[not json'), (e) => e.status === 400);
});

test('rerank: best first, top_n, indexes kept, bounds checked before the model runs', async () => {
  const { rerank } = await load('src/routes/retrieval.ts');
  let calls = 0;
  const run = async (_m, input) => { calls++; assert.equal(input.contexts.length, 3); return { response: [{ id: 1, score: 0.02 }, { id: 2, score: 0.99 }, { id: 0, score: 0.0001 }] }; };
  const out = await rerank(run, 'capital of France', '["cheese","Berlin is in Germany","Paris is the capital of France"]', 2);
  assert.deepEqual(out.results.map((r) => r.index), [2, 1]);
  assert.equal(out.results[0].document, 'Paris is the capital of France');
  assert.equal(out.documents, 3);
  await assert.rejects(rerank(run, 'q', JSON.stringify(Array.from({ length: 51 }, (_, i) => `d${i}`))), (e) => e.status === 400);
  await assert.rejects(rerank(run, 'q', '[]'), (e) => e.status === 400);
  await assert.rejects(rerank(async () => ({ response: [] }), 'q', 'a\nb'), (e) => e.status === 502);
  assert.equal(calls, 1);
});

test('Cohere-style rerank body and answer', async () => {
  const lib = await load('src/lib/cohere-rerank.ts');
  assert.deepEqual(lib.toRerankQuery({ query: ' q ', documents: ['a', { text: 'b' }], top_n: 1, return_documents: true }), { query: 'q', documents: ['a', 'b'], topN: 1, returnDocuments: true });
  assert.deepEqual(lib.toRerankQuery({ query: 'q', documents: '["a","b"]' }).documents, ['a', 'b']);
  assert.match(lib.toRerankQuery({ query: 'q', documents: [] }).error, /non-empty array/);
  assert.match(lib.toRerankQuery({ query: '', documents: ['a'] }).error, /query/);
  assert.match(lib.toRerankQuery({ query: 'q', documents: ['a'], top_n: 0 }).error, /top_n/);
  assert.equal(lib.rerankBodyFromQuery({}), null);
  const out = lib.toCohereRerank({ results: [{ index: 2, relevance_score: 0.9, document: 'Paris' }] }, true);
  assert.deepEqual(out.results, [{ index: 2, relevance_score: 0.9, document: { text: 'Paris' } }]);
  assert.equal(out.meta.billed_units.search_units, 1);
  assert.deepEqual(lib.toCohereRerank({ results: [{ index: 0, relevance_score: 0.5, document: 'x' }] }, false).results, [{ index: 0, relevance_score: 0.5 }]);
});

test('retrieval tools: names within 32 characters, descriptions within 450, one cent or less', async () => {
  const { RETRIEVAL } = await load('src/routes/retrieval.ts');
  assert.deepEqual(RETRIEVAL.map((e) => e.endpoint.path), ['/contents', '/ai/rerank']);
  for (const { endpoint: e } of RETRIEVAL) {
    assert.ok(e.summary.split(':')[0].length <= 32, e.summary);
    assert.ok(e.description.length <= 450, `${e.path} ${e.description.length}`);
    assert.ok(Number(e.price.slice(1)) <= 0.01, e.path);
  }
});
