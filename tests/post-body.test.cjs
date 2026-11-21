// src/lib/post-body.ts: the fields of a POSTed tool call as clients send them (flat JSON, form-encoded, nested once).
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { build } = require('esbuild');

let cached;
async function load() {
  if (cached) return cached;
  const b = await build({ entryPoints: ['src/lib/post-body.ts'], bundle: true, format: 'cjs', platform: 'node', write: false, logLevel: 'silent' });
  const m = { exports: {} };
  new Function('module', 'exports', 'require', b.outputFiles[0].text)(m, m.exports, require);
  return (cached = m.exports);
}

test('a body is read as JSON, as a form, or as nothing; never an error', async () => {
  const { parseBody } = await load();
  assert.deepEqual(parseBody('{"text":"hello"}', 'application/json'), { text: 'hello' });
  assert.deepEqual(parseBody('{"text":"hello"}', null), { text: 'hello' }, 'JSON without a content type');
  assert.deepEqual(parseBody('text=hello+world&lang=en', 'application/x-www-form-urlencoded'), { text: 'hello world', lang: 'en' });
  assert.deepEqual(parseBody('text=hello%20world', 'text/plain'), { text: 'hello world' }, 'a form body under another content type');
  assert.deepEqual(parseBody('"{\\"text\\":\\"hi\\"}"', 'application/json'), { text: 'hi' }, 'JSON stringified twice');
  for (const [text, type] of [['', 'application/json'], ['   ', null], ['[1,2]', 'application/json'], ['"plain"', 'application/json'], ['{broken', 'application/json'], ['just some words', 'text/plain'], ['42', null]]) assert.equal(parseBody(text, type), null, JSON.stringify(text));
});

test('inputs nested one level down are found; a flat body and a real input named query or data are left alone', async () => {
  const { unwrapBody } = await load();
  const known = (names) => (n) => names.includes(n);
  assert.deepEqual(unwrapBody({ input: { text: 'hi' } }, known(['text'])), { text: 'hi' });
  assert.deepEqual(unwrapBody({ arguments: { name: 'example.com' }, id: 7 }, known(['name'])), { name: 'example.com' });
  assert.deepEqual(unwrapBody({ params: { q: 'btc' } }, known(['q'])), { q: 'btc' });
  const flat = { text: 'hi', input: { text: 'other' } };
  assert.equal(unwrapBody(flat, known(['text'])), flat, 'a known top-level field wins');
  const search = { query: 'weather in Oslo' };
  assert.equal(unwrapBody(search, known(['query'])), search);
  const csv = { data: 'a,b\n1,2' };
  assert.equal(unwrapBody(csv, known(['text'])), csv, 'a string under a wrapper name is not a wrapper');
  const two = { input: { text: 'a' }, params: { text: 'b' } };
  assert.equal(unwrapBody(two, known(['text'])), two, 'two candidates: no guess');
  const none = { input: { other: 1 } };
  assert.equal(unwrapBody(none, known(['text'])), none, 'a nested object with no known input is not unwrapped');
  assert.equal(unwrapBody(null, known(['text'])), null);
});
