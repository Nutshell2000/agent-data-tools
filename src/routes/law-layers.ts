/**
 * LexGlyph's second and third layers (18 Nov 2026, Phase B of business/lexglyph/lexglyph-law-firm-plan-2026-11-18.md):
 *
 * - Case law: Court of Justice judgments that interpret the indexed acts, paragraph by paragraph, and the links from
 *   each paragraph to the articles it cites (scripts/law-index/build-caselaw.mjs). For an article: the judgments whose
 *   paragraphs discuss it most, with the first such paragraph.
 * - Swedish law: the Swedish statutes that implement the indexed directives (CELLAR's national implementing measures)
 *   and core statutes, section by section (scripts/law-index/build-se.mjs), searched by keyword (D1 FTS5) and meaning
 *   (Vectorize se-law, bge-m3, which reads Swedish), and the statutes that implement a given directive.
 *
 * Both live in the same EU-jurisdiction D1 database as the EU acts (LAW_DB); Swedish vectors in SE_VECTORS.
 */
import { HttpError, type Env } from "../lib/env";
import { runAi } from "../lib/ai";
import type { GroundSource } from "../lib/law-grounding";
import SE_CORE_JSON from "../data/se-core.json";

export const CASE_ATTRIBUTION = "Judgments: © European Union, https://eur-lex.europa.eu. Only the European Court Reports are authentic.";
export const SE_ATTRIBUTION = "Svensk författningssamling via Riksdagens öppna data (Regeringskansliets SFS-text). Endast den tryckta SFS är officiell.";

export interface CaseRef { celex: string; number: string | null; ecli: string | null; parties: string | null; date: string | null; para: string; text: string; url: string; mentions: number }
export interface SeSection { id: string; sfs: string; chapter: string | null; chapter_title: string | null; section: string; heading: string | null; text: string; name: string; url: string }

/** "C-311/18, Data Protection Commissioner v Facebook Ireland Limited and Maximillian Schrems" shortened for a line. */
export function caseTitle(c: Pick<CaseRef, "number" | "parties">): string {
  const parties = (c.parties ?? "").replace(/\s+/g, " ").trim();
  return `${(c.number ?? "Case").replace(/\.\s*$/, "").replace(/‑/g, "-")}${parties ? `, ${parties.length > 90 ? `${parties.slice(0, 87)}…` : parties}` : ""}`;
}
/** A paragraph's link on EUR-Lex: the judgment page, at the paragraph. */
export const caseParaUrl = (url: string, para: string, lang = "EN") => `${url.replace(/\/legal-content\/[A-Z]{2}\//, `/legal-content/${lang}/`)}${/^\d+$/.test(para) ? `#point${para}` : ""}`;
/** "3 kap. 5 §" */
export const seLabel = (s: Pick<SeSection, "chapter" | "section">) => `${s.chapter ? `${s.chapter} kap. ` : ""}${s.section} §`;

/** The judgments that discuss an article most (by paragraphs citing it), newest first among equals, with one paragraph each. */
export async function casesForArticle(db: D1Database, short: string, num: string, limit = 3): Promise<CaseRef[]> {
  const r = await db.prepare(
    `SELECT c.celex, c.number, c.ecli, c.parties, c.date, c.url, COUNT(*) AS mentions, MIN(CAST(l.para AS INTEGER)) AS first
     FROM case_links l JOIN cases c ON c.celex = l.celex WHERE l.short = ? AND l.num = ? AND l.para <> 'ruling'
     GROUP BY c.celex ORDER BY mentions DESC, c.date DESC LIMIT ?`,
  ).bind(short, num, limit).all<{ celex: string; number: string | null; ecli: string | null; parties: string | null; date: string | null; url: string; mentions: number; first: number }>().catch(() => ({ results: [] as never[] }));
  const rows = r.results ?? [];
  if (!rows.length) return [];
  // The first paragraph citing an article is usually the "Legal context" quoting it; the Court's own reasoning comes
  // later. Every citing paragraph of these judgments is read, and the first one that is not a quotation is shown.
  const cites = await db.prepare(`SELECT p.id, p.celex, p.para, p.text FROM case_links l JOIN case_paras p ON p.id = l.celex || ':' || l.para WHERE l.short = ? AND l.num = ? AND l.celex IN (${rows.map(() => "?").join(",")}) AND l.para <> 'ruling'`)
    .bind(short, num, ...rows.map((x) => x.celex)).all<{ id: string; celex: string; para: string; text: string }>().catch(() => ({ results: [] as never[] }));
  // Preliminary rulings open the Court's answer with "By its first question, the referring court asks, in essence…":
  // the paragraphs from there on are the reasoning. The heading "Consideration of the questions referred" is not numbered,
  // so it ends the paragraph before the reasoning: the reasoning starts one after.
  const starts = await db.prepare(`SELECT celex, MIN(CASE WHEN text LIKE 'By its%question%' THEN CAST(para AS INTEGER) ELSE CAST(para AS INTEGER) + 1 END) AS start FROM case_paras WHERE celex IN (${rows.map(() => "?").join(",")}) AND (text LIKE 'By its%question%' OR text LIKE '%Consideration of the question%') GROUP BY celex`)
    .bind(...rows.map((x) => x.celex)).all<{ celex: string; start: number }>().catch(() => ({ results: [] as never[] }));
  return rows.map((x) => {
    const start = (starts.results ?? []).find((s) => s.celex === x.celex)?.start ?? 0;
    const mine = (cites.results ?? []).filter((p) => p.celex === x.celex).sort((a, b) => Number(a.para) - Number(b.para));
    const best = bestParagraph(mine.filter((p) => Number(p.para) >= start)) ?? bestParagraph(mine) ?? mine[0];
    return { celex: x.celex, number: x.number, ecli: x.ecli, parties: x.parties, date: x.date, para: best?.para ?? String(x.first), text: best?.text ?? "", url: x.url, mentions: x.mentions };
  });
}

