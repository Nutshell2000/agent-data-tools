import { AI_PATHS } from "../routes/ai-text";

/** Tools that use a limited shared resource (Workers AI, Browser Rendering, paid search): never free, never via marketplaces. */
export const CAPACITY_LIMITED = new Set(["/summarize", "/screenshot", "/extract/rendered", "/image", "/transcribe", "/describe", "/search", ...AI_PATHS]);