// /pack/counterparty-full and /pack/einvoice-check (16 Nov 2026, src/routes/packs-business.ts): the verdict only repeats
// the sections' own verdicts, a failing section is reported and the rest answer, every section failing is an uncharged
// 502, and a pack never costs more than its sections bought one by one. Fake sections and a fake VIES: no network here.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const { before, test } = require("node:test");
const esbuild = require("esbuild");

async function loadTypeScript(entry) {
  const result = await esbuild.build({ entryPoints: [entry], bundle: true, platform: "node", format: "cjs", write: false, logLevel: "silent" });
  const loaded = new Module(entry, module);
  loaded.filename = entry;
  loaded.paths = Module._nodeModulePaths(process.cwd());
  loaded._compile(result.outputFiles[0].text, entry);
  return loaded.exports;
}

let B, endpoints, einvoice, bazaar, capacity, fileInput, longInput, recommend, mcpCompact;
before(async () => {
  B = await loadTypeScript(require.resolve("../src/routes/packs-business.ts"));
  endpoints = await loadTypeScript(require.resolve("../src/endpoints.ts"));
  einvoice = await loadTypeScript(require.resolve("../src/routes/einvoice.ts"));
  bazaar = await loadTypeScript(require.resolve("../src/lib/bazaar-extension.ts"));
  capacity = await loadTypeScript(require.resolve("../src/lib/capacity.ts"));
  fileInput = await loadTypeScript(require.resolve("../src/lib/file-input.ts"));
  longInput = await loadTypeScript(require.resolve("../src/lib/long-input.ts"));
  recommend = await loadTypeScript(require.resolve("../src/routes/recommend.ts"));
});

const ADDRESS = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
const URL_ = "https://shop.example.com/api/data";
const usd = (p) => Number(endpoints.ENDPOINTS.find((e) => e.path === p).price.slice(1));
const pack = (p) => B.PACKS_BUSINESS.find((e) => e.endpoint.path === p);

// What each single tool answers, cut to the fields the pack reads.
const ANSWERS = {
  "/check/counterparty": { address: ADDRESS, chain: "base", verdict: "pass", reasons: [], sanctions: { listed: false, matches: [] }, account: { type: "eoa" }, contract: null, holdings: { totalUsd: 1 }, limitations: [], note: "n" },
  "/check/payee": { address: ADDRESS, chain: "polygon", verdict: "pass", reasons: [], sanctions: { listed: false, matches: [] }, account: { type: "eoa" }, limitations: [] },
  "/sanctions/check": { query: { address: ADDRESS }, verdict: "pass", listed: false, matches: [], listDate: "2026-11-16T00:00:00.000Z", lists: [] },
  "/check/x402-seller": { url: URL_, verdict: "pass", reasons: [], terms: { paywalled: true, accepts: [] }, payees: [], domain: { name: "shop.example.com" }, limitations: [] },
  "/x402/payout-check": { url: URL_, verdict: "pass", status: "unchanged", reasons: [], live: { payTo: [] }, listing: null, declaration: { found: false, payTo: [] }, limitations: [] },
  "/domain-report": { domain: "shop.example.com", trust: "high", summary: "high trust", flags: [], facts: { ageDays: 4000 } },
  "/payee/check": { domain: "shop.example.com", verdict: "unknown", reasons: ["the payee has published no verified payee record"], wallets: [], record: null, attestation: null, fresh: false, note: "n" },
};
const fake = (over = {}) => {
  const calls = [];
  const run = async (p, inputs) => {
    calls.push([p, inputs]);
    const a = p in over ? over[p] : ANSWERS[p];
    if (a instanceof Error) throw a;
    return a;
  };
  return { run, calls };
};

