// LexGlyph (16 Nov 2026): the EU law search page for people. Accessible, six interface languages, free within a daily
// allowance, no JavaScript needed, official text linked in the visitor's language.
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

let lex, law, i18n, discovery;
before(async () => {
  lex = await loadTypeScript(require.resolve("../src/lib/lexglyph-page.ts"));
  law = await loadTypeScript(require.resolve("../src/routes/law-search.ts"));
  i18n = await loadTypeScript(require.resolve("../src/lib/lexglyph-i18n.ts"));
  discovery = await loadTypeScript(require.resolve("../src/discovery.ts"));
});

const result = { act: "General Data Protection Regulation", short: "GDPR", celex: "32016R0679", citation: "GDPR, Article 37", kind: "article", label: "Article 37", heading: "Designation of the data protection officer", text: "The controller and the processor shall designate a data protection officer <script>x</script> in any case where…", url: "https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:02016R0679-20160504#art_37", version: "consolidated text of 2016-05-04" };

test("the start page: one h1, a labelled search form that works without JavaScript, examples in several languages", () => {
  const html = lex.lexglyphPage("https://glyphcall.com", "Glyphcall");
  assert.equal((html.match(/<h1>/g) ?? []).length, 1);
  assert.match(html, /<form method="get" action="\/lexglyph" role="search">/);
  assert.match(html, /<label for="q"/);
  assert.match(html, /<label for="act"/);
  for (const [lang] of lex.EXAMPLES) assert.match(html, new RegExp(`<a lang="${lang}"`));
  assert.match(html, /<link rel="canonical" href="https:\/\/glyphcall.com\/lexglyph">/);
  assert.match(html, /hreflang="sv" href="https:\/\/glyphcall.com\/lexglyph\?lang=sv"/);
  assert.doesNotMatch(html, /noindex/);
  assert.match(html, /aria-live="polite"/);
  // The plain-words answer is on unless the visitor turned it off; the hidden 0 makes "off" survive the form.
  assert.match(html, /<input type="hidden" name="explain" value="0">/);
  assert.match(html, /name="explain" value="1" checked/);
});

test("every interface language has every string, and the browser's language picks it", () => {
  const keys = Object.keys(i18n.STRINGS.en);
  for (const l of i18n.UI_LANGS) assert.deepEqual(Object.keys(i18n.STRINGS[l]).sort(), [...keys].sort(), l);
  assert.equal(i18n.pickUiLang(null, "sv-SE,sv;q=0.9,en;q=0.8"), "sv");
  assert.equal(i18n.pickUiLang("de", "sv-SE"), "de");
  assert.equal(i18n.pickUiLang(null, "ja-JP"), "en");
  assert.equal(i18n.languageName("sv", "en"), "Swedish");
  const sv = lex.lexglyphPage("https://glyphcall.com", "Glyphcall", { ui: "sv" });
  assert.match(sv, /<html lang="sv">/);
  assert.match(sv, /Hoppa till resultaten/);
});

test("results: escaped, official text linked in the question's language and in English, copy and read-aloud tools", () => {
  const html = lex.lexglyphPage("https://glyphcall.com", "Glyphcall", { q: "dpo <b>", results: [result], left: 19, qLang: { eurlex: "SV", tag: "sv" } });
  assert.doesNotMatch(html, /<script>x<\/script>|<b>/);
  assert.match(html, /href="https:\/\/eur-lex.europa.eu\/legal-content\/SV\/TXT\/HTML\/\?uri=CELEX:02016R0679-20160504#art_37" hreflang="sv"/);
  assert.match(html, /official text in Swedish/);
  assert.match(html, /official text \(English\)/);
  assert.match(html, /data-copy="GDPR, Article 37 \(Designation of the data protection officer\), General Data Protection Regulation \(consolidated text of 2016-05-04\)\. https:\/\/eur-lex/);
  assert.match(html, /class="tool js speak" data-lang="en"/);
  assert.match(html, /19 free searches left today/);
  assert.match(html, /<meta name="robots" content="noindex">/);
});

test("the free allowance: a visitor over the daily limit is told so and nothing is searched", async () => {
  const store = new Map();
  const env = { TRIALS: { get: async (k) => store.get(k) ?? null, put: async (k, v) => store.set(k, v) } };
  const day = new Date().toISOString().slice(0, 10);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("lexglyph:203.0.113.9"));
  store.set(`lexglyph:${day}:${[...new Uint8Array(digest)].slice(0, 12).map((b) => b.toString(16).padStart(2, "0")).join("")}`, String(lex.LEXGLYPH_PER_VISITOR));
  const html = await lex.lexglyphHtml(env, "https://glyphcall.com", new URLSearchParams({ q: "dpo" }), "203.0.113.9");
  assert.match(html, /used today&#39;s 20 free searches/);
  assert.match(html, /role="alert"/);
  const sv = await lex.lexglyphHtml(env, "https://glyphcall.com", new URLSearchParams({ q: "dpo" }), "203.0.113.9", "sv-SE");
  assert.match(sv, /dagens 20 gratis sökningar/);
  const unknownAct = await lex.lexglyphHtml(env, "https://glyphcall.com", new URLSearchParams({ q: "dpo", act: "Narnia Act" }), "198.51.100.1");
  assert.match(unknownAct, /not in the index/);
});

test("language of the question: named for the answer, coded for EUR-Lex", () => {
  assert.equal(law.questionLanguage("när måste ett företag utse ett dataskyddsombud"), "Swedish");
  assert.equal(law.questionLang("welche KI-Praktiken sind verboten").eurlex, "DE");
  assert.equal(law.questionLang("who is a gatekeeper").eurlex, "EN");
  assert.equal(law.eurlexIn(result.url, "PL"), "https://eur-lex.europa.eu/legal-content/PL/TXT/HTML/?uri=CELEX:02016R0679-20160504#art_37");
});

test("LexGlyph is in its own host's sitemap, not the main one (21 Nov 2026)", () => {
  assert.ok(!discovery.sitemapXml("https://x.test").includes("/lexglyph</loc>"));
  assert.ok(discovery.lexSitemapXml().includes("<loc>https://lex.glyphcall.com/</loc>"));
});
