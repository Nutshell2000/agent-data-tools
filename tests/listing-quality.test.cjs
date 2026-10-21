const assert = require("node:assert/strict");
const Module = require("node:module");
const { before, test } = require("node:test");
const esbuild = require("esbuild");
const Ajv = require("ajv");

async function loadTypeScript(entry) {
  const result = await esbuild.build({ entryPoints: [entry], bundle: true, platform: "node", format: "cjs", write: false });
  const loaded = new Module(entry, module);
  loaded.filename = entry;
  loaded.paths = Module._nodeModulePaths(process.cwd());
  loaded._compile(result.outputFiles[0].text, entry);
  return loaded.exports;
}

let discovery, outputSchema;
before(async () => {
  discovery = await loadTypeScript(require.resolve("../src/discovery.ts"));
  outputSchema = await loadTypeScript(require.resolve("../src/lib/output-schema.ts"));
});

test("every listed tool says when an agent should use it, within the directory length bound", () => {
  for (const e of discovery.ENDPOINTS) {
    assert.match(e.description, /(^|\. )Use (when|to|for|before|as) /, e.path);
    assert.ok(e.description.length <= 450, `${e.path} ${e.description.length}`);
  }
});

test("output schemas derived from examples describe nested fields and accept their own example", () => {
  const ajv = new Ajv({ strict: false });
  for (const e of discovery.ENDPOINTS) {
    const schema = outputSchema.schemaFromExample(e.outputExample);
    assert.equal(schema.type, "object", e.path);
    assert.ok(Object.keys(schema.properties).length > 0, e.path);
    assert.equal(ajv.validate(schema, e.outputExample), true, `${e.path} ${JSON.stringify(ajv.errors)}`);
  }
  assert.deepEqual(outputSchema.schemaFromExample({ a: [{ b: 1 }], c: null, d: [] }), {
    type: "object",
    properties: { a: { type: "array", items: { type: "object", properties: { b: { type: "number" } } } }, c: {}, d: { type: "array", items: {} } },
  });
});

test("openapi describes each family result field by field", () => {
  const doc = discovery.openApi("https://example.test");
  const schema = doc.paths["/base/balance"].get.responses["200"].content["application/json"].schema;
  assert.equal(schema.type, "object");
  for (const field of Object.keys(discovery.ENDPOINTS.find((e) => e.path === "/base/balance").outputExample)) assert.ok(schema.properties[field], field);
});

test("home page and llms.txt present the full catalog without mis-encoded dashes", () => {
  const html = discovery.homePage("https://example.test", "0x0000000000000000000000000000000000000001");
  assert.ok(html.includes(`<title>${discovery.PAGE_TITLE}</title>`));
  assert.match(discovery.PAGE_TITLE, new RegExp(`${discovery.ENDPOINTS.length} tools, 25 free calls`));
  assert.doesNotMatch(html, /â€”/);
  assert.doesNotMatch(discovery.llmsTxt("https://example.test", false, "0x0000000000000000000000000000000000000001"), /â€”/);
});