test("counterparty: the sections follow the input, and each runs the single tool with that input", async () => {
  const names = (input) => B.counterpartySections(input).map(([name, p]) => `${name}=${p}`);
  assert.deepEqual(names({ address: ADDRESS }), ["wallet=/check/counterparty", "sanctions=/sanctions/check", "payee=/payee/check"]);
  assert.deepEqual(names({ address: ADDRESS, chain: "polygon" }), ["wallet=/check/payee", "sanctions=/sanctions/check", "payee=/payee/check"]);
  assert.deepEqual(names({ domain: "shop.example.com" }), ["domain=/domain-report", "payee=/payee/check"]);
  assert.deepEqual(names({ url: URL_ }), ["seller=/check/x402-seller", "payout=/x402/payout-check", "domain=/domain-report", "payee=/payee/check"]);
  assert.deepEqual(names({ url: URL_, address: ADDRESS }), ["wallet=/check/counterparty", "sanctions=/sanctions/check", "seller=/check/x402-seller", "payout=/x402/payout-check", "domain=/domain-report", "payee=/payee/check"]);

  const { run, calls } = fake();
  const out = await B.counterpartyFull({ url: URL_, address: ADDRESS, chain: "base" }, run);
  assert.deepEqual(calls.find(([p]) => p === "/domain-report")[1], { name: "shop.example.com" }, "the URL's host is the domain checked");
  assert.deepEqual(calls.find(([p]) => p === "/payee/check")[1], { address: ADDRESS, url: URL_, domain: undefined });
  assert.deepEqual(calls.find(([p]) => p === "/check/counterparty")[1], { address: ADDRESS, chain: "base" });
  assert.equal(out.verdict, "pass");
  assert.deepEqual(out.reasons, []);
  assert.deepEqual(out.sectionVerdicts, { wallet: "pass", sanctions: "pass", seller: "pass", payout: "pass", domain: "high trust", payee: "unknown" });
  assert.deepEqual(out.checks, { wallet: "/check/counterparty", sanctions: "/sanctions/check", seller: "/check/x402-seller", payout: "/x402/payout-check", domain: "/domain-report", payee: "/payee/check" });
  assert.deepEqual(out.failed, {});
  // Sections keep the verdict and its facts; what repeats elsewhere (the tool's note, the seller's domain part) is dropped.
  assert.deepEqual(Object.keys(out.seller), ["verdict", "reasons", "terms", "payees", "limitations"]);
  assert.equal(out.payee.attestation, undefined);
});

test("counterparty verdict: block if any section blocks, review if any says review, else pass; never a score", () => {
  const agg = (sections, failed = {}) => B.aggregateVerdict(sections, failed);
  const pass = { verdict: "pass", reasons: [] };
  assert.equal(agg({ wallet: pass, seller: pass }).verdict, "pass");
  // No verified payee record (unknown, partial) is shown and does not change the verdict.
  const quiet = agg({ wallet: pass, payee: { verdict: "unknown", reasons: ["no record"] } });
  assert.equal(quiet.verdict, "pass");
  assert.deepEqual(quiet.reasons, []);
  assert.equal(agg({ seller: pass, payee: { verdict: "partial", reasons: ["x"] } }).verdict, "pass");
  const review = agg({ wallet: pass, payout: { verdict: "review", reasons: ["the live wallet differs from the listing"] } });
  assert.equal(review.verdict, "review");
  assert.deepEqual(review.reasons, ["payout: the live wallet differs from the listing"]);
  const block = agg({ payout: { verdict: "review", reasons: ["r"] }, sanctions: { verdict: "block", matches: [{ name: "LAZARUS GROUP" }, { name: "LAZARUS GROUP" }] }, seller: pass });
  assert.equal(block.verdict, "block");
  assert.deepEqual(block.reasons, ["payout: r", "sanctions: sanctions list match: LAZARUS GROUP"]);
  // /domain-report has no verdict word: a high-severity flag is review (the rule /check/counterparty applies), lower ones are not.
  assert.equal(agg({ domain: { trust: "low", flags: [{ level: "high", message: "Registered 3 days ago." }] } }).verdict, "review");
  assert.equal(agg({ domain: { trust: "medium", flags: [{ level: "medium", message: "m" }] } }).verdict, "pass");
  assert.equal(agg({ domain: { trust: "medium", flags: [] } }).sectionVerdicts.domain, "medium trust");
  // A verdict word the pack does not know is never read as a pass or a block.
  assert.equal(agg({ seller: { verdict: "excellent" } }).sectionVerdicts.seller, "unknown");
  for (const out of [quiet, review, block]) assert.deepEqual(Object.keys(out), ["verdict", "reasons", "sectionVerdicts"], "no score or rating field");
});

