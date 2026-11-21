// SEO and safety fixes of 21 Nov 2026 (technical SEO audit and external security scan of glyphcall.com):
// - lex.glyphcall.com serves only LexGlyph (root page, its own sitemap and robots.txt); every other path is a redirect to
//   the main site, and the main site's /lexglyph moves to lex;
// - per-chain copies of one method stay up with noindex and leave the sitemap; the sitemap puts people's pages first,
//   lists the trust pages and no non-HTML file;
// - titles of at most 60 characters with the Glyphcall brand, descriptions of at most 160, twitter:card and og:image;
// - framing, base-uri, plugin and permission headers on HTML, Vary: Accept where the body depends on Accept, HSTS with
//   includeSubDomains;
// - the report routes answer anonymous callers from a 5-minute memo without forcing a counter write.
const assert = require("node:assert/strict");
const { after, before, test } = require("node:test");
const esbuild = require("esbuild");
const Module = require("node:module");
const path = require("node:path");
const { Miniflare, convertV4MiniflareOptions } = require("miniflare");

const SITE = "https://glyphcall.com", LEX = "https://lex.glyphcall.com";
const BROWSER = { accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8", "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36" };
const TOKEN = "owner-test-token";
let mf, H, T, D;

async function loadTs(rel) {
  const entry = require.resolve(rel);
  const r = await esbuild.build({ entryPoints: [entry], bundle: true, platform: "node", format: "cjs", write: false, logLevel: "silent" });
  const m = new Module(entry, null); m.filename = entry; m.paths = Module._nodeModulePaths(process.cwd()); m._compile(r.outputFiles[0].text, entry);
  return m.exports;
}

before(async () => {
  H = await loadTs("../src/lib/page-headers.ts");
  T = await loadTs("../src/lib/seo-text.ts");
  D = await loadTs("../src/discovery.ts");
  const b = await esbuild.build({ entryPoints: ["src/index.ts"], bundle: true, format: "esm", platform: "browser", write: false, logLevel: "silent", external: ["cloudflare:workers", "node:*"], alias: { "ajv/dist/2020.js": path.resolve("src/lib/ajv-unavailable.ts") }, plugins: [{ name: "url", setup(p) { p.onResolve({ filter: /^url$/ }, () => ({ path: "node:url", external: true })); } }] });
  mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: b.outputFiles[0].text, compatibilityDate: "2026-09-01", compatibilityFlags: ["nodejs_compat"],
    durableObjects: { METRICS: { className: "Metrics", useSQLite: true } }, kvNamespaces: ["TRIALS"],
    bindings: { PAY_TO: "0x2074c40346ae2a90e0e4a391bcee6f16bf5277f5", NETWORK: "eip155:8453", PAYWALL: "on", TRIALS_ENABLED: "on", MPP_EVM: "off", QUOTE_CACHE: "off", FACILITATOR_URL: "https://fixture.invalid", BASE_RPC_URL: "https://fixture.invalid",
      PUBLIC_SITE_ORIGIN: SITE, RETIRED_PUBLIC_HOSTS: "tools.funwords.eu,www.glyphcall.com", PUBLIC_BRAND: "Glyphcall", REVENUE_TOKEN: TOKEN, REPORT_CACHE_SECONDS: "300" },
    outboundService: async () => new Response("offline", { status: 503 }) }));
});
after(async () => { await mf?.dispose(); });

const ask = (url, { method = "GET", headers = BROWSER, body } = {}) => mf.dispatchFetch(url, { method, headers, body, redirect: "manual" });
const page = async (url, headers) => { const r = await ask(url, { headers }); return { r, html: await r.text() }; };
const tag = (html, re) => (html.match(re) ?? [])[1];
const titleOf = (html) => tag(html, /<title>([^<]*)<\/title>/);
const descOf = (html) => tag(html, /<meta name="description" content="([^"]*)"/);
const canonicalOf = (html) => tag(html, /<link rel="canonical" href="([^"]*)"/);
const unesc = (s) => s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");

