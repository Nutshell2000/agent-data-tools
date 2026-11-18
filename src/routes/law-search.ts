/**
 * EU law search (14 Nov 2026): our own search index, the first of the beat-Exa plan
 * (business/research-2026-11-14-biggest-earners/beat-exa-master-plan.md, Phase 2). Since 18 Nov 2026 185 acts with the
 * official Swedish text beside the English (business/lexglyph/lexglyph-law-firm-plan-2026-11-18.md). Originally 46 EU acts that agents and companies
 * ask about (GDPR, AI Act, DSA, DMA, NIS2, DORA, MiCA, VAT Directive, CSRD…), article by article and recital by recital,
 * in the latest consolidated English text in force when the index was built (scripts/law-index/build.mjs, monthly).
 *
 * Search is hybrid and runs entirely on our own infrastructure: no Brave, no outside search API.
 * - Keyword: D1 FTS5 (BM25) over act, article label, heading and text. Finds exact terms and article numbers.
 * - Meaning: bge-m3 vectors in Vectorize. Finds the right article when the question uses other words.
 * - The two rankings merge by reciprocal rank; bge-reranker-base orders the top candidates.
 *
 * Why: Exa's legal vertical lists only US sources and Exa processes every request in the US. Answers here cite the act,
 * the article and its EUR-Lex link, name the consolidated version, and the index lives in Cloudflare's EU jurisdiction.
 * Source: EUR-Lex / CELLAR, reuse authorised by Commission Decision 2011/833/EU. Not legal advice; only the Official
 * Journal is authentic.
 */
import { entry, flag, num, need, opt, type Entry } from "../family";
import { HttpError, type Env } from "../lib/env";
import { runAi } from "../lib/ai";
import { franc } from "franc-min";
import { RERANK_MODEL } from "./retrieval";
import { CHAT_MODEL, LARGE_CHAT_MODELS, chat } from "./ai-text";
import ACTS from "../data/eu-law-acts.json";
import { groundedContext, groundedPrompt, parseClaims, verifyClaims, type GroundSource, type GroundedClaim } from "../lib/law-grounding";
import { CASE_ATTRIBUTION, SE_ATTRIBUTION, caseParaUrl, caseSource, casesForArticle, seDeps, seLabel, seSearch, seSource, swedishImplementations, type CaseRef, type SeSection } from "./law-layers";

export const EMBED_MODEL = "@cf/baai/bge-m3";
const ATTRIBUTION = "© European Union, https://eur-lex.europa.eu (Commission Decision 2011/833/EU). Only the Official Journal text is authentic. Not legal advice.";

export const LAW_ACTS: readonly LawAct[] = ACTS as LawAct[];

export interface LawAct { celex: string; short: string; name: string; area?: string; prior?: number; keywords?: string[] }
/**
 * One passage of the index. Since 18 Nov 2026 (eu-law-v2) also `lang` (en, sv), `area` (practice area) and `para` (the
 * article paragraph in force where this part starts, for pinpoint citations). English passages are searched; the other
 * languages are the same provisions, read by act and label to show and quote in the reader's language.
 */
export interface LawRow { id: string; celex: string; version_celex: string; short: string; act: string; area?: string | null; lang?: string; kind: string; label: string; num: string; heading: string | null; part: number; parts: number; para?: string | null; text: string; url: string; version: string }

