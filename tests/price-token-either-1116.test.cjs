// 16 Nov 2026: /price/token (and its doors /token/price, /price/crypto) takes a ticker symbol OR a token contract address.
// The listing said `required: ["symbol"]`, so a planner could not send an address alone, and every surface gave both
// inputs an example value, so a planner that fills every input from its example sent symbol=ETH with the cbBTC address
// and was answered (and charged) for cbBTC. These pin what each published schema says now, and that either input works.
const assert = require("node:assert/strict");
const Module = require("node:module");
const { before, test } = require("node:test");
const esbuild = require("esbuild");

async function load(entry) {
  const built = await esbuild.build({ entryPoints: [entry], bundle: true, platform: "node", format: "cjs", write: false, external: ["cloudflare:workers"], logLevel: "silent" });
  const mod = new Module(entry, null);
  mod.filename = entry;
  mod.paths = Module._nodeModulePaths(process.cwd());
  mod._compile(built.outputFiles[0].text, entry);
  return mod.exports;
}

const PATHS = ["/price/token", "/token/price", "/price/crypto"];
const WETH_BASE = "0x4200000000000000000000000000000000000006";
let T, E, B, D, C;
before(async () => {
  T = await load(require.resolve("../src/tools.ts"));
  E = await load(require.resolve("../src/endpoints.ts"));
  B = await load(require.resolve("../src/lib/bazaar-extension.ts"));
  D = await load(require.resolve("../src/discovery.ts"));
  C = await load(require.resolve("../src/mcp-contract.ts"));
});
const tool = (path) => E.ENDPOINTS.find((e) => e.path === path);
/** The two JSON Schema keywords the listing uses for inputs: `required` and `anyOf` of `required` branches. */
const accepts = (schema, input) => schema.required.every((k) => k in input) && (!schema.anyOf || schema.anyOf.some((branch) => branch.required.every((k) => k in input)));

test("the Bazaar listing: symbol or address, neither alone required, one example call", () => {
  for (const path of PATHS) {
    const extension = B.bazaarExtensionFor(tool(path));
    const { info, schema } = extension.bazaar ?? extension;
    const query = schema.properties.input.properties.queryParams;
    assert.deepEqual(Object.keys(query.properties), ["symbol", "address", "chain"], path);
    assert.deepEqual(query.required, [], `${path}: no single input is required`);
    assert.deepEqual(query.anyOf, [{ required: ["symbol"] }, { required: ["address"] }], path);
    assert.ok(accepts(query, { symbol: "ETH" }) && accepts(query, { address: WETH_BASE }) && accepts(query, { address: WETH_BASE, chain: "base" }), `${path}: either input alone fits the schema`);
    assert.ok(!accepts(query, {}) && !accepts(query, { chain: "base" }), `${path}: the schema asks for one of them`);
    // The published example is one call for one token, and it fits its own schema.
    assert.deepEqual(info.input.queryParams, { symbol: "ETH" }, path);
    assert.ok(accepts(query, info.input.queryParams));
    // A planner fills every input that offers an example: the alternative offers none, so it cannot override symbol.
    assert.deepEqual(query.properties.symbol.examples, ["ETH"], path);
    assert.equal("examples" in query.properties.address, false, `${path}: address offers no value to fill in beside symbol`);
    assert.deepEqual(query.properties.chain.examples, ["base"], path);
    assert.match(query.properties.symbol.description, /Send symbol or address, one of the two/, path);
    assert.match(query.properties.address.description, /instead of symbol \(when both are sent, the address is priced\)/, path);
  }
  // Every other one-of tool keeps naming its example input as required.
  // 21 Nov 2026: /weather still answers an empty call, but its listing names city (PLANNED_INPUT_PATHS) so a planner sends a place.
  assert.deepEqual(B.requiredInputs(tool("/weather")), ["city"], "/weather lists city for planners");
  assert.deepEqual(B.requiredInputs(tool("/company")), Object.keys(B.exampleInput(tool("/company"))));
  assert.equal("anyOf" in (B.bazaarExtensionFor(tool("/company")).bazaar ?? B.bazaarExtensionFor(tool("/company"))).schema.properties.input.properties.queryParams, false);
});