test("lex root is the LexGlyph page, canonical to the lex root, with every language and x-default", async () => {
  const { r, html } = await page(`${LEX}/`);
  assert.equal(r.status, 200);
  assert.equal(canonicalOf(html), `${LEX}/`);
  assert.match(html, /<link rel="alternate" hreflang="x-default" href="https:\/\/lex.glyphcall.com\/">/);
  assert.match(html, /<link rel="alternate" hreflang="sv" href="https:\/\/lex.glyphcall.com\/\?lang=sv">/);
  assert.match(html, /<form method="get" action="\/" role="search">/);
  assert.match(html, /href="https:\/\/glyphcall.com\/about"/, "footer links name the main site");
  assert.match(html, /href="\/lexglyph\/security\?lang=en"/, "LexGlyph's own pages stay on lex");
  assert.match(html, /GET https:\/\/glyphcall.com\/law\/search/);
  const sv = await page(`${LEX}/?lang=sv`);
  assert.equal(canonicalOf(sv.html), `${LEX}/?lang=sv`);
});

test("every other path on lex is a redirect to the same path on the main site; LexGlyph's own paths stay", async () => {
  for (const p of ["/tools/weather", "/weather?city=Oslo", "/about", "/docs", "/eu-law-search-api"]) {
    const r = await ask(LEX + p);
    assert.equal(r.status, 301, p);
    assert.equal(r.headers.get("location"), SITE + p, p);
  }
  const post = await ask(`${LEX}/mcp`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  assert.equal(post.status, 308, "a POST keeps its method and body");
  const old = await ask(`${LEX}/lexglyph?lang=de`);
  assert.equal(old.status, 301);
  assert.equal(old.headers.get("location"), "/?lang=de");
  assert.equal((await ask(`${LEX}/lexglyph/security`)).status, 200);
});

test("lex has its own sitemap, named in its robots.txt; the main site's /lexglyph moves to lex", async () => {
  const xml = await (await ask(`${LEX}/sitemap.xml`)).text();
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  assert.ok(locs.length >= 2 && locs.length <= 10, String(locs.length));
  assert.ok(locs.every((u) => u.startsWith(`${LEX}/`)), "only lex pages");
  assert.equal(locs[0], `${LEX}/`);
  assert.match(await (await ask(`${LEX}/robots.txt`)).text(), /Sitemap: https:\/\/lex.glyphcall.com\/sitemap.xml/);
  const moved = await ask(`${SITE}/lexglyph?lang=sv`);
  assert.equal(moved.status, 301);
  assert.equal(moved.headers.get("location"), `${LEX}/?lang=sv`);
});

test("the main sitemap: people's pages first, trust pages in, no lex page, no SKILL.md, one page per chain method", async () => {
  const xml = await (await ask(`${SITE}/sitemap.xml`)).text();
  const paths = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]).pathname);
  assert.deepEqual(paths.slice(0, 8), ["/", "/es/", "/de/", "/fr/", "/app", "/transcribe-pro", "/text-to-speech-api", "/speech-to-text-api"], "the front page in each language comes first (lib/i18n)");
  for (const p of ["/about", "/faq", "/contact", "/terms", "/privacy", "/tools/eth-balance", "/tools/eth-call", "/vat-number-check"]) assert.ok(paths.includes(p), p);
  for (const p of ["/tools/base-balance", "/tools/gnosis-gas-history", "/lexglyph", "/skills/spellzcode-x402-reader/SKILL.md"]) assert.ok(!paths.includes(p), p);
  assert.equal(new Set(paths).size, paths.length, "no URL twice");
  assert.ok(paths.length < 720, `sitemap has ${paths.length} URLs`);
});

test("a per-chain copy keeps its page with noindex, follow; the representative stays indexable", async () => {
  const clone = await page(`${SITE}/tools/base-balance`);
  assert.equal(clone.r.status, 200);
  assert.match(clone.html, /<meta name="robots" content="noindex, follow">/);
  assert.match(clone.html, /href="\/tools\/eth-balance"/);
  const rep = await page(`${SITE}/tools/eth-balance`);
  assert.doesNotMatch(rep.html, /noindex/);
});

