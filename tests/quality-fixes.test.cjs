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

let T, C;
before(async () => {
  T = await load(require.resolve("../src/routes/ai-text.ts"));
  C = await load(require.resolve("../src/routes/company.ts"));
});

test("translation chunks stay within the limit and join back to the text", () => {
  const text = Array.from({ length: 60 }, (_, i) => `Sentence number ${i} says something about the order.`).join(" ") + "\nA last line";
  const chunks = T.translationChunks(text);
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((c) => c.length <= 900));
  assert.equal(chunks.join(""), text);
  const unbroken = "x".repeat(2000);
  assert.equal(T.translationChunks(unbroken).join(""), unbroken);
  assert.ok(T.translationChunks(unbroken).every((c) => c.length <= 900));
});

test("an incomplete translation is refused", () => {
  const source = "This is a longer sentence that has to be translated in full, see https://example.com/track for details.";
  assert.equal(T.translationComplete(source, "", "sv"), false);
  assert.equal(T.translationComplete(source, "Detta är", "sv"), false, "too short");
  assert.equal(T.translationComplete(source, "Detta är en längre mening som måste översättas i sin helhet och mer därtill…", "sv"), false, "trailing ellipsis and no URL");
  assert.equal(T.translationComplete(source, "Detta är en längre mening som måste översättas i sin helhet, se https://example.com/track för detaljer.", "sv"), true);
  assert.equal(T.translationComplete("Thank you", "Tack", "sv"), true, "short texts have no length check");
  assert.equal(T.translationComplete("Your payment was received and the order ships on Monday next week.", "付款已收到，订单下周一发货。", "zh"), true);
});

test("a company must be named what was asked for", () => {
  const item = (label, aliases = []) => ({ id: "Q1", labels: { en: { value: label } }, aliases: { en: aliases.map((value) => ({ value })) } });
  assert.equal(C.namedAs(item("Spotify"), "Spotify"), true);
  assert.equal(C.namedAs(item("Spotify"), "Spotify AB"), true, "legal form ignored");
  assert.equal(C.namedAs(item("Apple Inc."), "apple"), true);
  assert.equal(C.namedAs(item("Alphabet Inc.", ["Google parent"]), "google parent"), true, "alias");
  assert.equal(C.namedAs(item("Nestlé"), "nestle"), true, "accents");
  assert.equal(C.namedAs(item("École de recherche graphique"), "PostHog"), false);
  assert.equal(C.namedAs(item("California Institute of Technology", ["Caltech"]), "cal"), false);
});
