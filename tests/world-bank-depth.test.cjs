// World Bank snapshot depth (11 Nov 2026): every indicator must carry a real history. From 22 Oct to 11 Nov the
// snapshot held one year of total unemployment per country, and /econ/unemployment sold that as its history.
const assert = require("node:assert/strict");
const { before, test } = require("node:test");
const esbuild = require("esbuild");
const Module = require("node:module");

async function load(entry) {
  const built = await esbuild.build({ entryPoints: [entry], bundle: true, platform: "node", format: "cjs", write: false, external: ["cloudflare:workers"] });
  const mod = new Module(entry, null);
  mod.filename = entry;
  mod.paths = Module._nodeModulePaths(process.cwd());
  mod._compile(built.outputFiles[0].text, entry);
  return mod.exports;
}

let W, E;
before(async () => {
  W = await load(require.resolve("../src/data/world-bank.generated.ts"));
  E = await load(require.resolve("../src/routes/econ.ts"));
});

test("every indicator holds at least five years for the median country", () => {
  for (const [key, byCountry] of Object.entries(W.WORLD_BANK_SERIES)) {
    const depths = Object.values(byCountry).map((years) => Object.keys(years).length).sort((a, b) => a - b);
    assert.ok(depths.length >= 150, `${key}: ${depths.length} countries`);
    assert.ok(depths[Math.floor(depths.length / 2)] >= 5, `${key}: median depth ${depths[Math.floor(depths.length / 2)]}`);
  }
});

test("unemployment history is a history: five years for large economies, newest first", () => {
  for (const code of ["SWE", "USA", "DEU", "JPN", "BRA", "IND"]) {
    const s = E.seriesFor("unemploymentPct", code, 5);
    assert.equal(s.values.length, 5, code);
    assert.ok(s.values[0].year > s.values[4].year, code);
    assert.equal(s.latest.year, s.values[0].year);
  }
});
