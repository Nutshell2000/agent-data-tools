// LexGlyph's two Phase B pages (18 Nov 2026, business/lexglyph/lexglyph-law-firm-plan-2026-11-18.md):
// - /lexglyph/version: one article as it read on a date, today's wording, and what changed (lib/law-versions.ts).
// - /lexglyph/export (POST): the answer shown on the page as a Word document with footnoted citations (lib/docx.ts).
//   The page posts what it showed; nothing is searched again and nothing is stored.
import { STYLE } from "./page-style";
import { COMPANY_FOOTER } from "./legal";
import { MORE, STRINGS, type UiLang } from "./lexglyph-i18n";
import { articleOnDate, type PointInTime } from "./law-versions";
import { answerDocx } from "./docx";
import { LAW_ACTS, actOf, eurlexIn } from "../routes/law-search";
import { HttpError, type Env } from "./env";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function shell(ui: UiLang, title: string, body: string, back: string): string {
  return `<!doctype html>
<html lang="${ui}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} | LexGlyph</title><meta name="robots" content="noindex"><link rel="icon" href="/favicon.ico">
<style>${STYLE}
.diff p{margin:.25rem 0;white-space:pre-wrap}.diff del{background:#fde2e1;color:#7a1712}.diff ins{background:#dff3e4;color:#0f4a1e;text-decoration:underline}
@media (prefers-color-scheme: dark){.diff del{background:#4a1d1b;color:#ffd7d4}.diff ins{background:#16391f;color:#d2f5dc}}
.cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(18rem,1fr));gap:16px}.cols pre{white-space:pre-wrap;font-family:inherit}</style></head><body><main>
<p><a href="${back}">← LexGlyph</a></p>
${body}
<footer>LexGlyph. <span lang="en">Legal texts: © European Union, EUR-Lex.</span> ${COMPANY_FOOTER}</footer>
</main></body></html>`;
}

/** The point-in-time page body (exported for tests). */
export function versionBody(ui: UiLang, p: PointInTime, actName: string): string {
  const more = MORE[ui];
  const cite = `${p.short}, Article ${p.article}`;
  const link = (celex: string) => eurlexIn(`https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:${celex}#art_${p.article}`, ui === "sv" ? "SV" : "EN");
  const head = `<h1 lang="en">${esc(more.versionTitle(cite, p.date))}</h1><p class="lead" lang="en">${esc(actName)}</p>`;
  if (!p.then || !p.now) return `${head}<p role="status">${esc(p.note ?? STRINGS[ui].failed)}</p>`;
  const changed = p.diff.some((d) => d.kind !== "same");
  const diff = changed ? `<h2>${esc(more.versionChanges)}</h2><div class="diff" lang="${ui === "sv" ? "sv" : "en"}">${p.diff.map((d) => `<p>${d.kind === "removed" ? `<del>${esc(d.text)}</del>` : d.kind === "added" ? `<ins>${esc(d.text)}</ins>` : esc(d.text)}</p>`).join("")}</div>` : `<p role="status"><strong>${esc(more.versionSame)}</strong></p>`;
  return `${head}${diff}<div class="cols">
<section><h2>${esc(more.versionThen(p.then.from))}</h2><p class="note"><a href="${esc(link(p.then.celex))}" rel="noopener">EUR-Lex ${esc(p.then.celex)}</a></p>${p.then.heading ? `<h3>${esc(p.then.heading)}</h3>` : ""}<pre>${esc(p.then.text)}</pre></section>
<section><h2>${esc(more.versionNow(p.now.from))}</h2><p class="note"><a href="${esc(link(p.now.celex))}" rel="noopener">EUR-Lex ${esc(p.now.celex)}</a></p>${p.now.heading ? `<h3>${esc(p.now.heading)}</h3>` : ""}<pre>${esc(p.now.text)}</pre></section></div>`;
}

export async function lexglyphVersionHtml(env: Env, params: URLSearchParams, ui: UiLang, lexPath: string): Promise<string> {
  const back = `${lexPath}?lang=${ui}`;
  let act;
  try { act = actOf(params.get("act") ?? ""); } catch { act = undefined; }
  const article = (params.get("article") ?? "").trim();
  const date = (params.get("date") ?? "").trim();
  if (!act || !/^\d{1,3}[a-z]?$/.test(article) || !DATE.test(date) || !env.LAW_DB) return shell(ui, "LexGlyph", `<p role="alert">${esc(STRINGS[ui].failed)}</p>`, back);
  const lang = ui === "sv" ? "swe" : "eng";
  const p = await articleOnDate(env.LAW_DB, act.short, article, date, lang).catch(() => null);
  if (!p) return shell(ui, "LexGlyph", `<p role="alert">${esc(STRINGS[ui].busy)}</p>`, back);
  return shell(ui, `${act.short} Article ${article}, ${date}`, versionBody(ui, p, LAW_ACTS.find((a) => a.short === act.short)?.name ?? act.short), back);
}

interface ExportData { q?: string; lang?: string; ui?: UiLang; claims?: { text: string; quote: string; citation: string; url: string }[]; provisions?: { citation: string; heading?: string; text: string; url: string; version: string }[] }

/** The .docx for a posted answer: at most 200 kB in, strings only, so nothing but text reaches the document. */
export function lexglyphExport(form: string): { bytes: Uint8Array; filename: string } {
  if (form.length > 200_000) throw new HttpError(400, "the answer is too large to export");
  let d: ExportData;
  try { d = JSON.parse(form) as ExportData; } catch { throw new HttpError(400, "not an answer"); }
  const ui: UiLang = d.ui && Object.hasOwn(MORE, d.ui) ? d.ui : "en";
  const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
  const claims = (Array.isArray(d.claims) ? d.claims : []).slice(0, 12).map((c) => ({ text: str(c?.text, 1000), quote: str(c?.quote, 1000), citation: str(c?.citation, 300), url: str(c?.url, 400) }));
  const provisions = (Array.isArray(d.provisions) ? d.provisions : []).slice(0, 10).map((p) => ({ citation: str(p?.citation, 300), heading: str(p?.heading, 300) || undefined, text: str(p?.text, 12000), url: str(p?.url, 400), version: str(p?.version, 200) }));
  const t = STRINGS[ui], more = MORE[ui];
  const question = str(d.q, 400);
  const bytes = answerDocx({
    title: "LexGlyph", question, lang: str(d.lang, 8) || ui, claims, provisions,
    labels: { answer: t.plain, quoted: more.quotedHeading, provisions: t.found(provisions.length), note: more.docNote, source: "© European Union, https://eur-lex.europa.eu (Commission Decision 2011/833/EU)." },
  });
  const slug = question.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50) || "answer";
  return { bytes, filename: `lexglyph-${slug}.docx` };
}
