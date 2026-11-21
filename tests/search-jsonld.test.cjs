// Structured data and the IndexNow key file (16 Nov 2026). WebApplication data only where the page is a web app's
// own page, built from what the page shows; FAQ data only for questions and answers a reader can see on the page;
// no rating or review anywhere, because there are none. The key file answers on every host we submit for.
const assert = require('node:assert/strict');
const { before, after, test } = require('node:test');
const { build } = require('esbuild');
const Module = require('node:module');
const { Miniflare, convertV4MiniflareOptions } = require('miniflare');

const SITE = 'https://glyphcall.com', WORKER = 'https://agent-data-tools.revmesh2074.workers.dev';
const browser = { accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36' };

async function loadTypeScript(entry) {
  const built = await build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'cjs', write: false, external: ['cloudflare:workers'] });
  const mod = new Module(entry, null);
  mod.filename = entry;
  mod.paths = Module._nodeModulePaths(process.cwd());
  mod._compile(built.outputFiles[0].text, entry);
  return mod.exports;
}

let mf, A, P, H, C, S, D;
before(async () => {
  A = await loadTypeScript(require.resolve('../src/lib/app-jsonld.ts'));
  P = await loadTypeScript(require.resolve('../src/lib/product-pages.ts'));
  H = await loadTypeScript(require.resolve('../src/lib/home-page.ts'));
  C = await loadTypeScript(require.resolve('../src/lib/credits.ts'));
  S = await loadTypeScript(require.resolve('../src/lib/public-site.ts'));
  D = await loadTypeScript(require.resolve('../src/discovery.ts'));
  const b = await build({ entryPoints: ['src/index.ts'], bundle: true, format: 'esm', platform: 'browser', write: false, external: ['cloudflare:workers', 'node:*'], plugins: [{ name: 'fixture-facilitator', setup(b) {
    b.onResolve({ filter: /^url$/ }, () => ({ path: 'node:url', external: true }));
    b.onResolve({ filter: /^\.\/facilitator$/ }, () => ({ path: 'fixture', namespace: 'fixture' }));
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ loader: 'js', contents: `export function buildFacilitator(){return {
      getSupported:async()=>({kinds:[{x402Version:2,scheme:'exact',network:'eip155:8453',extra:{name:'USD Coin',version:'2',asset:'0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',assetTransferMethod:'eip3009'}}],extensions:[]}),
      verify:async()=>({isValid:false,invalidReason:'fixture'}), settle:async()=>({success:false,errorReason:'fixture'})
    }}` }));
  } }] });
  mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: b.outputFiles[0].text, compatibilityDate: '2026-09-01', compatibilityFlags: ['nodejs_compat'],
    durableObjects: { METRICS: { className: 'Metrics', useSQLite: true } }, kvNamespaces: ['TRIALS'],
    bindings: { PAY_TO: '0x2074c40346ae2a90e0e4a391bcee6f16bf5277f5', NETWORK: 'eip155:8453', PAYWALL: 'on', TRIALS_ENABLED: 'on', MPP_EVM: 'off', FACILITATOR_URL: 'https://fixture.invalid', BASE_RPC_URL: 'https://fixture.invalid',
      PUBLIC_SITE_ORIGIN: SITE, RETIRED_PUBLIC_HOSTS: 'tools.funwords.eu,www.glyphcall.com', PUBLIC_BRAND: 'Glyphcall' },
    outboundService: async () => new Response('not used', { status: 500 }) }));
});
after(async () => { await mf?.dispose(); });

