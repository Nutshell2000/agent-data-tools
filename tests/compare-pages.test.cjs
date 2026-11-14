// Comparison pages (src/lib/compare-pages.ts): every rival row has its own pricing page as source, our side is computed
// from the catalog, each page renders with a fair "when the rival is better" section, and the pages are in the sitemap
// and counted as pages people read.
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

let C, ENDPOINTS, keyPrice, isHumanPage, sitemapXml;
before(async () => {
  C = await loadTypeScript(require.resolve("../src/lib/compare-pages.ts"));
  ({ ENDPOINTS } = await loadTypeScript(require.resolve("../src/endpoints.ts")));
  ({ keyPrice } = await loadTypeScript(require.resolve("../src/lib/key-prices.ts")));
  ({ isHumanPage } = await loadTypeScript(require.resolve("../src/lib/funnel.ts")));
  ({ sitemapXml } = await loadTypeScript(require.resolve("../src/discovery.ts")));
});

test("every rival has a slug, its own https pricing page and a fair 'better' list", () => {
  const slugs = new Set();
  for (const r of C.RIVALS) {
    assert.match(r.slug, /^[a-z0-9-]+-alternative$/);
    assert.ok(!slugs.has(r.slug), r.slug); slugs.add(r.slug);
    assert.match(r.source, /^https:\/\//, r.slug);
    assert.ok(r.better.length >= 1, `${r.slug} says where the rival is better`);
    for (const k of ["price", "free", "commitment", "billing"]) assert.ok(r[k].length > 5, `${r.slug}.${k}`);
    assert.ok(r.fromUsd === null || (r.fromUsd > 0 && r.fromUsd < 5), r.slug);
  }
  assert.ok(C.RIVALS.length >= 6);
});

test("our side comes from the catalog and key prices", () => {
  const e = ENDPOINTS.find((x) => x.path === "/document/extract");
  const us = C.ourOffer(true);
  assert.equal(us.extractPrice, e.price);
  assert.equal(us.extractKeyPrice, keyPrice(e.path, e.price));
  const check = ENDPOINTS.find((x) => x.path === "/invoice/check");
  assert.equal(us.checkPrice, check ? check.price : undefined);
  if (us.planPerDoc) {
    const perDoc = Number(us.lead.label.replace(/[^0-9.]/g, "")) / Number(us.lead.calls.replace(/,/g, ""));
    assert.ok(Math.abs(Number(us.planPerDoc.slice(1)) - perDoc) < 0.001, `${us.planPerDoc} vs ${perDoc}`);
    assert.ok(us.priceLine.includes(us.planPerDoc));
  }
  assert.ok(!C.ourOffer(false).planPerDoc, "no plan price without card checkout");
});

test("every page renders with its canonical, the rival's source link, the date and the trademark note", () => {
  const origin = "https://example.test";
  const hub = C.compareIndexPage(origin, false, true, "Brand");
  assert.match(hub, /<link rel="canonical" href="https:\/\/example\.test\/compare">/);
  for (const r of C.RIVALS) {
    assert.ok(hub.includes(`/compare/${r.slug}`), `hub links ${r.slug}`);
    const page = C.comparePage(r, origin, true, true, "Brand");
    assert.ok(page.includes(`<link rel="canonical" href="${origin}/compare/${r.slug}">`), r.slug);
    assert.ok(page.includes(r.source.replace(/&/g, "&amp;")), `${r.slug} links its source`);
    assert.ok(page.includes(C.CHECKED), `${r.slug} states the date`);
    assert.match(page, /trademarks of their owners/);
    assert.match(page, /href="\/keys\/free"/, "free key button when on");
    assert.ok(!C.comparePage(r, origin, false, true, "Brand").includes('href="/keys/free"'), "no free key button when off");
    assert.ok(!/undefined|NaN|\$\$/.test(page), `${r.slug} has no broken values`);
  }
});

test("a rival cheaper per page than us is not called more expensive", () => {
  const ours = Number(C.ourOffer(true).extractKeyPrice.slice(1));
  for (const r of C.RIVALS.filter((x) => x.fromUsd !== null && x.fromUsd < ours)) {
    assert.match(C.comparePage(r, "https://example.test", false), /Not per page/, r.slug);
  }
});

test("compareHtml serves the hub and known rivals only, with no free-key button while free keys are off", () => {
  const env = { FREE_KEYS: "off", PUBLIC_BRAND: "Brand" };
  const hub = C.compareHtml(env, "https://example.test");
  assert.match(hub, /Invoice extraction API pricing compared/);
  assert.ok(!hub.includes('href="/keys/free"'));
  assert.match(C.compareHtml(env, "https://example.test", C.RIVALS[0].slug), /Brand/);
  assert.equal(C.compareHtml(env, "https://example.test", "nobody-alternative"), undefined);
});

test("the pages are in the sitemap and counted as human pages", () => {
  const xml = sitemapXml("https://example.test");
  for (const p of C.comparePaths()) {
    assert.ok(xml.includes(`<loc>https://example.test${p}</loc>`), p);
    assert.ok(isHumanPage(p), p);
  }
  assert.ok(!isHumanPage("/compare/../x"));
});
