// /docs/search on our own documentation index, and /v1/search routing to it (15 Nov 2026).
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

let docs, api;
before(async () => {
  docs = await loadTypeScript(require.resolve("../src/routes/docs-search.ts"));
  api = await loadTypeScript(require.resolve("../src/lib/search-api.ts"));
});

const row = (id, title, text, url = `https://x.test/${id}`) => ({ id, url, site: "x.test", source: "X docs", title, description: "", headings: "", text, crawled: "2026-10-12" });

test("keyword candidates are reordered by the reranker; without it the keyword order stands", async () => {
  const rows = [row("a", "Fetch API", "The Fetch API provides an interface."), row("b", "AbortController", "The AbortController interface lets you abort a fetch request.")];
  let asked;
  const deps = { keywords: async (m, l, site) => { asked = { m, l, site }; return rows; }, rerank: async () => [{ index: 0, score: 0.2 }, { index: 1, score: 0.9 }] };
  const r = await docs.docsSearch("abort a fetch", { count: 5, site: "developer.mozilla.org" }, deps);
  assert.deepEqual(r.candidates.map((x) => x.id), ["b", "a"]);
  assert.equal(asked.site, "developer.mozilla.org");
  assert.match(asked.m, /"abort" OR "fetch"/);
  const plain = await docs.docsSearch("abort a fetch", { count: 5, site: null }, { ...deps, rerank: async () => { throw new Error("AI down"); } });
  assert.deepEqual(plain.candidates.map((x) => x.id), ["a", "b"]);
  assert.equal(plain.scores, null);
  await assert.rejects(docs.docsSearch("a", { count: 5, site: null }, deps), /at least one word/);
});

test("the snippet is the sentence sharing most words with the question, cut to 300 characters", () => {
  const s = docs.snippet({ description: "Web API reference.", text: "Intro text about many things here. You can abort a fetch request by calling abort() on the controller. Other sentence that is long enough." }, "abort fetch request");
  assert.match(s, /^You can abort a fetch request/);
  assert.ok(docs.snippet({ description: "", text: "x".repeat(900) }, "y").length <= 300);
});

test("/v1/search goes to the docs index for category docs or indexed docs domains only", () => {
  const byCat = api.toToolQuery("/v1/search", { query: "useEffect cleanup", category: "docs", numResults: 3 });
  assert.equal(byCat.tool, "/docs/search");
  assert.equal(byCat.query.count, "3");
  const byDomain = api.toToolQuery("/v1/search", { query: "asyncio gather", includeDomains: ["docs.python.org"] });
  assert.equal(byDomain.tool, "/docs/search");
  assert.equal(byDomain.query.site, "docs.python.org");
  assert.notEqual(api.toToolQuery("/v1/search", { query: "x402", includeDomains: ["x402.org"] }).tool, "/docs/search");
  assert.notEqual(api.toToolQuery("/v1/search", { query: "fetch", category: "docs", includeText: ["abort"] }).tool, "/docs/search");
  assert.ok(api.DOC_HOSTS.has("react.dev") && api.DOC_HOSTS.has("developer.mozilla.org"));
});

test("docs results come back in the Exa result shape with a highlight", () => {
  const r = api.toSearchApi("/v1/search", { results: [{ title: "AbortController", url: "https://developer.mozilla.org/x", source: "MDN Web Docs", snippet: "Abort it.", crawled: "2026-10-12", score: 0.9 }], attribution: "t" }, "/docs/search");
  assert.equal(r.resolvedSearchType, "docs-index");
  assert.deepEqual(r.results[0].highlights, ["Abort it."]);
  assert.equal(r.results[0].id, "https://developer.mozilla.org/x");
});
