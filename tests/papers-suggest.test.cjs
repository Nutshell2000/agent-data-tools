// Paper search (src/routes/papers.ts): a description that shares no words with a paper's title gets the title from a
// suggester, but only a paper the index itself holds under that title is put first; the suggester's words never are.
const assert = require("node:assert/strict");
const { test } = require("node:test");
const esbuild = require("esbuild");
const Module = require("node:module");

async function load() {
  const built = await esbuild.build({ entryPoints: ["src/routes/papers.ts"], bundle: true, platform: "node", format: "cjs", write: false, external: ["cloudflare:workers"] });
  const mod = new Module("papers", null);
  mod.paths = Module._nodeModulePaths(process.cwd());
  mod._compile(built.outputFiles[0].text, "papers.js");
  return mod.exports;
}
const work = (title, doi) => ({ title, doi: `https://doi.org/${doi}`, publication_year: 2020, cited_by_count: 1, authorships: [], id: `https://openalex.org/${doi}` });

test("a suggested title is looked up in the index and put first only when the index holds it", async () => {
  const P = await load();
  const asked = [];
  const real = global.fetch;
  global.fetch = async (url) => {
    const q = new URL(String(url)).searchParams.get("search");
    asked.push(q);
    const results = q === "Denoising Diffusion Probabilistic Models" ? [work("Denoising Diffusion Probabilistic Models", "10.1/ddpm")]
      : q === "A Made Up Title Nobody Wrote" ? [work("Something else entirely", "10.1/other")]
      : [work("Subject-driven Text-to-Image Generation", "10.1/a"), work("Noise2Noise", "10.1/b")];
    return new Response(JSON.stringify({ meta: { count: results.length }, results }), { status: 200 });
  };
  try {
    const r = await P.searchPapers("image generation by learning to reverse a gradual noising process", "3", undefined, async () => ["Denoising Diffusion Probabilistic Models", "A Made Up Title Nobody Wrote"]);
    assert.deepEqual(r.results.map((p) => p.title), ["Denoising Diffusion Probabilistic Models", "Subject-driven Text-to-Image Generation", "Noise2Noise"]);
    assert.ok(!r.results.some((p) => p.title === "A Made Up Title Nobody Wrote"));
    // A query that already finds its own title asks no suggester.
    let called = false;
    global.fetch = async () => new Response(JSON.stringify({ meta: { count: 1 }, results: [work("Noise2Noise: Learning Image Restoration", "10.1/b")] }), { status: 200 });
    await P.searchPapers("Noise2Noise", "3", undefined, async () => { called = true; return []; });
    assert.equal(called, false);
    // A suggester that fails leaves the index's own answer.
    const kept = await P.searchPapers("something vague", "2", undefined, async () => { throw new Error("AI down"); });
    assert.equal(kept.results.length, 1);
  } finally {
    global.fetch = real;
  }
});