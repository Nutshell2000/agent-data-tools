// EU law search (src/routes/law-search.ts) and its index builder's parser (scripts/law-index/parse.mjs): acts resolve
// from names, aliases and CELEX; questions become safe FTS5 expressions; keyword and meaning rankings fuse; the reranker
// orders the result; every answer cites act, article, link, version and the EUR-Lex attribution.
const assert = require("node:assert/strict");
const { before, test } = require("node:test");
const esbuild = require("esbuild");
const Module = require("node:module");
const { pathToFileURL } = require("node:url");

async function loadTypeScript(entry) {
  const built = await esbuild.build({ entryPoints: [entry], bundle: true, platform: "node", format: "cjs", write: false, external: ["cloudflare:workers"] });
  const mod = new Module(entry, null);
  mod.filename = entry;
  mod.paths = Module._nodeModulePaths(process.cwd());
  mod._compile(built.outputFiles[0].text, entry);
  return mod.exports;
}

let L, P;
before(async () => {
  L = await loadTypeScript(require.resolve("../src/routes/law-search.ts"));
  P = await import(pathToFileURL(require.resolve("../scripts/law-index/parse.mjs")).href);
});

test("acts resolve from short name, full name, alias and CELEX; unknown acts are refused", () => {
  assert.equal(L.actOf("gdpr").short, "GDPR");
  assert.equal(L.actOf("General Data Protection Regulation").short, "GDPR");
  assert.equal(L.actOf("32016R0679").short, "GDPR");
  assert.equal(L.actOf("EU AI Act").short, "AI Act");
  assert.equal(L.actOf("vat").short, "VAT Directive");
  assert.equal(L.actOf(undefined), undefined);
  assert.throws(() => L.actOf("Magna Carta"), (e) => e.status === 400);
  assert.equal(new Set(L.LAW_ACTS.map((a) => a.short)).size, L.LAW_ACTS.length, "short names are unique");
  for (const a of L.LAW_ACTS) assert.match(a.celex, /^3\d{4}[RLD]\d{4}$/, a.short);
});

test("a question becomes quoted content words OR-ed, so no FTS5 syntax gets through", () => {
  assert.equal(L.ftsQuery("When is processing of personal data lawful?"), '"processing" OR "personal" OR "data" OR "lawful"');
  assert.equal(L.ftsQuery('NEAR(") OR *'), '"near"');
  assert.equal(L.ftsQuery("the of and"), null);
});

test("reciprocal-rank fusion puts ids found high in both lists first", () => {
  assert.deepEqual(L.fuse([["a", "b", "c"], ["c", "a", "d"]]).slice(0, 2), ["a", "c"]);
});

const row = (id, short, label, heading, text) => ({ id, celex: "32016R0679", version_celex: "02016R0679-20160504", short, act: "General Data Protection Regulation", kind: label.startsWith("Recital") ? "recital" : "article", label, num: label.split(" ")[1], heading, part: 1, parts: 1, text, url: `https://eur-lex.europa.eu/x#${id}`, version: "consolidated text of 2016-05-04" });