/** A paragraph that is the Court reasoning, not a quotation of the legislation or of the question referred. */
const QUOTING = /(provides|provided|states|stated|reads|read as follows|is worded as follows|is worded|was worded|are worded|is entitled|headed|as follows)\s*[:’']\s*$|(provides|states|reads|is worded as follows|was worded as follows)\s*:/i;
export function bestParagraph<T extends { para: string; text: string }>(paras: T[]): T | undefined {
  return paras.find((p) => !QUOTING.test(p.text.slice(0, 400)) && !/^[‘'“"]/.test(p.text.trim()) && !/refer(?:red)? the following questions?/i.test(p.text) && p.text.length > 120);
}

/** Swedish statutes implementing an indexed directive (CELLAR's national implementing measures for Sweden). */
export async function swedishImplementations(db: D1Database, shorts: string[]): Promise<{ short: string; sfs: string; name: string; url: string }[]> {
  const uniq = [...new Set(shorts)].slice(0, 10);
  if (!uniq.length) return [];
  const r = await db.prepare(`SELECT t.short, l.sfs, l.name, l.url FROM se_transpositions t JOIN se_laws l ON l.sfs = t.sfs WHERE t.short IN (${uniq.map(() => "?").join(",")})`).bind(...uniq).all<{ short: string; sfs: string; name: string; url: string }>().catch(() => ({ results: [] as never[] }));
  return r.results ?? [];
}

/** Reciprocal-rank fusion (k = 60), as in law-search.ts (kept here so the two modules do not import each other). */
function fuse(lists: string[][], k = 60): string[] {
  const score = new Map<string, number>();
  for (const list of lists) list.forEach((id, i) => score.set(id, (score.get(id) ?? 0) + 1 / (k + i + 1)));
  return [...score.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
}

const SE_STOP = new Set(["och", "att", "det", "som", "en", "ett", "för", "på", "är", "av", "med", "till", "om", "den", "de", "i", "vad", "hur", "när", "kan", "får", "ska", "måste", "jag", "vi", "har", "vid", "eller", "enligt", "lag", "lagen", "the", "of", "to", "and", "a", "is", "what", "when", "how"]);
/** FTS5 expression for a Swedish question: content words, quoted, OR-ed (no query syntax gets through). */
export function seFtsQuery(q: string): string | null {
  const words = [...new Set(q.toLowerCase().normalize("NFC").replace(/[^\p{L}\p{N}]+/gu, " ").split(" ").filter((w) => w.length > 2 && !SE_STOP.has(w)))].slice(0, 12);
  // A prefix match ("semester"*) also finds inflected and compound forms: semesterledighet, semesterlönen.
  return words.length ? words.map((w) => `"${w}"*`).join(" OR ") : null;
}

export interface SeDeps { embed(q: string): Promise<number[]>; vectors(v: number[], topK: number): Promise<string[]>; keywords(match: string, limit: number): Promise<string[]>; rows(ids: string[]): Promise<SeSection[]> }

/** Core statutes (src/data/se-core.json): SFS number -> the everyday names people use for it. */
const SE_CORE: Record<string, string[]> = Object.fromEntries(Object.entries(SE_CORE_JSON).filter(([k]) => !k.startsWith("_")) as [string, string[]][]);
/** The statutes a question names: "enligt LAS", "i aktiebolagslagen", "lagen om anställningsskydd". */
export function namedStatutes(q: string): string[] {
  const text = ` ${q.toLowerCase().replace(/[^\p{L}\p{N}-]+/gu, " ")} `;
  return Object.entries(SE_CORE).filter(([, names]) => names.some((n) => (n.length <= 4 ? text.includes(` ${n} `) : text.includes(n)))).map(([sfs]) => sfs);
}

/**
 * Swedish sections for a question: meaning and keywords fused, then two stated adjustments (18 Nov 2026), because there
 * is no reranker that reads Swedish: a section of a core statute (the general law a lawyer usually means, se-core.json)
 * ranks before the same score in a niche one, and a statute the question names ranks first. Without them, "hur många
 * semesterdagar" found the Armed Forces' employment act before the Annual Leave Act.
 */
export async function seSearch(q: string, deps: SeDeps, count = 3): Promise<SeSection[]> {
  const match = seFtsQuery(q);
  const vector = await deps.embed(q);
  const lists = await Promise.all([deps.vectors(vector, 40).catch(() => [] as string[]), match ? deps.keywords(match, 40).catch(() => [] as string[]) : Promise.resolve([] as string[])]);
  const named = new Set(namedStatutes(q));
  const score = new Map<string, number>();
  for (const list of lists) list.forEach((id, i) => score.set(id, (score.get(id) ?? 0) + 1 / (60 + i + 1)));
  const sfsOf = (id: string) => /^se:(\d{4}:\d+):/.exec(id)?.[1] ?? "";
  for (const [id, s] of score) {
    const sfs = sfsOf(id);
    // 0.03 for a core statute (eval-se.json, 18 Nov: 0.012 gave 5/18 first and 8/18 in the top 3, 0.03 gave 8/18 and 12/18,
    // 0.06 no better): about two rank steps of one list, so a core section wins near-ties but not a clearly better niche one.
    score.set(id, s + (named.has(sfs) ? 0.05 : 0) + (Object.hasOwn(SE_CORE, sfs) ? 0.03 : 0));
  }
  const ids = [...score.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id).slice(0, count);
  if (!ids.length) return [];
  const rows = await deps.rows(ids);
  return ids.map((id) => rows.find((r) => r.id === id)).filter((r): r is SeSection => Boolean(r));
}

export function seDeps(env: Env): SeDeps | null {
  const db = env.LAW_DB, index = env.SE_VECTORS;
  if (!db || !index) return null;
  return {
    async embed(q) {
      const out = await runAi<{ data?: number[][] }>(env, "@cf/baai/bge-m3", { text: [q.slice(0, 2000)] });
      const v = out.data?.[0];
      if (!v?.length) throw new HttpError(502, "the embedding model gave no vector; nothing was charged");
      return v;
    },
    async vectors(v, topK) { return (await index.query(v, { topK, returnMetadata: "none" })).matches.map((m) => m.id); },
    async keywords(match, limit) {
      const r = await db.prepare("SELECT id FROM se_sections_fts WHERE se_sections_fts MATCH ? ORDER BY bm25(se_sections_fts, 0, 2.0, 3.0, 1.0) LIMIT ?").bind(match, limit).all<{ id: string }>();
      return (r.results ?? []).map((x) => x.id);
    },
    async rows(ids) { return (await db.prepare(`SELECT * FROM se_sections WHERE id IN (${ids.map(() => "?").join(",")})`).bind(...ids).all<SeSection>()).results ?? []; },
  };
}

/** A Swedish section as the grounding step reads it: cited "3 kap. 5 § första stycket semesterlagen (1977:480)". */
export const seSource = (s: SeSection): GroundSource => ({ short: s.name, label: seLabel(s), kind: "se", para: null, text: s.text, url: s.url, lang: "sv" });
/** A judgment paragraph as the grounding step reads it: cited "C-311/18, Facebook Ireland and Schrems, para 134". */
export const caseSource = (c: CaseRef): GroundSource => ({ short: caseTitle(c), label: `para ${c.para}`, kind: "case", para: null, text: c.text, url: caseParaUrl(c.url, c.para), lang: "en" });
