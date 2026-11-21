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
  // 21 Nov 2026: " | brand" only while the title still fits 60 characters (lib/seo-text.ts); never the service name.
  assert.doesNotMatch(page.match(/<title>[^<]*<\/title>/)[0], /Agent Data Tools/);
  assert.match(page, /<nav class="crumbs"><a href="\/">Glyphcall<\/a>/);
  assert.match(page, /"provider":\{"@type":"Organization","name":"Glyphcall"/);
  assert.doesNotMatch(page.slice(0, page.indexOf("<h2>For AI agents</h2>")), /Agent Data Tools/);
  // 21 Nov 2026: the people's VIES page title spends its 60 characters on the search words, not the brand.
  assert.match(vatIndexPage("https://x.test", false, "Glyphcall"), /<title>Free VIES VAT number validation[^<]*<\/title>/);
  assert.doesNotMatch(registerIndexPage("https://x.test", "Glyphcall").match(/<title>[^<]*<\/title>/)[0], /Agent Data Tools/);
  assert.doesNotMatch(productPage(PRODUCTS[0], "https://x.test", false, () => undefined).match(/<title>[^<]*<\/title>/)[0], /Glyphcall/, "default keeps the service name");
});
