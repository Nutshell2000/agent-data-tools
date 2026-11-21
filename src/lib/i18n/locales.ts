// The product site in the visitor's language (owner, 21 Nov 2026: "we need to have our site display in the language in
// the country the user connects from"). Plan and the data behind the language choice: the operator's notes, i18n plan.
//
// Rules this module keeps:
// - One URL per language: "/" is English (and x-default), "/es/", "/de/", "/fr/" are the others. Every version names all
//   the others with hreflang links, so search engines show each person the right one.
// - Nobody is redirected on a guess. A person whose browser asks for Spanish first sees a one-tap bar on "/" ("¿Ver
//   esta página en español?"); only an explicit choice (a tap in the bar or the switcher, kept in the gc_lang cookie)
//   sends "/" on to that language next time. Crawlers keep no cookies and never see the bar.
// - Accept-Language decides; the visitor's country (Cloudflare's request.cf.country) is only a tie-breaker when the
//   browser lists English first and the country's language after it. Country alone never changes anything.
// - Prices stay in US dollars in every language.
import { aiCrawlerName } from "../ai-crawlers";
import { CONSOLE_LANGUAGES } from "../voice-console";

export const LANGS = ["en", "es", "de", "fr"] as const;
export type Lang = (typeof LANGS)[number];
export type OtherLang = Exclude<Lang, "en">;
export const OTHER_LANGS: readonly OtherLang[] = ["es", "de", "fr"];
export const LANG_COOKIE = "gc_lang";

const isLang = (x: string | undefined): x is Lang => (LANGS as readonly string[]).includes(x ?? "");
export const isOtherLang = (x: string | undefined): x is OtherLang => (OTHER_LANGS as readonly string[]).includes(x ?? "");

/** Each language's own name, its Open Graph locale, and the bar that offers it on the English page. */
export const LANG_INFO: Record<Lang, { name: string; label: string; ogLocale: string; ask: string; yes: string; stay: string }> = {
  en: { name: "English", label: "Language", ogLocale: "en_US", ask: "", yes: "", stay: "" },
  es: { name: "Español", label: "Idioma", ogLocale: "es_ES", ask: "¿Prefieres ver esta página en español?", yes: "Ver en español", stay: "Seguir en inglés" },
  de: { name: "Deutsch", label: "Sprache", ogLocale: "de_DE", ask: "Diese Seite lieber auf Deutsch lesen?", yes: "Auf Deutsch ansehen", stay: "Auf Englisch bleiben" },
  fr: { name: "Français", label: "Langue", ogLocale: "fr_FR", ask: "Voulez-vous voir cette page en français ?", yes: "Voir en français", stay: "Rester en anglais" },
};

/** Where the front page lives in each language. */
export const homePath = (lang: Lang) => (lang === "en" ? "/" : `/${lang}/`);

/** Countries whose main language is one of ours; used only as a tie-breaker (see the header of this file). */
const COUNTRY_LANG: Readonly<Record<string, OtherLang>> = {
  DE: "de", AT: "de", CH: "de", LI: "de",
  ES: "es", MX: "es", AR: "es", CO: "es", CL: "es", PE: "es", VE: "es", EC: "es", GT: "es", CU: "es", BO: "es", DO: "es",
  HN: "es", PY: "es", SV: "es", NI: "es", CR: "es", PA: "es", UY: "es", PR: "es",
  FR: "fr", BE: "fr", MC: "fr", LU: "fr", SN: "fr", CI: "fr",
};

/** Accept-Language as a list of base languages, most wanted first (q=0 dropped, order kept between equal weights). */
export function acceptedLanguages(header: string | undefined): string[] {
  if (!header) return [];
  const items = header.split(",").slice(0, 20).map((part, i) => {
    const [tag, ...params] = part.trim().split(";");
    const q = params.map((p) => /^\s*q=([0-9.]+)\s*$/i.exec(p)?.[1]).find(Boolean);
    return { base: tag.trim().toLowerCase().split("-")[0], q: q === undefined ? 1 : Number(q), i };
  }).filter((x) => /^[a-z]{2,3}$/.test(x.base) && x.q > 0);
  items.sort((a, b) => b.q - a.q || a.i - b.i);
  return [...new Set(items.map((x) => x.base))];
}

const BOT_UA = /bot\b|bot\/|crawl|spider|slurp|mediapartners|bingpreview|facebookexternalhit|embedly|preview|lighthouse|headless|curl\/|wget|python|node-fetch|go-http|java\//i;
/** Search and AI crawlers, link previews and scripts: they get each language at its own URL and nothing else. */
export const isCrawler = (userAgent: string | undefined) => !userAgent || BOT_UA.test(userAgent) || Boolean(aiCrawlerName(userAgent));

/** The gc_lang cookie, if it holds one of our languages. */
export function chosenLanguage(cookieHeader: string | undefined): Lang | undefined {
  const m = new RegExp(`(?:^|;\\s*)${LANG_COOKIE}=([a-z]{2})(?:;|$)`).exec(cookieHeader ?? "");
  return isLang(m?.[1]) ? m![1] as Lang : undefined;
}