const fold = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const ALIASES: Record<string, string> = {
  "general data protection regulation": "GDPR", "artificial intelligence act": "AI Act", "ai act": "AI Act", "eu ai act": "AI Act",
  "digital services act": "DSA", "digital markets act": "DMA", "nis 2": "NIS2", "nis2 directive": "NIS2", "mica": "MiCA",
  "vat": "VAT Directive", "vat directive": "VAT Directive", "2006 112": "VAT Directive", "accessibility act": "European Accessibility Act", "eaa": "European Accessibility Act",
  "eprivacy": "ePrivacy", "cookie directive": "ePrivacy", "psd2": "PSD2", "csrd": "CSRD", "csddd": "CSDDD", "cs3d": "CSDDD", "data act": "Data Act", "cra": "CRA",
  "cyber resilience act": "CRA", "dora": "DORA", "eidas": "eIDAS", "eidas 2": "eIDAS", "gpsr": "GPSR", "eudr": "EUDR", "cbam": "CBAM", "sfdr": "SFDR", "mdr": "MDR",
};
/** An act from its short name, full name, a common alias or its CELEX number; undefined for none. */
export function actOf(raw: string | undefined): LawAct | undefined {
  if (!raw?.trim()) return undefined;
  const key = fold(raw);
  const byAlias = Object.hasOwn(ALIASES, key) ? ALIASES[key] : undefined;
  const hit = LAW_ACTS.find((a) => a.celex === raw.trim().toUpperCase() || fold(a.short) === key || fold(a.name) === key || a.short === byAlias);
  if (!hit) throw new HttpError(400, `act "${raw.slice(0, 60)}" is not in the index; acts: ${LAW_ACTS.map((a) => a.short).join(", ")}`);
  return hit;
}

const STOP = new Set(["the", "a", "an", "of", "to", "in", "on", "for", "and", "or", "is", "are", "be", "by", "with", "what", "which", "who", "when", "how", "does", "do", "can", "under", "eu", "law", "article", "regulation", "directive", "i", "my", "we", "our", "it", "this", "that", "at", "as", "from", "if", "must", "shall"]);
/** The FTS5 MATCH expression for a free-text question: its content words, each quoted (so no query syntax gets through), OR-ed. */
export function ftsQuery(q: string): string | null {
  const words = [...new Set(fold(q).split(" ").filter((w) => w.length > 1 && !STOP.has(w)))].slice(0, 12);
  return words.length ? words.map((w) => `"${w}"`).join(" OR ") : null;
}

