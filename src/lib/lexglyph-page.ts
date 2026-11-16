// LexGlyph (owner named it 16 Nov 2026): the people's face of our EU law index, at /lexglyph on glyphcall.com.
// Why: Exa is an API for developers (its playground needs an account) and returns pages about the law. LexGlyph is a
// plain search page anyone can use without an account, in their own language, that answers in plain words and shows
// the articles the answer rests on, each linked to the official EUR-Lex text in the visitor's own language.
//
// Rules for this page:
// - Works without JavaScript (server-rendered GET form). Scripts only add: copy citation, copy link, read aloud (the
//   browser's own speech, nothing downloaded), and "/" to jump to the search box.
// - Accessible: one h1, labelled controls, a skip link, visible focus, results announced (aria-live), lang attributes on
//   every piece of text not in the page language, contrast >= 7:1 in both themes, 44-48 px targets, no sideways scroll.
// - Interface in six languages (lexglyph-i18n.ts), chosen by ?lang= or the browser; legal text is never translated by
//   us: the official EUR-Lex text in the visitor's language is linked instead.
// - The plain-words answer is on by default; one click turns it off.
// - Free for people within LEXGLYPH_PER_VISITOR searches a day per visitor (hashed address, never stored as is) and
//   LEXGLYPH_DAILY_CAP in total; software uses the paid API (/law/search) like every other tool.
// - Every claim on the page is measured (benchmarks page, multilingual run of 16 Nov 2026) or stated as a limit.
import { SERVICE_NAME } from "../endpoints";
import { STYLE } from "./compare-pages";
import { COMPANY_FOOTER } from "./legal";
import { publicBrand } from "./public-brand";
import { takeDailyBudget } from "./daily-cap";
import { HttpError, type Env } from "./env";
import { LAW_ACTS, actOf, answerFromArticles, eurlexIn, lawAnswer, lawDeps, lawSearch, questionLang } from "../routes/law-search";
import { STRINGS, UI_LANGS, UI_LANG_NAMES, languageName, pickUiLang, type UiLang } from "./lexglyph-i18n";

export const LEXGLYPH_PATH = "/lexglyph";
export const LEXGLYPH_PER_VISITOR = 20;
export const LEXGLYPH_DAILY_CAP = 2000;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const jsonLd = (value: unknown) => JSON.stringify(value).replace(/</g, "\\u003c");

/** Example questions shown as links, in several EU languages (each measured to find its article, 16 Nov 2026). */
export const EXAMPLES: readonly [lang: string, label: string, q: string][] = [
  ["en", "English", "when must a company appoint a data protection officer"],
  ["sv", "Svenska", "vilka AI-system räknas som högrisk"],
  ["de", "Deutsch", "welche KI-Praktiken sind verboten"],
  ["fr", "Français", "mesures de gestion des risques en matière de cybersécurité"],
  ["es", "Español", "autenticación reforzada del cliente para pagos en línea"],
  ["pl", "Polski", "zgłaszanie poważnych incydentów związanych z ICT"],
];

type LawResult = ReturnType<typeof lawAnswer>["results"][number];
export interface LexState {
  ui?: UiLang;
  q?: string;
  act?: string;
  explain?: boolean;
  results?: LawResult[];
  answer?: string | null;
  /** The question's language: EUR-Lex code (SV, DE…) for the official-text links and BCP 47 tag for reading aloud. */
  qLang?: { eurlex: string; tag: string };
  error?: string;
  left?: number | null;
}

/** "GDPR, Article 37" + heading + act + version: the line people paste into a memo or e-mail. */
export const citationLine = (r: Pick<LawResult, "citation" | "heading" | "act" | "url" | "version">) =>
  `${r.citation}${r.heading ? ` (${r.heading})` : ""}, ${r.act} (${r.version}). ${r.url}`;

