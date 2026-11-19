// Quote front (19 Nov 2026): a challenge minted by src/front/challenges.ts (mppx core only) must be the same challenge the
// core's mppx server would issue for the same route, apart from the per-issuance id, nonce and expiry, and must verify with
// the core's secret (Challenge.verify is what the server runs on a returning credential). Tempo and evm.
const assert = require("node:assert/strict");
const { test, before } = require("node:test");
const esbuild = require("esbuild");
const Module = require("node:module");
const path = require("node:path");

let F, mppx;
const ROOT = "test-root-secret-0123456789abcdef0123456789";
const REALM = "agent-data-tools.revmesh2074.workers.dev";
const load = async (entry, name) => {
  const out = await esbuild.build({ entryPoints: [entry], bundle: true, platform: "node", format: "cjs", write: false, logLevel: "silent" });
  const mod = new Module(name, null); mod.filename = path.resolve(name); mod.paths = Module._nodeModulePaths(process.cwd()); mod._compile(out.outputFiles[0].text, mod.filename); return mod.exports;
};
before(async () => {
  F = await load(require.resolve("../src/front/challenges.ts"), "front-challenges.js");
  mppx = await load(require.resolve("mppx"), "mppx-core.js");
});

const TEMPO = { method: "tempo", intent: "charge", scope: "/pack/url-safety", description: "URL safety check, scam signals: domain age, redirects and HTTPS",
  request: { amount: "10000", currency: "0x20c000000000000000000000b9537d11c60e8b50", methodDetails: { chainId: 4217, supportedModes: ["pull"] }, recipient: "0x6293ded2684f1a76e26becef87c137d691fbf800" } };
const EVM = { method: "evm", intent: "charge", scope: "/pack/url-safety", description: TEMPO.description,
  request: { amount: "10000", currency: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", methodDetails: { chainId: 8453, credentialTypes: ["authorization"], decimals: 6 }, recipient: "0x6293ded2684F1A76E26bEcef87c137D691Fbf800" } };

for (const terms of [TEMPO, EVM]) {
  test(`${terms.method}: a front challenge verifies with the core's derived secret and fails with any other`, async () => {
    const secret = await F.challengeSecretHex(ROOT, terms.method);
    const header = F.mintChallenge(terms, REALM, secret);
    const ch = mppx.Challenge.deserialize(header);
    assert.equal(mppx.Challenge.verify(ch, { secretKey: secret }), true, "core's check accepts it");
    const other = await F.challengeSecretHex(ROOT + "x", terms.method);
    assert.equal(mppx.Challenge.verify(ch, { secretKey: other }), false, "a different secret does not");
    const otherMethod = await F.challengeSecretHex(ROOT, terms.method === "tempo" ? "evm" : "tempo");
    assert.equal(mppx.Challenge.verify(ch, { secretKey: otherMethod }), false, "the other method's key does not");
  });

  test(`${terms.method}: fields match the live production challenge shape; nonce and id are fresh every time`, async () => {
    const secret = await F.challengeSecretHex(ROOT, terms.method);
    const now = Date.parse("2026-11-19T20:00:00Z");
    const a = mppx.Challenge.deserialize(F.mintChallenge(terms, REALM, secret, now));
    const b = mppx.Challenge.deserialize(F.mintChallenge(terms, REALM, secret, now));
    assert.equal(a.realm, REALM); assert.equal(a.method, terms.method); assert.equal(a.intent, "charge");
    assert.deepEqual(a.request, terms.request);
    assert.equal(a.description, terms.description);
    assert.equal(new Date(a.expires).toISOString(), "2026-11-19T20:05:00.000Z");
    const am = mppx.Challenge.meta(a) ?? (a.opaque ? JSON.parse(Buffer.from(a.opaque, "base64url").toString()) : {}), bm = mppx.Challenge.meta(b) ?? (b.opaque ? JSON.parse(Buffer.from(b.opaque, "base64url").toString()) : {});
    assert.equal(am._mppx_scope, terms.scope);
    assert.match(am._mppx_nonce, /^0x[0-9a-f]{64}$/);
    assert.notEqual(am._mppx_nonce, bm._mppx_nonce, "a challenge pays once: never reuse a nonce");
    assert.notEqual(a.id, b.id);
  });
}

test("the derived secret equals the core's derivation (src/lib/mpp-tempo.ts / mpp-evm.ts)", async () => {
  const fs = require("node:fs");
  for (const [file, label] of [["src/lib/mpp-tempo.ts", "mpp-tempo-challenge-signing"], ["src/lib/mpp-evm.ts", "mpp-evm-challenge-signing"]]) {
    const src = fs.readFileSync(file, "utf8");
    assert.ok(src.includes(`"${label}"`), `${file} still signs with ${label}`);
    assert.ok(/MPP_SECRET_KEY \|\| env\.CDP_API_KEY_SECRET/.test(src), `${file} still roots the secret in MPP_SECRET_KEY || CDP_API_KEY_SECRET`);
    assert.ok(/padStart\(2, "0"\)\)\.join\(""\)/.test(src), `${file} still returns the secret as hex`);
  }
  assert.equal(F.SIGNING_LABEL.tempo, "mpp-tempo-challenge-signing");
  assert.equal(F.SIGNING_LABEL.evm, "mpp-evm-challenge-signing");
});
