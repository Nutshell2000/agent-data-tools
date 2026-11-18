const assert = require("node:assert/strict");
const { test } = require("node:test");
const Module = require("node:module");
const esbuild = require("esbuild");
async function load(entry) {
  const built = await esbuild.build({ entryPoints: [entry], bundle: true, format: "cjs", platform: "node", write: false, logLevel: "silent", external: ["cloudflare:workers"] });
  const m = new Module(entry, null); m.filename = entry; m.paths = Module._nodeModulePaths(process.cwd()); m._compile(built.outputFiles[0].text, entry); return m.exports;
}
test("flagship tools cross-sell the higher-value next purchase, not a cheaper generic tool", async () => {
  const { relatedTools } = await load("src/lib/related.ts");
  const names = (p) => relatedTools(p).map((e) => e.path);
  assert.deepEqual(names("/transcribe"), ["/transcribe/long", "/transcribe/summary", "/transcribe/speakers"]);
  assert.ok(names("/document/extract").includes("/invoice/check"));
  assert.deepEqual(names("/stock/quote"), ["/stock/history", "/sec/financials"]);
  assert.deepEqual(names("/describe"), ["/image", "/extract"]);
  assert.deepEqual(names("/pdf/text"), ["/extract", "/document/extract", "/summarize"]);
});