/** Every JSON-LD block of a page, parsed; a block that is not valid JSON fails the test. */
function ldBlocks(html, where) {
  return [...html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)].map((m, i) => {
    try { return JSON.parse(m[1]); } catch (e) { assert.fail(`${where}: JSON-LD block ${i + 1} is not valid JSON: ${e.message}`); }
  });
}
const nodesOf = (blocks) => blocks.flatMap((b) => (Array.isArray(b['@graph']) ? b['@graph'] : [b]));
const ofType = (blocks, type) => nodesOf(blocks).filter((n) => n['@type'] === type);
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rarr: '→', larr: '←', middot: '·', hellip: '…', ndash: '–', mdash: '—', times: '×', euro: '€', copy: '©', check: '✓' };
const decode = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, e) => (e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENTITIES[e] ?? all));
/** What a reader sees, without any white space: the body with scripts, styles and tags taken out. */
const visible = (html) => decode(html.replace(/<head[\s\S]*?<\/head>/i, '').replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, '').replace(/<[^>]+>/g, '')).replace(/\s+/g, '');
const squeeze = (s) => String(s).replace(/\s+/g, '');
function assertNoRatings(value, where) {
  if (Array.isArray(value)) return value.forEach((v) => assertNoRatings(v, where));
  if (!value || typeof value !== 'object') return;
  for (const [k, v] of Object.entries(value)) {
    assert.ok(!/^(aggregateRating|starRating|contentRating|review|reviews|reviewCount|reviewRating|ratingValue|ratingCount|bestRating|worstRating)$/i.test(k), `${where}: ${k} in JSON-LD; there are no ratings or reviews to publish`);
    assert.ok(!(k === '@type' && /Rating|Review/.test(String(v))), `${where}: @type ${v}`);
    assertNoRatings(v, where);
  }
}
async function page(path, origin = SITE) {
  const res = await mf.dispatchFetch(`${origin}${path}`, { headers: browser, redirect: 'manual' });
  assert.equal(res.status, 200, `${origin}${path}`);
  return res.text();
}
const expectedPrices = () => [...C.WEB_PLANS, ...C.WEB_PACKS].map((x) => (x.usdCents / 100).toFixed(2));

test('JSON-LD cannot close its script tag or open a comment', () => {
  const nasty = { name: '</script><script>alert(1)</script>', description: '<!-- x --> & ]]> \u2028 "quoted"' };
  const out = A.ldJson(nasty);
  assert.ok(!/[<>&\u2028\u2029]/.test(out), out);
  assert.deepEqual(JSON.parse(out), nasty, 'the data survives the escaping unchanged');
  const script = A.webApplicationScript({ name: nasty.name, url: 'https://x.test/', description: nasty.description, brand: 'B', offers: [] });
  assert.equal(script.match(/<\/script>/g).length, 1);
  assert.equal(JSON.parse(/>([^<]*)</.exec(script)[1]).name, nasty.name);
});

test('WebApplication data: required properties, real offers, the maker, and nothing about ratings', () => {
  const ld = A.webApplicationLd({ name: 'N', url: 'https://x.test/n', description: 'D', brand: 'Glyphcall', offers: [{ label: '$9 a month', note: '900 pages' }, { label: '$4.5 once' }, { label: 'free' }] });
  assert.deepEqual(ld, {
    '@context': 'https://schema.org', '@type': 'WebApplication', name: 'N', url: 'https://x.test/n', description: 'D', applicationCategory: 'DeveloperApplication', operatingSystem: 'Any',
    offers: [{ '@type': 'Offer', price: '9.00', priceCurrency: 'USD', description: '$9 a month: 900 pages' }, { '@type': 'Offer', price: '4.50', priceCurrency: 'USD', description: '$4.5 once' }],
    provider: { '@type': 'Organization', name: 'SpellzCode', brand: { '@type': 'Brand', name: 'Glyphcall' } },
    publisher: { '@type': 'Organization', name: 'SpellzCode', brand: { '@type': 'Brand', name: 'Glyphcall' } },
  });
  assert.ok(!('offers' in A.webApplicationLd({ name: 'N', url: 'u', description: 'D', brand: 'B', offers: [] })), 'no prices shown: no offers published');
  assertNoRatings(ld, 'webApplicationLd');
});

test('every product page carries WebApplication data with the plan and pack prices it shows', () => {
  assert.ok(P.PRODUCTS.length >= 8);
  for (const p of P.PRODUCTS) {
    const html = P.productPage(p, 'https://x.test', true, () => undefined, undefined, true, 'Glyphcall');
    const blocks = ldBlocks(html, p.slug);
    const [app, ...more] = ofType(blocks, 'WebApplication');
    assert.ok(app && more.length === 0, `${p.slug}: exactly one WebApplication`);
    assert.equal(app.name, p.name);
    assert.equal(app.url, `https://x.test/${p.slug}`);
    assert.equal(app.url, /<link rel="canonical" href="([^"]+)">/.exec(html)[1]);
    assert.equal(app.description, decode(/<meta name="description" content="([^"]*)">/.exec(html)[1]), 'the page\'s own description');
    assert.equal(app.applicationCategory, 'DeveloperApplication');
    assert.equal(app.operatingSystem, 'Any');
    assert.equal(app.publisher.name, 'SpellzCode');
    assert.equal(app.provider.brand.name, 'Glyphcall');
    const offers = P.productOffers(p, true);
    assert.ok(offers.length > 0);
    assert.deepEqual(app.offers.map((o) => o.price), expectedPrices(), `${p.slug}: prices from the plans and packs in credits.ts`);
    app.offers.forEach((o, i) => {
      assert.equal(o.priceCurrency, 'USD');
      assert.equal(o.description, `${offers[i].label}: ${offers[i].calls} ${p.unit}`);
      assert.ok(visible(html).includes(squeeze(offers[i].label)) && visible(html).includes(squeeze(`${offers[i].calls} ${p.unit}`)), `${p.slug}: ${o.description} is on the page`);
    });
    // Without card payments the page shows the price per call only, and so does the data.
    const bare = P.productPage(p, 'https://x.test', true, () => undefined, undefined, false, 'Glyphcall');
    const [bareApp] = ofType(ldBlocks(bare, p.slug), 'WebApplication');
    assert.equal(bareApp.offers.length, 1);
    assert.ok(visible(bare).includes(squeeze(`$${Number(bareApp.offers[0].price)}per successful call`)) || visible(bare).includes(squeeze(bareApp.offers[0].description)), `${p.slug}: ${bareApp.offers[0].description}`);
    assertNoRatings(blocks, p.slug);
  }
});

