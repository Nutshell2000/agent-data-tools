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
  assert.match(html, new RegExp(`<title>${discovery.ENDPOINTS.length} pay-per-call tools for AI agents`));
  assert.doesNotMatch(html, /â€”/);
  assert.doesNotMatch(discovery.llmsTxt("https://example.test", false, "0x0000000000000000000000000000000000000001"), /â€”/);
});

test("catalog is grouped by category with every tool listed exactly once", () => {
  const html = discovery.homePage("https://example.test", "0x0000000000000000000000000000000000000001");
  const links = html.match(/href="#tool-/g).length;
  assert.equal(links, discovery.ENDPOINTS.length + 6, "each tool once per category table plus six Start here rows");
  for (const e of discovery.ENDPOINTS) assert.ok(html.includes(`id="tool-${e.path.slice(1).replaceAll("/", "_")}"`), e.path);
  for (const name of discovery.CATEGORY_ORDER) assert.match(html, new RegExp(`<h3 class="cat">${name} \\(\\d+\\)</h3>`));
  const llms = discovery.llmsTxt("https://example.test", false, "0x0000000000000000000000000000000000000001");
  assert.equal(llms.match(/^#### GET /gm).length, discovery.ENDPOINTS.length);
  assert.deepEqual(["/base/balance", "/price/tokens", "/wallet/portfolio", "/wallet", "/base64/encode", "/sanctions/check", "/feed", "/ai/chat", "/holidays"].map(discovery.categoryOf),
    ["Chain data", "Prices and DeFi", "Prices and DeFi", "Chain data", "Utilities", "Company, compliance and checks", "Web, documents and search", "AI", "Everyday data"]);
});
