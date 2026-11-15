// EU, UN and UK sanctions lists in /sanctions/check (Beat Exa, Phase 1: EU official records, 14 Nov 2026).
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

const EU = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<export xmlns="http://eu.europa.ec/fpi/fsd/export" generationDate="2026-10-23T17:05:43.888+02:00" globalFileId="1">
  <sanctionEntity designationDetails="" unitedNationId="" euReferenceNumber="EU.27.28" logicalId="13">
    <regulation regulationType="regulation" programme="IRQ" logicalId="348"><publicationUrl>x</publicationUrl></regulation>
    <subjectType code="person" classificationCode="P"/>
    <nameAlias firstName="Saddam" wholeName="Saddam Hussein Al-Tikriti" strong="true" logicalId="17"></nameAlias>
    <nameAlias wholeName="Abu Ali" strong="true" logicalId="19"></nameAlias>
  </sanctionEntity>
  <sanctionEntity euReferenceNumber="EU.1.2" logicalId="14">
    <regulation programme="RUS" logicalId="1"/>
    <subjectType code="enterprise" classificationCode="E"/>
    <nameAlias wholeName="Example &amp; Trading LLC" logicalId="20"/>
  </sanctionEntity>
</export>`;
const UN = `<CONSOLIDATED_LIST dateGenerated="2026-11-14T00:00:05.893Z"><INDIVIDUALS><INDIVIDUAL>
  <DATAID>6907993</DATAID><FIRST_NAME>ERIC</FIRST_NAME><SECOND_NAME>BADEGE</SECOND_NAME><UN_LIST_TYPE>DRC</UN_LIST_TYPE>
  <REFERENCE_NUMBER>CDi.001</REFERENCE_NUMBER><INDIVIDUAL_ALIAS><QUALITY/><ALIAS_NAME/></INDIVIDUAL_ALIAS>
</INDIVIDUAL></INDIVIDUALS><ENTITIES><ENTITY><DATAID>1</DATAID><FIRST_NAME>AL-QAIDA</FIRST_NAME><UN_LIST_TYPE>Al-Qaida</UN_LIST_TYPE>
  <REFERENCE_NUMBER>QDe.004</REFERENCE_NUMBER><ENTITY_ALIAS><QUALITY>a.k.a.</QUALITY><ALIAS_NAME>The Base</ALIAS_NAME></ENTITY_ALIAS>
</ENTITY></ENTITIES></CONSOLIDATED_LIST>`;
const UK = `<Designations><DateGenerated>12/11/2026</DateGenerated><Designation><UniqueID>AFG0006</UniqueID>
  <Names><Name><Name1>MOHAMMAD</Name1><Name2>HASSAN</Name2><Name6>AKHUND</Name6><NameType>Primary Name</NameType></Name>
  <Name><Name6>Mullah Hassan</Name6><NameType>Alias</NameType></Name></Names>
  <RegimeName>The Afghanistan (Sanctions) (EU Exit) Regulations 2020</RegimeName><IndividualEntityShip>Individual</IndividualEntityShip>
</Designation></Designations>`;

let lib, sanctions, entry;
before(async () => {
  lib = await loadTypeScript(require.resolve("../src/lib/intl-sanctions.ts"));
  sanctions = await loadTypeScript(require.resolve("../src/routes/sanctions.ts"));
  entry = sanctions.SANCTIONS.find((e) => e.endpoint.path === "/sanctions/check");
});

test("parsers read the three official formats", () => {
  const eu = lib.parseEu(EU);
  assert.equal(eu.date, "2026-10-23T15:05:43.888Z");
  assert.deepEqual(eu.parties[0], { id: "EU.27.28", name: "Saddam Hussein Al-Tikriti", type: "person", programs: ["IRQ"], aliases: ["Abu Ali"] });
  assert.equal(eu.parties[1].name, "Example & Trading LLC");
  assert.equal(eu.parties[1].type, "entity");
  const un = lib.parseUn(UN);
  assert.equal(un.parties.length, 2);
  assert.deepEqual(un.parties[0], { id: "CDi.001", name: "ERIC BADEGE", type: "person", programs: ["DRC"], aliases: [] });
  assert.deepEqual(un.parties[1].aliases, ["The Base"]);
  const uk = lib.parseUk(UK);
  assert.equal(uk.date, "2026-11-12T00:00:00.000Z");
  assert.deepEqual(uk.parties[0], { id: "AFG0006", name: "MOHAMMAD HASSAN AKHUND", type: "person", programs: ["The Afghanistan (Sanctions) (EU Exit) Regulations 2020"], aliases: ["Mullah Hassan"] });
});

const index = () => sanctions.intlFromCompact(lib.compactIntl({ eu: EU, un: UN, uk: UK }, "2026-11-14T00:00:00.000Z"));

test("name screening across EU, UN and UK, filtered by list", () => {
  const all = new Set(["eu", "un", "uk"]);
  const hits = sanctions.screenIntl(index(), "Saddam Hussein", all);
  assert.equal(hits[0].list, "eu");
  assert.equal(hits[0].listId, "EU.27.28");
  assert.equal(sanctions.screenIntl(index(), "abu ali", all)[0].matchedName, "Abu Ali");
  assert.equal(sanctions.screenIntl(index(), "the base", new Set(["un"]))[0].listId, "QDe.004");
  assert.equal(sanctions.screenIntl(index(), "Saddam", new Set(["uk"])).length, 0);
  assert.equal(sanctions.screenIntl(index(), "akhund", all)[0].list, "uk");
});

test("lists input: all by default, aliases, refuses unknown names and prototype keys", () => {
  assert.deepEqual([...sanctions.listsInput(undefined)], ["ofac", "eu", "un", "uk"]);
  assert.deepEqual([...sanctions.listsInput("EU, gb")], ["eu", "uk"]);
  assert.throws(() => sanctions.listsInput("constructor"), /not a list/);
  assert.throws(() => sanctions.listsInput("mars"), /not a list/);
});

test("/sanctions/check answers a name from the EU/UN/UK lists without OFAC when asked", async () => {
  sanctions.setIntlIndex(index());
  try {
    const q = (o) => (k) => o[k];
    const r = await entry.run({}, q({ name: "Saddam Hussein", lists: "eu,un,uk" }));
    assert.equal(r.verdict, "review");
    assert.equal(r.matches[0].list, "eu");
    assert.equal(r.lists.length, 3);
    assert.ok(r.lists.every((l) => l.checked));
    assert.equal(r.listDate, null);
    const clean = await entry.run({}, q({ name: "Nobody Atall", lists: "uk" }));
    assert.equal(clean.verdict, "pass");
    assert.equal(clean.lists[0].date, "2026-11-12T00:00:00.000Z");
  } finally {
    sanctions.setIntlIndex(undefined);
  }
});

test("published example names every list and keeps the old OFAC fields", () => {
  const ex = entry.endpoint.outputExample;
  assert.deepEqual(ex.lists.map((l) => l.list), ["ofac", "eu", "un", "uk"]);
  for (const k of ["verdict", "listed", "matches", "list", "listDate", "entries", "note"]) assert.ok(k in ex, k);
});
