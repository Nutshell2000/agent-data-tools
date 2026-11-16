// Verified payee records (2027 flagship, Phase 0): declaration parsing, verification statuses, wallet proofs, the paid
// check's verdicts and the signed attestation, with no network here.
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

let payee, viemAccounts, viem;
before(async () => {
  payee = await loadTypeScript(require.resolve("../src/routes/payee.ts"));
  viemAccounts = await import("viem/accounts");
  viem = await import("viem");
});

// Hardhat's public test key #0: never holds value.
const TEST_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const DOMAIN = "shop.example.com";

const kybPass = (over = {}) => ({
  verdict: "pass", flags: [],
  company: { name: "Example Shop AB", country: "SE", idType: "organisationsnummer", id: "559999-9999", legalForm: "Aktiebolag", status: null, source: "Bolagsverket and SCB (Sweden)" },
  groupParent: null, alternatives: [], lei: null,
  vat: { vat: "SE559999999901", valid: true, name: "Example Shop AB", given: true, derived: false },
  sanctions: { verdict: "pass", screenedNames: ["Example Shop"], matches: [], lists: [] },
  sources: ["Bolagsverket and SCB (Sweden)", "EU VIES (European Commission)"], failed: {}, checkedAt: "2026-11-15T08:00:00.000Z", note: "",
  ...over,
});

async function signedDeclaration() {
  const account = viemAccounts.privateKeyToAccount(TEST_KEY);
  const signature = await account.signMessage({ message: payee.walletMessage(DOMAIN, account.address) });
  return { account, doc: { version: 1, company: { name: "Example Shop AB", country: "SE", id: "559999-9999", vat: "SE559999999901" }, payTo: [{ address: account.address, network: "base", signature }], einvoice: { peppolId: "0007:5599999999", formats: ["ubl"] } } };
}

const deps = (doc, over = {}) => ({
  declaration: async () => (doc === null ? { found: false, reason: "HTTP 404" } : { found: true, text: JSON.stringify(doc) }),
  kyb: async () => kybPass(),
  walletSanctions: async () => "pass",
  verifySignature: async (address, message, signature) => viem.verifyMessage({ address, message, signature }),
  now: () => new Date("2026-11-15T12:00:00Z"),
  ...over,
});

test("domains are read from hosts and URLs; IPs, ports-only and bare names are refused", () => {
  assert.equal(payee.payeeDomain("Shop.Example.com"), "shop.example.com");
  assert.equal(payee.payeeDomain("https://shop.example.com/x?y=1"), "shop.example.com");
  assert.equal(payee.payeeDomain("shop.example.com."), "shop.example.com");
  for (const bad of ["", "localhost", "192.168.1.1", "exa mple.com", "-bad-.com"]) assert.throws(() => payee.payeeDomain(bad), /domain/);
});

test("a declaration is read leniently and its problems are named", () => {
  const { declaration, problems } = payee.parseDeclaration({
    company: { name: "X AB", country: "Sweden", vat: "se 5599-9999-9901", lei: "short" },
    payTo: ["0x1111111111111111111111111111111111111111", { address: "not-a-wallet" }, { address: "82wfSCZhCmZA7zwqqt6Q3FG8nqYBwUvbThP6M97fa9Q6" }],
    einvoice: { peppolId: "bad id", formats: ["ubl", 7] },
  });
  assert.equal(declaration.company.vat, "SE559999999901");
  assert.equal(declaration.company.country, null);
  assert.equal(declaration.company.lei, null);
  assert.deepEqual(declaration.wallets.map((w) => w.network), ["base", "solana"]);
  assert.equal(declaration.einvoice.peppolId, null);
  assert.deepEqual(declaration.einvoice.formats, ["ubl"]);
  assert.ok(problems.some((p) => /country/.test(p)) && problems.some((p) => /lei/.test(p)) && problems.some((p) => /not-a-wallet/.test(p)) && problems.some((p) => /peppolId/.test(p)));
  assert.deepEqual(payee.parseDeclaration([1, 2]).problems, ["the file is not a JSON object"]);
});

