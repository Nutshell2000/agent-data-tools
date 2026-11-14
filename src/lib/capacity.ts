import { MODEL_PATHS } from "../routes/ai-text";
import { HTTP_FREE_EXCLUDED } from "./free-calls";

/**
 * Tools that use a limited shared resource (Browser Rendering, AI media models, paid search): never free, never via
 * marketplaces. The AI text tools (/ai/chat, /ai/embed, /ai/summarize-text, /ai/translate…) left this set on 25 Oct 2026
 * (Workers Paid, the owner's decision): they are the category buyers pay most for, so the 25 free calls now let an assistant
 * user try them; AI_DAILY_CAP (src/lib/ai.ts) bounds the Workers AI bill whatever the free traffic does.
 */
// The per-model chat endpoints (/ai/model/*) and /ai/chat-large cost more Workers AI per call than the 8B text tools,
// so they stay paid-only: the free calls cover the cheap AI text tools.
// /page/publish stores content and runs a moderation model per call: paid only, never on marketplaces (1.84.0).
// /audit/contract (1.131.0) runs three large-model reviews a call and costs $1: paid only.
// The entry paths of capacity-limited tools (src/routes/entry-paths.ts, 7 Nov 2026) follow their canonical tool.
export const CAPACITY_LIMITED = new Set(["/summarize", "/page/publish", "/page/host", "/screenshot", "/screenshot/website", "/extract/rendered", "/image", "/image/generate", "/transcribe", "/text-to-speech", "/describe", "/search", "/search/web", "/web/search", "/search/similar", "/news", "/news/search", "/crypto/news", "/pack/web-research", "/pack/news-sentiment", "/ai/answer", "/ai/fact-check", "/ai/chat-large", "/llm/inference", "/ai/speech", "/ai/tts", "/audit/website", "/audit/contract", "/contract/audit", ...MODEL_PATHS]);
// /invoice/check (1.180.0): a model call plus up to two VIES checks, $0.05: paid only.
CAPACITY_LIMITED.add("/invoice/check");
/** True when a plain HTTP request with trial=1 may run this tool free (lib/free-calls.ts): not capacity-limited, and not taken out of the HTTP trial. */
export const httpFree = (path: string) => !CAPACITY_LIMITED.has(path) && !HTTP_FREE_EXCLUDED.has(path);