const PAGE_STYLE = `
.skip{position:absolute;left:-999px}.skip:focus{left:16px;top:16px;background:var(--bg);padding:8px;z-index:9}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
.langs{display:flex;flex-wrap:wrap;gap:4px 12px;justify-content:flex-end;font-size:.95rem;margin:0 0 .5rem;padding:0;list-style:none}
.langs a{display:inline-block;min-height:44px;line-height:44px;padding:0 4px}.langs a[aria-current]{font-weight:700;text-decoration:none}
.lex form{display:flex;flex-wrap:wrap;gap:8px;margin:1.2rem 0}
.lex input[type=search]{flex:1 1 22rem;min-height:48px;font-size:1.1rem;padding:0 14px;border:2px solid var(--line);border-radius:10px;background:var(--bg);color:var(--fg)}
.lex select{min-height:48px;font-size:1rem;padding:0 10px;border:2px solid var(--line);border-radius:10px;background:var(--bg);color:var(--fg);max-width:100%}
.lex button.tool{background:var(--bg);color:var(--fg);border:2px solid var(--line);min-height:44px;padding:0 14px;border-radius:10px;font-size:.95rem;cursor:pointer}
.lex button,.lex .btn{min-height:48px;padding:0 18px;font-size:1rem;border-radius:10px;cursor:pointer}
.lex label.explain{display:flex;align-items:center;gap:8px;min-height:48px}
.lex input[type=checkbox]{width:22px;height:22px}
.lex :focus-visible{outline:3px solid var(--accent);outline-offset:2px}
.chips{display:flex;flex-wrap:wrap;gap:8px;padding:0;list-style:none}
.chips a{display:inline-block;min-height:44px;line-height:44px;padding:0 12px;border:1px solid var(--line);border-radius:22px;text-decoration:none}
.result{border:1px solid var(--line);border-radius:12px;padding:16px;margin:12px 0;background:var(--card)}
.result h3{margin:0 0 4px}.result .meta{color:var(--muted);font-size:.95rem;margin:0 0 8px}
.result .meta a{display:inline-block;min-height:32px;line-height:32px}
.result details{margin-top:8px}.result summary{cursor:pointer;min-height:44px;line-height:44px}
.result pre{white-space:pre-wrap;font-family:inherit;margin:0}
.tools{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}
.answer{border-left:4px solid var(--accent);padding:12px 16px;background:var(--card);border-radius:8px}
.answer .text{white-space:pre-line}
.note{color:var(--muted);font-size:.95rem}
@media (prefers-color-scheme: light){.lex .note,.lex .meta,.lex .note span{color:#3f444b}.lex a,.langs a,a.skip{color:#0842a0}.lex button.primary{background:#0842a0;color:#fff;border-color:#0842a0}}
`;