test("a registered company with a signed wallet is verified", async () => {
  const { doc, account } = await signedDeclaration();
  const r = await payee.verifyPayee(DOMAIN, deps(doc));
  assert.equal(r.status, "verified");
  assert.equal(r.checks.company, "pass");
  assert.deepEqual(r.wallets, [{ address: account.address, network: "base", proof: "signature", sanctions: "pass" }]);
  assert.equal(r.expiresAt, "2026-12-15T12:00:00.000Z");
  assert.equal(r.einvoice.peppolId, "0007:5599999999");
});

test("a signature for another domain does not prove the wallet", async () => {
  const { doc } = await signedDeclaration();
  const r = await payee.verifyPayee("other.example.com", deps(doc));
  assert.equal(r.status, "partial");
  assert.equal(r.wallets[0].proof, "bad-signature");
  assert.ok(r.flags.some((f) => /does not verify/.test(f)));
});

test("no declaration is status none; no company is partial", async () => {
  assert.equal((await payee.verifyPayee(DOMAIN, deps(null))).status, "none");
  const { doc } = await signedDeclaration();
  const r = await payee.verifyPayee(DOMAIN, deps({ ...doc, company: undefined }));
  assert.equal(r.status, "partial");
  assert.equal(r.checks.company, "not-declared");
});

test("a sanctions match, a blocked wallet or a different register ID means review", async () => {
  const { doc } = await signedDeclaration();
  const sanctioned = await payee.verifyPayee(DOMAIN, deps(doc, { kyb: async () => kybPass({ verdict: "review", sanctions: { verdict: "review", screenedNames: ["Example Shop"], matches: [{ list: "eu" }], lists: [] } }) }));
  assert.equal(sanctioned.status, "review");
  const blocked = await payee.verifyPayee(DOMAIN, deps(doc, { walletSanctions: async () => "block" }));
  assert.equal(blocked.status, "review");
  const otherId = await payee.verifyPayee(DOMAIN, deps({ ...doc, company: { ...doc.company, id: "556703-7485" } }));
  assert.equal(otherId.status, "review");
  assert.ok(otherId.flags.some((f) => /register ID/.test(f)));
});

test("the paid check compares the quote's wallet with the record", async () => {
  const { doc, account } = await signedDeclaration();
  const record = await payee.verifyPayee(DOMAIN, deps(doc));
  const same = payee.walletMatches([account.address.toLowerCase()], record);
  assert.equal(same[0].match, "signed");
  assert.equal(payee.checkVerdict(record, same, false).verdict, "pass");
  const other = payee.walletMatches(["0x2222222222222222222222222222222222222222"], record);
  assert.equal(other[0].match, "not-declared");
  assert.equal(payee.checkVerdict(record, other, false).verdict, "review");
  assert.equal(payee.checkVerdict(null, [], false).verdict, "unknown");
  assert.equal(payee.checkVerdict(record, same, true).verdict, "block");
});

test("the attestation is signed with Ed25519 and verifies against the published key", async () => {
  const { doc } = await signedDeclaration();
  const record = await payee.verifyPayee(DOMAIN, deps(doc));
  const unsigned = await payee.attest(record, {}, "https://issuer.example");
  assert.equal(unsigned.signature, null);
  assert.equal(unsigned.payload.wallets.length, 1);

  const pair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  const env = { PAYEE_SIGNING_KEY: JSON.stringify(jwk) };
  const a = await payee.attest(record, env, "https://issuer.example");
  assert.equal(a.payload.sub, DOMAIN);
  assert.equal(a.payload.status, "verified");
  assert.equal(a.payload.company.vat, "SE559999999901");
  const keys = await payee.publicKeys(env);
  assert.equal(keys.keys[0].kid, a.kid);
  assert.equal(keys.keys[0].d, undefined);
  const pub = await crypto.subtle.importKey("jwk", { kty: "OKP", crv: "Ed25519", x: keys.keys[0].x }, { name: "Ed25519" }, false, ["verify"]);
  const sig = Uint8Array.from(Buffer.from(a.signature, "base64url"));
  assert.equal(await crypto.subtle.verify({ name: "Ed25519" }, pub, sig, new TextEncoder().encode(a.canonical)), true);
  assert.equal(await crypto.subtle.verify({ name: "Ed25519" }, pub, sig, new TextEncoder().encode(a.canonical.replace("verified", "partial"))), false);
});
