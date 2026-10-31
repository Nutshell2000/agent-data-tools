import { MODEL_PATHS } from "../routes/ai-text";

/**
 * Tools that use a limited shared resource (Browser Rendering, AI media models, paid search): never free, never via
 * marketplaces. The AI text tools (/ai/chat, /ai/embed, /ai/summarize-text, /ai/translate…) left this set on 25 Oct 2026
 * (Workers Paid, Peter's decision): they are the category buyers pay most for, so the 25 free calls now let an assistant
 * user try them; AI_DAILY_CAP (src/lib/ai.ts) bounds the Workers AI bill whatever the free traffic does.
 */
// The per-model chat endpoints (/ai/model/*) and /ai/chat-large cost more Workers AI per call than the 8B text tools,
// so they stay paid-only: the free calls cover the cheap AI text tools.
// /page/publish stores content and runs a moderation model per call: paid only, never on marketplaces (1.84.0).
export const CAPACITY_LIMITED = new Set(["/summarize", "/page/publish", "/screenshot", "/extract/rendered", "/image", "/transcribe", "/describe", "/search", "/news", "/pack/web-research", "/pack/news-sentiment", "/ai/answer", "/ai/fact-check", "/ai/chat-large", ...MODEL_PATHS]);