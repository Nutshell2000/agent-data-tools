// 19 Nov 2026: router-phrase fixes for the job classes where a real buyer router ranks us below #3 or absent.
// These are metadata-only (tags/listing names/related links) — no price, tool or account change, no self-payment.
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { build } = require("esbuild");

async function load(entry) {
  const b = await build({ entryPoints: [entry], bundle: true, format: "cjs", platform: "node", write: false, logLevel: "silent" });
  const m = { exports: {} };
  new Function("module", "exports", "require", b.outputFiles[0].text)(m, m.exports, require);
  return m.exports;
}

test("the router phrases for the biggest open jobs are in the first Bazaar tags", async () => {
  const ext = await load("src/lib/bazaar-extension.ts");
  // "web read" ($121/2d class): /contents was #12 because its aliases lacked the bare phrase.
  const contents = ext.listingTags(["web-read", "get-contents", "web-contents", "page-contents", "web-scraping"], "/contents");
  assert.ok(contents.slice(0, 5).includes("web-read"), contents.join(","));
  assert.equal(ext.listingNameFor({ path: "/contents", summary: "Web read, get contents: clean text of up to five pages in one call" }).startsWith("Web read"), true);
  // "fetch" ($247/2d class): the /web/fetch door now leads with the bare word (query "web fetch" already ranks #2).
  const fetchTags = ext.listingTags(["fetch", "web-fetch", "fetch-url", "url-fetch", "read-url", "http-fetch"], "/web/fetch");
  assert.equal(fetchTags[0], "fetch", fetchTags.join(","));
  // "exa search" remains a synonym on /search (brand-neutral wording).
  assert.ok(ext.SEARCH_TAGS["/search"].includes("exa-search"));
  // "fear greed index" ($20/2d class): the canonical tool now carries the phrase.
  assert.ok(ext.SEARCH_TAGS["/crypto/fear-greed"].includes("fear-greed-index"));
});

test("the top paid call points the next job at merchant/domain trust, not an entry door", async () => {
  const related = await load("src/lib/related.ts");
  const safety = related.relatedTools("/pack/url-safety").map((e) => e.path);
  assert.equal(safety[0], "/domain-report", safety.join(","));
  const { ENTRY_OF } = await load("src/routes/entry-paths.ts");
  assert.ok(!Object.hasOwn(ENTRY_OF, safety[0]));
});