test("counterparty: a failing section is reported and the rest answer; a gap is review, not pass", async () => {
  const { run } = fake({ "/x402/payout-check": new Error("the Bazaar did not answer") });
  const out = await B.counterpartyFull({ url: URL_ }, run);
  assert.deepEqual(out.failed, { payout: "the Bazaar did not answer" });
  assert.equal(out.payout, null);
  assert.equal(out.seller.verdict, "pass");
  assert.equal(out.sectionVerdicts.payout, undefined);
  assert.equal(out.verdict, "review");
  assert.deepEqual(out.reasons, ["payout: this check did not answer, so the verdict has a gap; try again"]);
  // A block from a section that answered still wins over the gap.
  const blocked = await B.counterpartyFull({ url: URL_, address: ADDRESS }, fake({ "/x402/payout-check": new Error("x"), "/sanctions/check": { verdict: "block", listed: true, matches: [{ name: "X" }] } }).run);
  assert.equal(blocked.verdict, "block");
});

test("counterparty: every section failing is an uncharged 502", async () => {
  const down = Object.fromEntries(Object.keys(ANSWERS).map((p) => [p, new Error("upstream down")]));
  await assert.rejects(B.counterpartyFull({ url: URL_, address: ADDRESS }, fake(down).run), (e) => e.status === 502 && /nothing was charged/.test(e.message));
});

test("counterparty: input is checked before anything runs", async () => {
  const run = (params) => pack("/pack/counterparty-full").run({}, (n) => params[n]);
  await assert.rejects(run({}), (e) => e.status === 400 && /url .*address .*domain/.test(e.message));
  await assert.rejects(run({ address: "0x123" }), (e) => e.status === 400);
  await assert.rejects(run({ url: "not a url" }), (e) => e.status === 400);
  await assert.rejects(run({ address: ADDRESS, chain: "solana" }), (e) => e.status === 400);
});

test("a pack never costs more than its sections bought one by one, for every input it accepts", () => {
  const price = usd("/pack/counterparty-full");
  const shapes = [{ address: ADDRESS }, { address: ADDRESS, chain: "polygon" }, { domain: "shop.example.com" }, { url: URL_ }, { address: ADDRESS, domain: "shop.example.com" }, { url: URL_, address: ADDRESS }];
  const sums = shapes.map((s) => B.counterpartySections(s).reduce((sum, [, p]) => sum + usd(p), 0));
  for (const [i, sum] of sums.entries()) assert.ok(price <= sum + 1e-9, `${JSON.stringify(shapes[i])}: pack $${price}, parts $${sum}`);
  // The cheapest shape today is a Polygon address ($0.005 + $0.009 + $0.01); the full one is $0.069.
  assert.ok(Math.min(...sums) >= 0.02 && Math.max(...sums) >= 0.06, String(sums));
  // The e-invoice pack always runs validate and to-json; the VAT and IBAN checks come on top when the file carries them.
  assert.ok(usd("/pack/einvoice-check") <= usd("/einvoice/validate") + usd("/einvoice/to-json"));
  // Both sell at the ordinary pack price, and the KYB pack keeps the price it had.
  assert.equal(pack("/pack/counterparty-full").endpoint.price, "$0.01");
  assert.equal(pack("/pack/einvoice-check").endpoint.price, "$0.01");
  assert.equal(endpoints.ENDPOINTS.find((e) => e.path === "/pack/kyb-eu").price, "$0.02");
});

const fixture = (name) => fs.readFileSync(path.join(__dirname, "fixtures", "einvoice", name), "utf8");
const tool = (p) => einvoice.EINVOICE.find((e) => e.endpoint.path === p);
async function parts(xml) {
  const q = (n) => (n === "xml" ? xml : undefined);
  return [await tool("/einvoice/validate").run({}, q), await tool("/einvoice/to-json").run({}, q)];
}
const viesValid = async (p) => ({ vat: `${p.country}${p.number}`, country: p.country, number: p.number, valid: true, name: null, address: null });

