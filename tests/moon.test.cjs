// Moon phases (11 Nov 2026): true new and full moons instead of the mean lunation. Local computation, no network.
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

let P;
before(async () => { P = await load(require.resolve("../src/routes/public-data.ts")); });

// Published new and full moons (UTC, to the minute). The first is the worked example in Meeus's chapter 49.
const KNOWN = [
  ["new", "1977-02-18T03:37:00Z"], ["new", "2000-01-06T18:14:00Z"], ["new", "2024-04-08T18:21:00Z"], ["full", "2024-12-15T09:02:00Z"], ["new", "2025-01-29T12:36:00Z"],
  ["full", "2025-03-14T06:55:00Z"], ["full", "2026-10-26T04:12:00Z"], ["new", "2026-11-09T07:02:00Z"], ["full", "2026-11-24T14:53:00Z"],
];

test("new and full moons fall within a minute of the published times", () => {
  for (const [kind, iso] of KNOWN) {
    const at = Date.parse(iso);
    // Asked half a day before the event, the tool names it as the next one.
    const out = P.moonPhase(new Date(at - 12 * 3600_000));
    const got = Date.parse(kind === "new" ? out.nextNewMoon : out.nextFullMoon);
    assert.ok(Math.abs(got - at) <= 60_000, `${kind} moon ${iso}: got ${new Date(got).toISOString()}`);
  }
});

test("the phase, age and illumination follow the true lunation", () => {
  const at = (iso) => P.moonPhase(new Date(iso));
  assert.equal(at("2026-11-09T07:30:00Z").phase, "New Moon");
  assert.ok(at("2026-11-09T07:30:00Z").ageDays <= 0.1 && at("2026-11-09T07:30:00Z").illuminationPercent < 0.5);
  // The mean-month version called this moment, eight hours before the real new moon, a moon 29 days old and next new in 23 hours.
  const before = at("2026-11-08T23:00:00Z");
  assert.equal(before.nextNewMoon, "2026-11-09T07:02:00.000Z");
  assert.equal(before.phase, "New Moon");
  assert.equal(at("2026-10-26T04:12:00Z").phase, "Full Moon");
  assert.ok(at("2026-10-26T04:12:00Z").illuminationPercent >= 99.9);
  assert.equal(at("2026-10-26T05:00:00Z").nextFullMoon, "2026-11-24T14:54:00.000Z");
  assert.equal(at("2026-10-18T16:00:00Z").phase, "First Quarter");
  assert.equal(at("2024-01-25T18:00:00Z").phase, "Full Moon");
  assert.equal(at("2026-11-17T12:00:00Z").phase, "First Quarter");
  assert.equal(at("2026-11-02T12:00:00Z").phase, "Last Quarter");
  // Every day of four years: the next events lie ahead, within one lunation, and the age never exceeds a lunation.
  for (let d = Date.UTC(2025, 0, 1); d < Date.UTC(2029, 0, 1); d += 864e5 * 1.37) {
    const m = P.moonPhase(new Date(d));
    for (const next of [m.nextNewMoon, m.nextFullMoon]) { const gap = (Date.parse(next) - d) / 864e5; assert.ok(gap > -0.001 && gap < 29.95, `${new Date(d).toISOString()} ${next}`); }
    assert.ok(m.ageDays >= 0 && m.ageDays <= 29.9 && m.illuminationPercent >= 0 && m.illuminationPercent <= 100);
  }
});
