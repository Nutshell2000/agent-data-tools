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
  // Capped at the ordinary per-call price, not the cheapest tool's, so a copied client can pay for most tools.
  assert.match(example, /const maxUsdcAtomic = 3000n; \/\/ \$0\.003 USDC, the ordinary per-call price \(\/extract costs \$0\.002\)/);
  assert.match(example, /maxAmountPerPayment: "\$0\.003"/);
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

test("agent discovery leads to a free quote and downloadable capped client", async () => {
  const discovery = await loadTypeScript(require.resolve("../src/discovery.ts"));
  const origin = "https://api.example.test";
  const document = discovery.llmsTxt(origin, false, "0x1111111111111111111111111111111111111111");
  assert.ok(document.indexOf("standalone Node CLI") < document.indexOf("npm install"));
  assert.match(document, /quote https:\/\/example.com --format both/);
  assert.match(document, /buy https:\/\/example.com --max-usdc 0\.002/);
  const card = discovery.serviceCard(origin, "recipient", "eip155:8453");
  assert.ok(card.docs.readerClient.endsWith(`/clients/reader/${discovery.READER_VERSION}/reader-client.mjs`));
  assert.ok(card.docs.readerExamples.endsWith("/examples/extract/manifest.json"));
  assert.match(discovery.robotsTxt(origin), /Sitemap: https:\/\/api.example.test\/sitemap.xml/);
  const sitemap = discovery.sitemapXml(origin);
  assert.match(sitemap, /xmlns="http:\/\/www.sitemaps.org\/schemas\/sitemap\/0.9"/);
  assert.match(sitemap, /<loc>https:\/\/api.example.test\/guides\/web-reading<\/loc>/);
  assert.doesNotMatch(sitemap, /extract\?|private|clients\/reader/);
});


test("reader documentation is canonical across owned discovery metadata", async () => {
  const d = await loadTypeScript(require.resolve("../src/discovery.ts"));
  const origin = "https://api.example.test";
  const api = d.openApi(origin);
  assert.equal(api.externalDocs.url, origin + "/guides/web-reading");
  assert.equal(api.paths["/extract"].get.externalDocs.url, api.externalDocs.url);
  assert.match(api.info.description, /^\d+ pay-per-call tools for AI agents/);
  assert.match(api.info.description, /Read public static documentation/);
  assert.equal(api.info.contact.email, "spellz111122@gmail.com");
  assert.ok(d.EXTRA_LINKS.every(link => link.href !== "/store"));
  const html = d.homePage(origin, "0x1111111111111111111111111111111111111111");
  assert.match(html, /rel="canonical" href="https:\/\/api.example.test\/"/);
  assert.ok(html.indexOf("Buy one page") < html.indexOf("Tools and prices"));
});

test("the registry description in server.json states the live tool count", async () => {
  const manifest = require("../server.json");
  const discovery = await loadTypeScript(require.resolve("../src/discovery.ts"));
  assert.match(manifest.description, new RegExp(`^${discovery.ENDPOINTS.length} agent tools: `), "update server.json when tools are added or removed");
  assert.ok(manifest.description.length <= 100, "the MCP Registry allows 100 characters");
});