export function lexglyphPage(origin: string, brand: string, s: LexState = {}): string {
  const ui = s.ui ?? "en";
  const t = STRINGS[ui];
  const url = `${origin}${LEXGLYPH_PATH}`;
  const title = s.q ? `${s.q.slice(0, 60)} | LexGlyph` : `LexGlyph: ${t.lead(LAW_ACTS.length).split(". ")[0]}`;
  const description = t.lead(LAW_ACTS.length);
  const actOptions = [`<option value="">${esc(t.allActs(LAW_ACTS.length))}</option>`, ...LAW_ACTS.map((a) => `<option value="${esc(a.short)}"${s.act === a.short ? " selected" : ""} lang="en">${esc(a.short === a.name ? a.name : `${a.short}: ${a.name}`)}</option>`)].join("");
  // The official text in the asker's language: the question's language, else the interface language, unless English.
  const officialCode = s.qLang && s.qLang.eurlex !== "EN" ? s.qLang.eurlex : ui !== "en" ? ui.toUpperCase() : null;
  const keep = (lang: UiLang) => `${LEXGLYPH_PATH}?${new URLSearchParams({ lang, ...(s.q ? { q: s.q } : {}), ...(s.act ? { act: s.act } : {}), ...(s.q && !s.explain ? { explain: "0" } : {}) })}`;
  const results = s.results ?? [];
  const resultHtml = results.map((r, i) => `<article class="result" aria-labelledby="r${i}">
<h3 id="r${i}" lang="en">${esc(r.citation)}${r.heading ? `: ${esc(r.heading)}` : ""}</h3>
<p class="meta"><span lang="en">${esc(r.act)} · ${esc(r.version)}</span> · ${officialCode ? `<a href="${esc(eurlexIn(r.url, officialCode))}" hreflang="${officialCode.toLowerCase()}" rel="noopener">${esc(t.officialIn(languageName(officialCode.toLowerCase(), ui)))}</a> · ` : ""}<a href="${esc(r.url)}" hreflang="en" rel="noopener">${esc(t.officialEn)}</a></p>
<p lang="en">${esc(r.text.slice(0, 420))}${r.text.length > 420 ? "…" : ""}</p>
<details><summary>${esc(t.readWhole(r.kind === "recital"))}</summary><pre lang="en">${esc(r.text)}</pre></details>
<p class="note" lang="en"><span class="cite">${esc(citationLine(r))}</span></p>
<div class="tools"><button type="button" class="tool js copy" data-copy="${esc(citationLine(r))}" hidden>${esc(t.copyCite)}</button><button type="button" class="tool js speak" data-lang="en" data-speak="${esc(`${r.citation}. ${r.heading ?? ""}. ${r.text.slice(0, 3000)}`)}" hidden>${esc(t.readAloud)}</button></div>
</article>`).join("\n");
  const status = s.error
    ? `<p role="alert">${esc(s.error)}</p>`
    : s.q
      ? `<p>${results.length ? esc(t.found(results.length)) : esc(t.none)}${s.left !== null && s.left !== undefined ? ` · ${esc(t.left(s.left))}` : ""} <button type="button" class="tool js share" hidden>${esc(t.share)}</button></p>`
      : "";
  const answerLang = s.qLang?.tag ?? ui;
  const body = `<a class="skip" href="#results">${esc(t.skip)}</a>
<nav aria-label="${esc(t.language)}"><ul class="langs">${UI_LANGS.map((l) => `<li><a href="${esc(keep(l))}" lang="${l}" hreflang="${l}"${l === ui ? ' aria-current="page"' : ""}>${UI_LANG_NAMES[l]}</a></li>`).join("")}</ul></nav>
<div class="lex">
<h1>LexGlyph</h1>
<p class="lead">${esc(t.lead(LAW_ACTS.length))}</p>
<form method="get" action="${LEXGLYPH_PATH}" role="search">
<input type="hidden" name="lang" value="${ui}">
<label for="q" class="sr">${esc(t.question)}</label>
<input id="q" name="q" type="search" required maxlength="400" value="${esc(s.q ?? "")}" placeholder="${esc(t.placeholder)}" autocomplete="off" aria-describedby="qhelp" aria-keyshortcuts="/">
<label for="act" class="sr">${esc(t.act)}</label>
<select id="act" name="act">${actOptions}</select>
<input type="hidden" name="explain" value="0">
<label class="explain"><input type="checkbox" name="explain" value="1"${s.q && !s.explain ? "" : " checked"}> ${esc(t.explain)}</label>
<button type="submit" class="btn primary">${esc(t.search)}</button>
</form>
<p id="qhelp" class="note">${esc(t.help)} ${esc(t.notAdvice)} <span class="js" hidden>${esc(t.shortcut)}.</span></p>
${s.q ? "" : `<h2>${esc(t.tryOne)}</h2><ul class="chips">${EXAMPLES.map(([lang, label, q]) => `<li><a lang="${lang}" href="${LEXGLYPH_PATH}?${new URLSearchParams({ lang: ui, q })}">${esc(q)} <span class="note">(${esc(label)})</span></a></li>`).join("")}</ul>`}
<section id="results" aria-live="polite" tabindex="-1">
${status}
${s.answer ? `<div class="answer"><h2>${esc(t.plain)}</h2><p class="text" lang="${answerLang}">${esc(s.answer)}</p><div class="tools"><button type="button" class="tool js speak" data-lang="${answerLang}" data-speak="${esc(s.answer.replace(/\[\d+[a-z()]*\]/g, ""))}" hidden>${esc(t.readAloud)}</button></div><p class="note">${esc(t.aiNote)}</p></div>` : ""}
${resultHtml}
</section>
<h2>${esc(t.why)}</h2>
<ul>${t.whyItems(LAW_ACTS.length, LEXGLYPH_PER_VISITOR).map((x) => `<li>${x}</li>`).join("")}</ul>
<section lang="en">
<h2>For developers and AI agents</h2>
<ul>
<li>API: <code>GET ${esc(origin)}/law/search?q=…</code>, $0.005 a search, pay per call or with a key. <a href="/eu-law-search-api">API details and plans</a>.</li>
<li>Already on Exa's SDK? Change one line: <code>Exa(api_key, base_url="${esc(origin)}/v1")</code> and send <code>category="law"</code>.</li>
<li>MCP: add <code>${esc(origin)}/mcp</code> to your AI assistant and ask it EU-law questions.</li>
</ul>
</section>
</div>
<script>(()=>{const say=(b,txt)=>{b.textContent=txt;setTimeout(()=>{b.textContent=b.dataset.label},2000)};
for(const el of document.querySelectorAll(".js")){if(el.classList.contains("speak")&&!("speechSynthesis"in window))continue;el.hidden=false;el.dataset.label=el.textContent;}
for(const b of document.querySelectorAll("button.copy"))b.addEventListener("click",async()=>{try{await navigator.clipboard.writeText(b.dataset.copy);say(b,${JSON.stringify(t.copied)})}catch{say(b,${JSON.stringify(t.copyFail)})}});
for(const b of document.querySelectorAll("button.share"))b.addEventListener("click",async()=>{try{await navigator.clipboard.writeText(location.href);say(b,${JSON.stringify(t.shareCopied)})}catch{say(b,${JSON.stringify(t.copyFail)})}});
let speaking=null;for(const b of document.querySelectorAll("button.speak"))b.addEventListener("click",()=>{speechSynthesis.cancel();if(speaking===b){speaking=null;b.textContent=b.dataset.label;return}
for(const o of document.querySelectorAll("button.speak"))o.textContent=o.dataset.label;const u=new SpeechSynthesisUtterance(b.dataset.speak);u.lang=b.dataset.lang;u.onend=()=>{b.textContent=b.dataset.label;speaking=null};speaking=b;b.textContent=${JSON.stringify(t.stop)};speechSynthesis.speak(u)});
document.addEventListener("keydown",e=>{if(e.key==="/"&&!/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)){e.preventDefault();document.getElementById("q").focus()}});
${s.q ? 'document.getElementById("results").focus();' : ""}})();</script>`;
  const ld = [{
    "@context": "https://schema.org", "@type": "WebApplication", name: "LexGlyph", url, description,
    applicationCategory: "LegalService", operatingSystem: "Any", isAccessibleForFree: true, inLanguage: [...UI_LANGS],
    accessibilityFeature: ["readingOrder", "structuralNavigation", "highContrastDisplay", "ttsMarkup"], accessMode: ["textual", "auditory"],
    offers: { "@type": "Offer", price: "0", priceCurrency: "EUR" }, publisher: { "@type": "Organization", name: brand },
  }];
  return `<!doctype html>
<html lang="${ui}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(ui === "en" ? url : `${url}?lang=${ui}`)}">
${UI_LANGS.map((l) => `<link rel="alternate" hreflang="${l}" href="${esc(l === "en" ? url : `${url}?lang=${l}`)}">`).join("")}
<meta property="og:type" content="website"><meta property="og:title" content="LexGlyph"><meta property="og:description" content="${esc(description)}"><meta property="og:url" content="${esc(url)}">
${s.q ? '<meta name="robots" content="noindex">' : ""}
<link rel="icon" href="/favicon.ico">
${ld.map((x) => `<script type="application/ld+json">${jsonLd(x)}</script>`).join("\n")}
<style>${STYLE}${PAGE_STYLE}</style></head><body><main>
${body}
<footer>LexGlyph · ${esc(brand)}. <span lang="en">Legal texts: © European Union, EUR-Lex, reused under the Commission's reuse policy.</span> ${COMPANY_FOOTER}</footer>
</main></body></html>`;
}

