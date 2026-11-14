// Czech (ARES) and Estonian (e-Business Register) company tools (src/routes/cz-ee-company.ts) and their place in
// /company/search: number checks, natural persons left out, ranking, and both registers searched by default.
const assert = require("node:assert/strict");
const { before, test, afterEach } = require("node:test");
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

let C, S;
before(async () => {
  C = await loadTypeScript(require.resolve("../src/routes/cz-ee-company.ts"));
  S = await loadTypeScript(require.resolve("../src/routes/company-search.ts"));
});
const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

test("IČO: check digit, VAT form and dropped leading zeros", () => {
  assert.equal(C.czIcoValid("00177041"), true);
  assert.equal(C.czIcoValid("00177042"), false);
  assert.equal(C.czIcoOf("CZ00177041"), "00177041");
  assert.equal(C.czIcoOf("177041"), "00177041");
  assert.equal(C.czIcoOf("001 77 041"), "00177041");
  assert.throws(() => C.czIcoOf("00177042"), /check digit/);
  assert.throws(() => C.czIcoOf("abc"), /IČO/);
});

test("Estonian register code: 8 digits, spaces and EE prefix tolerated", () => {
  assert.equal(C.eeCodeOf("101 373 19"), "10137319");
  assert.equal(C.eeCodeOf("EE10137319"), "10137319");
  assert.throws(() => C.eeCodeOf("1234"), /8 digits/);
  assert.equal(C.eeCity("Harju maakond, Tallinn, Kesklinna linnaosa, Sadama tn 25"), "Tallinn");
  assert.equal(C.eeCity("Tartu, Rüütli 1"), "Tartu");
});

test("Czech name search leaves out natural persons and dissolved subjects, exact name first", async () => {
  let sent;
  globalThis.fetch = async (url, init) => {
    sent = { url: String(url), body: JSON.parse(init.body) };
    return json({ pocetCelkem: 4, ekonomickeSubjekty: [
      { ico: "14145367", obchodniJmeno: "Základní organizace Odborové organizace Pro Libertate - ŠKODA AUTO", pravniForma: "707", sidlo: { nazevObce: "Praha" } },
      { ico: "07700903", obchodniJmeno: "Nadační fond Škoda Auto", pravniForma: "118", sidlo: { nazevObce: "Mladá Boleslav" } },
      { ico: "00177041", obchodniJmeno: "Škoda Auto a.s.", pravniForma: "121", sidlo: { nazevObce: "Mladá Boleslav" } },
      { ico: "12345678", obchodniJmeno: "Jan Škoda Auto", pravniForma: "101", sidlo: { nazevObce: "Brno" } },
      { ico: "87654321", obchodniJmeno: "Škoda Auto Old s.r.o.", pravniForma: "112", datumZaniku: "2001-01-01", sidlo: { nazevObce: "Brno" } },
    ] });
  };
  const r = await C.czSearch("Skoda Auto", 5);
  assert.match(sent.url, /\/vyhledat$/);
  assert.equal(sent.body.obchodniJmeno, "Skoda Auto");
  assert.deepEqual(r.matches.map((m) => m.ico), ["00177041", "07700903", "14145367"]);
  assert.equal(r.matches[0].legalForm, "Akciová společnost (joint-stock company, a.s.)");
});

test("Czech lookup refuses a natural person and reads status, VAT and insolvency", async () => {
  globalThis.fetch = async () => json({ ico: "12345678", obchodniJmeno: "Jan Novák", pravniForma: "101" });
  await assert.rejects(C.czLookup("12345678"), (e) => e.status === 404 && /natural person/.test(e.message));
  globalThis.fetch = async () => json({ ico: "00177041", obchodniJmeno: "Škoda Auto a.s.", pravniForma: "121", dic: "CZ00177041", datumVzniku: "1990-11-20",
    seznamRegistraci: { stavZdrojeVr: "AKTIVNI", stavZdrojeDph: "AKTIVNI", stavZdrojeIr: "NEEXISTUJICI" }, czNace2008: ["29100", "00"], sidlo: { textovaAdresa: "x", nazevObce: "Mladá Boleslav", psc: 29301, kodStatu: "CZ" } });
  const v = await C.czLookup("00177041");
  assert.equal(v.vatNumber, "CZ00177041");
  assert.equal(v.status, "registered");
  assert.equal(v.insolvencyRecord, false);
  assert.deepEqual(v.industryCodes, ["29100"]);
  assert.equal(v.address.postcode, "29301");
  globalThis.fetch = async () => json({}, 404);
  await assert.rejects(C.czLookup("00177041"), (e) => e.status === 404);
});

