// Focused product pages (src/lib/product-pages.ts): the numbers on them are computed from the catalog and the plans,
// every tool and guide they name exists, and the page says nothing the tool's own description does not.
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

let ENDPOINTS, PRODUCTS, productPage, productOffers, productPaths, PRODUCT_FOR_TOOL, taskGuide, keyPrice, CREDIT_PLANS, isHumanPage, sitemapXml;
before(async () => {
  ({ ENDPOINTS } = await loadTypeScript(require.resolve("../src/endpoints.ts")));
  ({ PRODUCTS, productPage, productOffers, productPaths, PRODUCT_FOR_TOOL } = await loadTypeScript(require.resolve("../src/lib/product-pages.ts")));
  ({ taskGuide } = await loadTypeScript(require.resolve("../src/guides/task-guides.ts")));
  ({ keyPrice } = await loadTypeScript(require.resolve("../src/lib/key-prices.ts")));
  ({ CREDIT_PLANS } = await loadTypeScript(require.resolve("../src/lib/credits.ts")));
  ({ isHumanPage } = await loadTypeScript(require.resolve("../src/lib/funnel.ts")));
  ({ sitemapXml } = await loadTypeScript(require.resolve("../src/discovery.ts")));
});

const title = (slug) => taskGuide(slug)?.phrase;

test("every product names live tools and guides, and has its own path", () => {
  const paths = new Set(ENDPOINTS.map((e) => e.path));
  const slugs = new Set();
  for (const p of PRODUCTS) {
    assert.ok(paths.has(p.tool), `${p.slug}: ${p.tool}`);
    for (const a of p.also) assert.ok(paths.has(a), `${p.slug}: ${a}`);
    for (const g of p.guides) assert.ok(taskGuide(g), `${p.slug}: guide ${g}`);
    assert.match(p.slug, /^[a-z0-9-]+-api$/);
    assert.ok(!paths.has(`/${p.slug}`), `${p.slug} collides with a tool path`);
    assert.ok(!slugs.has(p.slug)); slugs.add(p.slug);
    assert.ok(isHumanPage(`/${p.slug}`), `${p.slug} is counted as a page people read`);
    assert.ok(p.limits.length > 0, `${p.slug} states what it does not do`);
  }
  assert.equal(isHumanPage("/revenue"), false);
  assert.equal(isHumanPage("/pdf/text"), false);
});

test("PDF to text is the first product and its plan counts come from the key price", () => {
  const pdf = PRODUCTS[0];
  assert.equal(pdf.slug, "pdf-to-text-api");
  assert.equal(PRODUCT_FOR_TOOL.get("/pdf/text"), pdf);
  const tool = ENDPOINTS.find((e) => e.path === "/pdf/text");
  const perCall = Math.round(Number(keyPrice(tool.path, tool.price).slice(1)) * 1000);
  const offers = productOffers(pdf);
  assert.ok(offers[0].monthly, "the monthly plan leads");
  assert.equal(offers[0].calls, Math.floor(CREDIT_PLANS[0].credits / perCall).toLocaleString("en-US"));
  assert.deepEqual(productOffers(pdf, false), []);
});

test("the page shows the request three ways, the answer, the plans first, and one price", () => {
  for (const p of PRODUCTS) {
    const html = productPage(p, "https://x.test", true, title, undefined, true);
    const tool = ENDPOINTS.find((e) => e.path === p.tool);
    assert.match(html, new RegExp(`<h1>${p.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/&/g, "&amp;")}</h1>`));
    assert.match(html, /curl -H &quot;Authorization: Bearer \$API_KEY&quot;/);
    assert.match(html, /import os, requests/);
    assert.match(html, /await fetch\(/);
    assert.ok(html.includes(`https://x.test${p.tool}`), p.slug);
    assert.ok(html.indexOf("a month") < html.indexOf(" once"), `${p.slug}: plans before packs`);
    assert.match(html, /<link rel="canonical" href="https:\/\/x\.test\/[a-z0-9-]+-api">/);
    assert.match(html, /"@type":"FAQPage"/);
    assert.match(html, /form class="try"/);
    // One per-call price on the page: the key price. The wallet price is on the tool page.
    assert.ok(html.includes(`${keyPrice(tool.path, tool.price)} per successful call with a key`), p.slug);
    // Protocol names stay out of everything above the agents section.
    const above = html.slice(0, html.indexOf("<h2>For AI agents</h2>"));
    assert.doesNotMatch(above, /x402|MPP|USDC|Tempo/, `${p.slug}: payment protocols above the fold`);
  }
});

test("without a way to try or a card key the page offers neither", () => {
  const html = productPage(PRODUCTS[0], "https://x.test", false, title, undefined, false);
  assert.doesNotMatch(html, /form class="try"/);
  assert.doesNotMatch(html, /buy\.stripe\.com/);
  assert.match(html, /href="\/credits"/);
});

test("the free key is offered first only when it is switched on", () => {
  const off = productPage(PRODUCTS[0], "https://x.test", true, title);
  assert.doesNotMatch(off, /\/keys\/free/);
  assert.match(off, /No account to create\./);
  const on = productPage(PRODUCTS[0], "https://x.test", true, title, undefined, true, "Brand", true);
  assert.match(on, /<a class="btn primary" href="\/keys\/free">Get a free API key<\/a>/);
  assert.match(on, /A free key makes 100 calls a month/);
  assert.match(on, /<a class="btn" href="#try">/);
});

test("the sitemap lists the product pages", () => {
  const xml = sitemapXml("https://x.test");
  for (const path of productPaths()) assert.ok(xml.includes(`<loc>https://x.test${path}</loc>`), path);
});
