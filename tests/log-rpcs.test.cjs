const assert = require("node:assert/strict");
const Module = require("node:module");
const { test } = require("node:test");
const esbuild = require("esbuild");

async function load(entry) {
  const r = await esbuild.build({ entryPoints: [entry], bundle: true, platform: "node", format: "cjs", write: false });
  const m = new Module(entry, module); m.filename = entry; m.paths = Module._nodeModulePaths(process.cwd());
  m._compile(r.outputFiles[0].text, entry);
  return m.exports;
}

// eth_getLogs gets its own node order (22 Oct: /base/token-transfers answered 502 on its own example because the
// general order starts with nodes that refuse wide log scans). It may reorder or leave a node out, never add an unvetted
// node. Base leaves out Nodies since 1.146.0 (12 Nov 2026: it hung past 8 s on log scans from Cloudflare).
test("log scans use vetted nodes per chain, reordered with a wide-scan node first", async () => {
  const { EDGE_RPCS, LOG_RPCS } = await load(require.resolve("../src/lib/rpc.ts"));
  for (const chain of Object.keys(EDGE_RPCS)) {
    for (const u of LOG_RPCS[chain]) assert.ok(EDGE_RPCS[chain].includes(u), `${chain}: ${u} is a vetted node`);
    assert.ok(LOG_RPCS[chain].length >= 3, `${chain}: keeps fallbacks`);
  }
  assert.ok(!LOG_RPCS.base.some((u) => u.includes("nodies")), "Nodies is not used for Base log scans");
  assert.equal(LOG_RPCS.base[0], "https://base-rpc.publicnode.com", "Base starts with a node that answers 1,000-block scans");
  assert.ok(!LOG_RPCS.base.slice(0, 2).includes("https://base-mainnet.public.blastapi.io"), "BlastAPI (10-block cap) is not tried first");
});