test("Estonian search leaves out sole traders (FIE) and deleted entities", async () => {
  globalThis.fetch = async () => json({ status: "OK", data: [
    { reg_code: 1, name: "FIE Bolt Mees", legal_form: "3", status: "R", legal_address: "Tallinn" },
    { reg_code: 16469147, name: "Bolt Fleet Services EE OÜ", legal_form: "5", status: "R", legal_address: "Harju maakond, Tallinn, Kesklinna linnaosa, Vana-Lõuna tn 15" },
    { reg_code: 14532901, name: "Bolt Technology OÜ", legal_form: "5", status: "R", legal_address: "Harju maakond, Tallinn, Vana-Lõuna tn 15" },
    { reg_code: 2, name: "Bolt OÜ", legal_form: "5", status: "K", legal_address: "Tartu" },
  ] });
  const r = await C.eeSearch("Bolt", 5);
  assert.deepEqual(r.matches.map((m) => m.regCode), ["14532901", "16469147"]);
  assert.equal(r.matches[0].legalForm, "Osaühing (private limited company, OÜ)");
  assert.equal(r.matches[0].city, "Tallinn");
});

test("/company/search asks Czechia and Estonia by default and links their pages", async () => {
  const notFound = () => Promise.reject(Object.assign(new Error("none"), { status: 404 }));
  const searchers = {
    FR: { search: notFound, idType: "SIREN", id: (m) => m.siren, source: "fr" },
    CZ: { search: async () => ({ matches: [{ name: "Škoda Auto a.s.", ico: "00177041", legalForm: "Akciová společnost (joint-stock company, a.s.)", city: "Mladá Boleslav" }] }), idType: "IČO", id: (m) => m.ico, source: "ARES" },
    EE: { search: async () => ({ matches: [{ name: "Skoda Auto Eesti filiaal", regCode: "11111111", legalForm: "Välismaa äriühingu filiaal (branch of a foreign company)", city: "Tallinn" }] }), idType: "registrikood", id: (m) => m.regCode, source: "RIK" },
  };
  const r = await S.companySearch("Skoda Auto", null, 10, { searchers, lei: async () => [], now: () => new Date("2026-11-14T12:00:00Z") });
  assert.deepEqual(r.results.map((h) => `${h.country}:${h.id}`), ["CZ:00177041", "EE:11111111"]);
  assert.equal(r.results[0].exact, true);
  assert.equal(r.results[0].url, "https://ares.gov.cz/ekonomicke-subjekty?ico=00177041");
  assert.equal(r.results[0].details, "/cz/company?ico=00177041");
  assert.equal(r.results[1].branchOfForeign, true);
  assert.deepEqual(r.searched.sort(), ["CZ", "EE", "FR", "LEI"]);
  // A country list with CZ asks ARES, not GLEIF-only.
  const asked = [];
  await S.companySearch("Skoda Auto", ["CZ"], 5, { searchers, lei: async (n, l, c) => { asked.push(c); return []; } });
  assert.deepEqual(asked, [null]);
});

test("Czech and Estonian legal forms are set aside when names are compared", async () => {
  const V = await loadTypeScript(require.resolve("../src/routes/company-verify.ts"));
  assert.equal(V.coreName("ČEZ, a. s."), "cez");
  assert.equal(V.coreName("Škoda Auto a.s."), "skoda auto");
  assert.equal(V.coreName("Rohlik solutions s.r.o."), "rohlik solutions");
  assert.equal(V.coreName("Bolt Technology OÜ"), "bolt technology");
  assert.equal(V.coreName("J. Smith Holding"), "j smith holding", "a single initial before a word is not a legal form");
});

test("the default searcher set holds all six registers", () => {
  assert.deepEqual([...S.SEARCH_REGISTERS], ["FR", "SE", "NO", "FI", "CZ", "EE"]);
});
