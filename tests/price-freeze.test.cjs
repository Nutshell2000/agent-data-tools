const assert = require("node:assert/strict");
const Module = require("node:module");
const { before, test } = require("node:test");
const esbuild = require("esbuild");
const snapshot = require("./fixtures/price-freeze.json");

async function loadTypeScript(entry) {
  const result = await esbuild.build({ entryPoints: [entry], bundle: true, platform: "node", format: "cjs", write: false });
  const loaded = new Module(entry, module);
  loaded.filename = entry;
  loaded.paths = Module._nodeModulePaths(process.cwd());
  loaded._compile(result.outputFiles[0].text, entry);
  return loaded.exports;
}

let endpoints;
before(async () => {
  endpoints = await loadTypeScript(require.resolve("../src/endpoints.ts"));
});

// Existing prices are frozen until the 8 Nov stop-rule check (directories cache them, and a changed price makes
// v1 buyers fail with refused_amount). New tools set their own price; a removed tool must be removed on purpose.
test("no existing tool changes price before the freeze ends", { skip: new Date() >= new Date(`${snapshot.frozenUntil}T00:00:00Z`) }, () => {
  const live = Object.fromEntries(endpoints.ENDPOINTS.map((e) => [e.path, e.price]));
  for (const [path, price] of Object.entries(snapshot.prices)) {
    assert.ok(path in live, `${path} was removed during the price freeze`);
    assert.equal(live[path], price, `${path} changed price during the price freeze`);
  }
});
