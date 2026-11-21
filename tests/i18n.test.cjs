// The product site in the visitor's language (src/lib/i18n): one URL per language with hreflang, a bar instead of a
// redirect, crawlers untouched, the same sections as the English page, and the owner's rules in every language.
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

let L, HOME_STRINGS, EN, landingPage, voiceConsole, CONSOLE_LABELS_EN, sitemapXml, credits;
const ORIGIN = "https://x.test";
before(async () => {
  L = await loadTypeScript(require.resolve("../src/lib/i18n/locales.ts"));
  ({ HOME_STRINGS, EN } = await loadTypeScript(require.resolve("../src/lib/i18n/home-strings.ts")));
  ({ landingPage } = await loadTypeScript(require.resolve("../src/lib/home-page.ts")));
  ({ voiceConsole, CONSOLE_LABELS_EN } = await loadTypeScript(require.resolve("../src/lib/voice-console.ts")));
  ({ sitemapXml } = await loadTypeScript(require.resolve("../src/discovery.ts")));
  credits = await loadTypeScript(require.resolve("../src/lib/credits.ts"));
});

/** A language's front page as the Worker serves it: the one template in that language, plus the language parts. */
const page = (lang, card = true) => L.withLanguages(landingPage("Glyphcall", ORIGIN, card, { lang }), ORIGIN, lang);
const text = (html) => html.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ");
const sectionIds = (html) => [...html.matchAll(/<section[^>]*\sid="([^"]+)"/g)].map((m) => m[1]);

test("Accept-Language decides; the country is only a tie-breaker; crawlers and explicit choices are respected", () => {
  const chrome = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";
  const d = (h) => L.decideHome({ userAgent: chrome, ...h });
  assert.deepEqual(d({ acceptLanguage: "es-ES,es;q=0.9,en;q=0.8" }), { offer: "es" });
  assert.deepEqual(d({ acceptLanguage: "de-AT" }), { offer: "de" });
  assert.deepEqual(d({ acceptLanguage: "fr-BE,fr;q=0.9" }), { offer: "fr" });
  assert.deepEqual(d({ acceptLanguage: "en-US,en;q=0.9" }), { offer: undefined }, "English first: nothing");
  assert.deepEqual(d({ acceptLanguage: "en-US,en;q=0.9", country: "DE" }), { offer: undefined }, "country alone never changes anything");
  assert.deepEqual(d({ acceptLanguage: "en-US,en;q=0.9,de;q=0.8", country: "DE" }), { offer: "de" }, "English first plus the country's language: offer it");
  assert.deepEqual(d({ acceptLanguage: "en-US,en;q=0.9,de;q=0.8", country: "US" }), { offer: undefined });
  assert.deepEqual(d({ acceptLanguage: "it-IT,it;q=0.9,es;q=0.5" }), { offer: "es" }, "first of our languages in the list");
  assert.deepEqual(d({ acceptLanguage: "en;q=0.2,es;q=0.9" }), { offer: "es" }, "q-values order the list");
  assert.deepEqual(d({ acceptLanguage: "es;q=0,en" }), { offer: undefined }, "q=0 means not wanted");
  assert.deepEqual(d({ acceptLanguage: "sv-SE" }), { offer: undefined }, "a language we do not have yet: nothing");
  assert.deepEqual(d({ acceptLanguage: "es", cookie: "a=1; gc_lang=de" }), { redirect: "de" }, "an explicit choice wins");
  assert.deepEqual(d({ acceptLanguage: "es", cookie: "gc_lang=en" }), {}, "English chosen: no bar");
  assert.deepEqual(d({ acceptLanguage: "es", cookie: "gc_lang=xx" }), { offer: "es" }, "unknown cookie value ignored");
  for (const ua of [undefined, "Googlebot/2.1 (+http://www.google.com/bot.html)", "Mozilla/5.0 (compatible; bingbot/2.0)", "GPTBot/1.1", "curl/8.4.0", "facebookexternalhit/1.1"]) {
    assert.deepEqual(L.decideHome({ userAgent: ua, acceptLanguage: "es", cookie: "gc_lang=es" }), {}, `crawler ${ua}: never a bar or redirect`);
  }
});

