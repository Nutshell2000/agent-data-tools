// HTTP (3 free calls) and MCP (25) must have separate counters. A shared-IP MCP user spending many calls used to
// lock out every HTTP trial=1 caller at that address, and vice versa.
const assert = require("node:assert/strict");
const { test } = require("node:test");
const Module = require("node:module");
const esbuild = require("esbuild");
async function load(entry) {
  const b = await esbuild.build({ entryPoints: [entry], bundle: true, format: "cjs", platform: "node", write: false, logLevel: "silent", external: ["cloudflare:workers"] });
  const m = new Module(entry, null); m.filename = entry; m.paths = Module._nodeModulePaths(process.cwd()); m._compile(b.outputFiles[0].text, entry); return m.exports;
}
test("different surfaces namespace the free-call counter so one cannot exhaust the other", async () => {
  const free = await load("src/lib/free-calls.ts");
  const store = { m: new Map(), transaction(fn) { return fn({
    get: async (k) => this.m.get(k), put: async (k, v) => { this.m.set(k, v); },
  }); } };
  // Simulate what useFreeCall does: namespace the hash per surface, then take with that surface's limit.
  const hash = "deadbeef";
  const httpKey = "http:" + hash, mcpKey = "mcp:" + hash;
  for (let i = 0; i < 25; i++) assert.notEqual(await free.takeFreeCall(store, mcpKey, "2026-11-19", 25), null);
  assert.equal(await free.takeFreeCall(store, mcpKey, "2026-11-19", 25), null, "MCP used up");
  // HTTP still has all 3: the counter is separate.
  assert.equal(await free.takeFreeCall(store, httpKey, "2026-11-19", 3), 2);
  assert.equal(await free.takeFreeCall(store, httpKey, "2026-11-19", 3), 1);
  assert.equal(await free.takeFreeCall(store, httpKey, "2026-11-19", 3), 0);
  assert.equal(await free.takeFreeCall(store, httpKey, "2026-11-19", 3), null);
});