test('the front page carries WebApplication data with the plan and pack prices of its pricing section', () => {
  const html = H.landingPage('Glyphcall', 'https://x.test', true);
  const blocks = ldBlocks(html, '/');
  const apps = ofType(blocks, 'WebApplication');
  assert.equal(apps.length, 1);
  const [app] = apps;
  assert.equal(app.name, 'Glyphcall');
  assert.equal(app.url, 'https://x.test/');
  assert.equal(app.description, decode(/<meta name="description" content="([^"]*)">/.exec(html)[1]));
  assert.deepEqual(app.offers.map((o) => o.price), expectedPrices());
  const pricing = visible(html.slice(html.indexOf('id="pricing"')));
  for (const plan of C.WEB_PLANS) assert.ok(pricing.includes(`$${plan.usdCents / 100}/month`), `$${plan.usdCents / 100} a month is in the pricing section`);
  for (const pack of C.WEB_PACKS) assert.ok(pricing.includes(`$${pack.usdCents / 100}`));
  assert.deepEqual(app.publisher, { '@type': 'Organization', name: 'SpellzCode', brand: { '@type': 'Brand', name: 'Glyphcall' } });
  assertNoRatings(blocks, '/');
  const noCard = ofType(ldBlocks(H.landingPage('Glyphcall', 'https://x.test', false), '/'), 'WebApplication')[0];
  assert.ok(!('offers' in noCard), 'no plans on the page: no offers in the data');
  // Nothing about payment protocols was added before the agents section (tests/site-pages.test.cjs holds the full rule).
  assert.doesNotMatch(A.webApplicationScript({ name: 'Glyphcall', url: 'https://x.test/', description: app.description, brand: 'Glyphcall', offers: [] }), /x402|USDC|wallet|MPP/i);
});

test('served from the Worker\'s own host, the WebApplication data names the public site like the canonical tag', async () => {
  for (const path of ['/', `/${P.PRODUCTS[0].slug}`]) {
    const html = await page(path, WORKER);
    const [app] = ofType(ldBlocks(html, path), 'WebApplication');
    assert.equal(app.url, `${SITE}${path}`);
    assert.equal(app.url, /<link rel="canonical" href="([^"]+)">/.exec(html)[1]);
    assert.ok(!JSON.stringify(app).includes('workers.dev'));
    const onSite = ofType(ldBlocks(await page(path, SITE), path), 'WebApplication')[0];
    assert.deepEqual(app, onSite, 'the same data on both hosts');
  }
  const other = '<script type="application/ld+json">{"url":"https://w.test/x"}</script><pre>"https://w.test/x"</pre>';
  assert.equal(S.withPublicCanonical(other, 'https://w.test', SITE), other, 'only the marked block is rewritten');
});

