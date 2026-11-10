const assert = require("node:assert/strict");
const { before, test } = require("node:test");
const esbuild = require("esbuild");
const Module = require("node:module");

async function loadTypeScript(entry) {
  const built = await esbuild.build({ entryPoints: [entry], bundle: true, platform: "node", format: "cjs", write: false, external: ["cloudflare:workers"] });
  const mod = new Module(entry, null);
  mod.filename = entry;
  mod.paths = Module._nodeModulePaths(process.cwd());
  mod._compile(built.outputFiles[0].text, entry);
  return mod.exports;
}

let ENDPOINTS, CARD_JOBS, callsAt, keyPrice, paymentHint, isHumanPage;
before(async () => {
  ({ ENDPOINTS } = await loadTypeScript(require.resolve("../src/endpoints.ts")));
  ({ CARD_JOBS, paymentHint } = await loadTypeScript(require.resolve("../src/lib/credit-routes.ts")));
  ({ callsAt, keyPrice } = await loadTypeScript(require.resolve("../src/lib/credits.ts")));
  ({ isHumanPage } = await loadTypeScript(require.resolve("../src/lib/funnel.ts")));
});

test("what $1 buys on /credits matches the catalog prices", () => {
  for (const { path, credits } of CARD_JOBS) {
    const tool = ENDPOINTS.find((e) => e.path === path);
    assert.ok(tool, path);
    // A key pays the key price where one exists (KEY_PRICES: PDF reading), otherwise the catalog price.
    assert.equal(Math.round(Number(keyPrice(path, tool.price).slice(1)) * 1000), credits, path);
  }
});

test("hints count calls at the tool's own price", () => {
  assert.equal(callsAt(1000, "$0.005"), "200");
  assert.equal(callsAt(1000, "$0.002"), "500");
  assert.equal(callsAt(1000, "$0.03"), "33");
  assert.equal(callsAt(1000, "$0.05"), "20");
  assert.match(paymentHint("https://x.test", "$0.005"), /about 200 calls at \$0\.005/);
});

test("task guides count as pages people read, other paths under /guides do not", () => {
  assert.equal(isHumanPage("/guides/pdf-to-text-api"), true);
  assert.equal(isHumanPage("/guides/../revenue"), false);
  assert.equal(isHumanPage("/guides/a/b"), false);
});

test("a prepaid key pays the key price for PDF reading; the public price and every other tool are unchanged", async () => {
  const { KEY_PRICES, keyPriceLine } = await loadTypeScript(require.resolve("../src/lib/credits.ts"));
  for (const [path, price] of Object.entries(KEY_PRICES)) {
    const tool = ENDPOINTS.find((e) => e.path === path);
    assert.ok(tool, `${path} is a live tool`);
    assert.ok(Number(price.slice(1)) < Number(tool.price.slice(1)), `${path}: a key price must be below the public price`);
    assert.equal(keyPrice(path, tool.price), price);
    assert.match(keyPriceLine(path, "https://api.test"), /\$1 pays for 500 calls.*https:\/\/api\.test\/credits/);
  }
  assert.equal(ENDPOINTS.find((e) => e.path === "/pdf/text").price, "$0.005");
  assert.equal(keyPrice("/weather", "$0.002"), "$0.002");
  assert.equal(keyPriceLine("/weather", "https://api.test"), undefined);
});