test("e-invoice: rules, VAT numbers and IBAN in one answer, with the validator's own honesty lines", async () => {
  const [validation, parsed] = await parts(fixture("xrechnung-01.01a-cii.xml"));
  const asked = [];
  const out = await B.einvoiceCheck(validation, parsed, async (p) => { asked.push(`${p.country}${p.number}`); return viesValid(p); });
  assert.deepEqual(asked, ["DE123456789"], "the seller's VAT number as the file writes it, cleaned; the buyer has none");
  assert.equal(out.verdict, "pass");
  assert.equal(out.valid, true);
  assert.equal(out.rulesChecked, validation.rulesChecked);
  assert.deepEqual(out.checks.map((c) => `${c.check}:${c.status}`), ["seller_vat:pass", "buyer_vat:missing", "iban:pass"]);
  assert.equal(out.iban.valid, true);
  assert.deepEqual(out.invoice, parsed.invoice, "the whole invoice as /einvoice/to-json returns it");
  // Never "conformant": the answer says which rules ran and what was not checked.
  assert.equal(out.coverage, validation.coverage);
  assert.match(out.note, /subset/);
  assert.match(out.note, /not the official KoSIT validator/);
  assert.match(out.summary, /rules of our subset ran/);
  assert.doesNotMatch(JSON.stringify(out), /conformant|compliant with|certified/i);
});

test("e-invoice: a VIES outage is unavailable and review, never an error; an unknown VAT number or a broken rule is fail", async () => {
  const [validation, parsed] = await parts(fixture("xrechnung-01.01a-cii.xml"));
  const outage = await B.einvoiceCheck(validation, parsed, async () => { throw new Error("VIES did not answer"); });
  assert.equal(outage.verdict, "review");
  assert.equal(outage.checks[0].status, "unavailable");
  assert.equal(outage.seller, null);
  const unknown = await B.einvoiceCheck(validation, parsed, async (p) => ({ ...(await viesValid(p)), valid: false }));
  assert.equal(unknown.verdict, "fail");
  assert.match(unknown.summary, /^Failed: seller_vat/);

  // The same file with its payable amount changed breaks a sums rule: fail, with the rule numbers passed on.
  const broken = fixture("xrechnung-01.01a-cii.xml").replace(/<ram:DuePayableAmount>[^<]+</, "<ram:DuePayableAmount>999.00<");
  const [v2, p2] = await parts(broken);
  assert.equal(v2.valid, false);
  const failed = await B.einvoiceCheck(v2, p2, viesValid);
  assert.equal(failed.verdict, "fail");
  assert.match(failed.summary, /^Failed: rules/);
  assert.deepEqual(failed.errors, v2.errors);

  // What the file holds that the validator does not check travels with the answer.
  const withNotChecked = await B.einvoiceCheck({ ...validation, notChecked: ["allowances and charges"] }, parsed, viesValid);
  assert.deepEqual(withNotChecked.notChecked, ["allowances and charges"]);

  // A wrong IBAN check digit is fail; an IBAN held in another country than the seller's VAT number is review.
  const iban = (value) => ({ ...parsed, invoice: { ...parsed.invoice, payment: { ...parsed.invoice.payment, iban: value } } });
  assert.equal((await B.einvoiceCheck(validation, iban("DE79000000001234567891"), viesValid)).verdict, "fail");
  assert.equal((await B.einvoiceCheck(validation, iban("NL91ABNA0417164300"), viesValid)).verdict, "review");
});

test("e-invoice: a file that cannot be read is the single tool's own refusal, uncharged", async () => {
  const run = (params) => pack("/pack/einvoice-check").run({}, (n) => params[n]);
  await assert.rejects(run({}), (e) => e.status === 400);
  await assert.rejects(run({ xml: "<not-an-invoice/>" }), (e) => e.status === 422 && /nothing was charged/.test(e.message));
});