test("every language has every key of the English strings, with the same shape", () => {
  const shape = (v) => (typeof v === "function" ? "fn" : Array.isArray(v) ? `array${v.length}` : v && typeof v === "object" ? "object" : typeof v);
  const walk = (en, other, at) => {
    for (const k of Object.keys(en)) {
      if (k === "banned") continue;
      assert.ok(Object.hasOwn(other, k), `missing ${at}${k}`);
      const a = shape(en[k]), b = shape(other[k]);
      if (!(at === "" && (k === "console" || k === "ladder"))) assert.equal(b, a, `${at}${k}: ${b} where English has ${a}`);
      if (a === "object" && !Array.isArray(en[k])) walk(en[k], other[k], `${at}${k}.`);
    }
  };
  for (const lang of L.OTHER_LANGS) {
    walk(EN, HOME_STRINGS[lang], `${lang}: `);
    assert.ok(HOME_STRINGS[lang].console && HOME_STRINGS[lang].ladder, `${lang}: console labels and pricing cards`);
    for (const k of Object.keys(HOME_STRINGS[lang].console)) assert.ok(HOME_STRINGS[lang].console[k], `${lang}: console.${k}`);
  }
  for (const lang of L.LANGS) {
    const S = HOME_STRINGS[lang];
    assert.ok(S.title("Glyphcall").length <= 60, `${lang} title ${S.title("Glyphcall").length}`);
    assert.ok(S.description.length <= 160, `${lang} description ${S.description.length}`);
  }
});

test("every language home: own URL, canonical, hreflang for all plus x-default, html lang, title <= 60, description <= 160", () => {
  for (const lang of L.OTHER_LANGS) {
    const html = page(lang);
    assert.match(html, new RegExp(`<html lang="${lang}">`));
    assert.match(html, new RegExp(`<link rel="canonical" href="${ORIGIN}/${lang}/">`));
    for (const l of L.LANGS) assert.match(html, new RegExp(`<link rel="alternate" hreflang="${l}" href="${ORIGIN}${l === "en" ? "/" : `/${l}/`}">`), `${lang}: hreflang ${l}`);
    assert.match(html, new RegExp(`<link rel="alternate" hreflang="x-default" href="${ORIGIN}/">`));
    const title = /<title>([^<]+)<\/title>/.exec(html)[1];
    const desc = /<meta name="description" content="([^"]+)">/.exec(html)[1].replace(/&#39;/g, "'");
    assert.ok(title.length <= 60, `${lang} title ${title.length}: ${title}`);
    assert.ok(desc.length <= 160 && desc.length >= 90, `${lang} description ${desc.length}: ${desc}`);
    assert.match(title, /\| Glyphcall$/);
  }
});

test("the English page names every language and keeps its own copy; the bar appears only when offered", () => {
  const en = landingPage("Glyphcall", ORIGIN, true);
  const plain = L.withLanguages(en, ORIGIN, "en");
  for (const l of L.LANGS) assert.match(plain, new RegExp(`hreflang="${l}" href="${ORIGIN}${l === "en" ? "/" : `/${l}/`}"`));
  assert.match(plain, /hreflang="x-default" href="https:\/\/x.test\/"/);
  assert.match(plain, /<details class="gc-langpick">[\s\S]*?<details class="menu">/, "the picker sits in the header, before the phone menu");
  assert.match(plain, /<nav class="gc-langrow"[^>]*>[\s\S]*?<\/nav><p class="legal">/, "the language row sits in the footer");
  assert.match(plain, /data-gc-lang-js/);
  assert.doesNotMatch(plain, /class="gc-langbar"/);
  const back = plain.replace(`${L.languageHeadLinks(ORIGIN, "en")}<style>${L.LANGUAGE_CSS}</style>`, "").replace(L.languagePicker("en", "Language"), "").replace(L.menuLanguages("en"), "")
    .replace(L.languageRow("en", "Language"), "").replace(L.LANGUAGE_SCRIPT, "");
  assert.equal(back, en, "the English page is unchanged apart from the language parts");
  const offered = L.withLanguages(en, ORIGIN, "en", "de");
  assert.match(offered, /<body[^>]*><div class="gc-langbar" lang="de"[^>]*><span>Diese Seite lieber auf Deutsch lesen\?<\/span><a [^>]*href="\/de\/"[^>]*data-gc-lang="de"/);
  assert.match(offered, /<button type="button" data-gc-lang="en" aria-label="Auf Englisch bleiben"/);
});

