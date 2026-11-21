import { MODEL_PATHS } from "../routes/ai-text";
import { HTTP_FREE_EXCLUDED } from "./free-calls";

/**
 * Tools that use a limited shared resource (Browser Rendering, AI media models, paid search): never free, never via
 * marketplaces. The AI text tools (/ai/chat, /ai/embed, /ai/summarize-text, /ai/translate…) left this set on 25 Oct 2026
 * (Workers Paid, the owner's decision), so marketplaces sell them. From then until 21 Nov 2026 the free calls ran them
 * too; since then they are in METERED_NOT_CAPACITY_LIMITED below and no free path runs them.
 */
// The per-model chat endpoints (/ai/model/*) and /ai/chat-large cost more Workers AI per call than the 8B text tools,
// so they stay paid-only and off the marketplaces.
// /page/publish stores content and runs a moderation model per call: paid only, never on marketplaces (1.84.0).
// /audit/contract (1.131.0) runs three large-model reviews a call and costs $1: paid only.
// The entry paths of capacity-limited tools (src/routes/entry-paths.ts, 7 Nov 2026) follow their canonical tool.
export const CAPACITY_LIMITED = new Set(["/summarize", "/page/publish", "/page/host", "/screenshot", "/screenshot/website", "/extract/rendered", "/image", "/image/generate", "/transcribe", "/text-to-speech", "/describe", "/search", "/search/web", "/web/search", "/search/similar", "/exa/search", "/news", "/news/search", "/crypto/news", "/pack/web-research", "/pack/news-sentiment", "/ai/answer", "/ai/fact-check", "/ai/chat-large", "/llm/inference", "/ai/speech", "/ai/tts", "/audit/website", "/audit/contract", "/contract/audit", ...MODEL_PATHS]);
// /invoice/check (1.180.0): a model call plus up to two VIES checks, $0.05: paid only.
CAPACITY_LIMITED.add("/invoice/check");
// Resold LinkedIn and X data (src/routes/resale.ts): every call buys from another seller, so never a free call.
for (const p of ["/linkedin/profile", "/linkedin/company-posts", "/x/search"]) CAPACITY_LIMITED.add(p);
/** True when a plain HTTP request with trial=1 may run this tool free (lib/free-calls.ts): not metered or capacity-limited (FREE_EXCLUDED_METERED below), and not taken out of the HTTP trial. */
export const httpFree = (path: string) => !FREE_EXCLUDED_METERED.has(path) && !HTTP_FREE_EXCLUDED.has(path);
// Glyphcall Voice (1.189.0, routes/voice.ts): Whisper over up to an hour of audio and Aura-1 speech: paid only.
for (const p of ["/transcribe/long", "/text-to-speech/lite", "/transcribe/summary"]) CAPACITY_LIMITED.add(p);
// Glyphcall Voice round 4 (1.204.0, routes/voice-plus.ts): Nova-3 diarization and M2M100 subtitle translation: paid only.
for (const p of ["/transcribe/speakers", "/subtitles/translate", "/dub", "/voice/agent"]) CAPACITY_LIMITED.add(p);
CAPACITY_LIMITED.add("/audio/transcribe"); // 15 Nov 2026: the door to /transcribe
CAPACITY_LIMITED.add("/speech/to-text"); // 20 Nov 2026: round-13 door to /transcribe
CAPACITY_LIMITED.add("/news/sentiment"); // 20 Nov 2026: round-13 door to /pack/news-sentiment
// 1.304.0 (20 Nov 2026): big-paying-job doors to capacity-limited canonicals.
for (const p of ["/full-website-audit", "/image/generation", "/text-to-speech-generate"]) CAPACITY_LIMITED.add(p);
// Voice studio (1.206.0, routes/voice-studio.ts): Aura-2 for every line or caption, paid only (16 Nov 2026: they were
// missing here, so the free calls and the local smoke run would have run them).
for (const p of ["/dialogue", "/text-to-speech/captions"]) CAPACITY_LIMITED.add(p);
// 21 Nov 2026: the signed answers and the evidence bundle ($0.05) put this service's signature on a receipt, so a free
// call handed out signed attestations; they were missing here and only began to answer in 1.323.0. Paid only.
for (const p of ["/answers/page-evidence", "/answers/company-diligence", "/evidence/bundle"]) CAPACITY_LIMITED.add(p);

/**
 * Metered tools that are not capacity-limited: a paying buyer and a marketplace may run them like any other tool, but
 * each call can spend model money (Workers AI: chat, embeddings, rerank, moderation, translation, OCR by a vision
 * model) or a Vectorize query, so no free path runs them (21 Nov 2026, the owner: a free user must cost nothing metered).
 * Entry paths are listed with their canonical tool.
 */
export const METERED_NOT_CAPACITY_LIMITED: readonly string[] = [
  // The AI text tools (routes/ai-text.ts) and their entry paths.
  "/ai/chat", "/llm/chat", "/chat/completions", "/ai/summarize-text", "/ai/summarize", "/ai/sentiment", "/ai/sentiment-analysis", "/sentiment/analysis",
  "/ai/classify", "/ai/keywords", "/ai/rewrite", "/ai/outline", "/ai/translate", "/ai/translate-text", "/ai/embed", "/ai/embeddings", "/ai/extract-json",
  // Moderation and rerank models (routes/safety.ts, routes/retrieval.ts).
  "/ai/moderation", "/ai/rerank",
  // A model call inside a wider tool: OCR of scanned pages and field extraction, the token verdict's summary, and
  // the title guess of the paper search.
  "/document/text", "/document/extract", "/token/verdict", "/papers",
  // EU law search: an embedding model and a Vectorize query per call (routes/law-search.ts).
  "/law/search",
];

/**
 * THE list of tools no free path runs: everything metered (a handler that can spend model money, hosted browser
 * rendering, the paid search API, resold data or a Vectorize query) and everything capacity-limited or paid-only for
 * another reason. HTTP trial=1, the free MCP calls (anonymous and signed in), a free key's monthly calls, the ChatGPT
 * plugin's daily calls, review keys and the live example pages all ask `freeEligible`, and a tool in this set answers
 * a free attempt with the ordinary payment request. tests/free-metered.test.cjs reads the handlers' source and fails
 * when a tool that can reach a metered binding is missing here.
 */
export const FREE_EXCLUDED_METERED: ReadonlySet<string> = new Set([...CAPACITY_LIMITED, ...METERED_NOT_CAPACITY_LIMITED]);
/** True when a free call (MCP, a free key's monthly call, a daily call) may run this tool. */
export const freeEligible = (path: string) => !FREE_EXCLUDED_METERED.has(path);
