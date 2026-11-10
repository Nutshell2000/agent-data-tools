// arXiv paper search (10 Nov 2026): arXiv's public Atom API read with small regular expressions. Mocked fetch throughout.
const assert = require("node:assert/strict");
const { before, test } = require("node:test");
const esbuild = require("esbuild");
const Module = require("node:module");

async function load(entry) {
  const built = await esbuild.build({ entryPoints: [entry], bundle: true, platform: "node", format: "cjs", write: false, external: ["cloudflare:workers"] });
  const mod = new Module(entry, null);
  mod.filename = entry;
  mod.paths = Module._nodeModulePaths(process.cwd());
  mod._compile(built.outputFiles[0].text, entry);
  return mod.exports;
}

let A, tools, endpoints;
before(async () => {
  A = await load(require.resolve("../src/routes/arxiv.ts"));
  tools = await load(require.resolve("../src/tools.ts"));
  endpoints = await load(require.resolve("../src/endpoints.ts"));
});

const atom = (body, status = 200) => new Response(body, { status, headers: { "content-type": "application/atom+xml" } });
// What export.arxiv.org really sends (10 Nov 2026), shortened; whitespace and entities as in the live answer.
const FEED = `<?xml version='1.0' encoding='UTF-8'?>
<feed xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/" xmlns:arxiv="http://arxiv.org/schemas/atom" xmlns="http://www.w3.org/2005/Atom">
  <id>https://arxiv.org/api/5N6KgYCyuo0Tzx94VgsPt62pB2A</id>
  <title>arXiv Query: search_query=all:"attention is all you need"&amp;id_list=&amp;start=0&amp;max_results=2</title>
  <opensearch:itemsPerPage>2</opensearch:itemsPerPage>
  <opensearch:totalResults>47</opensearch:totalResults>
  <opensearch:startIndex>0</opensearch:startIndex>
  <entry>
    <id>http://arxiv.org/abs/2604.21816v1</id>
    <title>Tool Attention Is All You Need: Dynamic Tool Gating
  and Lazy Schema Loading</title>
    <updated>2026-04-23T16:10:00Z</updated>
    <link href="https://arxiv.org/abs/2604.21816v1" rel="alternate" type="text/html"/>
    <link href="https://arxiv.org/pdf/2604.21816v1" rel="related" type="application/pdf" title="pdf"/>
    <summary>  Tool tokens fall by 95.0% (47.3k -&gt; 2.4k) &amp; context use rises; see the "Attention" paper.
</summary>
    <category term="cs.AI" scheme="http://arxiv.org/schemas/atom"/>
    <category term="cs.LG" scheme="http://arxiv.org/schemas/atom"/>
    <published>2026-04-23T16:10:00Z</published>
    <arxiv:comment>21 pages</arxiv:comment>
    <arxiv:primary_category term="cs.AI"/>
    <author>
      <name>Anuj Sadani</name>
    </author>
    <author>
      <name>Deepak Kumar</name>
    </author>
  </entry>
  <entry>
    <id>http://arxiv.org/abs/hep-th/9901001v3</id>
    <title>An old-style identifier</title>
    <updated>1999-02-01T00:00:00Z</updated>
    <summary>Short.</summary>
    <category term="hep-th" scheme="http://arxiv.org/schemas/atom"/>
    <published>1999-01-01T00:00:00Z</published>
    <arxiv:doi>10.1000/xyz123</arxiv:doi>
    <arxiv:journal_ref>Phys.Rev. D60 (1999) 1</arxiv:journal_ref>
    <author><name>A. Physicist</name></author>
  </entry>
</feed>`;
const EMPTY = `<?xml version='1.0' encoding='UTF-8'?><feed xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/" xmlns="http://www.w3.org/2005/Atom"><opensearch:totalResults>0</opensearch:totalResults></feed>`;
const BAD_ID = `<?xml version='1.0' encoding='UTF-8'?><feed xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/" xmlns="http://www.w3.org/2005/Atom"><opensearch:totalResults>1</opensearch:totalResults><entry><id>https://arxiv.org/api/errors#incorrect_id_format_for_notanid</id><title>Error</title><summary>incorrect id format for notanid</summary><author><name>arXiv api core</name></author></entry></feed>`;

