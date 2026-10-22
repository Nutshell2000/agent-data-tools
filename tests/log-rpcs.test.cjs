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
// general order starts with nodes that refuse wide log scans). It may reorder, never add an unvetted node.
test("log scans use the same vetted nodes per chain, reordered with a wide-scan node first", async () => {
  const { EDGE_RPCS, LOG_RPCS } = await load(require.resolve("../src/lib/rpc.ts"));
  for (const chain of Object.keys(EDGE_RPCS)) {
    assert.deepEqual([...LOG_RPCS[chain]].sort(), [...EDGE_RPCS[chain]].sort(), `${chain}: same nodes`);
  }
  assert.equal(LOG_RPCS.base[0], "https://base-rpc.publicnode.com", "Base starts with a node that answers 1,000-block scans");
  assert.ok(!LOG_RPCS.base.slice(0, 2).includes("https://base-mainnet.public.blastapi.io"), "BlastAPI (10-block cap) is not tried first");
});
