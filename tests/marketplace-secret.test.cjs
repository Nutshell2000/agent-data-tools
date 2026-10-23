const assert = require("node:assert/strict");
const Module = require("node:module");
const { before, test } = require("node:test");
const esbuild = require("esbuild");

async function loadTypeScript(entry) {
  const result = await esbuild.build({ entryPoints: [entry], bundle: true, platform: "node", format: "cjs", write: false });
  const loaded = new Module(entry, module);
  loaded.filename = entry;
  loaded.paths = Module._nodeModulePaths(process.cwd());
  loaded._compile(result.outputFiles[0].text, entry);
  return loaded.exports;
}

let viaMarketplace, marketplaceOf;
before(async () => { ({ viaMarketplace, marketplaceOf } = await loadTypeScript(require.resolve("../src/lib/marketplace.ts"))); });

test("FluxA's proxy secret names the marketplace; each secret only works in its own header", () => {
  const env = { RAPIDAPI_PROXY_SECRET: a, FLUXA_PROXY_SECRET: b };
  assert.equal(marketplaceOf(env, a, undefined), "rapidapi");
  assert.equal(marketplaceOf(env, undefined, b), "fluxa");
  assert.equal(marketplaceOf(env, b, undefined), false, "the FluxA secret in the RapidAPI header");
  assert.equal(marketplaceOf(env, undefined, a), false, "the RapidAPI secret in the FluxA header");
  assert.equal(marketplaceOf({ RAPIDAPI_PROXY_SECRET: a }, undefined, b), false, "no FluxA secret configured");
  assert.equal(marketplaceOf(env, undefined, b.slice(1)), false);
});

const a = "a".repeat(24), b = "b".repeat(32), c = "c".repeat(20);

test("each RapidAPI listing's proxy secret is accepted from a comma-separated list", () => {
  const env = { RAPIDAPI_PROXY_SECRET: `${a},${b}, ${c}` };
  for (const secret of [a, b, c]) assert.equal(viaMarketplace(env, secret), true);
  assert.equal(viaMarketplace({ RAPIDAPI_PROXY_SECRET: a }, a), true);
});

test("anything other than an exact listed secret is refused", () => {
  const env = { RAPIDAPI_PROXY_SECRET: `${a},${b}` };
  for (const sent of [undefined, "", `${a},${b}`, a.slice(1), a + "a", "x".repeat(24), b.toUpperCase()]) assert.equal(viaMarketplace(env, sent), false, String(sent));
  assert.equal(viaMarketplace({}, a), false);
  assert.equal(viaMarketplace({ RAPIDAPI_PROXY_SECRET: "short,also-short" }, "short"), false);
});