test("OpenAPI and MCP: both inputs optional, described as one of the two, and no example on the alternative", async () => {
  const doc = D.openApi("https://example.test");
  const { z } = require("zod");
  for (const path of PATHS) {
    const parameters = Object.fromEntries(doc.paths[path].get.parameters.map((p) => [p.name, p]));
    assert.equal(parameters.symbol.required, false, path);
    assert.equal(parameters.address.required, false, path);
    assert.equal(parameters.symbol.example, "ETH", path);
    assert.equal("example" in parameters.address, false, path);
    assert.match(parameters.symbol.description, /one of the two/, path);
    const shape = C.toolInputShape(tool(path), z);
    assert.ok(shape.symbol.isOptional() && shape.address.isOptional() && shape.chain.isOptional(), `${path}: MCP marks neither required`);
    assert.match(shape.symbol.description ?? shape.symbol.unwrap().description, /Send symbol or address, one of the two/, path);
    // The MCP description's example is the published example call: the symbol alone.
    assert.match(C.toolDescription(tool(path)), / Example: symbol=ETH\. /, path);
    assert.doesNotMatch(C.toolDescription(tool(path)), /Example: [^.]*address=/, path);
  }
});

test("a call with either input gets past the input check; neither is the documented 400 (BTC over HTTP)", async () => {
  // The price is read from a network RPC, which is cut here: a call that was accepted fails later, not with a 400.
  const realFetch = globalThis.fetch;
  const asked = [];
  globalThis.fetch = async (input, init) => {
    const body = typeof init?.body === "string" ? init.body : input instanceof Request ? await input.clone().text() : "";
    asked.push(body.toLowerCase());
    throw new Error("NET");
  };
  const env = new Proxy({}, { get: () => undefined });
  const run = (path, query, wait = 300) => Promise.race([T.TOOLS[path](env, (n) => query[n]), new Promise((_, r) => setTimeout(() => r(Object.assign(new Error("NET timeout"), { status: 599 })), wait))]);
  const pastInputCheck = (e) => e.status !== 400;
  const CBBTC = "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf";
  try {
    // What the descriptions say about both: the address is the one priced. (First, so no other call's retries are in `asked`.)
    await assert.rejects(run("/price/token", { symbol: "ETH", address: CBBTC, chain: "base" }, 1500), pastInputCheck);
    assert.ok(asked.some((body) => body.includes(CBBTC.toLowerCase())), "the address sent is the token read");
    assert.ok(!asked.some((body) => body.includes(WETH_BASE)), "the symbol is not read when an address is sent");
    for (const path of PATHS) {
      await assert.rejects(run(path, { symbol: "ETH" }), pastInputCheck, `${path} symbol alone`);
      await assert.rejects(run(path, { address: WETH_BASE }), pastInputCheck, `${path} address alone`);
      await assert.rejects(run(path, { address: WETH_BASE, chain: "base" }), pastInputCheck, `${path} address and chain`);
      // An input sent empty is no input (a form with the other field left blank).
      await assert.rejects(run(path, { symbol: "ETH", address: "" }), pastInputCheck, `${path} symbol with a blank address`);
      await assert.rejects(run(path, { symbol: " ", address: WETH_BASE }), pastInputCheck, `${path} address with a blank symbol`);
      await assert.rejects(run(path, {}), (e) => e.status === 400 && /symbol \(e\.g\. ETH\) or address/.test(e.message), `${path} neither (MCP, packs)`);
      await assert.rejects(run(path, { chain: "base" }), (e) => e.status === 400, `${path} chain alone`);
      await assert.rejects(run(path, { [T.NO_INPUT]: "1" }), pastInputCheck, `${path} an empty HTTP call answers for BTC`);
    }
  } finally { globalThis.fetch = realFetch; }
});
