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
  assert.match(hero, /on your own phone or computer/, "the console also works on a phone");
  // The counter states the real cap (19 Nov 2026: 200,000; 21 Nov 2026: 20,000, CONSOLE_MAX_CHARS), never "no limit".
  assert.ok(html.includes('characters (up to "+MAX.toLocaleString()') && html.includes("MAX=20000"), "the runtime counter states the real cap");
  assert.doesNotMatch(hero, /no limit|No credits or limits/i, "no false no-limit claim in the visible copy");
  assert.match(hero, /data-voice="af_heart" aria-pressed="true"/);
  assert.equal((hero.match(/aria-pressed="true"/g) ?? []).length, 1, "one voice preselected");
  assert.match(hero, /&#9654; Play/);
  assert.match(hero, /Drop a recording here/);
  assert.match(hero, /Fix one sentence without redoing the rest<\/summary><ol id="hero-vc-sents">/, "one sentence can be redone alone");
  assert.equal(scripts(html), 1, "the console's script, once");
  assert.ok(html.indexOf("<script>") > html.indexOf("</main>"), "the script runs after the markup exists");
  assert.match(html, /href="#try">Try it free, no account/);
  assert.match(html, /<details class="menu">/, "a menu on phones");
});

test("the hero offers use-case scripts that fill the text box", () => {
  const html = landingPage("Glyphcall", "https://x.test", true);
  const hero = html.slice(html.indexOf('<section class="hero"'), html.indexOf('<section class="stats"'));
  for (const label of ["Narration", "Advertisement", "Podcast", "Character"]) assert.match(hero, new RegExp(`data-preset="\\d+">${label}</button>`), label);
  assert.match(hero, /aria-label="Try a sample script"/);
  assert.match(html, /querySelectorAll\("\[data-preset\]"\)/, "the buttons are wired to the text box");
  assert.equal(scripts(html), 1, "no second inline script");
});

test("the footer headings and agent links pass the accessibility rules", () => {
  const html = landingPage("Glyphcall", "https://x.test", true);
  const footer = html.slice(html.indexOf("<footer>"));
  assert.ok(!/<h4>/.test(footer), "no h4 without an h3 in the footer");
  assert.match(footer, /<h3>[^<]+ APIs<\/h3>/);
  assert.match(html, /\.agents p a\{[^}]*text-decoration:underline/);
});

test("the FAQ states the browser and API voice counts from the catalog", () => {
  const html = landingPage("Glyphcall", "https://x.test", true);
  const q = "How many voices are there?";
  assert.ok(html.includes(q), "the voice-count question is answered");
  const answer = html.slice(html.indexOf(q), html.indexOf(q) + 400);
  assert.ok(answer.includes(`${VC.CONSOLE_VOICES.length} voices in the free browser tools`));
  assert.match(answer, new RegExp(`and \\d+ through the API`));
  assert.match(html, /free browser voices/);
});

