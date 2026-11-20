// The product site's front page and docs (src/lib/site-pages.ts): they sell the products by plan, name no payment
// protocol before the agents section, and promise nothing the service does not do.
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

let landingPage, docsPage, PRODUCTS, productOffers, isHumanPage, sitemapXml, ENDPOINTS;
before(async () => {
  ({ landingPage, docsPage } = await loadTypeScript(require.resolve("../src/lib/site-pages.ts")));
  ({ PRODUCTS, productOffers } = await loadTypeScript(require.resolve("../src/lib/product-pages.ts")));
  ({ isHumanPage } = await loadTypeScript(require.resolve("../src/lib/funnel.ts")));
  ({ sitemapXml } = await loadTypeScript(require.resolve("../src/discovery.ts")));
  ({ ENDPOINTS } = await loadTypeScript(require.resolve("../src/endpoints.ts")));
});

test("the front page leads with the products and their plans, under the brand", () => {
  const html = landingPage("Glyphcall", "https://x.test", true);
  assert.match(html, /<title>Glyphcall: /);
  assert.match(html, /<a class="brand" href="\/">Glyphcall<\/a>/);
  for (const p of PRODUCTS) {
    assert.ok(html.includes(`href="/${p.slug}"`), p.slug);
    const lead = productOffers(p).find((o) => o.monthly);
    assert.ok(html.includes(`${lead.label}: ${lead.calls} ${p.unit}`), `${p.slug}: the card shows what the first plan buys`);
  }
  assert.match(html, /<link rel="canonical" href="https:\/\/x\.test\/">/);
  assert.match(html, /href="\/docs"/);
  assert.match(html, /href="\/agents"/);
  assert.match(html, /Long recording\? <a href="\/transcribe-pro">Transcribe Pro<\/a>/, "the long-recording upsell links to the paid plan, not the free browser tool");
  // 19 Nov 2026: the page no longer tells a consumer with a long recording that there is nothing to pay for.
  assert.match(html, /want a long recording transcribed on our servers with Transcribe Pro/, "the FAQ names the paid server-side option");
  assert.match(html, /want a long recording done on our servers with <a href="\/transcribe-pro">Transcribe Pro<\/a>/, "the pricing section links the paid option");
  assert.match(html, /<a href="\/transcribe-pro">Transcribe Pro<\/a> handles any length/, "a line near the tiles points at the paid long-recording product");
  assert.match(html, /<a href="\/transcribe-pro">Transcribe Pro<\/a> · <a href="\/agents">/, "the footer links the paid product");
  const above = html.slice(0, html.indexOf("<h2>For AI agents</h2>"));
  assert.doesNotMatch(above, /x402|MPP|USDC|Tempo|wallet/i, "no payment protocol before the agents section");
  assert.doesNotMatch(html, /Agent Data Tools/, "the brand is the only name on the page");
});

test("without card payments the front page links the pricing page instead of plans", () => {
  const html = landingPage("Glyphcall", "https://x.test", false);
  assert.doesNotMatch(html, /buy\.stripe\.com/);
  assert.match(html, /<a href="\/credits">Plans and packs<\/a>/);
});

test("the docs say how to send a key, what is charged, and how to send a file", () => {
  const html = docsPage("Glyphcall", "https://x.test");
  assert.match(html, /Authorization: Bearer \$API_KEY/);
  assert.match(html, /X-API-Key/);
  assert.match(html, /\/credits\/balance/);
  assert.match(html, /\/credits\/rotate/);
  assert.match(html, /-F &quot;file=@report\.pdf&quot;/);
  assert.match(html, /<td>5xx<\/td>[\s\S]*?<td>No<\/td>/);
  assert.match(html, /<link rel="canonical" href="https:\/\/x\.test\/docs">/);
  assert.ok(ENDPOINTS.some((e) => e.path === "/vat/validate") && ENDPOINTS.some((e) => e.path === "/pdf/text"), "the tools the docs show exist");
  assert.doesNotMatch(html, /rate limit/i, "no limit is promised that the service does not enforce");
});

test("the new pages are counted and listed", () => {
  assert.ok(isHumanPage("/docs"));
  assert.ok(isHumanPage("/agents"));
  assert.ok(sitemapXml("https://x.test").includes("<loc>https://x.test/docs</loc>"));
  // 19 Nov 2026: the two high-intent voice/commercial pages were built but invisible to sitemap-driven crawlers.
  const sm = sitemapXml("https://x.test");
  assert.ok(sm.includes("<loc>https://x.test/app</loc>"), "the free app is in the sitemap");
  assert.ok(sm.includes("<loc>https://x.test/transcribe-pro</loc>"), "Transcribe Pro is in the sitemap");
  assert.ok(sm.includes("<loc>https://x.test/guides</loc>"), "the guide hub is in the sitemap");
});