/** Reciprocal-rank fusion of several rankings (k = 60): ids found high in either list come first. */
export function fuse(lists: string[][], k = 60): string[] {
  const score = new Map<string, number>();
  for (const list of lists) list.forEach((id, i) => score.set(id, (score.get(id) ?? 0) + 1 / (k + i + 1)));
  return [...score.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
}

export interface LawDeps {
  embed(q: string): Promise<number[]>;
  vectors(v: number[], topK: number, filter: { short?: string; kind?: string }): Promise<string[]>;
  keywords(match: string, limit: number, filter: { short?: string; kind?: string }): Promise<string[]>;
  rows(ids: string[]): Promise<LawRow[]>;
  rerank(q: string, docs: string[]): Promise<{ index: number; score: number }[] | null>;
  /** The question in English (18 Nov 2026): keywords and the reranker read English, so a question in another language is put into English first. */
  translate?(q: string): Promise<string>;
  /** The same provisions in another language (all parts), by act short name and label. */
  localized?(provisions: { short: string; label: string }[], lang: string): Promise<LawRow[]>;
}

/** Languages whose official text is in the index besides English (build.mjs --langs). */
export const INDEXED_LANGS: readonly string[] = ["sv"];

/**
 * The acts a question is about, from the act's short name, full name or its own defining terms (eu-law-acts.json
 * `keywords`): "data protection" is GDPR, "invoice" the VAT Directive. At most two, the ones with the longest match.
 */
export function intendedActs(q: string): LawAct[] {
  const text = ` ${fold(q)} `;
  const hits = LAW_ACTS.map((a) => {
    const terms = [a.short, a.name, ...(a.keywords ?? [])].map(fold).filter((t) => t.length >= 3);
    const best = Math.max(0, ...terms.filter((t) => text.includes(` ${t} `)).map((t) => t.length));
    return { a, best };
  }).filter((h) => h.best > 0).sort((x, y) => y.best - x.best);
  return hits.slice(0, 2).map((h) => h.a);
}

export async function lawSearch(q: string, opts: { act?: LawAct; kind?: "article" | "recital"; count: number; lang?: string }, deps: LawDeps) {
  const filter = { ...(opts.act ? { short: opts.act.short } : {}), ...(opts.kind ? { kind: opts.kind } : {}) };
  // A question in another language is searched in English (18 Nov 2026): the keyword index and the reranker read
  // English, and the multilingual test of 16 Nov found the right article first for only 9 of 15 such questions.
  // The question as asked is still embedded too (bge-m3 is multilingual), so a poor translation cannot lose it.
  const lang = opts.lang ?? questionLang(q).iso;
  const english = lang !== "eng" && deps.translate ? (await deps.translate(q).catch(() => q)).trim().slice(0, 400) || q : q;
  const match = ftsQuery(english);
  // Without an act named by the caller, the acts the question is about are also searched on their own, so their
  // articles reach the reranker even when other acts use the same words more often.
  const intents = opts.act ? [] : intendedActs(english === q ? q : `${english} ${q}`);
  const [vector, asked] = await Promise.all([deps.embed(english), english === q ? Promise.resolve(null) : deps.embed(q).catch(() => null)]);
  const lists = await Promise.all([
    deps.vectors(vector, 30, filter),
    asked ? deps.vectors(asked, 20, filter).catch(() => [] as string[]) : Promise.resolve([] as string[]),
    match ? deps.keywords(match, 30, filter).catch(() => [] as string[]) : Promise.resolve([] as string[]),
    ...intents.flatMap((a) => [
      deps.vectors(vector, 15, { ...filter, short: a.short }).catch(() => [] as string[]),
      match ? deps.keywords(match, 15, { ...filter, short: a.short }).catch(() => [] as string[]) : Promise.resolve([] as string[]),
    ]),
  ]);
  const candidates = fuse(lists).slice(0, 30);
  if (!candidates.length) return { candidates: [] as LawRow[], scores: null as number[] | null, english };
  const rows = await deps.rows(candidates);
  const ordered = candidates.map((id) => rows.find((r) => r.id === id)).filter((r): r is LawRow => Boolean(r));
  const ranked = await deps.rerank(english, ordered.map((r) => `${r.short} ${r.label}${r.heading ? `: ${r.heading}` : ""}\n${r.text.slice(0, 1500)}`)).catch(() => null);
  if (!ranked?.length) return { candidates: onePerProvision(ordered), scores: null, english };
  const words = new Set(ftsQuery(english)?.replace(/"/g, "").split(" OR ") ?? []);
  const intended = new Set(intents.map((a) => a.short));
  const scored = ranked.filter((r) => r.index >= 0 && r.index < ordered.length).map((r) => ({ row: ordered[r.index], score: r.score + prior(ordered[r.index], words) + (intended.has(ordered[r.index].short) ? 0.05 : 0) }));
  scored.sort((a, b) => b.score - a.score);
  const seen = new Set<string>();
  const kept = scored.filter((s) => { const k = `${s.row.short}|${s.row.label}`; if (seen.has(k)) return false; seen.add(k); return true; });
  return { candidates: kept.map((s) => s.row), scores: kept.map((s) => Math.round(s.score * 1000) / 1000), english };
}

/**
 * The found provisions in the reader's language where the index holds it (Swedish since 18 Nov 2026): the same part when
 * it exists, else the provision's first part. Provisions without that language stay in English.
 */
export async function inLanguage(rows: LawRow[], lang: string, deps: LawDeps): Promise<LawRow[]> {
  if (lang === "en" || !INDEXED_LANGS.includes(lang) || !deps.localized || !rows.length) return rows;
  const other = await deps.localized(rows.map((r) => ({ short: r.short, label: r.label })), lang).catch(() => [] as LawRow[]);
  return rows.map((r) => {
    const same = other.filter((o) => o.short === r.short && o.label === r.label);
    return same.find((o) => o.part === r.part) ?? same.find((o) => o.part === 1) ?? r;
  });
}

/** The best-placed part of each article or recital only: one provision is one result. */
function onePerProvision(rows: LawRow[]): LawRow[] {
  const seen = new Set<string>();
  return rows.filter((r) => { const k = `${r.short}|${r.label}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

/**
 * Small, stated adjustments on top of the reranker, whose scores crowd near 1.0 (measured 14 Nov 2026 on
 * scripts/law-index/eval-questions.json): an operative article ranks before a recital explaining it; an article whose
 * heading carries the question's words ranks first ("Designation of gatekeepers" for "who is a gatekeeper"); an act's own
 * `prior` (eu-law-acts.json) moves narrow twins of a general act down (EUDPR repeats GDPR for EU institutions only).
 */
export function prior(row: Pick<LawRow, "kind" | "heading" | "short">, words: ReadonlySet<string>): number {
  const heading = new Set(fold(row.heading ?? "").split(" ").flatMap((w) => [w, w.replace(/s$/, "")]));
  const hits = [...words].filter((w) => heading.has(w) || heading.has(w.replace(/s$/, ""))).length;
  const act = LAW_ACTS.find((a) => a.short === row.short);
  return (row.kind === "article" ? 0.06 : 0) + (words.size ? 0.04 * Math.min(1, hits / Math.min(words.size, 3)) : 0) + (act?.prior ?? 0);
}

/** Bindings-backed dependencies: D1 for keywords and rows, Vectorize for meaning, Workers AI for embeddings and reranking. */
export function lawDeps(env: Env): LawDeps {
  const db = env.LAW_DB, index = env.LAW_VECTORS;
  if (!db || !index) throw new HttpError(503, "the EU law index is not available here; nothing was charged");
  const where = (filter: { short?: string; kind?: string }, alias = "p") => [filter.short ? `${alias}.short = ?` : "", filter.kind ? `${alias}.kind = ?` : ""].filter(Boolean);
  return {
    async embed(q) {
      const out = await runAi<{ data?: number[][] }>(env, EMBED_MODEL, { text: [q.slice(0, 2000)] });
      const v = out.data?.[0];
      if (!v?.length) throw new HttpError(502, "the embedding model gave no vector; nothing was charged");
      return v;
    },
    async vectors(v, topK, filter) {
      const r = await index.query(v, { topK, returnMetadata: "none", ...(filter.short || filter.kind ? { filter: { ...(filter.short ? { short: filter.short } : {}), ...(filter.kind ? { kind: filter.kind } : {}) } } : {}) });
      return r.matches.map((m) => m.id);
    },
    async keywords(match, limit, filter) {
      const conds = where(filter);
      const r = await db.prepare(`SELECT f.id AS id FROM passages_fts f JOIN passages p ON p.id = f.id WHERE passages_fts MATCH ?${conds.length ? ` AND ${conds.join(" AND ")}` : ""} ORDER BY bm25(passages_fts, 0, 1.0, 4.0, 3.0, 1.0) LIMIT ?`)
        .bind(match, ...(filter.short ? [filter.short] : []), ...(filter.kind ? [filter.kind] : []), limit).all<{ id: string }>();
      return (r.results ?? []).map((x) => x.id);
    },
    async rows(ids) {
      const r = await db.prepare(`SELECT * FROM passages WHERE id IN (${ids.map(() => "?").join(",")})`).bind(...ids).all<LawRow>();
      return r.results ?? [];
    },
    async rerank(q, docs) {
      const out = await runAi<{ response?: { id: number; score: number }[] }>(env, RERANK_MODEL, { query: q.slice(0, 1000), contexts: docs.map((text) => ({ text })), top_k: docs.length });
      return (out.response ?? []).map((r) => ({ index: r.id, score: r.score }));
    },
    async translate(q) {
      return chat(env, "Translate the user's question about EU law into English. Keep act names, article numbers and legal terms exact. Reply with the English question only.", q.slice(0, 400), 160, 0, CHAT_MODEL);
    },
    async localized(provisions, lang) {
      const keys = [...new Set(provisions.map((p) => `${p.short}|${p.label}`))].slice(0, 20);
      if (!keys.length) return [];
      const r = await db.prepare(`SELECT * FROM passages WHERE lang = ? AND (short || '|' || label) IN (${keys.map(() => "?").join(",")})`).bind(lang, ...keys).all<LawRow>();
      return r.results ?? [];
    },
  };
}

/** The answer: one entry per passage, with its citation, link and version; ATTRIBUTION travels with every answer. */
export function lawAnswer(q: string, act: LawAct | undefined, kind: string | undefined, count: number, found: { candidates: LawRow[]; scores: number[] | null }) {
  // Swedish text is cited the Swedish way ("GDPR, artikel 6", "skäl 47"); the label itself stays English (it is the key).
  const cite = (r: LawRow) => r.lang === "sv"
    ? `${r.short}, ${r.label.replace(/^Article /, "artikel ").replace(/^Recital /, "skäl ")}${r.parts > 1 ? ` (del ${r.part} av ${r.parts})` : ""}`
    : `${r.short}, ${r.label}${r.parts > 1 ? ` (part ${r.part} of ${r.parts})` : ""}`;
  const results = found.candidates.slice(0, count).map((r, i) => ({
    act: r.act, short: r.short, celex: r.celex, citation: cite(r),
    kind: r.kind, label: r.label, ...(r.heading ? { heading: r.heading } : {}), text: r.text, url: r.url, version: r.version,
    language: r.lang ?? "en", ...(r.para ? { paragraph: r.para } : {}),
    ...(found.scores ? { score: found.scores[i] } : {}),
  }));
  return { query: q, ...(act ? { act: act.short } : {}), ...(kind ? { kind } : {}), count: results.length, results, actsIndexed: LAW_ACTS.length, attribution: ATTRIBUTION };
}

/**
 * The model that writes grounded answers. Chosen 18 Nov 2026 with scripts/law-index/eval-answers.mjs on 34 questions
 * (24 held-out English, 10 in other languages): Llama 3.3 70B answered 32, kept 145 of 151 quotes, cited the expected
 * article for 29, 5.5 s on average; Llama 4 Scout 32 / 83 of 87 / 28 / 16 s; gpt-oss-120b 30 / 103 of 114 / 26 / 8 s.
 */
export const LAW_ANSWER_MODEL = LARGE_CHAT_MODELS["llama-3.3-70b"];

/**
 * A short answer from the articles found, the beat-Exa plan's answer over our own index (14 Nov 2026): Exa's /answer is
 * not payable over x402 and our general /ai/answer reads Brave results, which are not to be scaled. The model sees only
 * the numbered provisions and must cite them; with no articles there is no model call.
 */
/** The official EU languages by ISO 639-3 code (franc's output). */
const EU_LANGUAGES: Record<string, string> = {
  eng: "English", swe: "Swedish", deu: "German", fra: "French", spa: "Spanish", pol: "Polish", ita: "Italian", nld: "Dutch",
  por: "Portuguese", dan: "Danish", fin: "Finnish", ces: "Czech", ron: "Romanian", hun: "Hungarian", ell: "Greek",
  bul: "Bulgarian", hrv: "Croatian", slk: "Slovak", slv: "Slovenian", lit: "Lithuanian", lvs: "Latvian", ekk: "Estonian",
  gle: "Irish", mlt: "Maltese",
};
/** EUR-Lex's language codes (the two letters in /legal-content/XX/TXT/) for the same ISO 639-3 codes. */
export const EURLEX_CODES: Record<string, string> = {
  eng: "EN", swe: "SV", deu: "DE", fra: "FR", spa: "ES", pol: "PL", ita: "IT", nld: "NL", por: "PT", dan: "DA", fin: "FI",
  ces: "CS", ron: "RO", hun: "HU", ell: "EL", bul: "BG", hrv: "HR", slk: "SK", slv: "SL", lit: "LT", lvs: "LV", ekk: "ET",
  gle: "GA", mlt: "MT",
};
/** The question's EU language: its ISO 639-3 code, English name and EUR-Lex code; English when unsure. */
export function questionLang(question: string): { iso: string; name: string; eurlex: string } {
  const code = franc(question, { minLength: 10, only: Object.keys(EU_LANGUAGES) });
  const iso = Object.hasOwn(EU_LANGUAGES, code) ? code : "eng";
  return { iso, name: EU_LANGUAGES[iso], eurlex: EURLEX_CODES[iso] };
}
/** The question's language among the EU languages, English when unsure (short questions are hard to tell). */
export function questionLanguage(question: string): string {
  return questionLang(question).name;
}
/** The same EUR-Lex page in another official language (the article anchors are the same in every language). */
export const eurlexIn = (url: string, eurlexCode: string) => url.replace(/\/legal-content\/[A-Z]{2}\//, `/legal-content/${eurlexCode}/`);

/** lawAnswer's results as the grounding step reads them. */
export const sourcesOf = (results: ReturnType<typeof lawAnswer>["results"]): GroundSource[] =>
  results.map((r) => ({ short: r.short, label: r.label, kind: r.kind, para: r.paragraph ?? null, text: r.text, url: r.url, lang: r.language }));

/** What answerFromArticles says when no sentence survived the quote check: the provisions are shown, no answer is. */
export const NOT_ANSWERED = "The provisions found do not answer this question directly enough to quote. Read them below.";

/**
 * A grounded answer from the provisions found (18 Nov 2026; replaces the free-text answer of 14 Nov): every sentence
 * carries a quote that is looked up in the provision it cites, and is dropped when the quote is not there
 * (src/lib/law-grounding.ts). Each kept sentence has a pinpoint citation ("GDPR, Article 6(1)(f)", Swedish style
 * "GDPR, artikel 6.1 f" for Swedish text). `answer` joins the kept sentences with [n] markers for callers that read one
 * string; `claims` carries each sentence with its quote, citation and link. With nothing kept, `grounded` is false and
 * `answer` says so: no model text reaches the reader unchecked.
 */
export async function answerFromArticles(env: Env, question: string, results: GroundSource[], opts: { plain?: boolean; model?: string } = {}) {
  const model = opts.model ?? LAW_ANSWER_MODEL;
  if (!results.length) return { answer: "No provision in the indexed EU acts matches this question.", claims: [] as GroundedClaim[], grounded: false, model: null };
  // LexGlyph's page (15-16 Nov 2026): people, not software, read the answer, in the language they asked in.
  // The model ignored "the language of the question" in a Swedish test, so the language is detected and named.
  const lang = opts.plain ? questionLanguage(question) : "English";
  const reply = await chat(env, groundedPrompt(lang, Boolean(opts.plain)), groundedContext(question, results, 12000), 900, 0, model);
  const { kept, dropped } = verifyClaims(parseClaims(reply), results);
  if (!kept.length) return { answer: NOT_ANSWERED, claims: kept, grounded: false, dropped, model };
  return { answer: kept.map((k) => `${k.text} [${k.source}]`).join(" "), claims: kept, grounded: true, dropped, model };
}

export const LAW_SEARCH: Entry[] = [
  entry("/law/search", "EU law search: GDPR, AI Act, DSA, VAT and 180+ EU acts",
    `Search ${LAW_ACTS.length} EU acts article by article: Treaties, Charter, GDPR, AI Act, NIS2, DORA, MiFID II, employment, competition, procurement, company, IP, consumer and tax law, latest consolidated text in English (Swedish with lang=sv). Get act, article, heading, full text, EUR-Lex link and version; answer=true adds quote-checked sentences with pinpoint citations. Our own EU-stored index. Use for compliance questions and citing EU law. Not legal advice.`,
    ["eu-law", "legal-search", "gdpr", "ai-act", "compliance", "regulation", "eur-lex", "legal-research"], {
      q: { type: "string", description: "Question or keywords in any EU language; the articles are in English (at most 400 characters)", required: true, example: "which AI practices are banned" },
      act: { type: "string", description: "Only this act: short name (GDPR, AI Act, DSA, VAT Directive…), full name or CELEX number", example: "GDPR" },
      kind: { type: "string", description: "article or recital (default both)", enum: ["article", "recital"], example: "article" },
      count: { type: "integer", description: "Results (1-10, default 5)", example: 5 },
      lang: { type: "string", description: "Language of the legal text returned: en (default) or sv (the official Swedish text of the same provisions)", enum: ["en", "sv"], example: "en" },
      answer: { type: "string", description: "true: also a short AI-written answer in which every sentence quotes the provision it rests on, checked word for word, with a pinpoint citation (Article 6(1)(f)); sentences whose quote is not found are dropped. Not legal advice", example: "false" },
      cases: { type: "string", description: "true: each article also lists the Court of Justice judgments that discuss it most (case number, parties, ECLI, date, first paragraph citing it, link)", example: "false" },
      swedish: { type: "string", description: "true: also the Swedish statute sections that match the question (Swedish law, section by section) and the Swedish statutes implementing the directives found", example: "false" },
    },
    // A real answer from the live index, 14 Nov 2026 (2 of 5 results shown; the first article's text shortened here).
    {
      query: "which AI practices are banned", count: 5,
      results: [
        { act: "Artificial Intelligence Act", short: "AI Act", celex: "32024R1689", citation: "AI Act, Article 5 (part 1 of 11)", kind: "article", label: "Article 5", heading: "Prohibited AI practices",
          text: "1. The following AI practices shall be prohibited:\n(a) the placing on the market, the putting into service or the use of an AI system that deploys subliminal techniques beyond a person’s consciousness or purposefully manipulative or deceptive techniques…",
          url: "https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:02024R1689-20260727#art_5", version: "consolidated text of 2026-07-27", language: "en", paragraph: "1", score: 1.084 },
        { act: "Artificial Intelligence Act", short: "AI Act", celex: "32024R1689", citation: "AI Act, Recital 45", kind: "recital", label: "Recital 45",
          text: "(45) Practices that are prohibited by Union law, including data protection law, non-discrimination law, consumer protection law, and competition law, should not be affected by this Regulation.",
          url: "https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32024R1689#rct_45", version: "recital as published in the Official Journal", language: "en", score: 0.994 },
      ],
      actsIndexed: LAW_ACTS.length, attribution: ATTRIBUTION,
    },
    async (env, q) => {
      const query = need(q, "q", 400);
      const act = actOf(opt(q, "act", 120));
      const kindRaw = opt(q, "kind", 20)?.toLowerCase();
      if (kindRaw && kindRaw !== "article" && kindRaw !== "recital") throw new HttpError(400, "kind is article or recital");
      const kind = kindRaw as "article" | "recital" | undefined;
      const count = num(q, "count", { min: 1, max: 10, fallback: 5, integer: true });
      const textLang = (opt(q, "lang", 5) ?? "en").toLowerCase();
      if (textLang !== "en" && !INDEXED_LANGS.includes(textLang)) throw new HttpError(400, `lang is en or ${INDEXED_LANGS.join(", ")}`);
      const deps = lawDeps(env);
      const found = await lawSearch(query, { act, kind, count }, deps);
      const shown = { ...found, candidates: await inLanguage(found.candidates.slice(0, count), textLang, deps) };
      const out = lawAnswer(query, act, kind, count, shown);
      // Phase B layers (18 Nov 2026), only when asked for: they add database reads and, for Swedish law, one embedding.
      const withCases = flag(q, "cases"), withSe = flag(q, "swedish");
      const db = env.LAW_DB!;
      const se = withSe ? seDeps(env) : null;
      const [cases, seImpl, seHits] = await Promise.all([
        withCases ? Promise.all(out.results.map((r) => (r.kind === "article" ? casesForArticle(db, r.short, r.label.replace(/^Article /, ""), 3).catch(() => [] as CaseRef[]) : Promise.resolve([] as CaseRef[])))) : Promise.resolve(null),
        withSe ? swedishImplementations(db, out.results.map((r) => r.short)).catch(() => []) : Promise.resolve(null),
        se ? seSearch(query, se, 3).catch(() => [] as SeSection[]) : Promise.resolve(null),
      ]);
      const results = cases ? out.results.map((r, i) => ({ ...r, caseLaw: cases[i].map((c) => ({ case: c.number, parties: c.parties, ecli: c.ecli, date: c.date, paragraph: c.para, paragraphsCiting: c.mentions, text: c.text, url: caseParaUrl(c.url, c.para) })) })) : out.results;
      const layered = {
        ...out, results,
        ...(seHits ? { swedishLaw: seHits.map((x) => ({ citation: `${seLabel(x)} ${x.name}`, heading: x.heading, text: x.text, url: x.url })), implementedInSweden: seImpl, swedishAttribution: SE_ATTRIBUTION } : {}),
        ...(cases ? { caseAttribution: CASE_ATTRIBUTION } : {}),
      };
      if (!flag(q, "answer")) return layered;
      const sources = [...sourcesOf(out.results), ...(seHits ?? []).slice(0, 2).map(seSource), ...(cases ?? []).slice(0, 2).flatMap((l) => l.slice(0, 1)).filter((c) => c.text).map(caseSource)];
      return { ...layered, ...(await answerFromArticles(env, query, sources)) };
    }, "$0.005"),
];