test("listing: task first, one Use when sentence, the inputs routers plan, no capacity-limited section", () => {
  for (const p of ["/pack/counterparty-full", "/pack/einvoice-check", "/pack/kyb-eu"]) {
    const e = endpoints.ENDPOINTS.find((x) => x.path === p);
    assert.ok(e, p);
    assert.equal(e.description.split(/(?<=\. )/).filter((s) => s.startsWith("Use when ")).length, 1, `${p}: one sentence beginning "Use when "`);
    assert.ok(e.description.length <= 450, `${p} ${e.description.length}`);
    assert.ok(bazaar.ONE_OF_INPUT_PATHS.has(p), p);
    assert.equal(capacity.CAPACITY_LIMITED.has(p), false, p);
  }
  const full = endpoints.ENDPOINTS.find((x) => x.path === "/pack/counterparty-full");
  const einv = endpoints.ENDPOINTS.find((x) => x.path === "/pack/einvoice-check");
  assert.match(full.summary, /^Counterparty check before paying/);
  assert.match(full.description, /^Check a counterparty before an agent pays it/);
  assert.match(einv.summary, /^EU e-invoice check/);
  assert.match(einv.description, /^Check whether an EU e-invoice is usable/);
  // No wording that rates economic standing.
  assert.doesNotMatch(full.description + JSON.stringify(full.outputExample), /credit ?worth|credit score|creditworthy|solvency|rating/i);
  // The published call names one input, so a router that fills inputs from examples does not mix our example with its own value.
  assert.deepEqual(bazaar.requiredInputs(full), ["url"]);
  assert.deepEqual(bazaar.requiredInputs(einv), ["url"]);
  assert.deepEqual(Object.keys(bazaar.exampleInput(full)), ["url"]);
  assert.equal(full.params.address.example, "");
  assert.equal(einv.params.xml.example, "");
  // The two invoice tools point at each other.
  assert.match(einv.description, /PDF or scanned invoices: invoice_check\.$/);
  assert.match(endpoints.ENDPOINTS.find((x) => x.path === "/invoice/check").description, /pack_einvoice_check\.$/);
  // A pack with a capacity-limited section would be capacity-limited itself: none is, and no section runs a model.
  const sections = ["/check/counterparty", "/check/payee", "/sanctions/check", "/check/x402-seller", "/x402/payout-check", "/domain-report", "/payee/check", "/einvoice/validate", "/einvoice/to-json"];
  for (const p of sections) assert.equal(capacity.CAPACITY_LIMITED.has(p), false, p);
  // The e-invoice pack takes the same uploads and long xml text as the two tools it runs.
  assert.equal(fileInput.FILE_INPUT_PATHS["/pack/einvoice-check"], fileInput.FILE_INPUT_PATHS["/einvoice/validate"]);
  assert.deepEqual(longInput.LONG_INPUT_FIELDS["/pack/einvoice-check"], longInput.LONG_INPUT_FIELDS["/einvoice/validate"]);
});

test("published examples have the shape the handlers return", async () => {
  const full = pack("/pack/counterparty-full").endpoint;
  const real = await B.counterpartyFull({ url: full.params.url.example }, fake().run);
  assert.deepEqual(Object.keys(full.outputExample), Object.keys(real));
  for (const name of Object.keys(full.outputExample.checks)) assert.deepEqual(Object.keys(full.outputExample[name]), Object.keys(real[name]), name);
  assert.deepEqual(full.outputExample.checks, real.checks);

  const einv = pack("/pack/einvoice-check").endpoint;
  const [validation, parsed] = await parts(fixture("xrechnung-01.01a-cii.xml"));
  const out = await B.einvoiceCheck({ ...validation, url: einv.params.url.example }, parsed, async (p) => ({ ...(await viesValid(p)), valid: false }));
  // The fixture is the published example's file: everything but the VIES timestamp is the same answer.
  const { seller: exSeller, ...example } = einv.outputExample;
  const { seller, source: _source, ...answer } = out;
  assert.deepEqual(Object.keys(exSeller).sort(), [...Object.keys(seller), "checkedAt", "source"].sort());
  // The example's invoice is abridged (one line, no contact fields) so the quote header stays small; the rest is equal.
  const { invoice: exInvoice, ...exRest } = example;
  const { invoice, ...rest } = answer;
  assert.deepEqual(exRest, rest);
  for (const k of Object.keys(exInvoice)) assert.ok(k in invoice, k);
  assert.deepEqual(exInvoice.totals, invoice.totals);
});

test("the finder names the packs for their job phrases", () => {
  for (const need of ["should my agent pay this counterparty", "is it safe to pay this seller", "full counterparty check for an x402 seller"]) assert.equal(recommend.jobTool(need), "/pack/counterparty-full", need);
  for (const need of ["e-invoice check before booking", "check XRechnung file", "is this e-invoice usable"]) assert.equal(recommend.jobTool(need), "/pack/einvoice-check", need);
  // The jobs that were there keep their tools.
  assert.equal(recommend.jobTool("invoice check"), "/invoice/check");
});
