// What the code at an address says about it (11 Nov 2026). A wallet that delegates to contract code under EIP-7702
// carries 23 bytes of code and read "isContract: true" until this release. Local, no network.
const assert = require("node:assert/strict");
const { before, test } = require("node:test");
const esbuild = require("esbuild");
const Module = require("node:module");

async function load(entry) {
  const built = await esbuild.build({ entryPoints: [entry], bundle: true, platform: "node", format: "cjs", write: false, external: ["cloudflare:workers"] });
  const mod = new Module(entry, null);
  mod.filename = entry;
  mod.paths = Module._nodeModulePaths(process.cwd());
  mod._compile(built.outputFiles[0].text, entry);
  return mod.exports;
}

let C;
before(async () => { C = await load(require.resolve("../src/routes/chain-reads.ts")); });

test("an address without code is a plain wallet", () => {
  assert.deepEqual(C.codeKind("0x"), { isContract: false, codeBytes: 0, minimalProxy: false, implementation: null, delegatedTo: null });
});

test("an EIP-7702 delegation is a wallet, and the code it runs is named", () => {
  // The code an independent node returned on 11 Nov 2026 for 0xd8dA…6045 on Ethereum and on Base.
  const k = C.codeKind("0xef01005a7fc11397e9a8ad41bf10bf13f22b0a63f96f6d");
  assert.equal(k.isContract, false);
  assert.equal(k.codeBytes, 23);
  assert.equal(k.delegatedTo, "0x5a7fc11397e9a8ad41bf10bf13f22b0a63f96f6d");
  assert.equal(k.minimalProxy, false);
  // Upper-case hex from a node reads the same.
  assert.equal(C.codeKind("0xEF01005A7FC11397E9A8AD41BF10BF13F22B0A63F96F6D").delegatedTo, k.delegatedTo);
});

test("only the exact 23-byte designator counts as a delegation", () => {
  // Deployed code can never start with 0xef (EIP-3541), but a longer or shorter value must still not read as a wallet.
  assert.equal(C.codeKind("0xef01005a7fc11397e9a8ad41bf10bf13f22b0a63f96f6d00").isContract, true);
  assert.equal(C.codeKind("0xef0100").isContract, true);
});

test("ordinary code is a contract; an EIP-1167 clone names its implementation", () => {
  assert.deepEqual(C.codeKind("0x6080604052"), { isContract: true, codeBytes: 5, minimalProxy: false, implementation: null, delegatedTo: null });
  const clone = C.codeKind("0x363d3d373d3d3d363d73bebebebebebebebebebebebebebebebebebebebe5af43d82803e903d91602b57fd5bf3");
  assert.equal(clone.isContract, true);
  assert.equal(clone.minimalProxy, true);
  assert.equal(clone.implementation, "0xbebebebebebebebebebebebebebebebebebebebe");
});

test("the contract check and the wallet profile publish the delegation field", async () => {
  const { ENDPOINTS } = await load(require.resolve("../src/endpoints.ts"));
  for (const path of ["/eth/is-contract", "/base/is-contract", "/pack/wallet-profile"]) {
    const e = ENDPOINTS.find((x) => x.path === path);
    assert.ok(e, path);
    assert.ok("delegatedTo" in e.outputExample, `${path} example shows delegatedTo`);
  }
});
