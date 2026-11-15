// UK Companies House and Danish CVR in /company/search (15 Nov 2026): only where their secrets are set.
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

let reg, search, verify;
before(async () => {
  reg = await loadTypeScript(require.resolve("../src/routes/gb-dk-registers.ts"));
  search = await loadTypeScript(require.resolve("../src/routes/company-search.ts"));
  verify = await loadTypeScript(require.resolve("../src/routes/company-verify.ts"));
});

// The shape of Companies House GET /search/companies (developer-specs, 15 Nov 2026).
const CH = { items: [
  { title: "SPOTIFY LIMITED", company_number: "06436047", company_status: "active", company_type: "ltd", address: { locality: "London" } },
  { title: "SPOTIFY LTD", company_number: "05999999", company_status: "dissolved", company_type: "ltd", address: { locality: "Leeds" } },
  { title: "TESCO PLC", company_number: "00445790", company_status: "active", company_type: "plc", address: { locality: "Welwyn Garden City" } },
] };
// The shape of a CVR Elasticsearch hit (Vrvirksomhed.virksomhedMetadata.*).
const CVR = { hits: { hits: [
  { _source: { Vrvirksomhed: { cvrNummer: 24256790, virksomhedMetadata: { nyesteNavn: { navn: "NOVO NORDISK A/S" }, nyesteVirksomhedsform: { langBeskrivelse: "Aktieselskab" }, nyesteBeliggenhedsadresse: { postdistrikt: "Bagsværd" }, sammensatStatus: "NORMAL" } } } },
  { _source: { Vrvirksomhed: { cvrNummer: 12345678, virksomhedMetadata: { nyesteNavn: { navn: "Novo Nordisk Jensen" }, nyesteVirksomhedsform: { langBeskrivelse: "Enkeltmandsvirksomhed" }, sammensatStatus: "Aktiv" } } } },
] } };

test("Companies House answers: active first, legal forms named, dissolved kept after", () => {
  const m = reg.gbMatches(CH, "Spotify", 5);
  assert.deepEqual(m.map((x) => x.number), ["06436047", "05999999"]);
  assert.equal(m[0].legalForm, "Private limited company (Ltd)");
  assert.equal(m[1].status, "dissolved");
});

test("CVR answers: sole proprietorships are left out; CVR numbers keep 8 digits", () => {
  const m = reg.dkMatches(CVR, "Novo Nordisk", 5);
  assert.equal(m.length, 1);
  assert.deepEqual(m[0], { name: "NOVO NORDISK A/S", number: "24256790", legalForm: "Aktieselskab", city: "Bagsværd", status: "NORMAL" });
  assert.equal(reg.dkQuery("Novo Nordisk", 20).query.bool.must[0].match["Vrvirksomhed.virksomhedMetadata.nyesteNavn.navn"].operator, "and");
});

test("the HTTP calls send the credentials as Basic auth and map refusals", async () => {
  let seen;
  const ok = async (url, init) => { seen = { url, init }; return new Response(JSON.stringify(CH), { status: 200 }); };
  await reg.gbSearch("KEY", "Spotify", 5, ok);
  assert.match(seen.url, /^https:\/\/api\.company-information\.service\.gov\.uk\/search\/companies\?q=Spotify/);
  assert.equal(seen.init.headers.authorization, `Basic ${Buffer.from("KEY:").toString("base64")}`);
  await assert.rejects(reg.gbSearch("KEY", "x", 5, async () => new Response("", { status: 429 })), (e) => e.status === 503);
  await assert.rejects(reg.dkSearch("u", "p", "x", 5, async () => new Response("", { status: 401 })), (e) => e.status === 503);
});

test("searchers exist only with their secrets", () => {
  assert.deepEqual(Object.keys(reg.keyedSearchers({})), []);
  assert.deepEqual(Object.keys(reg.keyedSearchers({ COMPANIES_HOUSE_API_KEY: "k" })), ["GB"]);
  assert.deepEqual(Object.keys(reg.keyedSearchers({ CVR_USER: "u" })), []);
  assert.deepEqual(Object.keys(reg.keyedSearchers({ CVR_USER: "u", CVR_PASSWORD: "p" })), ["DK"]);
});

test("Danish legal forms are set aside when names are compared", () => {
  assert.equal(verify.coreName("NOVO NORDISK A/S"), "novo nordisk");
  assert.equal(verify.coreName("Lego ApS"), "lego");
});

test("company search: a GB register hit links to Companies House; without a key GB goes to GLEIF", async () => {
  const gb = { search: async () => ({ matches: reg.gbMatches(CH, "Tesco", 5) }), idType: "company number", id: (m) => m.number, source: reg.GB_SOURCE };
  const r = await search.companySearch("Tesco", ["GB"], 5, { searchers: { GB: gb }, lei: async () => [] });
  assert.equal(r.results[0].url, "https://find-and-update.company-information.service.gov.uk/company/00445790");
  assert.ok(!r.results[0].details, "no tool of ours holds the full UK record yet");
  assert.equal(r.results[0].status, "active");
  const asked = [];
  await search.companySearch("Tesco", ["GB"], 5, { searchers: {}, lei: async (n, l, c) => { asked.push(c); return []; } }).catch(() => {});
  assert.deepEqual(asked, ["GB"]);
});
