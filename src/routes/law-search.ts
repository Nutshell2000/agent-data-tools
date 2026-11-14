/**
 * EU law search (14 Nov 2026): our own search index, the first of the beat-Exa plan
 * (business/research-2026-11-14-biggest-earners/beat-exa-master-plan.md, Phase 2). 46 EU acts that agents and companies
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
import { entry, num, need, opt, type Entry } from "../family";
import { HttpError, type Env } from "../lib/env";
import { runAi } from "../lib/ai";
import { RERANK_MODEL } from "./retrieval";
import ACTS from "../data/eu-law-acts.json";

export const EMBED_MODEL = "@cf/baai/bge-m3";
const ATTRIBUTION = "© European Union, https://eur-lex.europa.eu (Commission Decision 2011/833/EU). Only the Official Journal text is authentic. Not legal advice.";

export interface LawAct { celex: string; short: string; name: string }
export const LAW_ACTS: readonly LawAct[] = ACTS as LawAct[];

export interface LawRow { id: string; celex: string; version_celex: string; short: string; act: string; kind: string; label: string; num: string; heading: string | null; part: number; parts: number; text: string; url: string; version: string }

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
}

export async function lawSearch(q: string, opts: { act?: LawAct; kind?: "article" | "recital"; count: number }, deps: LawDeps) {
  const filter = { ...(opts.act ? { short: opts.act.short } : {}), ...(opts.kind ? { kind: opts.kind } : {}) };
  const match = ftsQuery(q);
  const [byMeaning, byWords] = await Promise.all([
    deps.embed(q).then((v) => deps.vectors(v, 30, filter)),
    match ? deps.keywords(match, 30, filter).catch(() => [] as string[]) : Promise.resolve([] as string[]),
  ]);
  const candidates = fuse([byMeaning, byWords]).slice(0, 20);
  if (!candidates.length) return { candidates: [] as LawRow[], scores: null as number[] | null };
  const rows = await deps.rows(candidates);
  const ordered = candidates.map((id) => rows.find((r) => r.id === id)).filter((r): r is LawRow => Boolean(r));
  const ranked = await deps.rerank(q, ordered.map((r) => `${r.short} ${r.label}${r.heading ? `: ${r.heading}` : ""}\n${r.text.slice(0, 1500)}`)).catch(() => null);
  if (!ranked?.length) return { candidates: ordered, scores: null };
  const byScore = [...ranked].sort((a, b) => b.score - a.score).filter((r) => r.index >= 0 && r.index < ordered.length);
  return { candidates: byScore.map((r) => ordered[r.index]), scores: byScore.map((r) => Math.round(r.score * 1000) / 1000) };
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
  };
}

/** The answer: one entry per passage, with its citation, link and version; ATTRIBUTION travels with every answer. */
export function lawAnswer(q: string, act: LawAct | undefined, kind: string | undefined, count: number, found: { candidates: LawRow[]; scores: number[] | null }) {
  const results = found.candidates.slice(0, count).map((r, i) => ({
    act: r.act, short: r.short, celex: r.celex, citation: `${r.short}, ${r.label}${r.parts > 1 ? ` (part ${r.part} of ${r.parts})` : ""}`,
    kind: r.kind, label: r.label, ...(r.heading ? { heading: r.heading } : {}), text: r.text, url: r.url, version: r.version,
    ...(found.scores ? { score: found.scores[i] } : {}),
  }));
  return { query: q, ...(act ? { act: act.short } : {}), ...(kind ? { kind } : {}), count: results.length, results, actsIndexed: LAW_ACTS.length, attribution: ATTRIBUTION };
}

export const LAW_SEARCH: Entry[] = [
  entry("/law/search", "EU law search: GDPR, AI Act, DSA, VAT and 40+ EU acts",
    `Search ${LAW_ACTS.length} EU acts article by article: GDPR, AI Act, DSA, DMA, NIS2, DORA, MiCA, Data Act, VAT Directive, CSRD, PSD2 and more, in their latest consolidated English text, plus recitals. Ask in plain words; get the matching articles with act, article number, heading, full text, EUR-Lex link and version. Our own index (keyword + meaning, reranked), hosted in the EU. Use for compliance questions and citing EU law. Not legal advice.`,
    ["eu-law", "legal-search", "gdpr", "ai-act", "compliance", "regulation", "eur-lex", "legal-research"], {
      q: { type: "string", description: "Question or keywords, in English (at most 400 characters)", required: true, example: "when is processing of personal data lawful" },
      act: { type: "string", description: "Only this act: short name (GDPR, AI Act, DSA, VAT Directive…), full name or CELEX number", example: "GDPR" },
      kind: { type: "string", description: "article or recital (default both)", enum: ["article", "recital"], example: "article" },
      count: { type: "integer", description: "Results (1-10, default 5)", example: 5 },
    },
    { query: "when is processing of personal data lawful", count: 0, results: [], actsIndexed: LAW_ACTS.length, attribution: ATTRIBUTION },
    async (env, q) => {
      const query = need(q, "q", 400);
      const act = actOf(opt(q, "act", 120));
      const kindRaw = opt(q, "kind", 20)?.toLowerCase();
      if (kindRaw && kindRaw !== "article" && kindRaw !== "recital") throw new HttpError(400, "kind is article or recital");
      const kind = kindRaw as "article" | "recital" | undefined;
      const count = num(q, "count", { min: 1, max: 10, fallback: 5, integer: true });
      const found = await lawSearch(query, { act, kind, count }, lawDeps(env));
      return lawAnswer(query, act, kind, count, found);
    }, "$0.005"),
];
