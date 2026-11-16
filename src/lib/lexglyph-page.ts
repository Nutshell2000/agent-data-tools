// LexGlyph (owner named it 16 Nov 2026): the people's face of our EU law index, at /lexglyph on glyphcall.com.
// Why: Exa is an API for developers (its playground needs an account) and returns pages about the law. LexGlyph is a
// plain search page anyone can use without an account, in their own language, that returns the article itself with its
// text, the official EUR-Lex link and the version date, and can explain it in plain words.
//
// Rules for this page:
// - Works without JavaScript (server-rendered GET form); the only script is the optional "copy citation" button.
// - Accessible: one h1, labelled controls, a skip link, visible focus, results announced (aria-live), lang attributes on
//   the example questions, colour contrast in both themes, 44 px touch targets, no layout that needs a wide screen.
// - Free for people within LEXGLYPH_PER_VISITOR searches a day per visitor (hashed address, never stored as is) and
//   LEXGLYPH_DAILY_CAP in total; software uses the paid API (/law/search) like every other tool.
// - Every claim on the page is measured (benchmarks page, multilingual run of 16 Nov 2026) or stated as a limit.
import { SERVICE_NAME } from "../endpoints";
import { STYLE } from "./compare-pages";
import { COMPANY_FOOTER } from "./legal";
import { publicBrand } from "./public-brand";
import { takeDailyBudget } from "./daily-cap";
import { HttpError, type Env } from "./env";
import { LAW_ACTS, actOf, answerFromArticles, lawAnswer, lawDeps, lawSearch } from "../routes/law-search";

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
  q?: string;
  act?: string;
  explain?: boolean;
  results?: LawResult[];
  answer?: string | null;
  error?: string;
  left?: number | null;
}

/** "GDPR, Article 37" + heading + act + version: the line people paste into a memo or e-mail. */
export const citationLine = (r: Pick<LawResult, "citation" | "heading" | "act" | "url" | "version">) =>
  `${r.citation}${r.heading ? ` (${r.heading})` : ""}, ${r.act} (${r.version}). ${r.url}`;

const PAGE_STYLE = `
.skip{position:absolute;left:-999px}.skip:focus{left:16px;top:16px;background:var(--bg);padding:8px;z-index:9}
.lex form{display:flex;flex-wrap:wrap;gap:8px;margin:1.2rem 0}
.lex input[type=search]{flex:1 1 22rem;min-height:48px;font-size:1.1rem;padding:0 14px;border:2px solid var(--line);border-radius:10px;background:var(--bg);color:var(--fg)}
.lex select{min-height:48px;font-size:1rem;padding:0 10px;border:2px solid var(--line);border-radius:10px;background:var(--bg);color:var(--fg);max-width:100%}
.lex button.copy{background:var(--bg);color:var(--fg);border:2px solid var(--line);min-height:44px}.lex button,.lex .btn{min-height:48px;padding:0 18px;font-size:1rem;border-radius:10px;cursor:pointer}
.lex label.explain{display:flex;align-items:center;gap:8px;min-height:48px}
.lex input[type=checkbox]{width:22px;height:22px}
.lex :focus-visible{outline:3px solid var(--accent);outline-offset:2px}
.chips{display:flex;flex-wrap:wrap;gap:8px;padding:0;list-style:none}
.chips a{display:inline-block;min-height:44px;line-height:44px;padding:0 12px;border:1px solid var(--line);border-radius:22px;text-decoration:none}
.result{border:1px solid var(--line);border-radius:12px;padding:16px;margin:12px 0;background:var(--card)}
.result h3{margin:0 0 4px}.result .meta{color:var(--muted);font-size:.95rem;margin:0 0 8px}
.result details{margin-top:8px}.result summary{cursor:pointer;min-height:44px;line-height:44px}
.result pre{white-space:pre-wrap;font-family:inherit;margin:0}
.answer p:first-of-type{white-space:pre-line}.answer{border-left:4px solid var(--accent);padding:12px 16px;background:var(--card);border-radius:8px}
.note{color:var(--muted);font-size:.95rem}
`;

