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
  assert.match(html, /<title>[^<]{10,48} \| Glyphcall<\/title>/, "the title leads with the search words, ends with the brand, and fits 60 characters");
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
  // 21 Nov 2026: the one sentence near the tiles and the "Free for everyone" block became a Transcribe Pro band and a
  // three-plan ladder, so a visitor meets the paid product, its price and a free trial without reading the small print.
  const band = html.slice(html.indexOf('id="pro"'), html.indexOf('id="how"'));
  assert.match(band, /When your device is not enough/, "a band right after the free tiles sells the paid product");
  assert.match(band, /buy\.stripe\.com\/[A-Za-z0-9]+">Get Transcribe Pro: \$\d+ a month/, "the band's first button is the checkout");
  // 21 Nov 2026 (owner: free things must cost nothing): the free server trial runs Workers AI, so the band offers the $1
  // one-off pack in its place, and no page links the trial.
  assert.match(band, /data-ev="pack_click">\d+ hours for \$1, once</, "the band's second button is the $1 one-off pack");
  assert.doesNotMatch(html, /data-ev="trial_click"/, "no link to the free server trial");
  const prices = html.slice(html.indexOf('id="pricing"'), html.indexOf('id="developers"'));
  // 21 Nov 2026 offer ladder: Free, one job paid once, the monthly plan; the larger plan is a line under the cards.
  for (const plan of ["Glyphcall Free", "One job", "Transcribe Pro"]) assert.ok(prices.includes(`<h3>${plan}</h3>`), `${plan} is a plan card`);
  assert.ok(!prices.includes("<h3>Transcribe Pro Plus</h3>"), "the larger plan is no longer a card of its own");
  assert.match(prices, /data-ev="pack_click">Pay by card: \$1 once</, "the one-job card buys the $1 pack by card");
  assert.match(prices, /Building an app\?[\s\S]*?\$19 a month for developers/, "the developer plan is offered as a small link under the cards");
  assert.match(prices, /About \d+ hours<\/b> of transcription a month/, "the plan says what it buys in hours");
  assert.match(prices, /Compare Free and Transcribe Pro/, "Free and Pro side by side");
  assert.ok(!prices.includes("7,500 PDFs"), "developer credit tables are not in the consumer pricing");
  assert.match(html.slice(html.indexOf('id="developers"')), /id="api-pricing"/, "the developer credit plans sit in the developer block");
  assert.match(html, /<a href="\/transcribe-pro">Pro<\/a>/, "Pro is in the navigation");
  assert.match(html, /<a href="\/transcribe-pro">Transcribe Pro<\/a> · <a href="\/agents">/, "the footer links the paid product");
  const above = html.slice(0, html.indexOf("<h2>For AI agents</h2>"));
  assert.doesNotMatch(above, /x402|MPP|USDC|Tempo|wallet/i, "no payment protocol before the agents section");
  assert.doesNotMatch(html, /Agent Data Tools/, "the brand is the only name on the page");
});

test("the front page sells the voice tools first and folds the developer catalogue", () => {
  // 21 Nov 2026 layout pass: consumer sections (free tools, Pro, plans, questions) come before the developer block,
  // and the long API catalogue, credit plans and agent notes sit in one closed panel inside it.
  const html = landingPage("Glyphcall", "https://x.test", true);
  const at = (id) => html.indexOf(`id="${id}"`);
  const order = ["try", "make", "pro", "pricing", "how", "faq", "developers"].map(at);
  assert.ok(order.every((v) => v > 0), "every section is on the page");
  assert.deepEqual([...order].sort((a, b) => a - b), order, "sections run: try, make, pro, pricing, how, faq, developers");
  const dev = html.slice(at("developers"));
  const fold = dev.slice(dev.indexOf('<details class="devmore"'));
  assert.ok(dev.includes('<details class="devmore" id="apis">'), "the catalogue is folded");
  for (const id of ["api-pricing", "products"]) assert.ok(fold.includes(`id="${id}"`), `${id} is inside the folded panel`);
  const agents = fold.indexOf("<h2>For AI agents</h2>");
  assert.ok(agents > 0 && agents < fold.indexOf('<section class="final"'), "the agent notes are inside the folded panel, not in the questions");
  assert.match(html, /closest\("details\.devmore"\)/, "a link to an anchor inside the panel opens it");
  for (const ev of ["sticky_try", "sticky_pro", "pack_click"]) assert.ok(html.includes(`data-ev="${ev}"`), `${ev} is still counted`);
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
  // 20 Nov 2026: the two indexable acquisition pages (card credits + free key) were absent from the sitemap.
  assert.ok(sm.includes("<loc>https://x.test/credits</loc>"), "the pricing page is in the sitemap");
  // 21 Nov 2026: free keys by e-mail are off, so their page is not listed (an unpaid probe must not meet a 404 on a listed path).
  assert.ok(!sm.includes("<loc>https://x.test/keys/free</loc>"), "the switched-off free-key page is not in the sitemap");
});
