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

const ORIGIN = "https://example.test";
const ENV = {
  PAY_TO: "0x2074c40346ae2a90e0e4a391bcee6f16bf5277f5",
  NETWORK: "eip155:8453",
  EXTRA_NETWORKS: "eip155:137,eip155:42161,eip155:143,eip155:480",
  SOLANA_PAY_TO: "",
};
let discovery, index, contract;
before(async () => {
  discovery = await loadTypeScript(require.resolve("../src/discovery.ts"));
  index = await loadTypeScript(require.resolve("../src/lib/discovery-index.ts"));
  contract = await loadTypeScript(require.resolve("../src/mcp-contract.ts"));
});

// The paying bot of 21 Oct picked by task from our discovery files; every surface an agent reads must agree on
// which tools come first, or the one it reads shows toys and chain reads before the payee checks.
test("every discovery surface lists the same first 15 tools in sales order", () => {
  const expected = index.discoveryResources(ENV, ORIGIN).items.slice(0, 15).map((i) => i.resource.slice(ORIGIN.length));
  assert.deepEqual(expected.slice(0, 2), ["/ai/chat", "/ai/chat-large"]);
  assert.ok(expected.includes("/check/payee") && expected.includes("/check/counterparty"), "payee checks in the first 15");
  const card = discovery.serviceCard(ORIGIN, ENV.PAY_TO, ENV.NETWORK).endpoints.slice(0, 15).map((e) => e.url.slice(ORIGIN.length));
  assert.deepEqual(card, expected, "service card");
  const toolNames = expected.map((p) => contract.mcpName(p));
  assert.deepEqual(discovery.mcpServerCard(ORIGIN).tools.slice(0, 15).map((t) => t.name), toolNames, "MCP server card");
  const openApiTools = Object.keys(discovery.openApi(ORIGIN).paths).filter((p) => !p.startsWith("/v1/")).slice(0, 15);
  assert.deepEqual(openApiTools, expected, "OpenAPI");
  const llms = discovery.llmsTxt(ORIGIN, false, ENV.PAY_TO);
  const start = llms.slice(llms.indexOf("## Start here"), llms.indexOf("## Endpoints"));
  const listed = [...start.matchAll(/GET https:\/\/example\.test(\S+)/g)].map((m) => m[1]);
  assert.deepEqual(listed, expected.slice(0, listed.length), "llms.txt Start here");
  assert.ok(listed.length >= 10);
});

test("the cards list every payment rail they are given, primary network first", () => {
  const rails = { networks: ["eip155:8453", "eip155:137"], mpp: ["tempo/charge", "evm/charge"] };
  const card = discovery.serviceCard(ORIGIN, ENV.PAY_TO, ENV.NETWORK, rails);
  assert.equal(card.payment.network, "eip155:8453");
  assert.deepEqual(card.payment.networks, rails.networks);
  assert.deepEqual(card.payment.mpp, rails.mpp);
  const mcpCard = discovery.mcpServerCard(ORIGIN, rails.networks);
  assert.equal(mcpCard.payment.network, "eip155:8453");
  assert.deepEqual(mcpCard.payment.networks, rails.networks);
  // The networks a card would list are the ones every discovery resource accepts.
  const accepted = [...new Set(index.discoveryResources(ENV, ORIGIN).items[0].accepts.map((a) => a.network))];
  assert.deepEqual(accepted, ["eip155:8453", ...ENV.EXTRA_NETWORKS.split(",")]);
});

test("a guessed URL is pointed at the matching paid tools, and junk gets no suggestion", () => {
  const cases = { "/api/v1/weather": "/weather", "/ofac": "/sanctions/check", "/payee": "/check/payee", "/honeypot": "/token-report", "/scrape": "/extract", "/whois": "/domain", "/api/btc/fees": "/btc-fees", "/kyc": "/check/counterparty" };
  for (const [guess, tool] of Object.entries(cases)) assert.equal(discovery.suggestTools(guess)[0], tool, guess);
  for (const junk of ["/wp-login.php", "/favicon.ico", "/api", "/.env"]) assert.deepEqual(discovery.suggestTools(junk), [], junk);
  assert.ok(discovery.suggestTools("/gas").length <= 3);
  const plugin = discovery.aiPluginManifest(ORIGIN);
  assert.equal(plugin.api.url, `${ORIGIN}/openapi.json`);
  assert.equal(plugin.auth.type, "none");
});