export function lexglyphPage(origin: string, brand: string, s: LexState = {}): string {
  const url = `${origin}${LEXGLYPH_PATH}`;
  const title = s.q ? `${s.q.slice(0, 60)} | LexGlyph` : "LexGlyph: find the exact EU law article, in your language";
  const description = "Ask about GDPR, the AI Act, NIS2, DORA, the DSA, VAT and 40 more EU acts in your own language. LexGlyph returns the article itself, with its text, the official EUR-Lex link and the version date. Free, no account.";
  const actOptions = [`<option value="">All ${LAW_ACTS.length} acts</option>`, ...LAW_ACTS.map((a) => `<option value="${esc(a.short)}"${s.act === a.short ? " selected" : ""}>${esc(a.short === a.name ? a.name : `${a.short}: ${a.name}`)}</option>`)].join("");
  const results = s.results ?? [];
  const resultHtml = results.map((r, i) => `<article class="result" aria-labelledby="r${i}">
<h3 id="r${i}">${esc(r.citation)}${r.heading ? `: ${esc(r.heading)}` : ""}</h3>
<p class="meta">${esc(r.act)} · ${esc(r.version)} · <a href="${esc(r.url)}" rel="noopener">official text on EUR-Lex</a></p>
<p>${esc(r.text.slice(0, 420))}${r.text.length > 420 ? "…" : ""}</p>
<details><summary>Read the whole ${r.kind === "recital" ? "recital" : "article"}</summary><pre lang="en">${esc(r.text)}</pre></details>
<p class="note"><span class="cite">${esc(citationLine(r))}</span> <button type="button" class="btn copy" data-cite="${esc(citationLine(r))}" hidden>Copy citation</button></p>
</article>`).join("\n");
  const status = s.error
    ? `<p role="alert">${esc(s.error)}</p>`
    : s.q
      ? `<p>${results.length ? `${results.length} provisions found` : "No provision found: try other words, or choose an act."}${s.left !== null && s.left !== undefined ? ` · ${s.left} free searches left today` : ""}</p>`
      : "";
  const body = `<a class="skip" href="#results">Skip to results</a>
<div class="lex">
<h1>LexGlyph</h1>
<p class="lead">Find the exact EU law article. Ask in your own language: GDPR, the AI Act, NIS2, DORA, the DSA, MiCA, VAT and ${LAW_ACTS.length - 7} more acts. Free, no account.</p>
<form method="get" action="${LEXGLYPH_PATH}" role="search">
<label for="q" class="sr">Your question</label>
<input id="q" name="q" type="search" required maxlength="400" value="${esc(s.q ?? "")}" placeholder="e.g. when must a company appoint a data protection officer" autocomplete="off" aria-describedby="qhelp">
<label for="act" class="sr">Act</label>
<select id="act" name="act">${actOptions}</select>
<label class="explain"><input type="checkbox" name="explain" value="1"${s.explain ? " checked" : ""}> Explain in plain words</label>
<button type="submit" class="btn primary">Search</button>
</form>
<p id="qhelp" class="note">Questions in any EU language work; the articles are shown in English, the language of the consolidated text we index. Not legal advice.</p>
${s.q ? "" : `<h2>Try one</h2><ul class="chips">${EXAMPLES.map(([lang, label, q]) => `<li><a lang="${lang}" href="${LEXGLYPH_PATH}?q=${encodeURIComponent(q)}">${esc(q)} <span class="note">(${esc(label)})</span></a></li>`).join("")}</ul>`}
<section id="results" aria-live="polite" tabindex="-1">
${status}
${s.answer ? `<div class="answer"><h2>In plain words</h2><p>${esc(s.answer)}</p><p class="note">Written by an AI model from the articles below only, which it cites as [1], [2]… Check the article before you rely on it.</p></div>` : ""}
${resultHtml}
</section>
<h2>Why LexGlyph</h2>
<ul>
<li><strong>The article, not a page about it.</strong> On 102 compliance questions we had not seen before, the right article came first 76 times; a leading web search API managed 34. <a href="/benchmarks">Method and data</a>.</li>
<li><strong>Your language.</strong> Questions in Swedish, German, French, Spanish and Polish found the right article in the top five 13 times out of 15 in our test.</li>
<li><strong>Official text, dated.</strong> ${LAW_ACTS.length} acts article by article, from the EU's own publications office, with the version in force and a link to EUR-Lex.</li>
<li><strong>No account, no cookies.</strong> ${LEXGLYPH_PER_VISITOR} free searches a day, counted per visitor without keeping your address.</li>
</ul>
<h2>For developers and AI agents</h2>
<ul>
<li>API: <code>GET ${esc(origin)}/law/search?q=…</code>, $0.005 a search, pay per call or with a key. <a href="/eu-law-search-api">API details and plans</a>.</li>
<li>Already on Exa's SDK? Change one line: <code>Exa(api_key, base_url="${esc(origin)}/v1")</code> and send <code>category="law"</code>.</li>
<li>MCP: add <code>${esc(origin)}/mcp</code> to your AI assistant and ask it EU-law questions.</li>
</ul>
</div>
<script>for(const b of document.querySelectorAll("button.copy")){b.hidden=false;b.addEventListener("click",async()=>{try{await navigator.clipboard.writeText(b.dataset.cite);b.textContent="Copied";}catch{b.textContent="Select the text to copy";}});}${s.q ? 'document.getElementById("results").focus();' : ""}</script>`;
  const ld = [{
    "@context": "https://schema.org", "@type": "WebApplication", name: "LexGlyph", url, description,
    applicationCategory: "LegalService", operatingSystem: "Any", isAccessibleForFree: true, inLanguage: ["en", "sv", "de", "fr", "es", "pl"],
    offers: { "@type": "Offer", price: "0", priceCurrency: "EUR" }, publisher: { "@type": "Organization", name: brand },
  }];
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(url)}">
<meta property="og:type" content="website"><meta property="og:title" content="LexGlyph: find the exact EU law article"><meta property="og:description" content="${esc(description)}"><meta property="og:url" content="${esc(url)}">
${s.q ? '<meta name="robots" content="noindex">' : ""}
<link rel="icon" href="/favicon.ico">
${ld.map((x) => `<script type="application/ld+json">${jsonLd(x)}</script>`).join("\n")}
<style>${STYLE}${PAGE_STYLE}.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}</style></head><body><main>
${body}
<footer>LexGlyph is made by ${esc(brand)}. Legal texts: © European Union, EUR-Lex, reused under the Commission's reuse policy. ${COMPANY_FOOTER}</footer>
</main></body></html>`;
}

async function visitorKey(ip: string | undefined, day: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`lexglyph:${ip ?? "unknown"}`));
  return `lexglyph:${day}:${[...new Uint8Array(digest)].slice(0, 12).map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

/** The page for a GET: no question renders the start page; a question runs the search within the free allowance. */
export async function lexglyphHtml(env: Env, origin: string, params: URLSearchParams, ip: string | undefined): Promise<string> {
  const brand = publicBrand(env, SERVICE_NAME);
  const q = (params.get("q") ?? "").trim().slice(0, 400);
  const actRaw = (params.get("act") ?? "").trim();
  const explain = params.get("explain") === "1";
  if (!q) return lexglyphPage(origin, brand, { act: actRaw || undefined });
  let act;
  try { act = actRaw ? actOf(actRaw) : undefined; } catch { return lexglyphPage(origin, brand, { q, error: "That act is not in the index; choose one from the list." }); }
  const day = new Date().toISOString().slice(0, 10);
  const key = await visitorKey(ip, day);
  const used = env.TRIALS ? Number(await env.TRIALS.get(key)) || 0 : 0;
  if (used >= LEXGLYPH_PER_VISITOR) {
    return lexglyphPage(origin, brand, { q, act: act?.short, explain, error: `You have used today's ${LEXGLYPH_PER_VISITOR} free searches. They come back tomorrow; for more, use the API with a free key.`, left: 0 });
  }
  try {
    await takeDailyBudget(env, "lexglyph", env.LEXGLYPH_DAILY_CAP, LEXGLYPH_DAILY_CAP, "LexGlyph");
    const found = await lawSearch(q, { act, count: 5 }, lawDeps(env));
    const out = lawAnswer(q, act, undefined, 5, found);
    const answer = explain && out.results.length ? (await answerFromArticles(env, q, out.results, { plain: true }).catch(() => ({ answer: null }))).answer : null;
    await env.TRIALS?.put(key, String(used + 1), { expirationTtl: 2 * 86400 }).catch(() => {});
    return lexglyphPage(origin, brand, { q, act: act?.short, explain, results: out.results, answer, left: env.TRIALS ? LEXGLYPH_PER_VISITOR - used - 1 : null });
  } catch (e) {
    const busy = e instanceof HttpError && (e.status === 503 || e.status === 502);
    return lexglyphPage(origin, brand, { q, act: act?.short, explain, error: busy ? "LexGlyph is busy right now; please try again in a minute." : "Something went wrong with this search; please try again." });
  }
}
