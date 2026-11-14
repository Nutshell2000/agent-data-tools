// The public brand (src/lib/public-brand.ts): off until the owner sets PUBLIC_BRAND; unset, nothing changes.
const assert = require("node:assert/strict");
const { before, test } = require("node:test");
const esbuild = require("esbuild");
const Module = require("node:module");

async function loadTypeScript(entry) {
  const built = await esbuild.build({ entryPoints: [entry], bundle: true, platform: "node", format: "cjs", write: false, external: ["cloudflare:workers"] });
  const mod = new Module(entry, null);
  mod.filename = entry;
  mod.paths = Module._nodeModulePaths(process.cwd());
  mod._compile(built.outputFiles[0].text, entry);
  return mod.exports;
}

let publicBrand, PRODUCTS, productPage, vatIndexPage, registerIndexPage;
before(async () => {
  ({ publicBrand } = await loadTypeScript(require.resolve("../src/lib/public-brand.ts")));
  ({ PRODUCTS, productPage } = await loadTypeScript(require.resolve("../src/lib/product-pages.ts")));
  ({ vatIndexPage } = await loadTypeScript(require.resolve("../src/lib/vat-pages.ts")));
  ({ registerIndexPage } = await loadTypeScript(require.resolve("../src/lib/register-pages.ts")));
});

test("the brand is the owner's setting when it is a plain name, otherwise the service name", () => {
  assert.equal(publicBrand({}, "Agent Data Tools"), "Agent Data Tools");
  assert.equal(publicBrand({ PUBLIC_BRAND: " Glyphcall " }, "Agent Data Tools"), "Glyphcall");
  assert.equal(publicBrand({ PUBLIC_BRAND: "<script>" }, "Agent Data Tools"), "Agent Data Tools");
  assert.equal(publicBrand({ PUBLIC_BRAND: "" }, "Agent Data Tools"), "Agent Data Tools");
});

test("pages for people carry the brand in the title, the crumbs and the structured data", () => {
  const page = productPage(PRODUCTS[0], "https://x.test", false, () => undefined, undefined, true, "Glyphcall");
  assert.match(page, /<title>[^<]* · Glyphcall<\/title>/);
  assert.match(page, /<nav class="crumbs"><a href="\/">Glyphcall<\/a>/);
  assert.match(page, /"provider":\{"@type":"Organization","name":"Glyphcall"/);
  assert.doesNotMatch(page.slice(0, page.indexOf("<h2>For AI agents</h2>")), /Agent Data Tools/);
  assert.match(vatIndexPage("https://x.test", false, "Glyphcall"), / · Glyphcall<\/title>/);
  assert.match(registerIndexPage("https://x.test", "Glyphcall"), / · Glyphcall<\/title>/);
  assert.match(productPage(PRODUCTS[0], "https://x.test", false, () => undefined), / · Agent Data Tools<\/title>/, "default stays the service name");
});
