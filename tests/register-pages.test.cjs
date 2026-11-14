// Company register pages (src/lib/register-pages.ts): the rules each page states about a company number are checked
// here against the page's own example, so a wrong check-digit rule or VAT formula cannot ship.
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

let REGISTER_COUNTRIES, REGISTER_BASE, registerCountryPage, registerIndexPage, registerPagePaths, ENDPOINTS, isHumanPage, sitemapXml, VAT_COUNTRIES;
before(async () => {
  ({ REGISTER_COUNTRIES, REGISTER_BASE, registerCountryPage, registerIndexPage, registerPagePaths } = await loadTypeScript(require.resolve("../src/lib/register-pages.ts")));
  ({ ENDPOINTS } = await loadTypeScript(require.resolve("../src/endpoints.ts")));
  ({ isHumanPage } = await loadTypeScript(require.resolve("../src/lib/funnel.ts")));
  ({ sitemapXml } = await loadTypeScript(require.resolve("../src/discovery.ts")));
  ({ VAT_COUNTRIES } = await loadTypeScript(require.resolve("../src/lib/vat-pages.ts")));
});

const digits = (s) => s.replace(/\D/g, "").split("").map(Number);
const luhnOk = (s) => { const d = digits(s).reverse(); return d.reduce((sum, n, i) => sum + (i % 2 ? (n * 2 > 9 ? n * 2 - 9 : n * 2) : n), 0) % 10 === 0; };
const mod11 = (s, weights) => { const d = digits(s); const r = 11 - (weights.reduce((sum, w, i) => sum + w * d[i], 0) % 11); return (r === 11 ? 0 : r) === d[weights.length]; };
const by = (slug) => REGISTER_COUNTRIES.find((c) => c.slug === slug);

test("each register names a live tool, and its example is the tool's own example", () => {
  for (const c of REGISTER_COUNTRIES) {
    const tool = ENDPOINTS.find((e) => e.path === c.tool);
    assert.ok(tool, c.tool);
    assert.match(c.example, c.pattern, c.slug);
    assert.ok(Object.values(tool.params).some((p) => String(p.example) === c.example), `${c.slug}: ${c.example} is an example input of ${c.tool}`);
    if (c.vatSlug) assert.ok(VAT_COUNTRIES.some((v) => v.slug === c.vatSlug), c.vatSlug);
  }
});

test("the check-digit rules the pages state hold for their examples", () => {
  assert.ok(luhnOk(by("sweden").example), "Sweden: Luhn");
  assert.match(by("sweden").checkDigit, /Luhn/);
  assert.ok(mod11(by("norway").example, [3, 2, 7, 6, 5, 4, 3, 2]), "Norway: mod 11");
  assert.match(by("norway").checkDigit, /3, 2, 7, 6, 5, 4, 3, 2/);
  assert.ok(mod11(by("finland").example, [7, 9, 10, 5, 8, 4, 2]), "Finland: mod 11");
  assert.match(by("finland").checkDigit, /7, 9, 10, 5, 8, 4, 2/);
  assert.ok(luhnOk(by("france").example), "France: Luhn");
});

test("the VAT numbers the pages derive are right", () => {
  const siren = Number(by("france").example);
  assert.equal((12 + 3 * (siren % 97)) % 97, 27);
  assert.match(by("france").vat, /FR27552032534/);
  assert.match(by("sweden").vat, /SE556703748501/);
  assert.match(by("finland").vat, /FI01120389/);
  assert.match(by("norway").vat, /NO923609016MVA/);
  for (const slug of ["sweden", "finland", "france"]) {
    const made = /becomes ([A-Z0-9]+)/.exec(by(slug).vat)[1];
    const vat = VAT_COUNTRIES.find((v) => v.slug === slug);
    assert.match(made, vat.pattern, `${slug}: the derived VAT number fits the VAT page's pattern`);
  }
});

test("a register page has the facts, the lookup, the answer and the product link; all are listed and counted", () => {
  const html = registerCountryPage(by("norway"), "https://x.test", true);
  assert.match(html, /<h1>Norwegian company register lookup<\/h1>/);
  assert.match(html, /organisasjonsnummer/);
  assert.match(html, /form class="try" method="get" action="\/no\/company"/);
  assert.match(html, /<link rel="canonical" href="https:\/\/x\.test\/company-register\/norway">/);
  assert.match(html, /href="\/company-check-api"/);
  assert.match(html, /Not a credit report|No\. It returns register facts/);
  assert.doesNotMatch(html, /x402|MPP|USDC/);
  assert.doesNotMatch(registerCountryPage(by("sweden"), "https://x.test", false), /form class="try"/);
  const index = registerIndexPage("https://x.test");
  const xml = sitemapXml("https://x.test");
  for (const path of registerPagePaths()) {
    assert.ok(isHumanPage(path), path);
    assert.ok(xml.includes(`<loc>https://x.test${path}</loc>`), path);
    if (path !== REGISTER_BASE) assert.ok(index.includes(`href="${path}"`), path);
  }
});