test("the language pages carry every section of the English page", () => {
  const en = sectionIds(landingPage("Glyphcall", ORIGIN, true)).filter((id) => id !== undefined);
  assert.ok(en.length >= 8);
  for (const lang of L.OTHER_LANGS) {
    const ids = sectionIds(page(lang));
    for (const id of en) assert.ok(ids.includes(id), `${lang} is missing section #${id} (the English page changed; add it to lib/i18n/home-localized.ts)`);
  }
});

test("prices and checkout links are the shared constants, in US dollars", () => {
  for (const lang of L.OTHER_LANGS) {
    const html = page(lang);
    assert.ok(html.includes(credits.VOICE_PRO_URL), `${lang}: the Pro link`);
    assert.ok(html.includes(credits.VOICE_HOURS_PACK_URL), `${lang}: the $1 pack link`);
    assert.ok(html.includes(`$${credits.VOICE_PRO_CENTS / 100}`));
    assert.doesNotMatch(html, /€|\bEUR\b(?!-Lex)|\d\s?\$/, `${lang}: dollars written $3, never 3 $ or euros`);
    const english = landingPage("Glyphcall", ORIGIN, true);
    for (const m of html.matchAll(/https:\/\/buy\.stripe\.com\/[A-Za-z0-9]+/g)) assert.ok(english.includes(m[0]), `${lang}: checkout link ${m[0]} is not one of the English page's`);
  }
});

test("owner rules in every language: pay methods, no accounts, no speed, refund, AI or rival words", () => {
  const RIVALS = /elevenlabs|openai|otter|descript|speechify|murf|assemblyai|deepgram|naturalreader|google cloud|amazon polly/i;
  const pay = { es: /tarjeta, Apple Pay, Google Pay o Link/, de: /Karte, Apple Pay, Google Pay oder Link/, fr: /carte, Apple Pay, Google Pay ou Link/ };
  for (const lang of L.OTHER_LANGS) {
    const body = text(page(lang));
    assert.match(body, pay[lang], `${lang}: the four pay methods`);
    // The English page keeps one allowed request-format line naming two formats; a translation adds no rival name.
    const count = (t) => (t.match(new RegExp(RIVALS.source, "gi")) ?? []).length;
    assert.ok(count(body) <= count(text(landingPage("Glyphcall", ORIGIN, true))), `${lang}: no rival names beyond the English page's request-format line`);
    // The folded API catalogue (details.devmore) shows the products' own English descriptions, as on the English page.
    const consumer = text(page(lang).replace(/<details class="devmore"[\s\S]*?<\/details>\n<\/div><\/div><\/section>/, ""));
    for (const re of HOME_STRINGS[lang].banned) assert.doesNotMatch(consumer, re, `${lang}: banned ${re}`);
    assert.doesNotMatch(body, /try pro free|gratis en un archivo|kostenlos testen auf einer datei|essai gratuit/i, `${lang}: no free server trial`);
  }
});

