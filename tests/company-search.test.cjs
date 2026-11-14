// EU company search over official registers (src/routes/company-search.ts): every source is asked, a failing source is
// named while the rest answer, GLEIF adds LEIs to register entities it matches, home companies rank before foreign
// branches, and nothing answered at all is an uncharged 502.
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

let S, V;
before(async () => {
  S = await loadTypeScript(require.resolve("../src/routes/company-search.ts"));
  V = await loadTypeScript(require.resolve("../src/routes/company-verify.ts"));
});

const notFound = () => Object.assign(new Error("no match"), { status: 404 });
const fake = (rows) => ({
  FR: { ...V.SEARCHERS.FR, search: async () => (rows.FR ? { matches: rows.FR } : Promise.reject(notFound())) },
  SE: { ...V.SEARCHERS.SE, search: async () => (rows.SE === "down" ? Promise.reject(new Error("timeout")) : rows.SE ? { matches: rows.SE } : Promise.reject(notFound())) },
  NO: { ...V.SEARCHERS.NO, search: async () => (rows.NO ? { matches: rows.NO } : Promise.reject(notFound())) },
  FI: { ...V.SEARCHERS.FI, search: async () => (rows.FI ? { matches: rows.FI } : Promise.reject(notFound())) },
});
const leiRecord = (lei, name, country, registeredAs = null, city = "X") => ({ id: lei, attributes: { lei, entity: { legalName: { name }, status: "ACTIVE", jurisdiction: country, registeredAs, legalAddress: { addressLines: [], city, country } }, registration: {} } });
const now = () => new Date("2026-11-14T12:00:00Z");

test("one ranked list from every register and GLEIF; LEIs join their register entity; foreign branches after home companies", async () => {
  const leiAsked = [];
  const r = await S.companySearch("Spotify", null, 10, {
    now,
    searchers: fake({
      FR: [{ name: "SPOTIFY AB", siren: "511237240", legalForm: "3220", city: null }, { name: "SPOTIFY FRANCE SAS", siren: "511930729", legalForm: "SAS", city: "PARIS" }],
      SE: [{ name: "SPOTIFY TECHNOLOGY S.A.", orgnr: "502078-0291", legalForm: "Utländsk juridisk person (foreign legal person)", city: "UTLANDET" }, { name: "Spotify AB", orgnr: "556703-7485", legalForm: "Aktiebolag (limited company)", city: "STOCKHOLM" }],
    }),
    lei: async (name, limit, country) => { leiAsked.push(country); return [leiRecord("5493004INDUJX1TDHI57", "Spotify AB", "SE", "556703-7485"), leiRecord("549300B4X0JHWV0DTD60", "SPOTIFY TECHNOLOGY S.A.", "LU")]; },
  });
  assert.deepEqual(leiAsked, [null]);
  assert.deepEqual(r.results.map((h) => `${h.country}:${h.id}`), ["SE:556703-7485", "FR:511237240", "FR:511930729", "LU:549300B4X0JHWV0DTD60", "SE:502078-0291"]);
  const home = r.results[0];
  assert.equal(home.lei, "5493004INDUJX1TDHI57", "GLEIF's record of the same register number adds its LEI, not a second row");
  assert.equal(home.exact, true);
  assert.equal(r.results[1].branchOfForeign, true);
  assert.equal(r.results.at(-1).branchOfForeign, true);
  assert.equal(r.results.find((h) => h.country === "FR" && h.id === "511930729").url, "https://annuaire-entreprises.data.gouv.fr/entreprise/511930729");
  assert.equal("url" in home, false, "Sweden's register has no free page per company: the field is left out, never null");
  for (const h of r.results) assert.ok(Object.values(h).every((v) => v !== null), `${h.id} carries no nulls`);
  assert.equal(home.details, "/se/company?orgnr=556703-7485");
  assert.equal(r.complete, true);
  assert.equal(r.retrievedAt, "2026-11-14T12:00:00.000Z");
  assert.deepEqual(r.searched.sort(), ["FI", "FR", "LEI", "NO", "SE"]);
});

test("a country list: register countries search their register, others search GLEIF for that country", async () => {
  const asked = [];
  const r = await S.companySearch("Siemens AG", ["DE", "SE"], 5, {
    now, searchers: fake({ SE: [] }),
    lei: async (_n, _l, country) => { asked.push(country); return country === "DE" ? [leiRecord("529900VGZ27M5ZHAEZ97", "Siemens Advanta Solutions GmbH", "DE"), leiRecord("W38RGI023J3WT1HWRP32", "Siemens Aktiengesellschaft", "DE")] : []; },
  });
  assert.deepEqual(asked.sort(), ["DE", null].sort());
  assert.equal(r.results[0].name, "Siemens Aktiengesellschaft", "a spelled-out legal form still makes an exact match");
  assert.equal(r.results[0].exact, true);
  assert.deepEqual(r.countries, ["DE", "SE"]);
});

test("a source that fails is named and the rest answer; nothing answering is an uncharged 502; no match is an answer", async () => {
  const partial = await S.companySearch("Volvo", ["SE", "NO"], 5, { now, searchers: fake({ SE: "down", NO: [{ name: "VOLVO NORGE AS", orgnr: "912345678", legalForm: "Aksjeselskap", city: "OSLO" }] }), lei: async () => [] });
  assert.equal(partial.complete, false);
  assert.deepEqual(partial.failed, ["SE"]);
  assert.equal(partial.results[0].url, "https://data.brreg.no/enhetsregisteret/oppslag/enheter/912345678");
  await assert.rejects(S.companySearch("Volvo", ["SE"], 5, { now, searchers: fake({ SE: "down" }), lei: async () => { throw new Error("gleif down"); } }), (e) => e.status === 502);
  const none = await S.companySearch("xqzzyvv", null, 5, { now, searchers: fake({}), lei: async () => [] });
  assert.equal(none.count, 0);
  assert.equal(none.complete, true);
  await assert.rejects(S.companySearch("AB", null, 5, { now, searchers: fake({}), lei: async () => [] }), (e) => e.status === 400);
});

test("country input: codes, names, EU for all; unknown names refused", () => {
  assert.equal(S.countriesOf(undefined), null);
  assert.equal(S.countriesOf("EU"), null);
  assert.deepEqual(S.countriesOf("se, Norway,UK"), ["SE", "NO", "GB"]);
  assert.throws(() => S.countriesOf("Atlantis"), (e) => e.status === 400);
});

test("foreign branches by register: SE foreign legal person, NO NUF, FR form 3220", () => {
  assert.equal(S.isForeignBranch({ country: "SE", legalForm: "Utländsk juridisk person (foreign legal person)" }), true);
  assert.equal(S.isForeignBranch({ country: "NO", legalForm: "Norskregistrert utenlandsk foretak" }), true);
  assert.equal(S.isForeignBranch({ country: "FR", legalForm: "3220" }), true);
  assert.equal(S.isForeignBranch({ country: "SE", legalForm: "Aktiebolag (limited company)" }), false);
});