// A product slug that is also a real catalog endpoint (e.g. /text-to-speech-api) is a 402 paid API door, not a
// human HTML page, so it cannot be fetched as a 200 here. Skip those; the human page families are still all covered.
const HUMAN_PRODUCT_SLUGS = () => {
  const doors = new Set(D.ENDPOINTS.map((e) => e.path));
  return P.PRODUCTS.map((p) => `/${p.slug}`).filter((path) => !doors.has(path));
};
const FAMILIES = () => [
  '/', '/docs', '/credits', '/tools', '/guides', '/about', '/transcribe-pro',
  ...HUMAN_PRODUCT_SLUGS(),
  '/vat-number-check', '/vat-number-check/austria', '/company-register', '/company-register/sweden',
  '/tools/weather', '/tools/sanctions-check', '/tools/pdf-text', '/tools/time', '/tools/vat-validate',
  ...[...D.sitemapXml('').matchAll(/<loc>(\/guides\/[^<]*)<\/loc>/g)].map((m) => m[1]).filter((_, i) => i % 6 === 0),
  '/guides/web-reading', '/guides/local-mcp',
  '/e-invoice', '/e-invoice/rules', '/e-invoice/rules/br-01', '/de/e-rechnung', '/de/e-rechnung/regeln', '/de/e-rechnung/regeln/br-01',
];

test('on every page family: JSON-LD parses, FAQ data repeats only questions and answers the page shows, no ratings', async () => {
  const withFaq = [], withApp = [];
  for (const path of FAMILIES()) {
    const html = await page(path);
    const blocks = ldBlocks(html, path);
    assertNoRatings(blocks, path);
    for (const node of nodesOf(blocks)) assert.ok(typeof node['@type'] === 'string' || Array.isArray(node['@type']), `${path}: a node without @type`);
    const seen = visible(html);
    const faqs = ofType(blocks, 'FAQPage');
    assert.ok(faqs.length <= 1, `${path}: more than one FAQPage`);
    for (const faq of faqs) {
      assert.ok(Array.isArray(faq.mainEntity) && faq.mainEntity.length > 0, `${path}: an empty FAQPage`);
      for (const q of faq.mainEntity) {
        assert.equal(q['@type'], 'Question');
        assert.equal(q.acceptedAnswer?.['@type'], 'Answer');
        assert.ok(q.name && q.acceptedAnswer.text, `${path}: a question or answer is empty`);
        assert.ok(seen.includes(squeeze(q.name)), `${path}: the question "${q.name}" is in the FAQ data but not on the page`);
        assert.ok(seen.includes(squeeze(q.acceptedAnswer.text)), `${path}: the answer to "${q.name}" in the FAQ data is not the text on the page: ${q.acceptedAnswer.text}`);
      }
      withFaq.push(path);
    }
    if (ofType(blocks, 'WebApplication').length) withApp.push(path);
  }
  assert.deepEqual(withApp.sort(), ['/', ...HUMAN_PRODUCT_SLUGS()].sort(), 'WebApplication data only on the front page and the human product pages');
  for (const path of ['/', ...HUMAN_PRODUCT_SLUGS(), '/tools/weather', '/vat-number-check/austria', '/company-register/sweden', '/e-invoice/rules/br-01', '/de/e-rechnung/regeln/br-01', '/transcribe-pro']) assert.ok(withFaq.includes(path), `${path} shows questions and carries FAQ data`);
  // Audited 16 Nov 2026: these pages have no question-and-answer section, so they carry no FAQ data.
  for (const path of ['/docs', '/credits', '/tools', '/guides', '/about']) assert.ok(!withFaq.includes(path), `${path} shows no questions and answers, so it carries no FAQ data`);
});

test('the IndexNow key file answers on every host, and the sitemap lists the host that was asked', async () => {
  const key = /INDEXNOW_KEY = "([0-9a-f]{32})"/.exec(require('node:fs').readFileSync('src/index.ts', 'utf8'))[1];
  for (const host of [SITE, WORKER, 'https://tools.funwords.eu', 'https://www.glyphcall.com']) {
    const res = await mf.dispatchFetch(`${host}/${key}.txt`, { redirect: 'manual' });
    assert.equal(res.status, 200, host);
    assert.match(res.headers.get('content-type'), /text\/plain/);
    assert.equal((await res.text()).trim(), key);
  }
  const xml = await (await mf.dispatchFetch(`${SITE}/sitemap.xml`)).text();
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  assert.ok(locs.length > 600 && locs.every((u) => u.startsWith(`${SITE}/`)), 'the public site\'s sitemap holds only its own URLs');
  for (const [, day] of xml.matchAll(/<lastmod>([^<]*)<\/lastmod>/g)) assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(day) && day <= new Date().toISOString().slice(0, 10), day);
  const moved = await mf.dispatchFetch('https://tools.funwords.eu/sitemap.xml', { redirect: 'manual' });
  assert.deepEqual([moved.status, moved.headers.get('location')], [301, `${SITE}/sitemap.xml`], 'a retired host has no sitemap of its own to submit');
});