test("an arXiv ID is read bare, with a version, old-style or inside a link; free text is a search", () => {
  assert.equal(A.arxivId("1706.03762"), "1706.03762");
  assert.equal(A.arxivId(" 1706.03762v7 "), "1706.03762v7");
  assert.equal(A.arxivId("arXiv:2401.01234"), "2401.01234");
  assert.equal(A.arxivId("https://arxiv.org/abs/2401.01234v2"), "2401.01234v2");
  assert.equal(A.arxivId("arxiv.org/pdf/2005.11401.pdf"), "2005.11401");
  assert.equal(A.arxivId("https://arxiv.org/abs/hep-th/9901001"), "hep-th/9901001");
  assert.equal(A.arxivId("hep-th/9901001"), "hep-th/9901001");
  for (const text of ["transformers", "attention is all you need", "papers from 2401.01234 onwards", "gpt 4.5 evaluation", "3.14159", "1706.037", "2401.012345"]) assert.equal(A.arxivId(text), null, text);
});

test("search words become arXiv's query: every word must match, a quoted phrase stays a phrase, a category narrows", () => {
  assert.equal(A.arxivQuery("retrieval augmented generation"), "all:retrieval AND all:augmented AND all:generation");
  assert.equal(A.arxivQuery('"attention is all you need" transformer'), 'all:"attention is all you need" AND all:transformer');
  assert.equal(A.arxivQuery("graph neural networks", "cs.LG"), "all:graph AND all:neural AND all:networks AND cat:cs.LG");
  // Operators and brackets a caller might type are not passed through as query syntax.
  assert.equal(A.arxivQuery("llm) OR (all:x & agents ANDNOT rag"), "all:llm AND all:all AND all:agents AND all:rag");
  assert.equal(A.arxivQuery("a b c " + "w ".repeat(3) + "one two three four five six seven eight nine ten eleven").split(" AND ").length, 10);
  assert.throws(() => A.arxivQuery("! ? ,"), (e) => e.status === 400);
});

test("the Atom answer becomes papers: entities decoded, whitespace collapsed, both ID styles, total kept", () => {
  const { total, papers } = A.parseArxiv(FEED);
  assert.equal(total, 47);
  assert.equal(papers.length, 2);
  assert.deepEqual(papers[0], {
    id: "2604.21816", version: 1, title: "Tool Attention Is All You Need: Dynamic Tool Gating and Lazy Schema Loading",
    summary: 'Tool tokens fall by 95.0% (47.3k -> 2.4k) & context use rises; see the "Attention" paper.',
    authors: ["Anuj Sadani", "Deepak Kumar"], authorsTotal: 2, published: "2026-04-23", updated: "2026-04-23",
    primaryCategory: "cs.AI", categories: ["cs.AI", "cs.LG"], comment: "21 pages", journalRef: null, doi: null,
    url: "https://arxiv.org/abs/2604.21816", pdf: "https://arxiv.org/pdf/2604.21816",
  });
  assert.equal(papers[1].id, "hep-th/9901001");
  assert.equal(papers[1].version, 3);
  assert.equal(papers[1].primaryCategory, "hep-th");
  assert.equal(papers[1].doi, "10.1000/xyz123");
  assert.equal(papers[1].journalRef, "Phys.Rev. D60 (1999) 1");
  assert.equal(papers[1].pdf, "https://arxiv.org/pdf/hep-th/9901001");
  assert.deepEqual(A.parseArxiv(EMPTY), { total: 0, papers: [] });
  assert.throws(() => A.parseArxiv(BAD_ID), (e) => e.status === 400 && /incorrect id format/.test(e.message));
  // A long abstract is cut, a long author list is capped with its true length kept.
  const many = FEED.replace("<summary>Short.</summary>", `<summary>${"word ".repeat(600)}</summary>`).replace("<author><name>A. Physicist</name></author>", Array.from({ length: 30 }, (_, i) => `<author><name>Author ${i}</name></author>`).join(""));
  const long = A.parseArxiv(many).papers[1];
  assert.ok(long.summary.length <= 1200 && long.summary.endsWith("…"));
  assert.equal(long.authors.length, 12);
  assert.equal(long.authorsTotal, 30);
});

