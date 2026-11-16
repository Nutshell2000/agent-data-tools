// LexGlyph (16 Nov 2026): the EU law search page for people. Accessible, free within a daily allowance, no JS needed.
const assert = require("node:assert/strict");
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

let lex, law, discovery;
before(async () => {
  lex = await loadTypeScript(require.resolve("../src/lib/lexglyph-page.ts"));
  law = await loadTypeScript(require.resolve("../src/routes/law-search.ts"));
  discovery = await loadTypeScript(require.resolve("../src/discovery.ts"));
});

const result = { act: "General Data Protection Regulation", short: "GDPR", celex: "32016R0679", citation: "GDPR, Article 37", kind: "article", label: "Article 37", heading: "Designation of the data protection officer", text: "The controller and the processor shall designate a data protection officer <script>x</script> in any case where…", url: "https://eur-lex.europa.eu/x#art_37", version: "consolidated text of 2016-05-04" };

test("the start page: one h1, a labelled search form that works without JavaScript, examples in several languages", () => {
  const html = lex.lexglyphPage("https://glyphcall.com", "Glyphcall");
  assert.equal((html.match(/<h1>/g) ?? []).length, 1);
  assert.match(html, /<form method="get" action="\/lexglyph" role="search">/);
  assert.match(html, /<label for="q"/);
  assert.match(html, /<label for="act"/);
  for (const [lang] of lex.EXAMPLES) assert.match(html, new RegExp(`<a lang="${lang}"`));
  assert.match(html, /<link rel="canonical" href="https:\/\/glyphcall.com\/lexglyph">/);
  assert.doesNotMatch(html, /noindex/);
  assert.match(html, /aria-live="polite"/);
});

test("results are escaped, linked to EUR-Lex, expandable and copyable; search pages are not indexed", () => {
  const html = lex.lexglyphPage("https://glyphcall.com", "Glyphcall", { q: "dpo <b>", results: [result], left: 19 });
  assert.doesNotMatch(html, /<script>x<\/script>|<b>/);
  assert.match(html, /official text on EUR-Lex/);
  assert.match(html, /<details><summary>Read the whole article/);
  assert.match(html, /data-cite="GDPR, Article 37 \(Designation of the data protection officer\), General Data Protection Regulation \(consolidated text of 2016-05-04\)\. https:\/\/eur-lex/);
  assert.match(html, /19 free searches left today/);
  assert.match(html, /<meta name="robots" content="noindex">/);
});

test("the free allowance: a visitor over the daily limit is told so and nothing is searched", async () => {
  const store = new Map();
  const env = { TRIALS: { get: async (k) => store.get(k) ?? null, put: async (k, v) => store.set(k, v) } };
  const day = new Date().toISOString().slice(0, 10);
  // Pre-fill the counter for this visitor as the page would after 20 searches.
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("lexglyph:203.0.113.9"));
  store.set(`lexglyph:${day}:${[...new Uint8Array(digest)].slice(0, 12).map((b) => b.toString(16).padStart(2, "0")).join("")}`, String(lex.LEXGLYPH_PER_VISITOR));
  const html = await lex.lexglyphHtml(env, "https://glyphcall.com", new URLSearchParams({ q: "dpo" }), "203.0.113.9");
  assert.match(html, /used today&#39;s 20 free searches/);
  assert.match(html, /role="alert"/);
  const unknownAct = await lex.lexglyphHtml(env, "https://glyphcall.com", new URLSearchParams({ q: "dpo", act: "Narnia Act" }), "198.51.100.1");
  assert.match(unknownAct, /not in the index/);
});

test("plain-words answers are asked for in the question's own language", () => {
  assert.equal(law.questionLanguage("när måste ett företag utse ett dataskyddsombud"), "Swedish");
  assert.equal(law.questionLanguage("welche KI-Praktiken sind verboten"), "German");
  assert.equal(law.questionLanguage("who is a gatekeeper"), "English");
});

test("LexGlyph is in the sitemap", () => {
  assert.ok(discovery.sitemapXml("https://x.test").includes("<loc>https://x.test/lexglyph</loc>"));
});