test("catalog is grouped by category with every tool listed exactly once", () => {
  const html = discovery.homePage("https://example.test", "0x0000000000000000000000000000000000000001");
  const links = html.match(/<td class="path"><a href="\/tools\//g).length;
  assert.equal(links, discovery.ENDPOINTS.length + 6, "each tool once per category table plus six Start here rows");
  for (const e of discovery.ENDPOINTS) assert.ok(html.includes(`id="tool-${e.path.slice(1).replaceAll("/", "_")}"`), e.path);
  for (const name of discovery.CATEGORY_ORDER) assert.match(html, new RegExp(`<h3 class="cat">${name} \\(\\d+\\)</h3>`));
  const llms = discovery.llmsTxt("https://example.test", false, "0x0000000000000000000000000000000000000001");
  assert.equal(llms.match(/^#### GET /gm).length, discovery.ENDPOINTS.length);
  assert.deepEqual(["/base/balance", "/price/tokens", "/wallet/portfolio", "/wallet", "/base64/encode", "/sanctions/check", "/feed", "/ai/chat", "/holidays"].map(discovery.categoryOf),
    ["Chain data", "Prices and DeFi", "Prices and DeFi", "Chain data", "Utilities", "Company, compliance and checks", "Web, documents and search", "AI", "Everyday data"]);
});

test("Worker bundle replaces Ajv's runtime compiler with a stand-in that fails immediately", async () => {
  const fs = require("node:fs");
  assert.match(fs.readFileSync(require.resolve("../wrangler.jsonc"), "utf8"), /"alias":\s*\{\s*"ajv\/dist\/2020\.js":\s*"\.\/src\/lib\/ajv-unavailable\.ts"\s*\}/);
  const { default: Ajv } = await loadTypeScript(require.resolve("../src/lib/ajv-unavailable.ts"));
  assert.throws(() => new Ajv({ strict: false }).compile({ type: "object" }), /unavailable on Cloudflare Workers/);
});

test("service summary states the current tool count and the buyer terms", () => {
  assert.match(discovery.SERVICE_SUMMARY, new RegExp(`^${discovery.ENDPOINTS.length} pay-per-call tools`));
  for (const phrase of ["No account needed", "25 free calls", "/credits", "failed calls are never charged", "/status"]) assert.ok(discovery.SERVICE_SUMMARY.includes(phrase), phrase);
});

test("OpenAPI x-guidance stays short enough for AgentCash to include it automatically", () => {
  // @agentcash/discovery auto-includes guidance up to 1,000 estimated tokens (length / 4) and flags anything over 4,000 characters.
  const guidance = discovery.openApi("https://agent-data-tools.revmesh2074.workers.dev").info["x-guidance"];
  assert.ok(guidance.length <= 4000, `x-guidance is ${guidance.length} characters`);
  for (const path of ["/status", "/price/token", "/sanctions/check", "/extract", "/mcp"]) assert.ok(guidance.includes(path), path);
});

test("every published ownership proof is a PAY_TO signature of the production origin", async () => {
  const { recoverMessageAddress } = require("viem");
  const fs = require("node:fs");
  const payTo = fs.readFileSync(require.resolve("../wrangler.jsonc"), "utf8").match(/"PAY_TO":\s*"(0x[0-9a-fA-F]{40})"/)[1];
  for (const proof of discovery.OWNERSHIP_PROOFS) {
    if (proof.length === 132) {
      // Plain EOA signature: must recover to PAY_TO offline.
      const signer = await recoverMessageAddress({ message: "https://agent-data-tools.revmesh2074.workers.dev", signature: proof });
      assert.equal(signer.toLowerCase(), payTo.toLowerCase(), proof);
    } else {
      // Smart-wallet (ERC-1271) signature: must be an ABI-wrapped 65-byte owner signature; CI then
      // verifies it against PAY_TO on Base with `npm run check:ownership`.
      assert.match(proof, /^0x([0-9a-f]{64}){4}[0-9a-f]{130}0{62}$/, proof);
      assert.equal(parseInt(proof.slice(2 + 64 * 3, 2 + 64 * 4), 16), 65, proof);
    }
  }
  const api = discovery.openApi("https://agent-data-tools.revmesh2074.workers.dev");
  assert.equal("x-agentcash-provenance" in api, discovery.OWNERSHIP_PROOFS.length > 0);
});

test("directory scrapers get the HTML homepage with OpenGraph tags; programs keep the JSON card", async () => {
  const { prefersHtml } = await loadTypeScript(require.resolve("../src/lib/negotiate.ts"));
  assert.equal(prefersHtml(undefined, "Mozilla/5.0 (compatible; x402scan/1.0; +https://x402.org)"), true);
  assert.equal(prefersHtml("*/*", "Mozilla/5.0 (Macintosh)"), true);
  assert.equal(prefersHtml("text/html,application/xhtml+xml", "curl/8"), true);
  assert.equal(prefersHtml("application/json", "Mozilla/5.0"), false);
  assert.equal(prefersHtml(undefined, "node"), false);
  assert.equal(prefersHtml("*/*", undefined), false);
  const html = discovery.homePage("https://example.test", "0x0000000000000000000000000000000000000001");
  for (const tag of ["og:title", "og:description", "og:site_name", "og:url"]) assert.match(html, new RegExp(`<meta property="${tag}" content="[^"]+">`), tag);
  // x402scan shows the og:image beside the listing; it must be a real 1200x630 PNG.
  assert.match(html, /<meta property="og:image" content="https:\/\/example\.test\/og\.png">/);
  const { OG_IMAGE_PNG_BASE64 } = await loadTypeScript(require.resolve("../src/lib/og-image.ts"));
  const png = Buffer.from(OG_IMAGE_PNG_BASE64, "base64");
  assert.equal(png.subarray(1, 4).toString(), "PNG");
  assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [1200, 630]);
  assert.ok(png.length < 64 * 1024, `og.png is ${png.length} bytes`);
});

test("directory listing copy names every MCP bundle with its current tool count", () => {
  // Normalized so a Windows checkout with CRLF line endings reads the same as CI.
  const copy = require("node:fs").readFileSync(require.resolve("../docs/listings.md"), "utf8").replace(/\r\n/g, "\n");
  for (const slug of Object.keys(discovery.MCP_BUNDLES)) {
    assert.match(copy, new RegExp(`/mcp/${slug} \\([^)]*, ${discovery.mcpBundleTools(slug).length} tools\\)`), slug);
  }
  const short = copy.split("## Short description (under 160 characters)\n\n")[1].split("\n")[0];
  assert.ok(short.length <= 160, `short description is ${short.length}`);
});

// Zero.xyz names a crawled tool after its serviceName and searches that name lexically, so each measured buyer
// intent must find our tool by its words (Zero intents with paid calls, 20 Oct 2026).
test("listing names carry the words of the measured buyer intents", async () => {
  const { listingName } = await loadTypeScript(require.resolve("../src/lib/bazaar-extension.ts"));
  const nameOf = (path) => listingName(discovery.ENDPOINTS.find((e) => e.path === path).summary).toLowerCase();
  const intents = [
    ["/email", ["verify", "email"]],
    ["/company", ["company", "data"]],
    ["/weather", ["weather"]],
    ["/domain", ["domain"]],
    ["/check/counterparty", ["payee"]],
    ["/check/payee", ["payee"]],
    ["/check/x402-seller", ["x402", "seller"]],
    ["/sanctions/check", ["sanctions"]],
    ["/token-report", ["token", "honeypot"]],
    ["/x402/check", ["x402"]],
    ["/package", ["package", "risk"]],
  ];
  for (const [path, words] of intents) for (const w of words) assert.ok(nameOf(path).includes(w), `${path}: "${nameOf(path)}" lacks "${w}"`);
});
