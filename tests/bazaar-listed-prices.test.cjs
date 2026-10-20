const assert = require('node:assert/strict');
const { test } = require('node:test');
const Module = require('node:module');
const esbuild = require('esbuild');

// Tools already indexed in the Coinbase Bazaar keep the price their listing shows: the Bazaar only refreshes a
// listing on the next settled payment, and buyers that read it pay (or cap at) the listed amount. Changing one of
// these prices silently turns every Bazaar buyer into a refused payment. Update this table only together with a
// fresh settlement of that tool (owner decision), never on its own.
const BAZAAR_LISTED_PRICES = { '/btc-fees': '$0.002', '/package': '$0.002' };

async function load(path) {
  const entry = require.resolve(path);
  const b = await esbuild.build({ entryPoints: [entry], bundle: true, write: false, platform: 'node', format: 'cjs' });
  const m = new Module(entry, module); m.filename = entry; m.paths = Module._nodeModulePaths(process.cwd());
  m._compile(b.outputFiles[0].text, entry);
  return m.exports;
}

test('Bazaar-listed tools keep their listed price', async () => {
  const { ENDPOINTS } = await load('../src/endpoints.ts');
  for (const [path, price] of Object.entries(BAZAAR_LISTED_PRICES)) {
    assert.equal(ENDPOINTS.find((e) => e.path === path)?.price, price, `${path} must stay at its Bazaar-listed ${price}`);
  }
});