async function visitorKey(ip: string | undefined, day: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`lexglyph:${ip ?? "unknown"}`));
  return `lexglyph:${day}:${[...new Uint8Array(digest)].slice(0, 12).map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

/** The page for a GET: no question renders the start page; a question runs the search within the free allowance. */
export async function lexglyphHtml(env: Env, origin: string, params: URLSearchParams, ip: string | undefined, acceptLanguage?: string): Promise<string> {
  const brand = publicBrand(env, SERVICE_NAME);
  const ui = pickUiLang(params.get("lang"), acceptLanguage);
  const t = STRINGS[ui];
  const q = (params.get("q") ?? "").trim().slice(0, 400);
  const actRaw = (params.get("act") ?? "").trim();
  // The checkbox sends explain=1 after a hidden explain=0, so the last value counts; no value at all means on.
  const ex = params.getAll("explain");
  const explain = ex.length ? ex[ex.length - 1] === "1" : true;
  if (!q) return lexglyphPage(origin, brand, { ui, act: actRaw || undefined });
  let act;
  try { act = actRaw ? actOf(actRaw) : undefined; } catch { return lexglyphPage(origin, brand, { ui, q, explain, error: t.notAct }); }
  const ql = questionLang(q);
  const qLang = { eurlex: ql.eurlex, tag: ql.eurlex.toLowerCase() };
  const day = new Date().toISOString().slice(0, 10);
  const key = await visitorKey(ip, day);
  const used = env.TRIALS ? Number(await env.TRIALS.get(key)) || 0 : 0;
  if (used >= LEXGLYPH_PER_VISITOR) return lexglyphPage(origin, brand, { ui, q, act: act?.short, explain, qLang, error: t.limit(LEXGLYPH_PER_VISITOR), left: 0 });
  try {
    await takeDailyBudget(env, "lexglyph", env.LEXGLYPH_DAILY_CAP, LEXGLYPH_DAILY_CAP, "LexGlyph");
    const found = await lawSearch(q, { act, count: 5 }, lawDeps(env));
    const out = lawAnswer(q, act, undefined, 5, found);
    const answer = explain && out.results.length ? (await answerFromArticles(env, q, out.results, { plain: true }).catch(() => ({ answer: null }))).answer : null;
    await env.TRIALS?.put(key, String(used + 1), { expirationTtl: 2 * 86400 }).catch(() => {});
    return lexglyphPage(origin, brand, { ui, q, act: act?.short, explain, qLang, results: out.results, answer, left: env.TRIALS ? LEXGLYPH_PER_VISITOR - used - 1 : null });
  } catch (e) {
    const busy = e instanceof HttpError && (e.status === 503 || e.status === 502);
    return lexglyphPage(origin, brand, { ui, q, act: act?.short, explain, qLang, error: busy ? t.busy : t.failed });
  }
}
