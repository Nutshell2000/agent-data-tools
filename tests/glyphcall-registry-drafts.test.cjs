// 16 Nov 2026: MCP Registry entries for the com.glyphcall namespace are prepared, NOT published. Publishing them needs
// the owner to prove control of glyphcall.com to the registry first; until then no workflow may pick them up.
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { readdirSync, readFileSync } = require("node:fs");
const { test } = require("node:test");

const DIR = "registry-drafts/com.glyphcall";
const EXPECTED = { "tools.json": "/mcp/compact", "company-check.json": "/mcp/company-check", "voice.json": "/mcp/voice" };

test("the three com.glyphcall drafts are written beside the published manifests, in their shape, led by the brand", () => {
  execFileSync(process.execPath, ["scripts/build-registry-manifests.mjs"], { encoding: "utf8", timeout: 120_000 });
  const server = JSON.parse(readFileSync("server.json", "utf8"));
  assert.deepEqual(readdirSync(DIR).sort(), Object.keys(EXPECTED).sort());
  for (const [file, path] of Object.entries(EXPECTED)) {
    const text = readFileSync(`${DIR}/${file}`, "utf8");
    const m = JSON.parse(text);
    assert.equal(m.name, `com.glyphcall/${file.replace(".json", "")}`);
    assert.equal(m.$schema, server.$schema);
    assert.equal(m.version, server.version, "the same release as the published manifests");
    assert.deepEqual(m.repository, server.repository);
    assert.match(m.title, /^Glyphcall: \S/);
    assert.match(m.description, /^Glyphcall: \S/);
    assert.ok(m.description.length <= 100 && m.title.length <= 100, `${file}: registry limits`);
    assert.ok(!/\b\d+ (data |agent )?tools\b/.test(m.title + m.description), `${file}: no tool count`);
    assert.equal(m.websiteUrl, "https://glyphcall.com/");
    assert.deepEqual(m.remotes.map((r) => [r.type, r.url]), [["streamable-http", `https://glyphcall.com${path}`]]);
    assert.ok(!text.includes("workers.dev"), `${file}: every address is on glyphcall.com`);
    assert.equal(m.icons[0].src, "https://glyphcall.com/logo.png");
    // Same keys as a manifest the registry already accepts from us (registry/<slug>.json, written by the same script).
    const published = JSON.parse(readFileSync(`registry/${path.split("/").pop()}.json`, "utf8"));
    assert.deepEqual(Object.keys(m).sort(), Object.keys(published).sort(), `${file}: keys`);
    assert.deepEqual(Object.keys(m.remotes[0]).sort(), Object.keys(published.remotes[0]).sort());
    assert.match(published.name, /^io\.github\.Nutshell2000\//, "the published entries keep their names");
  }
});

test("no workflow publishes the drafts: the publish step reads server.json and registry/*.json only", () => {
  const workflow = readFileSync(".github/workflows/publish-mcp.yml", "utf8");
  const loops = [...workflow.matchAll(/for manifest in ([^;\n]+);/g)].map((m) => m[1].trim());
  assert.deepEqual(loops, ["server.json registry/*.json"], "the publish loop changed: check that it still cannot reach registry-drafts/");
  // A shell glob `registry/*.json` matches one path segment inside registry/ and nothing else.
  const globbed = (path) => path === "server.json" || /^registry\/[^/]+\.json$/.test(path);
  for (const file of Object.keys(EXPECTED)) assert.equal(globbed(`${DIR}/${file}`), false, file);
  assert.equal(globbed("registry/voice.json"), true);
  for (const name of readdirSync(".github/workflows")) {
    assert.ok(!readFileSync(`.github/workflows/${name}`, "utf8").includes("registry-drafts"), `${name} must not read the drafts`);
  }
  assert.match(readFileSync(".gitignore", "utf8"), /^registry-drafts\/$/m, "generated, like registry/");
});
