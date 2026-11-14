// Listing inputs as planners use them (14 Nov 2026). Routers and agents fill EVERY listed input from its `examples`, not
// only the required ones, so an optional example must work beside the required ones, and a list input must not carry a
// one-address pattern. Live check of the same rule: `node scripts/smoke-examples.mjs --all-params` (638/643 before the fix).
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

let endpoints, bazaar;
before(async () => {
  endpoints = await loadTypeScript(require.resolve("../src/endpoints.ts"));
  bazaar = await loadTypeScript(require.resolve("../src/lib/bazaar-extension.ts"));
});

const tool = (path) => endpoints.ENDPOINTS.find((e) => e.path === path);

test("the HTML section input offers no example to planners on /extract and its doors", () => {
  for (const path of ["/extract", "/scrape", "/web/fetch", "/page/markdown"]) {
    const e = tool(path);
    assert.ok(e, path);
    const props = bazaar.bazaarInputProperties(e);
    assert.ok(props.section, `${path} keeps the section input`);
    assert.equal("examples" in props.section, false, `${path} section must not list an example`);
    assert.ok(props.url.examples.length, `${path} url keeps its example`);
  }
});

test("list inputs and non-EVM addresses are not held to a single 0x address", () => {
  const call = endpoints.ENDPOINTS.filter((e) => /\/call$/.test(e.path) && e.params.args);
  assert.ok(call.length >= 10, "every network's contract call");
  for (const e of call) assert.equal(bazaar.bazaarInputProperties(e).args.pattern, undefined, e.path);
  for (const e of endpoints.ENDPOINTS) {
    for (const [name, p] of Object.entries(bazaar.bazaarInputProperties(e))) {
      if (!p.pattern) continue;
      assert.doesNotMatch(e.params[name].description, /comma|JSON array|Solana/i, `${e.path} ${name}`);
    }
  }
  // A single-address input keeps its pattern.
  assert.equal(bazaar.bazaarInputProperties(tool("/base/call")).to.pattern, "^0x[0-9a-fA-F]{40}$");
});

test("an optional example names the same network as the required example address", () => {
  assert.equal(tool("/contract/abi").params.chain.example, "ethereum");
});

test("the discovery files list Solana terms when a Solana payee is set, like the live 402 does", async () => {
  const idx = await loadTypeScript(require.resolve("../src/lib/discovery-index.ts"));
  const env = { NETWORK: "eip155:8453", EXTRA_NETWORKS: "eip155:137,eip155:42161", PAY_TO: "0x6293ded2684f1a76e26becef87c137d691fbf800", SOLANA_PAY_TO: "82wfSCZhCmZA7zwqqt6Q3FG8nqYBwUvbThP6M97fa9Q6" };
  const terms = idx.usdcRequirements(env, "$0.01");
  assert.deepEqual(terms.map((t) => t.network), ["eip155:8453", "eip155:137", "eip155:42161", "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp"]);
  const sol = terms.at(-1);
  assert.equal(sol.asset, "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
  assert.equal(sol.payTo, env.SOLANA_PAY_TO);
  assert.equal(sol.amount, "10000");
  assert.ok(sol.extra.feePayer);
  assert.equal(idx.usdcRequirements({ ...env, SOLANA_PAY_TO: "" }, "$0.01").length, 3);
});
