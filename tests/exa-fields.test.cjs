// Exa request-field parity (15 Nov 2026, Beat-Exa plan 4b step 2), against exa-js 2.28's request and response types.
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

let api;
before(async () => { api = await loadTypeScript(require.resolve("../src/lib/search-api.ts")); });

test("userLocation becomes the search country", () => {
  assert.equal(api.userCountry("se"), "SE");
  assert.equal(api.userCountry({ country: "DE", latitude: 52.5, longitude: 13.4 }), "DE");
  assert.equal(api.userCountry({ latitude: 1, longitude: 2 }), undefined);
  assert.equal(api.userCountry("Sweden"), undefined);
  const q = api.toToolQuery("/v1/search", { query: "bästa kaffet", userLocation: "SE" });
  assert.equal(q.query.country, "SE");
});

test("fields that change nothing come back as Exa IGNORED_FIELD warnings with a JSON path", () => {
  const w = api.exaWarnings("/v1/search", { query: "x", type: "deep", outputSchema: { type: "text" }, moderation: true, startCrawlDate: "2025-01-01", contents: { maxAgeHours: -1, subpages: 2 }, userLocation: { latitude: 1, longitude: 2 } });
  const paths = w.map((x) => x.path);
  for (const p of ["/type", "/outputSchema", "/moderation", "/startCrawlDate", "/contents/maxAgeHours", "/contents/subpages", "/userLocation"]) assert.ok(paths.includes(p), p);
  assert.ok(w.every((x) => x.code === "IGNORED_FIELD" && x.message.length > 10));
});

test("fields we honour give no warning", () => {
  for (const type of ["auto", "lite", "fast", "keyword", "neural", "instant"]) assert.deepEqual(api.exaWarnings("/v1/search", { query: "x", type }), [], type);
  assert.deepEqual(api.exaWarnings("/v1/search", { query: "x", userLocation: "SE", contents: { maxAgeHours: 0, livecrawl: "always", text: true } }), []);
  assert.deepEqual(api.exaWarnings("/v1/contents", { urls: ["https://a.test"], maxAgeHours: 24 }), []);
  assert.deepEqual(api.exaWarnings("/v1/answer", { query: "x", outputSchema: { type: "object", properties: { a: {} } } }), []);
});

test("answer and contents warnings", () => {
  const a = api.exaWarnings("/v1/answer", { query: "x", systemPrompt: "be brief", text: true, userLocation: "SE" }).map((x) => x.path);
  assert.deepEqual(a, ["/systemPrompt", "/text", "/userLocation"]);
  const c = api.exaWarnings("/v1/contents", { urls: ["https://a.test"], highlights: true, livecrawl: "never" }).map((x) => x.path);
  assert.deepEqual(c.sort(), ["/highlights", "/livecrawl"]);
});

test("inner tool notes become warnings; the field before the colon is the path", () => {
  assert.deepEqual(api.warningsFromIgnored(["excludeDomains: results come from a source of record", "startPublishedDate is not a date"]).map((w) => w.path), ["/excludeDomains", "/startPublishedDate"]);
});

test("outputSchema: object properties (at most 10) and array item keys; text schemas stay text", () => {
  const s = api.schemaFields({ type: "object", properties: { company: { type: "string" }, founded: { type: "integer" }, people: { type: "array", items: { type: "object", properties: { name: {}, role: {} } } } } });
  assert.deepEqual(s.fields, ["company", "founded", "people"]);
  assert.deepEqual(s.lists, { people: ["name", "role"] });
  assert.equal(api.schemaFields({ type: "text", description: "two lines" }), null);
  const many = Object.fromEntries(Array.from({ length: 15 }, (_, i) => [`f${i}`, {}]));
  assert.equal(api.schemaFields({ type: "object", properties: many }).fields.length, 10);
  assert.equal(api.schemaFields({ type: "object", properties: { constructor: {}, "bad key!": {} } }).fields.join(), "constructor");
});

test("a structured answer streams as one JSON chunk", () => {
  const s = api.answerStream({ answer: { company: "Spotify AB" }, citations: [], requestId: "r" });
  const first = JSON.parse(s.split("\n\n")[0].slice(6));
  assert.equal(first.choices[0].delta.content, '{"company":"Spotify AB"}');
  assert.ok(s.endsWith("data: [DONE]\n\n"));
});

test("content statuses say the page was read live", () => {
  const r = api.toSearchApi("/v1/contents", { results: [], statuses: [{ id: "https://a.test", status: "success" }, { id: "https://b.test", status: "error" }] });
  assert.equal(r.statuses[0].source, "crawled");
  assert.equal(r.statuses[1].source, undefined);
});
