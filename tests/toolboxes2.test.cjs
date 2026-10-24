const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const { build } = require('esbuild');

let T;
before(async () => {
  const b = await build({ entryPoints: ['src/routes/toolboxes2.ts'], bundle: true, format: 'cjs', platform: 'node', write: false, logLevel: 'silent' });
  const m = { exports: {} };
  new Function('module', 'exports', 'require', b.outputFiles[0].text)(m, m.exports, require);
  T = m.exports;
});

test('IDs: UUID v4 and v7 versions and variants, ULID and UUID v7 timestamps round-trip, NanoID alphabet', () => {
  for (let i = 0; i < 50; i++) {
    assert.match(T.uuidV4(), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.match(T.uuidV7(), /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.match(T.ulid(), /^[0-9A-HJKMNP-TV-Z]{26}$/);
    assert.match(T.nanoid(), /^[A-Za-z0-9_-]{21}$/);
  }
  const ms = Date.UTC(2026, 9, 24, 12, 0, 0);
  assert.equal(T.decodeId(T.ulid(ms)).ms, ms);
  assert.equal(T.decodeId(T.uuidV7(ms)).timestamp, new Date(ms).toISOString());
  assert.equal(T.decodeId(T.uuidV4()).timestamp, null);
  assert.equal(T.decodeId('not-an-id').kind, 'unknown');
  assert.ok(T.ulid(ms) < T.ulid(ms + 1000), 'ULIDs sort by time');
});

test('random strings use only the alphabet and the requested length', () => {
  const s = T.randomString(500);
  assert.equal(s.length, 500);
  assert.match(s, /^[0-9A-Za-z]+$/);
  assert.match(T.randomString(40, 'abc'), /^[abc]{40}$/);
});

test('strings: identifier splitting, every case, slug without accents', () => {
  const c = T.allCases('XMLHttpRequest userID_value');
  assert.equal(c.snake, 'xml_http_request_user_id_value');
  assert.equal(c.camel, 'xmlHttpRequestUserIdValue');
  assert.equal(c.constant, 'XML_HTTP_REQUEST_USER_ID_VALUE');
  assert.equal(c.kebab, 'xml-http-request-user-id-value');
  assert.equal(T.slugify('Crème Brûlée — 2026!'), 'creme-brulee-2026');
});
