// /benchmarks (15 Nov 2026): recorded runs only, Exa's wins shown, files linked, in the sitemap.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const { before, test } = require("node:test");
const esbuild = require("esbuild");

async function loadTypeScript(entry) {
  const result = await esbuild.build({ entryPoints: [entry], bundle: true, platform: "node", format: "cjs", write: false });
  const loaded = new Module(entry, module);
  loaded.filename = entry;
  loaded.paths = Module._nodeModulePaths(process.cwd());
  loaded._compile(result.outputFiles[0].text, entry);
  return loaded.exports;
}

let b, discovery, endpoints;
before(async () => {
  b = await loadTypeScript(require.resolve("../src/lib/benchmarks-page.ts"));
  discovery = await loadTypeScript(require.resolve("../src/discovery.ts"));
  endpoints = await loadTypeScript(require.resolve("../src/endpoints.ts"));
});

test("every benchmark has a date, a method, both systems, limits and files that exist in the repository", () => {
  for (const x of b.BENCHMARKS) {
    assert.match(x.date, /^\d{1,2} \w+ 20\d\d$/, x.id);
    assert.ok(x.method.length > 60, x.id);
    assert.equal(x.rows.filter((r) => r.ours).length, 1, x.id);
    assert.equal(x.rows.filter((r) => !r.ours).length, 1, x.id);
    for (const r of x.rows) assert.equal(r.cells.length, x.columns.length, `${x.id} ${r.system}`);
    assert.ok(x.limits.length > 0, x.id);
    for (const [, file] of x.files) assert.ok(fs.existsSync(path.join(__dirname, "..", file)), file);
  }
});

test("the page shows where Exa is ahead, not only where we are", () => {
  const papers = b.BENCHMARKS.find((x) => x.id === "papers");
  assert.equal(papers.rows[0].ours, false);
  const html = b.benchmarksPage("https://x.test", "Brand");
  assert.match(html, /Exa is slightly\s+ahead/);
  assert.match(html, /17 \/ 20/);
  assert.match(html, /<link rel="canonical" href="https:\/\/x\.test\/benchmarks">/);
  assert.match(html, /not affiliated with Exa/);
});

test("links from the page go to live pages and tools", () => {
  const html = b.benchmarksPage("https://x.test", "Brand");
  const tools = new Set(endpoints.ENDPOINTS.map((e) => `/tools/${e.path.slice(1).replace(/\//g, "-")}`));
  for (const [, , p] of b.NO_EQUIVALENT) if (p.startsWith("/tools/")) assert.ok(tools.has(p), p);
  for (const p of ["/eu-law-search-api", "/exa-alternative-api", "/eu-sanctions-screening-api"]) assert.ok(html.includes(`href="${p}"`), p);
});

test("the page is in the sitemap", () => {
  assert.ok(discovery.sitemapXml("https://x.test").includes("<loc>https://x.test/benchmarks</loc>"));
});
