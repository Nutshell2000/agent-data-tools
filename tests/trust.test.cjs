// The trust and evidence layer (11 Nov 2026): payout-wallet change verdicts, paycheck.json reading, canonical receipts,
// and the three listings. No network: the verdict and receipt logic is pure, and the listings are read from ENDPOINTS.
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

let T, endpoints;
before(async () => {
  T = (await load(require.resolve("../src/routes/trust.ts"))).__test;
  endpoints = await load(require.resolve("../src/endpoints.ts"));
});

const A = "0x6293ded2684F1A76E26bEcef87c137D691Fbf800";
const OLD = "0x2074c40346aE2A90e0e4a391BcEe6f16bF5277f5";
const EVIL = "0x000000000000000000000000000000000000dEaD";
const listing = (payTo) => ({ payTo, lastSettledAt: "2026-11-11T00:00:00Z", payers30d: 3, calls30d: 9 });
const none = { found: false, payTo: [] };

test("payout verdict: unchanged, declared rotation, undeclared change, no listing, no terms", () => {
  assert.deepEqual(T.payoutVerdict([A], listing([A]), none), { verdict: "pass", status: "unchanged", reasons: [] });
  // Case does not matter for EVM wallets.
  assert.equal(T.payoutVerdict([A.toLowerCase()], listing([A]), none).status, "unchanged");
  // The 7 Nov 2026 case: the listing still shows the old wallet, the seller declares both.
  assert.deepEqual(T.payoutVerdict([A], listing([OLD]), { found: true, payTo: [A, OLD] }), { verdict: "pass", status: "declared-rotation", reasons: [] });
  // The same change without a declaration is how a hijack looks.
  const hijack = T.payoutVerdict([EVIL], listing([A]), none);
  assert.equal(hijack.verdict, "review");
  assert.equal(hijack.status, "undeclared-change");
  assert.match(hijack.reasons[0], /has not declared the change/);
  // A declaration that names the new wallet but not the listed one is not a declared rotation.
  assert.equal(T.payoutVerdict([EVIL], listing([A]), { found: true, payTo: [EVIL] }).status, "undeclared-change");
  // A live wallet missing from the seller's own file is a reason even when the listing agrees.
  const notInFile = T.payoutVerdict([A], listing([A]), { found: true, payTo: [OLD] });
  assert.equal(notInFile.verdict, "review");
  assert.equal(notInFile.status, "unchanged");
  assert.equal(T.payoutVerdict([A], null, none).status, "not-listed");
  assert.equal(T.payoutVerdict([A], null, none).verdict, "pass");
  assert.equal(T.payoutVerdict([], listing([A]), none).status, "no-terms");
});

test("paycheck.json: Lumiere's payTo list, other field names, objects, junk", () => {
  assert.deepEqual(T.declaredWallets({ payTo: [A, OLD, A], tests: {} }), [A, OLD]);
  assert.deepEqual(T.declaredWallets({ wallets: [{ address: A }, { address: "" }, 7] }), [A]);
  assert.deepEqual(T.declaredWallets({ payouts: [" sol123 "] }), ["sol123"]);
  assert.equal(T.declaredWallets({ nothing: true }), null);
  assert.equal(T.declaredWallets("text"), null);
  assert.equal(T.declaredWallets(null), null);
});

test("canonical receipt text: key order never changes the text", () => {
  assert.equal(T.canonicalJson({ b: 1, a: { d: [2, { y: 1, x: null }], c: "z" } }), '{"a":{"c":"z","d":[2,{"x":null,"y":1}]},"b":1}');
  assert.equal(T.canonicalJson({ a: 1, b: 2 }), T.canonicalJson({ b: 2, a: 1 }));
});

test("the three listings: task-first names, five tags, at the ordinary price, real example hash", () => {
  const byPath = Object.fromEntries(endpoints.ENDPOINTS.map((e) => [e.path, e]));
  for (const p of ["/x402/payout-check", "/x402/seller-record", "/x402/receipt"]) {
    const e = byPath[p];
    assert.ok(e, p);
    assert.equal(e.price, "$0.01", p);
    assert.ok(e.tags.length >= 5, p);
    assert.match(e.description, /(^|\. )Use (when|to|for|before|as) /, p);
    assert.ok(e.description.length <= 450, `${p} description is ${e.description.length} characters`);
  }
  assert.match(byPath["/x402/receipt"].params.hash.example, /^0x[0-9a-f]{64}$/);
  assert.equal(byPath["/x402/receipt"].outputExample.transactionHash, byPath["/x402/receipt"].params.hash.example);
});
