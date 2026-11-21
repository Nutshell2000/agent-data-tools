// 21 Nov 2026: an SDK's own key (OpenAI Bearer sk-…, Anthropic/Exa x-api-key, ElevenLabs xi-api-key) is not a payment, so
// the API-shaped fronts must quote it like an unpaid request instead of refusing its empty first probe with 400.
const assert = require("node:assert/strict");
const { before, test } = require("node:test");
const esbuild = require("esbuild");
const Module = require("node:module");

async function load(entry) {
  const built = await esbuild.build({ entryPoints: [entry], bundle: true, platform: "node", format: "cjs", write: false, external: ["cloudflare:workers"] });
  const mod = new Module(entry, null);
  mod.filename = entry;
  mod.paths = Module._nodeModulePaths(process.cwd());
  mod._compile(built.outputFiles[0].text, entry);
  return mod.exports;
}

let P;
before(async () => { P = await load(require.resolve("../src/lib/paying-request.ts")); });
const headers = (h) => (name) => h[name];
const key = "adt_" + "a".repeat(43);

test("payments and our own keys count as paying", () => {
  for (const h of [
    { "payment-signature": "e30=" }, { "x-payment": "e30=" },
    { authorization: 'Payment id="x", method="tempo"' }, { authorization: `Bearer ${key}` }, { authorization: key },
    { "x-api-key": key }, { "xi-api-key": ` ${key}` },
  ]) assert.equal(P.carriesPayment(headers(h)), true, JSON.stringify(h));
});

test("an SDK's own key, or no header, is not a payment", () => {
  for (const h of [
    {}, { authorization: "Bearer sk-test" }, { authorization: "Bearer sk-ant-api03-x" }, { "x-api-key": "sk-ant-x" },
    { "x-api-key": "exa_123" }, { "xi-api-key": "sk_eleven" }, { authorization: "Basic dXNlcjpwYXNz" },
  ]) assert.equal(P.carriesPayment(headers(h)), false, JSON.stringify(h));
});
