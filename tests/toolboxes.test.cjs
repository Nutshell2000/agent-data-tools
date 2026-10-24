const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const { build } = require('esbuild');

let T;
before(async () => {
  const b = await build({ entryPoints: ['src/routes/toolboxes.ts'], bundle: true, format: 'cjs', platform: 'node', write: false, logLevel: 'silent' });
  const m = { exports: {} };
  new Function('module', 'exports', 'require', b.outputFiles[0].text)(m, m.exports, require);
  T = m.exports;
});
const enc = (s) => new TextEncoder().encode(s);
const run = async (path, params) => T.TOOLBOXES.find((f) => f.endpoint.path === path).run({}, (n) => params[n]);

test('MD5 and CRC-32 on standard vectors, SHA via Web Crypto, SRI form', async () => {
  assert.equal(T.md5(enc('')), 'd41d8cd98f00b204e9800998ecf8427e');
  assert.equal(T.md5(enc('abc')), '900150983cd24fb0d6963f7d28e17f72');
  assert.equal(T.md5(enc('The quick brown fox jumps over the lazy dog')), '9e107d9d372bb6826bd81d3542a419d6');
  assert.equal(T.md5(enc('a'.repeat(1000))), 'cabe45dcc9ae5b66ba86600cca6b8ba8');
  assert.equal(T.crc32(enc('123456789')), 'cbf43926');
  const h = await T.hashAll(enc('abc'));
  assert.equal(h.sha256, 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(h.keccak256, '0x4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45');
  assert.match(h.sri.sha384, /^sha384-[A-Za-z0-9+/]+=*$/);
  const hex = await run('/pack/hash-toolbox', { text: '0x616263', hex: 'true' });
  assert.equal(hex.md5, '900150983cd24fb0d6963f7d28e17f72');
  await assert.rejects(run('/pack/hash-toolbox', { text: 'zz', hex: 'true' }), (e) => e.status === 400);
});

test('encodings: forms and automatic decoding of already-encoded input', () => {
  const e = T.encodings('a b');
  assert.equal(e.urlComponent, 'a%20b');
  assert.equal(e.hex, '612062');
  assert.equal(T.encodings('aGVsbG8gd29ybGQ=').decoded.base64, 'hello world');
  assert.equal(T.encodings('68656c6c6f').decoded.hex, 'hello');
  assert.equal(T.encodings('caf%C3%A9').decoded.url, 'café');
  assert.equal(T.encodings('a &amp; b &#x263A;').decoded.html, 'a & b ☺');
  assert.equal(T.encodings('bücher.de').punycode, 'xn--bcher-kva.de');
  assert.deepEqual(T.encodings('plain words').decoded, {});
});

test('JSON toolbox: invalid input with line and column, sorted keys, stats and YAML', async () => {
  const bad = await run('/pack/json-toolbox', { json: '{\n  "a": 1,\n  "b": }' });
  assert.equal(bad.valid, false);
  assert.ok(bad.error.message);
  const ok = await run('/pack/json-toolbox', { json: '{"b":[1,null],"a":{"c":true}}', sortKeys: 'true' });
  assert.equal(ok.minified, '{"a":{"c":true},"b":[1,null]}');
  assert.deepEqual(ok.stats, { depth: 2, objects: 2, arrays: 1, keys: 3, strings: 0, numbers: 1, booleans: 1, nulls: 1 });
  assert.match(ok.yaml, /^b:\n/m);
  assert.equal(ok.schema.type, 'object');
});
