/**
 * Tools that use a limited shared resource (Browser Rendering, AI media models, paid search): never free, never via
 * marketplaces. The AI text tools (/ai/chat, /ai/embed, /ai/summarize-text, /ai/translate…) left this set on 25 Oct 2026
 * (Workers Paid, Peter's decision): they are the category buyers pay most for, so the 25 free calls now let an assistant
 * user try them; AI_DAILY_CAP (src/lib/ai.ts) bounds the Workers AI bill whatever the free traffic does.
 */
export const CAPACITY_LIMITED = new Set(["/summarize", "/screenshot", "/extract/rendered", "/image", "/transcribe", "/describe", "/search", "/news", "/pack/web-research", "/pack/news-sentiment"]);