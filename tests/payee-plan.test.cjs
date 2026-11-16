// Step A of the all-rails plan: the accepts list in a payee declaration and /payee/plan's rail choice. Non-custodial:
// the plan names what to pay where; nothing here pays, routes or holds money. No network.
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

let payee, plan;
before(async () => {
  payee = await loadTypeScript(require.resolve("../src/routes/payee.ts"));
  plan = await loadTypeScript(require.resolve("../src/routes/payee-plan.ts"));
});

const W = "0x1111111111111111111111111111111111111111";
const ACCEPTS = [
  { rail: "card", checkoutUrl: "https://buy.stripe.com/abc" },
  { rail: "x402", network: "base", payTo: W },
  { rail: "swish", number: "123 999 99 99" },
  { rail: "sepa-instant", instructionsUrl: "https://shop.example.com/pay" },
  { rail: "mpp", method: "tempo", url: "https://shop.example.com/api" },
];
const record = (over = {}) => ({
  domain: "shop.example.com", status: "verified", flags: [], verifiedAt: "2026-11-15T12:00:00.000Z", expiresAt: "2026-12-15T12:00:00.000Z",
  wallets: [{ address: W, network: "base", proof: "signature", sanctions: "pass" }],
  accepts: payee.parseAccepts(ACCEPTS, []), company: {}, einvoice: null, sources: [], checks: {},
  ...over,
});
const pass = { verdict: "pass", reasons: [] };
const input = (over = {}) => ({ amount: 5, currency: "USD", can: ["x402", "mpp", "card", "sepa-instant", "swish"], network: null, ...over });

test("accepts entries are read; bad ones are named and dropped; no account numbers are taken", () => {
  const problems = [];
  const a = payee.parseAccepts([...ACCEPTS, { rail: "sepa", iban: "SE3550000000054910000003" }, { rail: "swish", number: "0701234567" }, { rail: "card", checkoutUrl: "http://insecure.example" }, { rail: "fax" }], problems);
  assert.deepEqual(a.map((x) => x.rail), ["card", "x402", "swish", "sepa-instant", "mpp"]);
  assert.equal(a[0].provider, "Stripe");
  assert.equal(a[2].number, "1239999999");
  assert.ok(!JSON.stringify(a).includes("SE3550"), "an IBAN is never kept");
  assert.equal(problems.length, 4);
  assert.ok(problems.some((p) => /do not store account numbers/.test(p)) && problems.some((p) => /unknown rail fax/.test(p)));
  const bad = []; payee.parseAccepts("x402", bad); assert.deepEqual(bad, ["accepts must be a list"]);
});

test("in USD the signed x402 wallet is chosen first, and card ranks last", () => {
  const p = plan.planPayment(record(), pass, input());
  assert.equal(p.chosen.rail, "x402");
  assert.equal(p.chosen.instruction.payTo, W);
  assert.equal(p.chosen.instruction.amount, 5);
  assert.equal(p.chosen.final, true);
  assert.equal(p.options.at(-1).rail, "card");
  assert.equal(p.options.at(-1).chargebacks, true);
  assert.deepEqual(p.excluded.map((e) => e.rail).sort(), ["sepa-instant", "swish"], "euro and krona rails are left out for a USD price");
});

test("currency and the buyer's rails decide: SEK goes to Swish, EUR to SEPA Instant when crypto is not possible", () => {
  assert.equal(plan.planPayment(record(), pass, input({ currency: "SEK", can: ["swish", "card"] })).chosen.rail, "swish");
  assert.equal(plan.planPayment(record(), pass, input({ currency: "EUR", can: ["sepa-instant", "card"] })).chosen.rail, "sepa-instant");
  const eurCrypto = plan.planPayment(record(), pass, input({ currency: "EUR" }));
  assert.equal(eurCrypto.chosen.rail, "x402");
  assert.match(eurCrypto.chosen.notes.join(" "), /exchange step/);
});

test("small amounts skip card; a blocked or unproven wallet is excluded or marked down", () => {
  const tiny = plan.planPayment(record(), pass, input({ amount: 0.01, can: ["card", "x402"] }));
  assert.equal(tiny.chosen.rail, "x402");
  assert.ok(tiny.excluded.some((e) => e.rail === "card" && /minimum/.test(e.excluded)));
  const blocked = plan.planPayment(record({ wallets: [{ address: W, network: "base", proof: "signature", sanctions: "block" }] }), pass, input({ can: ["x402"] }));
  assert.equal(blocked.chosen, null);
  const unproven = plan.planPayment(record({ wallets: [{ address: W, network: "base", proof: "declared", sanctions: "pass" }] }), pass, input({ can: ["x402", "card"] }));
  assert.equal(unproven.chosen.rail, "x402");
  assert.match(unproven.chosen.notes.join(" "), /not proven/);
});

test("no record or a block verdict gives no plan; an old record without accepts falls back to its wallets", () => {
  assert.equal(plan.planPayment(null, { verdict: "unknown", reasons: ["no record"] }, input()).chosen, null);
  assert.equal(plan.planPayment(record(), { verdict: "block", reasons: ["OFAC"] }, input()).options.length, 0);
  const old = record({ accepts: undefined });
  assert.equal(plan.planPayment(old, pass, input()).chosen.rail, "x402");
});

test("verification flags an x402 payTo outside payTo and an unknown card host", async () => {
  const doc = { payTo: [W], accepts: [{ rail: "x402", payTo: "0x2222222222222222222222222222222222222222" }, { rail: "card", checkoutUrl: "https://pay.unknown.example/x" }] };
  const r = await payee.verifyPayee("shop.example.com", {
    declaration: async () => ({ found: true, text: JSON.stringify(doc) }), kyb: async () => { throw new Error("not called"); },
    walletSanctions: async () => "pass", verifySignature: async () => false, now: () => new Date("2026-11-15T12:00:00Z"),
  });
  assert.equal(r.accepts.length, 2);
  assert.ok(r.flags.some((f) => /not in payTo/.test(f)));
  assert.ok(r.flags.some((f) => /not a payment provider we know/.test(f)));
});
