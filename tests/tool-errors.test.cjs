// "Nothing found" from a tool is 422 NOT_FOUND over HTTP, never 404 (11 Nov 2026): routers read a 404 on a tool URL as a
// broken endpoint and rank the seller down. Local, no network.
const assert = require("node:assert/strict");
const { before, test } = require("node:test");
const { readFileSync } = require("node:fs");
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

let E, D, S;
before(async () => {
  E = await load(require.resolve("../src/lib/tool-errors.ts"));
  D = await load(require.resolve("../src/discovery.ts"));
  S = await load(require.resolve("../src/endpoints.ts"));
});

test("a tool's 404 is answered as 422 with code NOT_FOUND and the tool's own message", () => {
  assert.deepEqual(E.toolErrorAnswer({ status: 404, message: "no CVE record with that ID; nothing was charged" }, true),
    { status: 422, body: { error: "no CVE record with that ID; nothing was charged", code: "NOT_FOUND" } });
  // A tool that names its own condition keeps that name.
  assert.equal(E.toolErrorAnswer({ status: 404, message: "x", code: "NO_POOL" }, true).body.code, "NO_POOL");
});

test("everything else keeps its status; a 400 keeps the inputs and the example", () => {
  assert.deepEqual(E.toolErrorAnswer({ status: 404, message: "not found" }, false), { status: 404, body: { error: "not found" } });
  const help = { inputs: { city: "optional string: a city" }, example: "https://x.test/weather?city=London" };
  assert.deepEqual(E.toolErrorAnswer({ status: 400, message: "city is required" }, true, help), { status: 400, body: { error: "city is required", ...help } });
  assert.deepEqual(E.toolErrorAnswer({ status: 503, message: "busy", code: "ARXIV_BUSY" }, true), { status: 503, body: { error: "busy", code: "ARXIV_BUSY" } });
  assert.equal(E.toolErrorAnswer({ status: 422, message: "the call reverted" }, true).status, 422);
});

test("the HTTP error handler uses it, and no tool documents or promises a 404", () => {
  const index = readFileSync(require.resolve("../src/index.ts"), "utf8");
  assert.match(index, /toolErrorAnswer\(err, err\.status === 404 && ENDPOINTS\.some/);
  const doc = D.openApi("https://api.test");
  for (const e of S.ENDPOINTS) {
    assert.equal(doc.paths[e.path].get.responses["404"], undefined, `${e.path} documents no 404`);
    assert.doesNotMatch(e.description, /\b404\b/, `${e.path}'s description promises no 404`);
  }
  assert.match(doc.components.responses.Unprocessable.description, /NOT_FOUND/);
});