/**
 * Which language to offer a visitor of the English page, or undefined for none. The first of our languages in
 * Accept-Language wins; when that is English, the country's language is offered only if the browser lists it too.
 */
export function suggestedLanguage(acceptLanguage: string | undefined, country: string | undefined): OtherLang | undefined {
  const wanted = acceptedLanguages(acceptLanguage);
  const first = wanted.find((l) => isLang(l));
  if (isOtherLang(first)) return first;
  if (first !== "en") return undefined;
  const hint = country ? COUNTRY_LANG[country.toUpperCase()] : undefined;
  return hint && wanted.includes(hint) ? hint : undefined;
}

export type HomeDecision = { redirect: OtherLang } | { offer?: OtherLang };
/** What "/" does for this request: send an explicit choice on to its page, offer a language, or nothing. */
export function decideHome(h: { userAgent?: string; acceptLanguage?: string; cookie?: string; country?: string }): HomeDecision {
  if (isCrawler(h.userAgent)) return {};
  const chosen = chosenLanguage(h.cookie);
  if (isOtherLang(chosen)) return { redirect: chosen };
  if (chosen === "en") return {};
  return { offer: suggestedLanguage(h.acceptLanguage, h.country) };
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** hreflang links for every language (and x-default to the English page) plus the Open Graph locales. */
export function languageHeadLinks(origin: string, current: Lang, pathOf: (lang: Lang) => string = homePath): string {
  return LANGS.map((l) => `<link rel="alternate" hreflang="${l}" href="${esc(origin + pathOf(l))}">`).join("")
    + `<link rel="alternate" hreflang="x-default" href="${esc(origin + pathOf("en"))}">`
    + `<meta property="og:locale" content="${LANG_INFO[current].ogLocale}">`
    + LANGS.filter((l) => l !== current).map((l) => `<meta property="og:locale:alternate" content="${LANG_INFO[l].ogLocale}">`).join("");
}

/** The language links (header picker and footer row). Plain links that work without script; a tap is remembered. */
export function languageLinks(current: Lang, pathOf: (lang: Lang) => string = homePath): string {
  return LANGS.map((l) => `<a href="${esc(pathOf(l))}" hreflang="${l}" lang="${l}" data-gc-lang="${l}"${l === current ? ' aria-current="true"' : ""}>${esc(LANG_INFO[l].name)}</a>`).join("");
}

/** The compact picker for the header: a <details> menu, no script needed to open it. */
export function languagePicker(current: Lang, label: string, pathOf: (lang: Lang) => string = homePath): string {
  return `<details class="gc-langpick"><summary aria-label="${esc(label)}">${current.toUpperCase()}</summary><div>${languageLinks(current, pathOf)}</div></details>`;
}

/** The footer row. */
export function languageRow(current: Lang, label: string, pathOf: (lang: Lang) => string = homePath): string {
  return `<nav class="gc-langrow" aria-label="${esc(label)}">${languageLinks(current, pathOf)}</nav>`;
}

/** The one-tap bar on the English page, written in the offered language. */
export function languageBar(lang: OtherLang, pathOf: (lang: Lang) => string = homePath): string {
  const i = LANG_INFO[lang];
  return `<div class="gc-langbar" lang="${lang}" role="region" aria-label="${esc(i.name)}"><span>${esc(i.ask)}</span><a class="btn sm primary" href="${esc(pathOf(lang))}" hreflang="${lang}" data-gc-lang="${lang}">${esc(i.yes)}</a><button type="button" data-gc-lang="en" aria-label="${esc(i.stay)}" title="${esc(i.stay)}">&times;</button></div>`;
}

/** Remembers a tap on any [data-gc-lang] link or button for a year; the close button also hides the bar. */
export const LANGUAGE_SCRIPT = `<script data-gc-lang-js>document.addEventListener("click",(e)=>{const a=e.target&&e.target.closest&&e.target.closest("[data-gc-lang]");if(!a)return;try{document.cookie="${LANG_COOKIE}="+a.getAttribute("data-gc-lang")+";path=/;max-age=31536000;samesite=lax"+(location.protocol==="https:"?";secure":"");}catch(_){}if(a.tagName==="BUTTON"){const b=a.closest(".gc-langbar");if(b)b.remove();}});</script>`;

export const LANGUAGE_CSS = `.gc-langbar{position:relative;z-index:22;display:flex;flex-wrap:wrap;gap:8px 12px;align-items:center;justify-content:center;padding:8px 44px 8px 16px;background:#16161d;color:#fff;font-size:.93rem;text-align:center}
.gc-langbar .btn{background:#fff;color:#16161d;border-color:#fff}.gc-langbar button{position:absolute;right:6px;top:50%;transform:translateY(-50%);width:44px;height:44px;border:0;background:none;color:#fff;font-size:1.4rem;line-height:1;cursor:pointer}
.gc-langpick{position:relative}.gc-langpick>summary{list-style:none;cursor:pointer;display:inline-flex;align-items:center;min-height:44px;padding:0 10px;border-radius:999px;border:1px solid var(--line);font-size:.85rem;font-weight:700;color:var(--fg)}
.gc-langpick>summary::-webkit-details-marker{display:none}.gc-langpick>div{position:absolute;right:0;top:calc(100% + 6px);z-index:40;display:grid;min-width:150px;padding:6px;border-radius:14px;border:1px solid var(--line);background:#fff;box-shadow:0 18px 40px -18px rgba(22,22,29,.3)}
.gc-langpick>div a{padding:10px 12px;border-radius:10px;color:var(--fg)}.gc-langpick>div a[aria-current]{font-weight:700;background:rgba(22,22,29,.05)}
.gc-langpick>summary::after{content:none}
.gc-langrow{display:flex;flex-wrap:wrap;gap:6px 14px;margin:14px 0 0}.gc-langrow a{color:var(--muted)}.gc-langrow a[aria-current]{color:var(--fg);font-weight:700}
.gc-menulangs{display:flex;flex-wrap:wrap;gap:4px 12px;padding-top:8px;margin-top:4px;border-top:1px solid var(--line)}.gc-menulangs a[aria-current]{font-weight:700}
@media (max-width:720px){.gc-langpick{display:none}}
@media (max-width:560px){.gc-langbar{padding:4px 48px 4px 12px;font-size:.85rem}.gc-langbar span{display:none}.gc-langbar .btn{min-height:40px;padding:6px 16px}}`;

/** The languages inside the phone menu (the header picker is hidden on phones to keep Play and the menu in view). */
export const menuLanguages = (current: Lang, pathOf: (lang: Lang) => string = homePath) => `<span class="gc-menulangs">${languageLinks(current, pathOf)}</span>`;

/**
 * Adds the language parts to a front page without changing its copy: hreflang links and the picker's CSS in the head,
 * the bar (when one is offered) at the top of the body, the picker before the phone menu and the languages inside it,
 * the language row in the footer and the small script that remembers a tap. Each insertion point is checked by
 * tests/i18n.test.cjs, so a redesign that moves them fails a test instead of silently losing the switcher.
 */
export function withLanguages(html: string, origin: string, current: Lang = "en", offer?: OtherLang): string {
  const label = LANG_INFO[current].label;
  return html
    .replace("</head>", `${languageHeadLinks(origin, current)}<style>${LANGUAGE_CSS}</style></head>`)
    .replace(/<body[^>]*>/, (body) => `${body}${offer ? languageBar(offer) : ""}`)
    .replace(/<details class="menu">(<summary[^>]*>[\s\S]*?<\/summary><div>)/, (_m, open) => `${languagePicker(current, label)}<details class="menu">${open}${menuLanguages(current)}`)
    .replace(`<p class="legal">`, `${languageRow(current, label)}<p class="legal">`)
    .replace("</body>", `${LANGUAGE_SCRIPT}</body>`);
}

/** The voice site's own page in each language, where one exists (Cloudflare Pages project glyphcall-voice), and the
 * name the transcription model uses for the language. German has no voices yet, so its text to speech link is English. */
export const VOICE_PAGES: Record<OtherLang, { tts: string; stt: string; srt: string; whisper: string; voice?: string }> = {
  es: { tts: "/texto-a-voz", stt: "/transcribir-audio", srt: "/generador-de-subtitulos", whisper: "spanish", voice: "ef_dora" },
  de: { tts: "/text-to-speech", stt: "/transkribieren", srt: "/untertitel-generator", whisper: "german" },
  fr: { tts: "/synthese-vocale", stt: "/transcrire-audio", srt: "/generateur-sous-titres", whisper: "french", voice: "ff_siwis" },
};

const WHISPER_ISO: Readonly<Record<string, string>> = {
  english: "en", spanish: "es", french: "fr", german: "de", italian: "it", portuguese: "pt", dutch: "nl", swedish: "sv", norwegian: "nb", danish: "da",
  finnish: "fi", polish: "pl", turkish: "tr", russian: "ru", ukrainian: "uk", arabic: "ar", hindi: "hi", japanese: "ja", korean: "ko", chinese: "zh",
};
/** The console's spoken-language names in `lang` ("Inglés", "Englisch" …), from the runtime's own data; English as fallback. */
export function consoleLanguageNames(lang: OtherLang): Record<string, string> {
  let names: Intl.DisplayNames | undefined;
  try { names = new Intl.DisplayNames([lang], { type: "language" }); } catch { names = undefined; }
  const out: Record<string, string> = {};
  for (const [value, label] of CONSOLE_LANGUAGES) {
    const iso = Object.hasOwn(WHISPER_ISO, value) ? WHISPER_ISO[value] : "";
    const n = (iso && names?.of(iso)) || label;
    out[value] = n.charAt(0).toLocaleUpperCase(lang) + n.slice(1);
  }
  return out;
}
