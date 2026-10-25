// Content safety tools (25 Oct 2026). Bazaar search that day, nothing of ours in the results: "pii detection" (41 payers
// summed over the top 20), "pii redaction" (39), "content moderation" (30). PII detection is local pattern matching with
// checksums (Luhn for cards, mod-97 for IBANs), so it costs nothing to run; moderation runs Meta's Llama Guard 3 on Workers
// AI (Llama 3.1 Community License), about $0.0001 a call.
import { entry, need, opt, type Entry } from "../family";
import { runAi } from "../lib/ai";
import { HttpError } from "../lib/env";
import { ibanCheck, luhn } from "./utils";

type Hit = { type: string; start: number; end: number; value: string };
const PATTERNS: [string, RegExp][] = [
  ["email", /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,24}/gi],
  ["iban", /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]){11,30}\b/g],
  ["credit_card", /\b\d(?:[ -]?\d){12,18}\b/g],
  ["us_ssn", /\b\d{3}-\d{2}-\d{4}\b/g],
  ["crypto_address", /\b0x[a-fA-F0-9]{40}\b|\bbc1[a-z0-9]{25,59}\b/g],
  ["ip_address", /\b(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}\b/g],
  ["phone", /(?:\+\d{1,3}[\s.-]?)?(?:\(\d{1,4}\)[\s.-]?)?\d{2,4}(?:[\s.-]\d{2,4}){1,4}/g],
];
const KEEP = (type: string, value: string) => {
  const digits = value.replace(/\D/g, "");
  if (type === "credit_card") return digits.length >= 13 && digits.length <= 19 && luhn(digits);
  if (type === "iban") return Boolean((ibanCheck(value) as { valid?: boolean }).valid);
  if (type === "phone") return digits.length >= 8 && digits.length <= 15 && (/^\+/.test(value) || /[\s.()-]/.test(value)) && !/^\d{4}-\d{2}-\d{2}$/.test(value.trim());
  return true;
};
const LABEL: Record<string, string> = { email: "[EMAIL]", iban: "[IBAN]", credit_card: "[CARD]", us_ssn: "[SSN]", crypto_address: "[WALLET]", ip_address: "[IP]", phone: "[PHONE]" };

/** Personal data in a text: typed hits (earlier patterns win overlaps), counts, and the text with each hit replaced. */
export function piiScan(text: string, types?: Set<string>) {
  const hits: Hit[] = [];
  for (const [type, re] of PATTERNS) {
    if (types && !types.has(type)) continue;
    for (const m of text.matchAll(re)) {
      const start = m.index ?? 0, end = start + m[0].length;
      if (!KEEP(type, m[0]) || hits.some((h) => start < h.end && end > h.start)) continue;
      hits.push({ type, start, end, value: m[0] });
    }
  }
  hits.sort((a, b) => a.start - b.start);
  let redacted = "", at = 0;
  for (const h of hits) { redacted += text.slice(at, h.start) + LABEL[h.type]; at = h.end; }
  redacted += text.slice(at);
  const counts: Record<string, number> = {};
  for (const h of hits) counts[h.type] = (counts[h.type] ?? 0) + 1;
  // Each hit is shown masked (first and last two characters): the answer should not repeat the data it found.
  const mask = (v: string) => (v.length <= 6 ? "*".repeat(v.length) : `${v.slice(0, 2)}${"*".repeat(Math.min(12, v.length - 4))}${v.slice(-2)}`);
  return { found: hits.length, counts, items: hits.map((h) => ({ type: h.type, start: h.start, end: h.end, masked: mask(h.value) })), redacted };
}

/** Llama Guard 3 hazard categories (MLCommons taxonomy). */
export const GUARD_CATEGORIES: Readonly<Record<string, string>> = {
  S1: "Violent crimes", S2: "Non-violent crimes", S3: "Sex-related crimes", S4: "Child sexual exploitation", S5: "Defamation",
  S6: "Specialized advice", S7: "Privacy", S8: "Intellectual property", S9: "Indiscriminate weapons", S10: "Hate",
  S11: "Suicide and self-harm", S12: "Sexual content", S13: "Elections", S14: "Code interpreter abuse",
};
export const GUARD_MODEL = "@cf/meta/llama-guard-3-8b";
/** "safe" or "unsafe\nS9,S1" from Llama Guard as a verdict. */
export function guardVerdict(reply: string) {
  const text = reply.trim().toLowerCase();
  if (!/^(safe|unsafe)/.test(text)) throw new HttpError(502, "the moderation model gave no verdict");
  const flagged = text.startsWith("unsafe");
  const codes = flagged ? [...new Set((reply.match(/S\d{1,2}/g) ?? []).filter((c) => GUARD_CATEGORIES[c]))] : [];
  return { flagged, categories: codes.map((code) => ({ code, name: GUARD_CATEGORIES[code] })) };
}

const PII_TYPES = Object.keys(LABEL);
export const SAFETY: Entry[] = [
  entry("/text/pii", "PII detection and redaction: emails, phones, cards, IBANs",
    "Find personal data in a text and get it back redacted: emails, phone numbers, card numbers (Luhn-checked), IBANs (mod-97), US SSNs, IP and crypto wallet addresses, each with its position, plus the text with every hit replaced by a label such as [EMAIL]. Hits are shown masked. Up to 20,000 characters; names and street addresses are not detected. Use before logging, storing or sending text to a model.",
    ["pii-detection", "pii-redaction", "redact", "privacy", "text"], {
      text: { type: "string", description: "The text to scan (up to 20,000 characters)", required: true, example: "Contact Anna at anna.berg@example.com or +46 70 123 45 67; card 4111 1111 1111 1111." },
      types: { type: "string", description: `Optional comma-separated types to look for: ${PII_TYPES.join(", ")} (default all)`, example: "email,phone" },
    },
    { found: 3, counts: { email: 1, credit_card: 1, phone: 1 }, items: [{ type: "email", start: 16, end: 37, masked: "an************om" }, { type: "phone", start: 41, end: 57, masked: "+4************67" }, { type: "credit_card", start: 64, end: 83, masked: "41************11" }], redacted: "Contact Anna at [EMAIL] or [PHONE]; card [CARD]." },
    (_env, q) => {
      const text = need(q, "text", 20_000);
      const raw = opt(q, "types", 200);
      const types = raw ? new Set(raw.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean)) : undefined;
      if (types) for (const t of types) if (!PII_TYPES.includes(t)) throw new HttpError(400, `unknown type "${t}"; use ${PII_TYPES.join(", ")}`);
      return piiScan(text, types);
    }, "$0.01"),

  entry("/ai/moderation", "Content moderation, safety check: Llama Guard 3",
    "Classify a text as safe or unsafe with Meta's Llama Guard 3 and name the hazard categories it falls into (violent and non-violent crimes, sexual content, child exploitation, hate, self-harm, weapons, privacy, defamation, elections and others; 14 in all). Up to 8,000 characters. Also available in the OpenAI moderation shape at /v1/moderations. Use to screen user messages, model outputs or content before an agent posts or acts on it.",
    ["content-moderation", "moderation", "safety", "llama-guard", "ai"], {
      text: { type: "string", description: "The text to classify (up to 8,000 characters)", required: true, example: "How do I bake sourdough bread at home?" },
    },
    { flagged: false, categories: [], model: GUARD_MODEL },
    async (env, q) => {
      const text = need(q, "text", 8000);
      const out = await runAi<{ response?: unknown }>(env, GUARD_MODEL, { messages: [{ role: "user", content: text }] });
      return { ...guardVerdict(String(out?.response ?? "")), model: GUARD_MODEL };
    }, "$0.002"),
];