test("the console speaks the page's language and opens on transcription; English stays byte-identical", () => {
  const en1 = voiceConsole({ voiceSite: "https://v.test" });
  const en2 = voiceConsole({ voiceSite: "https://v.test", labels: CONSOLE_LABELS_EN });
  assert.equal(en1, en2);
  const es = page("es");
  assert.match(es, /<div class="vc[^"]*" id="hero-vc" data-first="stt">/);
  assert.match(es, /<option value="spanish" selected>Español<\/option>/);
  assert.match(es, /<option value="english">Inglés<\/option>/);
  assert.match(es, /Suelta aquí una grabación/);
  const de = page("de");
  assert.match(de, /<option value="german" selected>Deutsch<\/option>/);
  assert.match(de, /noch kein Deutsch/, "German page says plainly that no voice reads German yet");
  assert.match(page("fr"), /<option value="french" selected>Français<\/option>/);
});

test("the sitemap lists each language home", () => {
  const xml = sitemapXml(ORIGIN);
  assert.match(xml, /<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9" xmlns:xhtml="http:\/\/www\.w3\.org\/1999\/xhtml">/);
  for (const home of ["/", "/es/", "/de/", "/fr/"]) {
    const entry = new RegExp(`<url><loc>${ORIGIN}${home}</loc>[^]*?</url>`).exec(xml)?.[0] ?? "";
    for (const l of L.LANGS) assert.ok(entry.includes(`<xhtml:link rel="alternate" hreflang="${l}" href="${ORIGIN}${l === "en" ? "/" : `/${l}/`}"/>`), `${home}: alternate ${l}`);
    assert.ok(entry.includes(`hreflang="x-default" href="${ORIGIN}/"`), `${home}: x-default`);
  }
  assert.doesNotMatch(new RegExp(`<url><loc>${ORIGIN}/docs</loc>[^]*?</url>`).exec(xml)?.[0] ?? "", /xhtml:link/, "pages without languages get no alternates");
});

test("the Worker: / offers a bar or follows a choice, crawlers get English, /es redirects to /es/", async () => {
  const { Miniflare, convertV4MiniflareOptions } = require("miniflare");
  const bundle = await esbuild.build({ entryPoints: ["src/index.ts"], bundle: true, format: "esm", platform: "browser", write: false,
    external: ["cloudflare:workers", "node:*"], plugins: [{ name: "url", setup(b) { b.onResolve({ filter: /^url$/ }, () => ({ path: "node:url", external: true })); } }] });
  const mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: bundle.outputFiles[0].text,
    compatibilityDate: "2026-09-01", compatibilityFlags: ["nodejs_compat"],
    durableObjects: { METRICS: { className: "Metrics", useSQLite: true } },
    bindings: { PAY_TO: "0x2074c40346ae2a90e0e4a391bcee6f16bf5277f5", NETWORK: "eip155:8453", PAYWALL: "on", TRIALS_ENABLED: "off", COLD_SINGLE_ROUTES: "0", PUBLIC_BRAND: "Glyphcall", STRIPE_READ_KEY: "x" },
    outboundService: async () => new Response("unexpected", { status: 500 }),
  }));
  const browser = { accept: "text/html", "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36" };
  const get = (path, headers) => mf.dispatchFetch(`https://glyphcall.com${path}`, { headers, redirect: "manual" });
  try {
    let r = await get("/", { ...browser, "accept-language": "es-ES,es;q=0.9" });
    assert.equal(r.status, 200);
    assert.match(r.headers.get("vary") ?? "", /Accept-Language/);
    assert.match(await r.text(), /class="gc-langbar" lang="es"/);

    r = await get("/", { ...browser, "accept-language": "es-ES", cookie: "gc_lang=fr" });
    assert.equal(r.status, 302);
    assert.equal(new URL(r.headers.get("location"), "https://glyphcall.com").pathname, "/fr/");
    assert.match(r.headers.get("cache-control") ?? "", /private/);
    await r.text();

    r = await get("/", { accept: "text/html", "user-agent": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)", "accept-language": "es", cookie: "gc_lang=es" });
    assert.equal(r.status, 200, "crawlers are never redirected");
    assert.doesNotMatch(await r.text(), /class="gc-langbar"/);

    r = await get("/es", browser);
    assert.equal(r.status, 301);
    assert.equal(new URL(r.headers.get("location"), "https://glyphcall.com").pathname, "/es/");
    await r.text();

    for (const l of L.OTHER_LANGS) {
      r = await get(`/${l}/`, browser);
      assert.equal(r.status, 200, `/${l}/`);
      assert.match(await r.text(), new RegExp(`<html lang="${l}">`));
    }
  } finally {
    await mf.dispose();
  }
});

