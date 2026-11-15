// /pack/kyb-eu (15 Nov 2026): register + GLEIF + VIES + four sanctions lists in one call, with no network here.
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

let kyb;
before(async () => { kyb = await loadTypeScript(require.resolve("../src/routes/kyb.ts")); });

const hit = (o) => ({ idType: "id", legalForm: null, city: null, exact: true, url: null, details: null, lei: null, source: "Register", ...o });
const deps = (over = {}) => ({
  search: async () => ({ results: [hit({ name: "Spotify AB", country: "SE", id: "556703-7485", lei: "5493004INDUJX1TDHI57", source: "Bolagsverket" })] }),
  vies: async (vat) => ({ vat, valid: true, name: "Spotify AB" }),
  lei: async (lei) => ({ lei, legalName: "Spotify AB", entityStatus: "ACTIVE", legalAddress: { country: "SE" }, registration: { status: "ISSUED" } }),
  sanctions: async () => ({ verdict: "pass", matches: [], lists: [{ list: "eu", checked: true }] }),
  now: () => new Date("2026-11-15T08:00:00Z"),
  ...over,
});

test("VAT numbers implied by register IDs follow each state's rule", () => {
  assert.equal(kyb.vatFromRegister({ country: "SE", id: "556703-7485" }), "SE556703748501");
  assert.equal(kyb.vatFromRegister({ country: "FI", id: "0112038-9" }), "FI01120389");
  assert.equal(kyb.vatFromRegister({ country: "FR", id: "303265045" }), "FR40303265045"); // checked valid in VIES 15 Nov 2026
  assert.equal(kyb.vatFromRegister({ country: "CZ", id: "00177041" }), "CZ00177041");
  assert.equal(kyb.vatFromRegister({ country: "NO", id: "923609016" }), null);
});

test("legal forms are set aside before sanctions screening", () => {
  assert.equal(kyb.coreName("Spotify AB"), "Spotify");
  assert.equal(kyb.coreName("PJSC Rosneft Oil Company"), "Rosneft Oil Company");
  assert.equal(kyb.coreName("AB"), "AB");
});

test("a clean company passes with every source named", async () => {
  const r = await kyb.kybCheck({ q: "Spotify", country: "SE" }, deps());
  assert.equal(r.verdict, "pass");
  assert.equal(r.vat.vat, "SE556703748501");
  assert.equal(r.vat.derived, true);
  assert.equal(r.lei.legalName, "Spotify AB");
  assert.deepEqual(r.sanctions.screenedNames, ["Spotify"]);
  assert.equal(r.sources.length, 4);
  assert.deepEqual(r.flags, []);
});

test("a sanctions match or an invalid given VAT number means review", async () => {
  const hitList = deps({ sanctions: async () => ({ verdict: "review", matches: [{ list: "eu", listId: "EU.1", name: "X" }], lists: [] }) });
  assert.equal((await kyb.kybCheck({ q: "Rosneft" }, hitList)).verdict, "review");
  const badVat = deps({ vies: async (vat) => ({ vat, valid: false }) });
  const r = await kyb.kybCheck({ vat: "SE556703748501" }, badVat);
  assert.equal(r.verdict, "review");
  assert.match(r.flags.join(" "), /not valid in VIES/);
});

test("the group is the subject without a country; the local entity with one", async () => {
  const results = [hit({ name: "Klarna Group plc", country: "GB", id: "L1", groupParent: true, exact: false }), hit({ name: "Klarna Bank AB", country: "SE", id: "556737-0431" })];
  const d = deps({ search: async () => ({ results }) });
  const group = await kyb.kybCheck({ q: "Klarna" }, d);
  assert.equal(group.company.name, "Klarna Group plc");
  assert.equal(group.groupParent, null);
  assert.deepEqual(group.flags, []);
  const local = await kyb.kybCheck({ q: "Klarna", country: "SE" }, d);
  assert.equal(local.company.name, "Klarna Bank AB");
  assert.equal(local.groupParent.name, "Klarna Group plc");
  assert.deepEqual(local.sanctions.screenedNames, ["Klarna", "Klarna Bank", "Klarna Group"]);
});

test("an LEI selects exactly its entity; an unknown LEI keeps its own 404", async () => {
  const results = [hit({ name: "Spotify Technology S.A.", country: "LU", id: "L2", lei: "549300B4X0JHWV0DTD60" }), hit({ name: "Spotify AB", country: "SE", id: "556703-7485", lei: "5493004INDUJX1TDHI57" })];
  const r = await kyb.kybCheck({ lei: "5493004INDUJX1TDHI57" }, deps({ search: async () => ({ results }) }));
  assert.equal(r.company.name, "Spotify AB");
  const { HttpError } = await loadTypeScript(require.resolve("../src/lib/env.ts"));
  await assert.rejects(kyb.kybCheck({ lei: "549300NE7KNMPC4QN531" }, deps({ lei: async () => { throw new HttpError(404, "no LEI record"); } })), (e) => e.status === 404);
  await assert.rejects(kyb.kybCheck({}, deps()), /give q/);
});

test("a failing source is named and the rest still answer", async () => {
  const r = await kyb.kybCheck({ q: "Spotify" }, deps({ lei: async () => { throw new Error("GLEIF timed out"); } }));
  assert.equal(r.failed.lei, "GLEIF timed out");
  assert.equal(r.vat.valid, true);
});
