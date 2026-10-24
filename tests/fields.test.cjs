const assert = require('node:assert/strict');
const Module = require('node:module');
const { before, test } = require('node:test');
const esbuild = require('esbuild');

async function loadTypeScript(entry) {
  const result = await esbuild.build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'cjs', write: false });
  const loaded = new Module(entry, module);
  loaded.filename = entry;
  loaded.paths = Module._nodeModulePaths(process.cwd());
  loaded._compile(result.outputFiles[0].text, entry);
  return loaded.exports;
}

let fields, endpoints;
before(async () => {
  fields = await loadTypeScript('src/lib/fields.ts');
  endpoints = await loadTypeScript('src/endpoints.ts');
});

test('pickFields keeps only the listed top-level keys and leaves everything else alone', () => {
  const r = { a: 1, b: { c: 2 }, d: [3] };
  assert.deepEqual(fields.pickFields(r, 'a, d'), { a: 1, d: [3] });
  assert.deepEqual(fields.pickFields(r, 'b'), { b: { c: 2 } });
  assert.equal(fields.pickFields(r, undefined), r);
  assert.equal(fields.pickFields(r, ''), r);
  assert.equal(fields.pickFields(r, 'nope,zzz'), r, 'no match returns the full result');
  assert.deepEqual(fields.pickFields([1, 2], 'a'), [1, 2]);
  assert.equal(fields.pickFields(null, 'a'), null);
});

test('every paid tool publishes an input schema; tools without inputs of their own carry only, and examples ignore it', () => {
  const noInput = [];
  for (const e of endpoints.ENDPOINTS) {
    const names = Object.keys(e.params);
    assert.ok(names.length >= 1, `${e.path} has no parameters`);
    if (names.length === 1 && names[0] === 'only') noInput.push(e.path);
    assert.deepEqual(endpoints.exampleParams(e).filter(([n]) => n === 'only'), [], `${e.path} example must not use only`);
  }
  assert.deepEqual(noInput.sort(), ['/arb/gas', '/base-gas', '/btc-fees', '/btc-price', '/eth/gas', '/network', '/op/gas', '/pack/gas-tracker', '/ping', '/polygon/gas', '/yes-no']);
  assert.deepEqual(endpoints.exampleParams(endpoints.ENDPOINTS.find((e) => e.path === '/btc-fees')), [], 'the Bazaar-listed /btc-fees example stays input-free');
});
