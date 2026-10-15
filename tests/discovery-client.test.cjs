const assert = require("node:assert/strict");
const Module = require("node:module");
const { before, test } = require("node:test");
const esbuild = require("esbuild");

async function loadTypeScript(entry) {
  const result = await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    platform: "node",
    format: "cjs",
    write: false,
  });
  const loaded = new Module(entry, module);
  loaded.filename = entry;
  loaded.paths = Module._nodeModulePaths(process.cwd());
  loaded._compile(result.outputFiles[0].text, entry);
  return loaded.exports;
}

let homePage;
let llmsTxt;
let openApi;
let mcpServerCard;
let mcpServerVersion;

before(async () => {
  ({ homePage, llmsTxt, openApi, mcpServerCard, MCP_SERVER_VERSION: mcpServerVersion } =
    await loadTypeScript(require.resolve("../src/discovery.ts")));
});

function decodeHtml(value) {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&");
}

function getHomepageExample(html) {
  const match = html.match(/<pre class="client-example"><code>([\s\S]*?)<\/code><\/pre>/);
  assert.ok(match, "homepage should render the client example");
  return decodeHtml(match[1]);
}

function getLlmsExample(document) {
  const match = document.match(/```typescript\n([\s\S]*?)\n```/);
  assert.ok(match, "llms.txt should render the client example");
  return match[1];
}

test("publishes the same safely capped client example on homepage and llms.txt", async () => {
  const origin = "https://api.example.test";
  const payTo = "0x1111111111111111111111111111111111111111";
  const homepage = homePage(origin, payTo, false);
  const llms = llmsTxt(origin, false, payTo);
  const example = getHomepageExample(homepage);

  assert.equal(example, getLlmsExample(llms));
  assert.match(example, /register\("eip155:8453"/);
  assert.match(example, /requirement\.network !== "eip155:8453"/);
  assert.match(example, /expectedPayTo = "0x1111111111111111111111111111111111111111"/);
  assert.match(example, /0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913/);
  assert.match(example, /const maxUsdcAtomic = 5000n; \/\/ \$0\.005 USDC/);
  assert.match(example, /return \/\^\\d\+\$\/\.test\(requirement\.amount\)/);
  assert.doesNotMatch(example, /trial=1/);
  assert.doesNotMatch(example, /0x[0-9a-fA-F]{64}/, "the example must not contain a private-key literal");
  assert.match(homepage, /npm install @x402\/fetch @x402\/evm viem/);
  assert.match(llms, /npm install --save-dev typescript tsx @types\/node/);
  assert.match(homepage, /\/package-audit<\/code> costs \$0\.20/);
  assert.match(llms, /\/package-audit costs \$0\.20/);
  assert.match(homepage, /Free trials are disabled/);
  assert.match(llms, /Free trials are disabled/);
  assert.doesNotMatch(llms, /Free trials are disabled by default, and the example/);

  await esbuild.transform(example, { loader: "ts", target: "es2022", format: "esm" });
});

test("OpenAPI discovery keeps package-audit price and default-off trial guidance", () => {
  const api = openApi("https://api.example.test", false);
  const guidance = api.info["x-guidance"];

  assert.equal(api.paths["/package-audit"].get["x-payment-info"].price.amount, "0.20");
  assert.match(guidance, /\/package-audit costs \$0\.20/);
  assert.match(guidance, /Free trials are disabled/);
});

test("MCP runtime options and server card match server.json version", () => {
  const manifest = require("../server.json");
  const serverCard = mcpServerCard("https://api.example.test");

  assert.equal(mcpServerVersion, manifest.version);
  assert.equal(serverCard.serverInfo.version, manifest.version);
});