test("hybrid search: filters reach both indexes, candidates fuse, the reranker orders, the answer cites", async () => {
  const seen = {};
  const rows = { "gdpr:a6:1": row("gdpr:a6:1", "GDPR", "Article 6", "Lawfulness of processing", "1. Processing shall be lawful only if…"), "gdpr:a5:1": row("gdpr:a5:1", "GDPR", "Article 5", "Principles", "Personal data shall be…"), "gdpr:r40:1": row("gdpr:r40:1", "GDPR", "Recital 40", null, "(40) In order for processing to be lawful…") };
  const deps = {
    embed: async (q) => { seen.embedded = q; return [0.1, 0.2]; },
    vectors: async (_v, k, f) => { seen.vf = f; seen.k = k; return ["gdpr:r40:1", "gdpr:a6:1"]; },
    keywords: async (m, _l, f) => { seen.match = m; seen.kf = f; return ["gdpr:a6:1", "gdpr:a5:1"]; },
    rows: async (ids) => ids.map((id) => rows[id]),
    rerank: async (_q, docs) => docs.map((d, index) => ({ index, score: d.includes("Article 6") ? 0.9 : 0.2 })),
  };
  const act = L.actOf("GDPR");
  const found = await L.lawSearch("when is processing lawful", { act, count: 2 }, deps);
  assert.deepEqual(seen.vf, { short: "GDPR" });
  assert.deepEqual(seen.kf, { short: "GDPR" });
  assert.equal(seen.match, '"processing" OR "lawful"');
  const out = L.lawAnswer("when is processing lawful", act, undefined, 2, found);
  assert.equal(out.results[0].citation, "GDPR, Article 6");
  assert.equal(out.results[0].heading, "Lawfulness of processing");
  // Reranker 0.9, plus 0.06 for an operative article, plus half the heading bonus ("processing" of "processing lawful").
  assert.equal(out.results[0].score, 0.98);
  assert.ok(out.results.every((r, i, all) => i === 0 || all[i - 1].score >= r.score));
  assert.equal(out.results.length, 2);
  assert.match(out.attribution, /eur-lex\.europa\.eu.*Not legal advice/);
  // Without the reranker the fused order stands, and a failing keyword index does not fail the search.
  const plain = await L.lawSearch("lawful", { count: 3 }, { ...deps, keywords: async () => { throw new Error("fts down"); }, rerank: async () => null });
  assert.deepEqual(plain.candidates.map((r) => r.id), ["gdpr:r40:1", "gdpr:a6:1"]);
  assert.equal(plain.scores, null);
});

test("the acts a question is about come from names and defining terms, longest match first", () => {
  assert.deepEqual(L.intendedActs("maximum fines for infringing data protection rules").map((a) => a.short), ["GDPR"]);
  assert.equal(L.intendedActs("what an invoice must contain for VAT")[0].short, "VAT Directive");
  assert.equal(L.intendedActs("who is a gatekeeper")[0].short, "DMA");
  assert.deepEqual(L.intendedActs("the weather in Paris"), []);
  // "ai" alone is too short to count; "ai system" counts.
  assert.equal(L.intendedActs("is this ai system high-risk")[0].short, "AI Act");
});

test("without the index bindings the tool answers 503, uncharged", () => {
  assert.throws(() => L.lawDeps({}), (e) => e.status === 503);
});

test("the parser reads both CELLAR layouts: articles with headings, recitals, numbers joined, amendment markers gone", () => {
  const oj = `<p class="oj-doc-ti">REGULATION (EU) 2016/679</p><div class="eli-subdivision" id="rct_1"><p class="oj-normal">(1)</p><p class="oj-normal">The protection of natural persons is a fundamental right.</p></div>
    <div class="eli-subdivision" id="art_1"><p class="oj-ti-art">Article 1</p><div class="eli-title"><p class="oj-sti-art">Subject-matter and objectives</p></div><div><p class="oj-normal">1.</p><p class="oj-normal">This Regulation lays down rules&#160;relating to data.</p></div></div>
    <p class="oj-ti-section-1">CHAPTER II</p><div class="eli-subdivision" id="art_2"><p class="oj-ti-art">Article 2</p><p class="oj-normal">This Regulation applies to the processing of data.</p></div><div id="anx_I">ANNEX I should not be read</div>`;
  const r = P.parseAct(oj);
  assert.equal(r.title, "REGULATION (EU) 2016/679");
  assert.deepEqual(r.items.map((i) => `${i.kind}:${i.num}`), ["recital:1", "article:1", "article:2"]);
  assert.equal(r.items[1].heading, "Subject-matter and objectives");
  assert.equal(r.items[1].text, "1. This Regulation lays down rules relating to data.");
  assert.equal(r.items[2].text, "This Regulation applies to the processing of data.", "chapter titles and annexes stay out");
  const cons = `<p class="title-doc-first">Council Directive 2006/112/EC</p><div class="eli-subdivision" id="art_44"><p class="title-article-norm">Article 44</p><p class="norm">▼M1 The place of supply ►C1 of services ◄ shall be…</p></div>`;
  const c = P.parseAct(cons);
  assert.equal(c.items[0].text, "The place of supply of services shall be…");
  const long = Array.from({ length: 40 }, (_, i) => `Line ${i} ${"x".repeat(90)}`).join("\n");
  const parts = P.chunks(long);
  assert.ok(parts.length > 1 && parts.every((p) => p.length <= 2000));
  assert.equal(parts.join("\n"), long);
});