test("the two voice product pages carry the console where they had no try", () => {
  for (const [slug, tab] of [["speech-to-text-api", "stt"], ["text-to-speech-api", "tts"]]) {
    const p = PRODUCTS.find((x) => x.slug === slug);
    const html = productPage(p, "https://x.test", false, () => undefined, undefined, true, "Glyphcall");
    assert.match(html, /<div id="try"><h2>Try it free, right here<\/h2>/, slug);
    assert.match(html, new RegExp(`data-first="${tab}"`), slug);
    assert.match(html, /<a class="btn primary" href="#try">Try it free, no account<\/a>/, slug);
    assert.match(html, /The paid API (speaks your text|transcribes) in one call — see the request below or <a href="#pricing">plans<\/a>\./, slug);
    assert.equal(scripts(html), 1, slug);
  }
  const pdf = productPage(PRODUCTS.find((x) => x.slug === "pdf-to-text-api"), "https://x.test", true, () => undefined);
  assert.doesNotMatch(pdf, /class="vc/, "other products keep their own try form");
  assert.equal(scripts(pdf), 0);
});

test("the console keeps the copy rules and names only what the browser tools do", () => {
  const all = VC.voiceConsole({ voiceSite: "https://voice.x.test" }) + VC.voiceConsoleScript();
  assert.doesNotMatch(all, /x402|MPP|USDC|Tempo|wallet/i);
  // Whole words: the worker calls the espeak-ng module's instantiateWasm hook (21 Nov 2026).
  assert.doesNotMatch(all, /\b(?:faster|fastest|instant|cheapest)\b/i, "no speed or price superlatives");
  assert.doesNotMatch(all, /localStorage\.(get|set)Item\([^)]*\)(?![^;]*catch)/, "storage is wrapped");
  for (const v of VC.CONSOLE_VOICES) assert.match(v.id, /^[abefiph][fm]_[a-z]+$/, "a Kokoro v1.0 voice id");
  assert.equal(new Set(VC.CONSOLE_VOICES.map((v) => v.id)).size, VC.CONSOLE_VOICES.length);
  // Every library the console fetches names an exact version.
  for (const url of all.match(/https:\/\/cdn[^"'\s]+/g)) assert.match(url, /@\d+\.\d+\.\d+|\/\d+\.\d+\.\d+\//, url);
});

// 21 Nov 2026: parity with voice.glyphcall.com's tts.js and tts-worker.js.
test("41 voices in 7 languages: English chips first, the rest under More voices grouped by language", () => {
  assert.equal(VC.CONSOLE_VOICES.length, 41);
  assert.deepEqual([...new Set(VC.CONSOLE_VOICES.map((v) => v.lang))], ["en-us", "en-gb", "es", "fr", "it", "pt-br", "hi"]);
  assert.ok(VC.CONSOLE_VOICES.slice(0, VC.CONSOLE_VOICES_SHOWN).every((v) => v.lang.startsWith("en")), "the chips are English");
  const html = VC.voiceConsole({ voiceSite: "https://voice.x.test" });
  assert.match(html, /<summary>35 more voices, 7 languages<\/summary>/);
  const more = html.slice(html.indexOf('<details class="vc-more">'), html.indexOf("</details>"));
  for (const label of ["English (American)", "English (British)", "Español", "Français", "Italiano", "Português (Brasil)"]) assert.ok(more.includes(`<p class="vc-lang">${label}</p>`), label);
  assert.match(more, /data-voice="ef_dora" lang="es"/);
  assert.match(html, /id="vc-gpu"/, "the graphics card option is in the markup (shown only with WebGPU)");
});

test("the worker phonemizes other languages with espeak-ng, falls back from WebGPU and posts each sentence", () => {
  const js = VC.voiceConsoleScript();
  assert.ok(js.includes("https://cdn.jsdelivr.net/npm/espeak-ng@1.0.2/dist/espeak-ng.js"));
  assert.ok(js.includes("https://cdn.jsdelivr.net/npm/espeak-ng@1.0.2/dist/espeak-ng.wasm"));
  assert.ok(js.includes("WebAssembly.compile"), "compiled once");
  assert.ok(js.includes("generate_from_ids") && js.includes("model.tokenizer"));
  assert.ok(js.includes('device:\\"webgpu\\"') && js.includes('dtype:\\"q8\\",device:\\"wasm\\"'), "WebGPU with the wasm engine as fallback");
  assert.ok(js.includes('type:\\"chunk\\"'), "playback starts with the first sentence");
  assert.match(js, /navigator\.gpu\?/, "the option is offered only where WebGPU exists");
});

// 21 Nov 2026 review of the console: retry, mobile data, pauses, pronunciations, memory, accessibility.
test("a failed load can be retried, the warm-up spares mobile data, and the text is capped for memory", () => {
  const html = VC.voiceConsole({ voiceSite: "https://voice.x.test" });
  const js = VC.voiceConsoleScript();
  assert.ok(js.includes("loading=null;throw err;"), "the worker forgets a failed load");
  assert.match(js, /function fail\(msg\)\{if\(tw\)\{tw\.terminate\(\);tw=null;\}/, "the page drops a failed worker");
  assert.ok(js.includes("Press Play to try again."));
  assert.doesNotMatch(js, /addEventListener\("focus",warm/, "no download on focus");
  assert.ok(js.includes("saveData") && js.includes('effectiveType!=="4g"'), "no warm-up on Save-Data or slow connections");
  assert.match(html, /<span class="vc-size" id="vc-size">about 90 MB, once<\/span>/);
  assert.equal(VC.CONSOLE_MAX_CHARS, 20000);
  assert.match(html, /maxlength="20000"/);
  assert.match(html, /href="https:\/\/studio\.glyphcall\.com\/audiobook"/);
  assert.doesNotMatch(js, /addEventListener\("input",\(\)=>\{upd\(\);store\.set/, "storage writes are debounced");
});

test("paragraph pauses, a pronunciation list, and accessible controls", () => {
  const html = VC.voiceConsole({ voiceSite: "https://voice.x.test" });
  const js = VC.voiceConsoleScript();
  assert.ok(js.includes("GAP=0.12,PARA=0.5") && js.includes('type:\\"para\\"'), "a longer pause after a paragraph");
  assert.match(html, /<summary>Pronunciations<\/summary>/);
  assert.ok(js.includes('store.get("gc-vc-pron")') && js.includes("const respell="), "saved on the device and applied before speaking");
  assert.match(VC.VOICE_CONSOLE_CSS, /\.vc-voices button\{[^}]*min-height:44px/);
  assert.match(VC.VOICE_CONSOLE_CSS, /\.vc-presets button\{[^}]*min-height:44px/);
  assert.match(html, /<progress id="vc-tbar" max="1" hidden aria-label="Speech progress">/);
  assert.match(html, /id="vc-tpct" aria-live="off"/);
  for (const v of VC.CONSOLE_VOICES) assert.deepEqual(Object.keys(v).sort(), ["accent", "gender", "hello", "id", "lang", "name"], v.id);
});

test("a voice chip plays its recorded sample through one reused audio element, before any download", () => {
  const js = VC.voiceConsoleScript();
  assert.ok(js.includes('SAMPLE_BASE="https://voice.glyphcall.com/samples/"'));
  assert.ok(js.includes('const clip=new Audio();clip.preload="none"'));
  assert.ok(js.includes('clip.src=SAMPLE_BASE+encodeURIComponent(voice)+".mp3"'));
  assert.doesNotMatch(js, /300 hours|commercial use|voice-test/i);
});
