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
// - The free page costs nothing metered (21 Nov 2026, the owner's rule): its search is keyword-only, D1 full-text
//   search with no model call and no Vectorize query (lawKeywordDeps, seKeywordDeps). So it has no plain-words
//   answer, no search by meaning and no translation of the question; those are in the paid API (/law/search with
//   answer=true), which the page names. The renderer still knows how to show an answer; this page never gives it one.
// - Free for people within LEXGLYPH_PER_VISITOR searches a day per visitor (hashed address, never stored as is) and
//   LEXGLYPH_DAILY_CAP in total; software uses the paid API (/law/search) like every other tool.
// - Every claim on the page is measured (benchmarks page, multilingual run of 16 Nov 2026) or stated as a limit.
import { SERVICE_NAME } from "../endpoints";
import { STYLE } from "./page-style";
import { COMPANY_FOOTER } from "./legal";
import { publicBrand } from "./public-brand";
import { takeDailyBudget } from "./daily-cap";
import { HttpError, type Env } from "./env";
import { INDEXED_LANGS, LAW_ACTS, actOf, eurlexIn, inLanguage, lawAnswer, lawKeywordDeps, lawSearch, questionLang } from "../routes/law-search";
import { MORE, STRINGS, UI_LANGS, UI_LANG_NAMES, languageName, pickUiLang, type UiLang } from "./lexglyph-i18n";
import type { GroundedClaim } from "./law-grounding";
import { caseParaUrl, caseTitle, casesForArticle, seKeywordDeps, seLabel, seSearch, swedishImplementations, type CaseRef, type SeSection } from "../routes/law-layers";

