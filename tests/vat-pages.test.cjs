// Per-country VAT check pages (src/lib/vat-pages.ts): one row per VIES country, each shape matching its own pattern,
// and the pages count as pages people read and are in the sitemap; entry-path tool pages are not.
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

let VAT_COUNTRIES, VAT_BASE, vatCountryPage, vatIndexPage, vatPagePaths, VIES_COUNTRIES, vatParts, isHumanPage, sitemapXml, ENTRY_OF, ENDPOINTS, toolDocPage, toolSlug;
before(async () => {
  ({ VAT_COUNTRIES, VAT_BASE, vatCountryPage, vatIndexPage, vatPagePaths } = await loadTypeScript(require.resolve("../src/lib/vat-pages.ts")));
  ({ VIES_COUNTRIES, vatParts } = await loadTypeScript(require.resolve("../src/routes/registries.ts")));
  ({ isHumanPage } = await loadTypeScript(require.resolve("../src/lib/funnel.ts")));
  ({ sitemapXml } = await loadTypeScript(require.resolve("../src/discovery.ts")));
  ({ ENTRY_OF } = await loadTypeScript(require.resolve("../src/routes/entry-paths.ts")));
  ({ ENDPOINTS, toolSlug } = await loadTypeScript(require.resolve("../src/endpoints.ts")));
  ({ toolDocPage } = await loadTypeScript(require.resolve("../src/lib/tool-pages.ts")));
});

test("the table is exactly the countries the VAT tool can check", () => {
  assert.deepEqual(VAT_COUNTRIES.map((c) => c.code).sort(), [...VIES_COUNTRIES].sort());
  const slugs = new Set(VAT_COUNTRIES.map((c) => c.slug));
  assert.equal(slugs.size, VAT_COUNTRIES.length);
});

test("every shape matches its own pattern and is read by the tool as that country", () => {
  for (const c of VAT_COUNTRIES) {
    assert.match(c.shape, c.pattern, c.code);
    assert.ok(c.shape.startsWith(c.code), c.code);
    assert.equal(vatParts(c.shape)?.country, c.code, c.code);
    assert.doesNotMatch(`${c.code}1`, c.pattern, `${c.code}: too short a number must not match`);
    if (c.register) assert.ok(ENDPOINTS.some((e) => e.path === c.register), c.register);
  }
});

test("a country page states the format, offers the check and links the product", () => {
  const de = VAT_COUNTRIES.find((c) => c.code === "DE");
  const html = vatCountryPage(de, "https://x.test", true);
  assert.match(html, /<h1>Check a German VAT number<\/h1>/);
  assert.match(html, /USt-IdNr\./);
  assert.match(html, /form class="try" method="get" action="\/vat\/validate"/);
  assert.match(html, /<link rel="canonical" href="https:\/\/x\.test\/vat-number-check\/germany">/);
  assert.match(html, /href="\/company-check-api"/);
  assert.match(html, /"@type":"FAQPage"/);
  assert.doesNotMatch(html, /x402|MPP|USDC/);
  const se = vatCountryPage(VAT_COUNTRIES.find((c) => c.code === "SE"), "https://x.test", false);
  assert.match(se, /href="\/company-register\/sweden"/);
  assert.doesNotMatch(se, /form class="try"/);
  const index = vatIndexPage("https://x.test", true);
  for (const c of VAT_COUNTRIES) assert.ok(index.includes(`${VAT_BASE}/${c.slug}`), c.slug);
});

test("the pages are counted and listed; entry-path pages point at their tool and stay out of the sitemap", () => {
  const xml = sitemapXml("https://x.test");
  for (const path of vatPagePaths()) {
    assert.ok(isHumanPage(path), path);
    assert.ok(xml.includes(`<loc>https://x.test${path}</loc>`), path);
  }
  assert.equal(isHumanPage("/vat-number-check/../revenue"), false);
  const [door, canonical] = Object.entries(ENTRY_OF)[0];
  assert.ok(!xml.includes(`<loc>https://x.test/tools/${toolSlug(door)}</loc>`), door);
  assert.ok(xml.includes(`<loc>https://x.test/tools/${toolSlug(canonical)}</loc>`), canonical);
  const page = toolDocPage(ENDPOINTS.find((e) => e.path === door), "https://x.test", false);
  assert.ok(page.includes(`<link rel="canonical" href="https://x.test/tools/${toolSlug(canonical)}">`), door);
});
