// /claims/check (Sann): the tool answers its published example, explains in English or Swedish, refuses bad input,
// and the generated engine copy matches the sann-engine repository's known-answer cases that matter most.
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

let C;
before(async () => { C = await loadTypeScript(require.resolve("../src/routes/claims.ts")); });
const q = (o) => (name) => o[name];
const ids = (r) => [...new Set(r.findings.flatMap((f) => f.rules.map((x) => x.id)))].sort();

test("the published example finds the generic and the offset claim and skips the specified one", async () => {
  const e = C.CLAIMS[0];
  assert.equal(e.endpoint.price, "$0.02");
  const r = await e.run({}, q({ text: e.endpoint.params.text.example }));
  assert.equal(r.verdict, "fix");
  assert.deepEqual(ids(r), ["GENERIC", "OFFSET"]);
  assert.equal(r.counts.high, 2);
  for (const f of r.findings) assert.equal(e.endpoint.params.text.example.slice(f.start, f.end), f.text);
});

test("Swedish explanations on request, English by default", () => {
  const en = C.claimsCheck("Miljövänlig tvål", "sv", "en");
  const sv = C.claimsCheck("Miljövänlig tvål", "sv");
  assert.equal(en.findings[0].rules[0].title, "Generic environmental claim");
  assert.equal(sv.findings[0].rules[0].title, "Allmänt miljöpåstående");
  assert.match(sv.disclaimer, /inte juridisk rådgivning/);
});

test("known answers and false positives", () => {
  assert.deepEqual(ids(C.claimsCheck("Dark green linen shirt")), []);
  assert.deepEqual(ids(C.claimsCheck("Hållbarhet: 12 månader", "sv")), []);
  assert.deepEqual(ids(C.claimsCheck("Kontrollera eventuella separata krav på USB-ström.", "sv")), []);
  assert.deepEqual(ids(C.claimsCheck("GOTS certified organic cotton")), ["CERTIFIED"]);
  assert.deepEqual(ids(C.claimsCheck("Nickelfria, kadmiumfria och blyfria örhängen", "sv")), ["LEGAL"]);
  assert.equal(C.claimsCheck("Made from 70% recycled polyester").verdict, "ok");
});

test("bad input is refused before anything runs", async () => {
  const e = C.CLAIMS[0];
  await assert.rejects(async () => e.run({}, q({})), /text is required/);
  await assert.rejects(async () => e.run({}, q({ text: "x", lang: "xx" })), /lang must be/);
  await assert.rejects(async () => e.run({}, q({ text: "a".repeat(C.CLAIMS_MAX + 1) })), /longer than/);
});

test("the engine copy is generated, not hand-edited", () => {
  const fs = require("node:fs"), path = require("node:path");
  for (const f of ["engine.ts", "lexicon.ts", "rules.ts", "index.ts"]) {
    assert.match(fs.readFileSync(path.join(__dirname, "..", "src", "lib", "sann", f), "utf8"), /^\/\/ @ts-nocheck\n\/\/ GENERATED from /, f);
  }
});
