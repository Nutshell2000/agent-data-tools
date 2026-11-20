// The installable voice app (src/lib/voice-app.ts): /app, its manifest and a service worker that is limited to /app.
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

let A, landingPage;
before(async () => {
  A = await loadTypeScript(require.resolve("../src/lib/voice-app.ts"));
  ({ landingPage } = await loadTypeScript(require.resolve("../src/lib/site-pages.ts")));
});

test("the app page holds the console, links the manifest and registers the worker for /app only", () => {
  const html = A.appPage("Glyphcall", "https://x.test");
  assert.match(html, /<link rel="manifest" href="\/manifest\.webmanifest">/);
  assert.match(html, /id="app-vc"/);
  assert.match(html, /serviceWorker\.register\("\/sw\.js",\{scope:"\/app"\}\)/);
  assert.match(html, /beforeinstallprompt/);
  assert.match(html, /Add to Home Screen/);
  assert.match(html, /Want this in your own app\? Our <a href="\/text-to-speech-api">text to speech API<\/a> speaks your text on our servers\./, "the console points a delighted visitor at the paid TTS API");
  assert.match(html, /Need transcription in your app\? See the <a href="\/speech-to-text-api">speech to text API<\/a>/, "the STT tab points at the paid STT API");
  assert.match(html, /Voice generation and transcription run on our servers through an API, priced per call with a key\./, "the developer card states what the API actually is");
  assert.doesNotMatch(html, /The same voices|price per hour|x402|MPP|USDC|Tempo|wallet/i, "no misleading or payment-protocol words on a human page");
});

test("the app page publishes WebApplication structured data so search engines can list the free app", () => {
  const html = A.appPage("Glyphcall", "https://x.test");
  assert.match(html, /<script type="application\/ld\+json" data-ld="app">/);
  const ld = JSON.parse(/<script type="application\/ld\+json" data-ld="app">([\s\S]*?)<\/script>/.exec(html)[1]);
  assert.equal(ld["@type"], "WebApplication");
  assert.equal(ld.name, "Glyphcall Voice");
  assert.equal(ld.url, "https://x.test/app");
  assert.match(ld.description, /Install Glyphcall Voice on Windows|natural voices and speech to text/i);
  assert.ok(!ld.aggregateRating && !ld.review, "no unverified rating or review is published");
});

test("the app page shows a FAQPage matching its visible questions and declares a twitter card", () => {
  const html = A.appPage("Glyphcall", "https://x.test");
  assert.match(html, /<meta name="twitter:card" content="summary_large_image">/);
  const faq = JSON.parse(/<script type="application\/ld\+json" data-ld="faq">([\s\S]*?)<\/script>/.exec(html)[1]);
  assert.equal(faq["@type"], "FAQPage");
  assert.ok(faq.mainEntity.length >= 3, "three questions");
  for (const q of faq.mainEntity) {
    assert.equal(q["@type"], "Question");
    assert.ok(html.includes(q.name) && html.includes(q.acceptedAnswer.text), `visible: ${q.name}`);
  }
});

test("the manifest is installable: name, standalone, start inside the scope, a 512 px icon", () => {
  const m = A.appManifest("Glyphcall");
  assert.equal(m.display, "standalone");
  assert.equal(m.scope, "/app");
  assert.ok(String(m.start_url).startsWith("/app"));
  assert.ok(m.icons.some((i) => i.sizes === "512x512" && i.type === "image/png"));
  assert.ok(m.name && m.short_name);
});

test("the service worker caches the shell and the model runtime and never touches other paths or methods", () => {
  const sw = A.appServiceWorker();
  assert.match(sw, /addEventListener\("fetch"/);
  assert.match(sw, /r\.method!=="GET"/);
  assert.match(sw, /cdn\\\.jsdelivr\\\.net/);
  assert.doesNotThrow(() => new Function(sw));
});

test("the front page links the app", () => {
  const html = landingPage("Glyphcall", "https://x.test", true);
  assert.match(html, /href="\/app"/);
});