export const LEXGLYPH_PATH = "/lexglyph";
export const LEXGLYPH_SECURITY_PATH = "/lexglyph/security";
export const LEXGLYPH_VERSION_PATH = "/lexglyph/version";
export const LEXGLYPH_EXPORT_PATH = "/lexglyph/export";
export const LEXGLYPH_PER_VISITOR = 20;
export const LEXGLYPH_DAILY_CAP = 500;
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
  /** The answer's sentences, each with the quote it rests on (checked against the text) and a pinpoint citation. */
  claims?: GroundedClaim[];
  /** False when the model gave nothing that passed the quote check: the provisions are shown without a summary. */
  grounded?: boolean;
  /** Phase B (18 Nov 2026): judgments per result (same order), Swedish statutes implementing the acts found, Swedish sections. */
  cases?: CaseRef[][];
  seImpl?: { short: string; sfs: string; name: string; url: string }[];
  se?: SeSection[];
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
.answer h3{font-size:1rem;margin:1rem 0 .4rem}
.quotes{list-style:none;padding:0;margin:0}.quotes li{margin:0 0 .6rem}
.quotes blockquote{margin:0;padding:6px 12px;border-left:3px solid var(--line);font-style:italic}
.quotes cite{font-style:normal;font-size:.95rem}.pin{white-space:nowrap}
.cases ul{padding-left:1.1rem}.cases li{margin:.4rem 0}.cases p{margin:.2rem 0;font-size:.95rem}
.ondate,.export{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:.6rem 0 0}
.ondate input[type=date]{min-height:44px;font-size:1rem;padding:0 8px;border:2px solid var(--line);border-radius:10px;background:var(--bg);color:var(--fg)}
.note{color:var(--muted);font-size:.95rem}
@media (prefers-color-scheme: light){.lex .note,.lex .meta,.lex .note span{color:#3f444b}.lex a,.langs a,a.skip{color:#0842a0}.lex button.primary{background:#0842a0;color:#fff;border-color:#0842a0}}
`;

export function lexglyphPage(origin: string, brand: string, s: LexState = {}): string {
  const ui = s.ui ?? "en";
  const t = STRINGS[ui];
  const url = `${origin}${LEXGLYPH_PATH}`;
  const title = s.q ? `${s.q.slice(0, 60)} | LexGlyph` : `LexGlyph: ${t.lead(LAW_ACTS.length).split(". ")[0]}`;
  const description = t.lead(LAW_ACTS.length);
  const more = MORE[ui];
  // 185 acts (18 Nov 2026): grouped by practice area, in the order a lawyer looks for them.
  const option = (a: (typeof LAW_ACTS)[number]) => `<option value="${esc(a.short)}"${s.act === a.short ? " selected" : ""} lang="en">${esc(a.short === a.name ? a.name : `${a.short}: ${a.name}`)}</option>`;
  const areas = Object.keys(more.areas).filter((k) => LAW_ACTS.some((a) => (a.area ?? "other") === k));
  const actOptions = [`<option value="">${esc(t.allActs(LAW_ACTS.length))}</option>`, ...areas.map((k) => `<optgroup label="${esc(more.areas[k])}">${LAW_ACTS.filter((a) => (a.area ?? "other") === k).map(option).join("")}</optgroup>`)].join("");
  // Phase B blocks under each provision (18 Nov 2026).
  const caseBlock = (cases: CaseRef[], linkLang: string) => cases.length ? `<details class="cases"><summary>${esc(more.caseLaw)} (${cases.length})</summary><ul>${cases.map((c) => `<li><a href="${esc(caseParaUrl(c.url, c.para, linkLang))}" rel="noopener" lang="en">${esc(caseTitle(c))}, para ${esc(c.para)}</a>${c.date ? ` <span class="note">(${esc(c.date)}${c.ecli ? `, ${esc(c.ecli)}` : ""}; ${esc(more.moreParas(c.mentions))})</span>` : ""}<p lang="en">${esc(c.text.slice(0, 360))}${c.text.length > 360 ? "…" : ""}</p></li>`).join("")}</ul></details>` : "";
  const implBlock = (short: string) => {
    const laws = (s.seImpl ?? []).filter((x) => x.short === short);
    return laws.length ? `<p class="note">${esc(more.implementedBy)}: ${laws.slice(0, 6).map((l) => `<a href="${esc(l.url)}" rel="noopener" lang="sv">${esc(l.name)}</a>`).join(", ")}</p>` : "";
  };
  const dateForm = (r: LawResult) => `<form method="get" action="${LEXGLYPH_VERSION_PATH}" class="ondate"><input type="hidden" name="lang" value="${ui}"><input type="hidden" name="act" value="${esc(r.short)}"><input type="hidden" name="article" value="${esc(r.label.replace(/^Article /, ""))}"><label>${esc(more.onDate)} <input type="date" name="date" required max="${new Date().toISOString().slice(0, 10)}"></label> <button type="submit" class="tool">${esc(more.onDateGo)}</button></form>`;
  // The official text in the asker's language: the question's language, else the interface language, unless English.
  const officialCode = s.qLang && s.qLang.eurlex !== "EN" ? s.qLang.eurlex : ui !== "en" ? ui.toUpperCase() : null;
  const keep = (lang: UiLang) => `${LEXGLYPH_PATH}?${new URLSearchParams({ lang, ...(s.q ? { q: s.q } : {}), ...(s.act ? { act: s.act } : {}) })}`;
  const results = s.results ?? [];
  const resultHtml = results.map((r, i) => {
    // The text shown is in the reader's language where the index holds it (Swedish); its link opens the same language.
    const tl = r.language ?? "en";
    const tlName = languageName(tl, ui);
    const otherOfficial = officialCode && officialCode.toLowerCase() !== tl ? `<a href="${esc(eurlexIn(r.url, officialCode))}" hreflang="${officialCode.toLowerCase()}" rel="noopener">${esc(t.officialIn(languageName(officialCode.toLowerCase(), ui)))}</a> · ` : "";
    const ownLink = tl === "en" ? t.officialEn : t.officialIn(tlName);
    return `<article class="result" aria-labelledby="r${i}">
<h3 id="r${i}" lang="${tl}">${esc(r.citation)}${r.heading ? `: ${esc(r.heading)}` : ""}</h3>
<p class="meta"><span lang="en">${esc(r.act)} · ${esc(r.version)}</span> · ${otherOfficial}<a href="${esc(r.url)}" hreflang="${tl}" rel="noopener">${esc(ownLink)}</a></p>
<p lang="${tl}">${esc(r.text.slice(0, 420))}${r.text.length > 420 ? "…" : ""}</p>
<details><summary>${esc(more.readWholeIn(r.kind === "recital", tlName))}</summary><pre lang="${tl}">${esc(r.text)}</pre></details>
<p class="note" lang="en"><span class="cite">${esc(citationLine(r))}</span></p>
<div class="tools"><button type="button" class="tool js copy" data-copy="${esc(citationLine(r))}" hidden>${esc(t.copyCite)}</button><button type="button" class="tool js speak" data-lang="${tl}" data-speak="${esc(`${r.citation}. ${r.heading ?? ""}. ${r.text.slice(0, 3000)}`)}" hidden>${esc(t.readAloud)}</button></div>
${caseBlock(s.cases?.[i] ?? [], officialCode ?? tl.toUpperCase())}${implBlock(r.short)}${r.kind === "article" ? dateForm(r) : ""}
</article>`;
  }).join("\n");
  // The answer: each sentence with the pinpoint citation it rests on, then the quotes themselves, word for word.
  const claims = s.claims ?? [];
  const answerHtml = claims.length
    ? `<div class="answer"><h2>${esc(t.plain)}</h2>
<p class="text" lang="${s.qLang?.tag ?? ui}">${claims.map((c) => `${esc(c.text)} <a class="pin" href="${esc(c.url)}" rel="noopener" lang="${c.citation.includes("artikel") || c.citation.includes("skäl") ? "sv" : "en"}">[${esc(c.citation)}]</a>`).join(" ")}</p>
<h3>${esc(more.quotedHeading)}</h3>
<ul class="quotes">${claims.map((c) => `<li><blockquote>“${esc(c.quote)}”</blockquote> <cite><a href="${esc(c.url)}" rel="noopener">${esc(c.citation)}</a></cite></li>`).join("")}</ul>
<div class="tools"><button type="button" class="tool js speak" data-lang="${s.qLang?.tag ?? ui}" data-speak="${esc(claims.map((c) => c.text).join(" "))}" hidden>${esc(t.readAloud)}</button><button type="button" class="tool js copy" data-copy="${esc(claims.map((c) => `${c.text} (${c.citation})`).join(" "))}" hidden>${esc(t.copyCite)}</button></div>
<p class="note">${esc(more.aiNote)}</p>
${exportForm()}</div>`
    : s.q && s.explain && s.grounded === false && results.length ? `<p class="note answer">${esc(more.notGrounded)}</p>` : "";
  // Swedish statutes for the question (Swedish questions, or the Swedish interface).
  const seHtml = (s.se ?? []).length ? `<section class="se" lang="sv"><h2>${esc(more.swedishLaw)}</h2>${(s.se ?? []).map((x) => `<article class="result"><h3>${esc(`${seLabel(x)} ${x.name}`)}${x.heading ? `: ${esc(x.heading)}` : ""}</h3><p>${esc(x.text.slice(0, 500))}${x.text.length > 500 ? "…" : ""}</p><p class="note"><a href="${esc(x.url)}" rel="noopener">Riksdagen: ${esc(x.name)}</a></p></article>`).join("")}</section>` : "";
  // The Word download posts the answer as shown; nothing is searched again and nothing is stored.
  function exportForm() {
    const data = JSON.stringify({ q: s.q, lang: s.qLang?.tag ?? ui, ui, claims: claims.map((c) => ({ text: c.text, quote: c.quote, citation: c.citation, url: c.url })), provisions: results.map((r) => ({ citation: r.citation, heading: r.heading, text: r.text, url: r.url, version: r.version })) });
    return `<form method="post" action="${LEXGLYPH_EXPORT_PATH}" class="export"><input type="hidden" name="data" value="${esc(data)}"><button type="submit" class="tool">${esc(more.exportWord)}</button></form>`;
  }
  const status = s.error
    ? `<p role="alert">${esc(s.error)}</p>`
    : s.q
      ? `<p>${results.length ? esc(t.found(results.length)) : esc(t.none)}${s.left !== null && s.left !== undefined ? ` · ${esc(t.left(s.left))}` : ""} <button type="button" class="tool js share" hidden>${esc(t.share)}</button></p>`
      : "";
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
<button type="submit" class="btn primary">${esc(t.search)}</button>
</form>
<p id="qhelp" class="note">${esc(t.help)} ${esc(t.notAdvice)} <span class="js" hidden>${esc(t.shortcut)}.</span></p>
${s.q ? "" : `<h2>${esc(t.tryOne)}</h2><ul class="chips">${EXAMPLES.map(([lang, label, q]) => `<li><a lang="${lang}" href="${LEXGLYPH_PATH}?${new URLSearchParams({ lang: ui, q })}">${esc(q)} <span class="note">(${esc(label)})</span></a></li>`).join("")}</ul>`}
<section id="results" aria-live="polite" tabindex="-1">
${status}
${answerHtml}
${resultHtml}
${seHtml}
</section>
<h2>${esc(t.why)}</h2>
<ul>${t.whyItems(LAW_ACTS.length, LEXGLYPH_PER_VISITOR).map((x) => `<li>${x}</li>`).join("")}</ul>
<section lang="en">
<h2>For developers and AI agents</h2>
<ul>
<li>API: <code>GET ${esc(origin)}/law/search?q=…</code>, $0.005 a search, pay per call or with a key. <a href="/eu-law-search-api">API details and plans</a>.</li>
<li>The search on this page matches words and is free. The API also searches by meaning, takes a question in any EU language and, with <code>answer=true</code>, writes a plain-words answer in which every sentence comes with the quote it rests on and a pinpoint citation. Swedish text: <code>lang=sv</code>.</li>
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
<footer>LexGlyph · ${esc(brand)}. <a href="${LEXGLYPH_SECURITY_PATH}?lang=${ui}">${esc(MORE[ui].security)}</a>. <span lang="en">Legal texts: © European Union, EUR-Lex, reused under the Commission's reuse policy.</span> ${COMPANY_FOOTER}</footer>
</main></body></html>`;
}

async function visitorKey(ip: string | undefined, day: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`lexglyph:${ip ?? "unknown"}`));
  return `lexglyph:${day}:${[...new Uint8Array(digest)].slice(0, 12).map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * The page for a GET: no question renders the start page; a question runs the keyword search within the free
 * allowance. Nothing here calls a model or Vectorize (tests/free-metered.test.cjs reads this function's source).
 */
export async function lexglyphHtml(env: Env, origin: string, params: URLSearchParams, ip: string | undefined, acceptLanguage?: string): Promise<string> {
  const brand = publicBrand(env, SERVICE_NAME);
  const ui = pickUiLang(params.get("lang"), acceptLanguage);
  const t = STRINGS[ui];
  const q = (params.get("q") ?? "").trim().slice(0, 400);
  const actRaw = (params.get("act") ?? "").trim();
  // No plain-words answer on the free page (it would be a model call); old links with explain=1 just search.
  const explain = false;
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
    const deps = lawKeywordDeps(env);
    const found = await lawSearch(q, { act, count: 5, lang: ql.iso }, deps);
    // The provisions in the question's language where the index holds it (Swedish), so answers quote that text.
    const textLang = INDEXED_LANGS.includes(qLang.tag) ? qLang.tag : "en";
    const shown = { ...found, candidates: await inLanguage(found.candidates.slice(0, 5), textLang, deps) };
    const out = lawAnswer(q, act, undefined, 5, shown);
    // Phase B layers (18 Nov 2026): judgments on each article found, Swedish statutes implementing the acts found, and
    // Swedish sections when the question or the interface is Swedish. A layer that fails is left out, never the page.
    const db = env.LAW_DB!;
    const se = seKeywordDeps(env);
    const wantSe = qLang.tag === "sv" || ui === "sv";
    const [cases, seImpl, seHits] = await Promise.all([
      Promise.all(out.results.map((r) => (r.kind === "article" ? casesForArticle(db, r.short, r.label.replace(/^Article /, ""), 3).catch(() => [] as CaseRef[]) : Promise.resolve([] as CaseRef[])))),
      swedishImplementations(db, out.results.map((r) => r.short)).catch(() => []),
      wantSe && se ? seSearch(q, se, 3).catch(() => [] as SeSection[]) : Promise.resolve([] as SeSection[]),
    ]);
    await env.TRIALS?.put(key, String(used + 1), { expirationTtl: 2 * 86400 }).catch(() => {});
    return lexglyphPage(origin, brand, { ui, q, act: act?.short, explain, qLang, results: out.results, answer: null, claims: [], cases, seImpl, se: seHits, left: env.TRIALS ? LEXGLYPH_PER_VISITOR - used - 1 : null });
  } catch (e) {
    const busy = e instanceof HttpError && (e.status === 503 || e.status === 502);
    return lexglyphPage(origin, brand, { ui, q, act: act?.short, explain, qLang, error: busy ? t.busy : t.failed });
  }
}