test("the read: one more try after a busy answer, a still-busy arXiv is an uncharged 503, a 400 body is passed on", async () => {
  const noSleep = async () => {};
  const urls = [];
  const flaky = async (url) => { urls.push(url); return urls.length === 1 ? atom("", 503) : atom(FEED); };
  assert.ok((await A.arxivRead({ search_query: "all:x", max_results: "2" }, flaky, noSleep)).includes("<entry>"));
  assert.equal(urls.length, 2);
  assert.match(urls[0], /^https:\/\/export\.arxiv\.org\/api\/query\?search_query=all%3Ax&max_results=2$/);
  await assert.rejects(A.arxivRead({ id_list: "1" }, async () => atom("", 429), noSleep), (e) => e.status === 503 && e.code === "ARXIV_BUSY");
  await assert.rejects(A.arxivRead({ id_list: "1" }, async () => atom("", 404), noSleep), (e) => e.status === 502);
  await assert.rejects(A.arxivRead({ id_list: "1" }, async () => { throw new Error("timeout"); }, noSleep), (e) => e.status === 502);
  assert.equal(await A.arxivRead({ id_list: "notanid" }, async () => atom(BAD_ID, 400), noSleep), BAD_ID);
});

test("the tool: a search, a lookup by ID or link, refusals with a reason, and the listing's shape", async () => {
  const e = endpoints.ENDPOINTS.find((x) => x.path === "/arxiv/search");
  assert.ok(e, "/arxiv/search is listed");
  assert.equal(e.summary.split(":")[0], "arXiv search");
  assert.equal(e.params.q.required, true);
  const real = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (url) => { seen.push(String(url)); return /zzqx/.test(String(url)) ? atom(EMPTY) : /notanid|9999\.99999/.test(String(url)) ? atom(EMPTY) : atom(FEED); };
  try {
    const run = (input) => tools.TOOLS["/arxiv/search"]({}, (n) => input[n]);
    const found = await run({ q: "attention transformer", count: "2", sort: "newest", category: "cs.AI" });
    assert.deepEqual(Object.keys(found).sort(), Object.keys(e.outputExample).sort());
    assert.deepEqual(Object.keys(found.papers[0]).sort(), Object.keys(e.outputExample.papers[0]).sort());
    assert.equal(found.total, 47);
    assert.equal(found.count, 2);
    const sent = new URL(seen.at(-1)).searchParams;
    assert.equal(sent.get("search_query"), "all:attention AND all:transformer AND cat:cs.AI");
    assert.equal(sent.get("max_results"), "2");
    assert.equal(sent.get("sortBy"), "submittedDate");
    // The names search agents send (query, limit) are read as q and count.
    await run({ query: "attention", limit: "3" });
    assert.equal(new URL(seen.at(-1)).searchParams.get("max_results"), "3");
    const one = await run({ q: "https://arxiv.org/abs/2604.21816" });
    assert.equal(new URL(seen.at(-1)).searchParams.get("id_list"), "2604.21816");
    assert.equal(one.count, 1);
    await assert.rejects(run({ q: "zzqx nothing" }), (err) => err.status === 404 && /nothing was charged/.test(err.message));
    await assert.rejects(run({ q: "9999.99999" }), (err) => err.status === 404);
    await assert.rejects(run({ q: "agents", category: "not a category" }), (err) => err.status === 400);
    await assert.rejects(run({ q: "agents", sort: "random" }), (err) => err.status === 400);
    await assert.rejects(run({}), (err) => err.status === 400);
  } finally { globalThis.fetch = real; }
});
