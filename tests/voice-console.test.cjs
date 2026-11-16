// The free voice console (src/lib/voice-console.ts) on the front page and the two voice product pages: the tool is the
// hero, the try the product pages promised exists, and the page keeps its copy rules.
const assert = require("node:assert/strict");
const { before, test } = require("node:test");
const esbuild = require("esbuild");
const Module = require("node:module");

async function loadTypeScript(entry) {
  const built = await esbuild.build({ entryPoints: [entry], bundle: true, platform: "node", format: "cjs", write: false, external: ["cloudflare:workers"] });
  const mod = new Module(entry, null);
  mod.filename = entry;
  mod.paths = Module._nodeModulePaths(process.cwd());
  mod._compile(built.outputFiles[0].text, entry);
  return mod.exports;
}

let landingPage, PRODUCTS, productPage, VC;
before(async () => {
  ({ landingPage } = await loadTypeScript(require.resolve("../src/lib/site-pages.ts")));
  ({ PRODUCTS, productPage } = await loadTypeScript(require.resolve("../src/lib/product-pages.ts")));
  VC = await loadTypeScript(require.resolve("../src/lib/voice-console.ts"));
});

const scripts = (html) => (html.match(/<script>/g) ?? []).length;

test("the front page opens on the console, with text already in it and a voice chosen", () => {
  const html = landingPage("Glyphcall", "https://x.test", true);
  const hero = html.slice(html.indexOf('<section class="hero"'), html.indexOf('<section class="stats"'));
  assert.match(hero, /id="hero-vc"/);
  assert.match(hero, /<textarea id="hero-vc-text"[^>]*>Welcome!/);
  assert.match(hero, /data-voice="af_heart" aria-pressed="true"/);
  assert.equal((hero.match(/aria-pressed="true"/g) ?? []).length, 1, "one voice preselected");
  assert.match(hero, /&#9654; Play/);
  assert.match(hero, /Drop a recording here/);
  assert.equal(scripts(html), 1, "the console's script, once");
  assert.ok(html.indexOf("<script>") > html.indexOf("</main>"), "the script runs after the markup exists");
  assert.match(html, /href="#try">Try it free, no account/);
  assert.match(html, /<details class="menu">/, "a menu on phones");
});

test("the two voice product pages carry the console where they had no try", () => {
  for (const [slug, tab] of [["speech-to-text-api", "stt"], ["text-to-speech-api", "tts"]]) {
    const p = PRODUCTS.find((x) => x.slug === slug);
    const html = productPage(p, "https://x.test", false, () => undefined, undefined, true, "Glyphcall");
    assert.match(html, /<div id="try"><h2>Try it free, right here<\/h2>/, slug);
    assert.match(html, new RegExp(`data-first="${tab}"`), slug);
    assert.match(html, /<a class="btn primary" href="#try">Try it free, no account<\/a>/, slug);
    assert.equal(scripts(html), 1, slug);
  }
  const pdf = productPage(PRODUCTS.find((x) => x.slug === "pdf-to-text-api"), "https://x.test", true, () => undefined);
  assert.doesNotMatch(pdf, /class="vc/, "other products keep their own try form");
  assert.equal(scripts(pdf), 0);
});

test("the console keeps the copy rules and names only what the browser tools do", () => {
  const all = VC.voiceConsole({ voiceSite: "https://voice.x.test" }) + VC.voiceConsoleScript();
  assert.doesNotMatch(all, /x402|MPP|USDC|Tempo|wallet/i);
  assert.doesNotMatch(all, /faster|fastest|instant|cheapest/i, "no speed or price superlatives");
  assert.doesNotMatch(all, /localStorage\.(get|set)Item\([^)]*\)(?![^;]*catch)/, "storage is wrapped");
  for (const v of VC.CONSOLE_VOICES) assert.match(v.id, /^[ab][fm]_[a-z]+$/, "a Kokoro English voice id");
  assert.equal(new Set(VC.CONSOLE_VOICES.map((v) => v.id)).size, VC.CONSOLE_VOICES.length);
  // Every library the console fetches names an exact version.
  for (const url of all.match(/https:\/\/cdn[^"'\s]+/g)) assert.match(url, /@\d+\.\d+\.\d+|\/\d+\.\d+\.\d+\//, url);
});