test("the voice showcase speaks the page's language: button labels, card tags and the note after a tap", () => {
  const en = landingPage("Glyphcall", ORIGIN, true);
  assert.match(en, /note\.textContent=b\.dataset\.voiceName\+" is ready below\. Type your words and press Play\."/);
  assert.match(en, /b\.innerHTML="&#9632;&nbsp; Stop"/);
  const es = page("es");
  assert.match(es, /note\.textContent="Has elegido a "\+b\.dataset\.voiceName\+"\. Ve a Texto a voz/);
  assert.match(es, /b\.innerHTML="&#9632;&nbsp; Parar"/);
  assert.match(es, /<small>mujer, inglés británico<\/small>/);
  assert.match(page("de"), /note\.textContent=b\.dataset\.voiceName\+" ist ausgewählt\./);
  assert.match(page("fr"), /<h2 class="own" id="make-own">À vous de jouer<\/h2>/);
});

test("/transcribe-pro search titles and descriptions fit in every language (step B drafts)", async () => {
  const { TRANSCRIBE_PRO_META } = await loadTypeScript(require.resolve("../src/lib/i18n/transcribe-pro-strings.ts"));
  for (const lang of L.LANGS) {
    const m = TRANSCRIBE_PRO_META[lang];
    for (const [h, p] of [[60, "$3"], [999, "$19"]]) {
      const t = m.title("Glyphcall", h, p), d = m.description(h, p);
      assert.ok(t.length <= 60, `${lang} title ${t.length}: ${t}`);
      assert.ok(d.length <= 160, `${lang} description ${d.length}: ${d}`);
      if (lang !== "en") for (const re of HOME_STRINGS[lang].banned) assert.doesNotMatch(`${t} ${d}`, re, `${lang}: banned ${re}`);
    }
  }
});

test("the language cookie is a preference only and the privacy page says so", async () => {
  const { PRIVACY_HTML } = await loadTypeScript(require.resolve("../src/lib/legal.ts"));
  assert.match(PRIVACY_HTML, /<code>gc_lang<\/code>/, "the privacy page names the cookie");
  assert.match(PRIVACY_HTML, /for one year/, "and how long it lasts");
  assert.match(PRIVACY_HTML, /preference only/);
  assert.doesNotMatch(PRIVACY_HTML, /The pages set no cookies\./, "no longer claims there are no cookies at all");
  // The script sets exactly gc_lang with the same lifetime the page states, and only on a tap (a click handler).
  assert.match(L.LANGUAGE_SCRIPT, /addEventListener\("click"/);
  assert.match(L.LANGUAGE_SCRIPT, /document\.cookie="gc_lang="\+a\.getAttribute\("data-gc-lang"\)\+";path=\/;max-age=31536000;samesite=lax"/);
  assert.equal((L.LANGUAGE_SCRIPT.match(/document\.cookie/g) ?? []).length, 1, "no other cookie");
  // Crawlers: the English page stays whole and reachable; no bar, no redirect, whatever the cookie or language.
  const en = landingPage("Glyphcall", ORIGIN, true);
  for (const ua of ["Googlebot/2.1 (+http://www.google.com/bot.html)", "Mozilla/5.0 (compatible; bingbot/2.0)"]) {
    assert.deepEqual(L.decideHome({ userAgent: ua, acceptLanguage: "de-DE", cookie: "gc_lang=de", country: "DE" }), {});
  }
  const offered = L.withLanguages(en, ORIGIN, "en", "es");
  assert.ok(offered.includes(en.slice(en.indexOf("<main>"), en.indexOf("</main>"))), "the bar adds a strip; the English page under it is unchanged");
});