test("titles fit 60 characters with the Glyphcall brand, descriptions fit 160, social tags and one brand", async () => {
  for (const p of ["/tools/eth-balance", "/tools/weather", "/tools/extract", "/tools", "/about", "/terms", "/vat-number-check"]) {
    const { html } = await page(SITE + p);
    const title = unesc(titleOf(html));
    assert.ok(title.length <= 60, `${p}: ${title.length} "${title}"`);
    assert.doesNotMatch(title, /Agent Data Tools/, p);
    const d = descOf(html);
    if (d) assert.ok(unesc(d).length <= 160, `${p}: description ${unesc(d).length}`);
    assert.match(html, /<meta name="twitter:card" content="summary_large_image">/, p);
    assert.match(html, /<meta property="og:image" content="https:\/\/glyphcall.com\/og-glyphcall.png">/, p);
  }
  assert.match(titleOf((await page(`${SITE}/tools/extract`)).html), / \| Glyphcall$/, "the brand where it fits");
  const tool = (await page(`${SITE}/tools/weather`)).html;
  assert.match(tool, /"provider":\{"@type":"Organization","name":"Glyphcall"/);
  assert.match(tool, /"@type":"BreadcrumbList"/);
  const about = (await page(`${SITE}/about`)).html;
  assert.equal(titleOf(about), "About | Glyphcall");
  assert.equal(canonicalOf(about), `${SITE}/about`);
});

test("HTML answers carry Permissions-Policy; HSTS covers subdomains; / varies on Accept", async () => {
  const r = await ask(`${SITE}/credits`);
  await r.arrayBuffer();
  assert.match(r.headers.get("permissions-policy"), /camera=\(\).*microphone=\(self\)/);
  assert.equal(r.headers.get("strict-transport-security"), "max-age=31536000; includeSubDomains");
  assert.match(r.headers.get("vary") ?? "", /Accept/);
  for (const headers of [BROWSER, { accept: "application/json", "user-agent": "node" }]) {
    const root = await ask(`${SITE}/`, { headers });
    await root.arrayBuffer();
    assert.match(root.headers.get("vary") ?? "", /Accept/, headers.accept);
  }
  const json = await ask(`${SITE}/health`, { headers: { accept: "application/json" } });
  await json.arrayBuffer();
  assert.equal(json.headers.get("permissions-policy"), null, "JSON answers keep their headers");
});

test("only Permissions-Policy is added to HTML (framing and referrer belong to lib/response-headers.ts), and Vary keeps what is there", () => {
  const h1 = new Headers({ "content-security-policy": "frame-ancestors 'self'", "permissions-policy": "camera=()" });
  H.setHtmlHeaders(h1);
  assert.equal(h1.get("content-security-policy"), "frame-ancestors 'self'");
  assert.equal(h1.get("permissions-policy"), "camera=()", "a route's own policy is kept");
  assert.equal(h1.get("x-frame-options"), null);
  const h2 = new Headers();
  H.setHtmlHeaders(h2);
  assert.deepEqual([...h2.keys()], ["permissions-policy"]);
  const v = new Headers({ vary: "Origin" });
  H.varyOnAccept(v); H.varyOnAccept(v);
  assert.equal(v.get("vary"), "Origin, Accept");
});

test("titles and descriptions are cut at a word boundary", () => {
  assert.equal(T.seoTitle("Weather API", "Glyphcall"), "Weather API | Glyphcall");
  const long = "A very long page title that certainly goes past the sixty character limit of results";
  const t = T.seoTitle(long, "Glyphcall");
  assert.ok(t.length <= 60 && t.endsWith("…") && !/\s…$/.test(t), t);
  assert.equal(T.seoTitle([long, "Short form"], "Glyphcall"), "Short form | Glyphcall");
  const d = T.metaDescription("word ".repeat(60));
  assert.ok(d.length <= 160 && d.endsWith("word…"), d);
});

test("the report routes: anonymous reads are cached for 5 minutes without internal state; the owner gets a fresh one", async () => {
  for (const p of ["/metrics", "/metrics/callers", "/status", "/revenue"]) {
    const r = await ask(SITE + p, { headers: { accept: "application/json" } });
    await r.arrayBuffer();
    assert.equal(r.status, 200, p);
    assert.equal(r.headers.get("cache-control"), "public, max-age=300", p);
    assert.equal(r.headers.get("x-metrics-state"), null, p);
  }
  const owner = await ask(`${SITE}/metrics`, { headers: { accept: "application/json", authorization: `Bearer ${TOKEN}` } });
  await owner.arrayBuffer();
  assert.ok(owner.headers.get("x-metrics-state"), "the owner sees the counter state");
  assert.equal(owner.headers.get("cache-control"), "private, no-store");
  const rev = await (await ask(`${SITE}/revenue`, { headers: { accept: "application/json", authorization: `Bearer ${TOKEN}` } })).json();
  assert.ok("cardCredits" in rev, "card figures only with the token");
});

test("sitemapPaths keeps the people-first order and drops each per-chain copy", () => {
  const paths = D.sitemapPaths();
  assert.equal(paths[0], "/");
  assert.ok(paths.indexOf("/about") < paths.indexOf("/tools"));
  assert.ok(!paths.some((p) => p.endsWith(".md")));
});

test("/pricing sends people to the plans on the front page; /de goes to the German pages", async () => {
  const p = await ask(`${SITE}/pricing?ref=x`);
  assert.equal(p.status, 301);
  assert.equal(p.headers.get("location"), "/?ref=x#pricing");
  const d = await ask(`${SITE}/de`);
  assert.equal(d.status, 301);
  assert.equal(d.headers.get("location"), "/de/", "the German front page (lib/i18n), which links the e-Rechnung section");
});

test("guide links do not swallow the punctuation after a URL", async () => {
  for (const p of ["/guides/ai-sdk", "/guides/local-mcp"]) {
    const { html } = await page(SITE + p);
    assert.doesNotMatch(html, /href="https:\/\/[^"]*[.,:;!?]"/, p);
  }
});

test("VIES: the free checker for people and the API page for developers link to each other", async () => {
  const idx = (await page(`${SITE}/vat-number-check`)).html;
  const t = unesc(titleOf(idx));
  assert.match(t, /VIES/); assert.match(t, /VAT/); assert.match(t, /validation/); assert.ok(t.length <= 60, t);
  assert.ok(unesc(descOf(idx)).length <= 160);
  assert.match(idx, /<label for="vatc-vat">VAT number, e\.g\. SE556677889901<\/label>/);
  assert.match(idx, /data-ev="vat_check"/);
  assert.match(idx, /<form class="try vatc" method="get" action="\/vat\/validate"/, "the plain form still works without JavaScript");
  assert.match(idx, /href="\/tools\/vat-validate"/);
  const de = unesc(titleOf((await page(`${SITE}/vat-number-check/germany`)).html));
  assert.match(de, /^VIES VAT number validation for Germany/);
  const api = (await page(`${SITE}/tools/vat-validate`)).html;
  assert.match(unesc(titleOf(api)), /^VIES VAT validation API/);
  const top = api.slice(api.indexOf("<h1>"), api.indexOf("<h2>"));
  assert.match(top, /<a href="\/vat-number-check">Check a VAT number by hand: free VIES checker<\/a>/, "above the API details");
  assert.doesNotMatch(api, /vat-checker/);
});

test("the checker words a busy register, used free checks and paused free checks for people", async () => {
  const V = await loadTs("../src/lib/vat-pages.ts");
  const per = V.checksPerDollar({ path: "/vat/validate", price: "$0.01" });
  assert.match(per, /^\d[\d,]*$/);
  assert.equal(V.checkerOutcome(503, false, per).text, "The EU register is busy. Try again in a moment; nothing was charged.");
  assert.match(V.checkerOutcome(402, false, per).text, /^Your 3 free checks are used\. Buy checks by card: \$1 for [\d,]+ checks\.$/);
  assert.match(V.checkerOutcome(402, true, per).text, /^Free checks are paused right now\./);
  assert.equal(V.checkerOutcome(402, false, "").text, "Your 3 free checks are used. Buy checks by card from $1.");
  assert.equal(V.checkerOutcome(200, false, per), null);
});

test("/app: a free MultimediaApplication, a title and description within limits, and it asks to keep the model", async () => {
  const { r, html } = await page(`${SITE}/app`);
  assert.equal(r.status, 200);
  const ld = JSON.parse(/<script type="application\/ld\+json" data-ld="app">([^<]+)<\/script>/.exec(html)[1]);
  assert.equal(ld.applicationCategory, "MultimediaApplication");
  assert.deepEqual(ld.offers.map((o) => o.price), ["0"]);
  assert.ok(unesc(titleOf(html)).length <= 60, titleOf(html));
  assert.ok(unesc(descOf(html)).length <= 160);
  assert.equal(ld.description, unesc(descOf(html)));
  assert.match(html, /data-persist="1"/);
});
