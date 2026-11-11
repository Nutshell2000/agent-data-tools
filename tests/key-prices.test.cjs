// What a prepaid key pays (lib/key-prices.ts): the tools named one by one in KEY_PRICES, and one credit for every tool that
// only computes (LOCAL_PATHS). The owner, 11 Nov 2026: "Yes, all three" (a key price of 1 credit for pure lookups and
// converters). The public price of every tool is unchanged; a wallet paying per call never sees the key price charged.
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

let ENDPOINTS, LOCAL_PATHS, ENTRY_OF, KEY_PRICES, keys;
before(async () => {
  ({ ENDPOINTS } = await loadTypeScript(require.resolve("../src/endpoints.ts")));
  ({ LOCAL_PATHS } = await loadTypeScript(require.resolve("../src/families.ts")));
  ({ ENTRY_OF } = await loadTypeScript(require.resolve("../src/routes/entry-paths.ts")));
  ({ KEY_PRICES } = await loadTypeScript(require.resolve("../src/lib/credits.ts")));
  keys = await loadTypeScript(require.resolve("../src/lib/key-prices.ts"));
});

const priceOf = (path) => ENDPOINTS.find((e) => e.path === path)?.price;

test("every live tool that only computes costs one credit with a key, and its public price stands", () => {
  const live = [...LOCAL_PATHS].filter((path) => priceOf(path));
  assert.ok(live.length >= 80, `expected the local tools to be live, found ${live.length}`);
  for (const path of live) {
    const price = priceOf(path);
    assert.ok(Number(price.slice(1)) >= 0.002, `${path}: the public price keeps the floor`);
    assert.equal(keys.keyPrice(path, price), "$0.001", path);
    assert.equal(keys.keyPriceFor(path, price), "$0.001", path);
    assert.match(keys.keyPriceLine(path, price, "https://api.test"), /costs \$0\.001 a call instead of the price above: \$1 pays for 1,000 calls.*https:\/\/api\.test\/credits/);
  }
});

test("the tools named one by one keep their key price, below their public price", () => {
  for (const [path, withKey] of Object.entries(KEY_PRICES)) {
    const price = priceOf(path);
    assert.ok(price, `${path} is a live tool`);
    assert.ok(Number(withKey.slice(1)) < Number(price.slice(1)), `${path}: a key price must be below the public price`);
    assert.equal(keys.keyPrice(path, price), withKey);
    assert.match(keys.keyPriceLine(path, price, "https://api.test"), /\$1 pays for 500 calls.*https:\/\/api\.test\/credits/);
  }
  assert.equal(priceOf("/pdf/text"), "$0.005");
});

test("an entry path pays what its tool pays", () => {
  const doors = Object.entries(ENTRY_OF).filter(([door]) => priceOf(door));
  assert.ok(doors.length > 20);
  let localDoors = 0;
  for (const [door, tool] of doors) {
    assert.equal(keys.keyPrice(door, priceOf(door)), keys.keyPrice(tool, priceOf(door)), `${door} -> ${tool}`);
    if (LOCAL_PATHS.has(tool)) { localDoors += 1; assert.equal(keys.keyPrice(door, priceOf(door)), "$0.001", door); }
  }
  assert.ok(localDoors >= 1, "at least one door runs a tool that only computes");
});

test("every other tool costs a key its public price, and nothing is ever dearer with a key", () => {
  const named = new Set(Object.keys(KEY_PRICES));
  for (const e of ENDPOINTS) {
    const tool = Object.hasOwn(ENTRY_OF, e.path) ? ENTRY_OF[e.path] : e.path;
    const withKey = keys.keyPrice(e.path, e.price);
    assert.ok(Number(withKey.slice(1)) <= Number(e.price.slice(1)), e.path);
    if (!LOCAL_PATHS.has(tool) && !named.has(tool) && !named.has(e.path)) {
      assert.equal(withKey, e.price, e.path);
      assert.equal(keys.keyPriceFor(e.path, e.price), undefined, e.path);
      assert.equal(keys.keyPriceLine(e.path, e.price, "https://api.test"), undefined, e.path);
    }
  }
  // Data from outside, an AI model or a browser is never one credit.
  for (const path of ["/weather", "/extract", "/ai/chat", "/screenshot", "/search", "/eth/balance", "/price/token"]) {
    assert.equal(keys.keyPrice(path, priceOf(path)), priceOf(path), path);
  }
  // A key price that is not below the public price is no offer at all.
  assert.equal(keys.keyPriceFor("/hash", "$0.001"), undefined);
});
