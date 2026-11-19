// Signed seller evidence: fixed-point amounts, aggregation of already-public facts, and an Ed25519
// signature that verifies against the same JWKS the payee attestations publish. No network here.
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

let seller, payee;
before(async () => {
  seller = await loadTypeScript(require.resolve("../src/lib/seller-evidence.ts"));
  payee = await loadTypeScript(require.resolve("../src/routes/payee.ts"));
});

const revenue = {
  sinceUtc: "2026-10-21", settlements: 2275, grossAtomic: "19352000", selfPayments: 3229,
  asset: "USDC", decimals: 6,
  byEndpoint: {
    "/pack/url-safety": { settlements: 1154, grossAtomic: "11540000" },
    "/btc-fees": { settlements: 5, grossAtomic: "10000" },
  },
  payerActivity: { distinctExternalWallets: 85, returningOnAnotherUtcDay: 27 },
  evidence: "facilitator-reported; independent chain reconciliation pending",
};
const reliability = {
  windowDays: 7, served: 4398, serverErrors: 17, successRate: 0.996,
  recent: { days: 3, served: 1200, serverErrors: 2, successRate: 0.998 },
  medianDailySuccessRate: 0.997, daysAt99: 6,
};

test("atomic USDC amounts are exact fixed-point strings, never floats", () => {
  assert.equal(seller.usdcAmount("19352000"), "19.352000");
  assert.equal(seller.usdcAmount("11540000"), "11.540000");
  assert.equal(seller.usdcAmount("1"), "0.000001");
  assert.equal(seller.usdcAmount("0"), "0.000000");
  assert.equal(seller.usdcAmount("garbage"), "0.000000");
  assert.equal(seller.usdcAmount("12345", 3), "12.345");
});

test("seller evidence aggregates public facts and states its limits", async () => {
  const e = await seller.sellerEvidence({}, "https://agent.test", revenue, reliability);
  assert.equal(e.signature, null, "no key configured means an unsigned, still truthful document");
  assert.equal(e.payload.type, "agent-data-tools.seller-evidence.v1");
  assert.equal(e.payload.iss, "https://agent.test");
  assert.equal(e.payload.delivery.paidCalls, 2275);
  assert.equal(e.payload.delivery.grossUsdc, "19.352000");
  assert.equal(e.payload.delivery.selfPaymentsExcluded, 3229);
  assert.equal(e.payload.delivery.window.sinceUtc, "2026-10-21");
  assert.equal(e.payload.delivery.topPaidTools[0].path, "/pack/url-safety");
  assert.equal(e.payload.delivery.topPaidTools[0].grossUsdc, "11.540000");
  assert.equal(e.payload.reliability.successRate, 0.996);
  assert.equal(e.payload.reliability.recent.days, 3);
  assert.equal(e.payload.limitations.length, 4);
  assert.match(e.payload.verify.receiptExample.transaction, /^0x[0-9a-f]{64}$/);
  assert.match(e.canonical, /^\{"delivery":/, "canonical JSON has sorted keys");
});

test("a malformed decimals field falls back to six without throwing", async () => {
  const e = await seller.sellerEvidence({}, "https://agent.test", { ...revenue, decimals: 99 }, reliability);
  assert.equal(e.payload.delivery.decimals, 6);
  assert.equal(e.payload.delivery.grossUsdc, "19.352000");
});

test("the evidence is signed with Ed25519 and verifies against the published key", async () => {
  const pair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  const env = { PAYEE_SIGNING_KEY: JSON.stringify(jwk) };
  const e = await seller.sellerEvidence(env, "https://agent.test", revenue, reliability);
  assert.ok(e.signature);
  const keys = await payee.publicKeys(env);
  assert.equal(keys.keys[0].kid, e.kid);
  const pub = await crypto.subtle.importKey("jwk", { kty: "OKP", crv: "Ed25519", x: keys.keys[0].x }, { name: "Ed25519" }, false, ["verify"]);
  const sig = Uint8Array.from(Buffer.from(e.signature, "base64url"));
  assert.equal(await crypto.subtle.verify({ name: "Ed25519" }, pub, sig, new TextEncoder().encode(e.canonical)), true);
  assert.equal(await crypto.subtle.verify({ name: "Ed25519" }, pub, sig, new TextEncoder().encode(e.canonical.replace('"paidCalls":2275', '"paidCalls":2276'))), false);
});
