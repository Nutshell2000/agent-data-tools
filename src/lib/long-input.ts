import { HttpError } from "./env";
// Long POST fields that must not travel in the URL (1.131.0, 11 Nov 2026). A POST to a tool is forwarded as the GET
// with its fields in the query (src/index.ts), and the payment quote repeats that URL in the PAYMENT-REQUIRED header:
// a 7,000-character field already makes a 15.8 KB header (measured on /ai/chat), and Node's fetch refuses headers over
// 16 KB. A tool that takes a whole source file therefore gets the field as a short reference, "@sha256:<hex>", and the
// text itself waits here, in this isolate, until the forwarded request has finished. The reference is the hash of the
// text, so the unpaid quote and the paid retry of the same body name the same resource URL.

/** Tools whose long text inputs are held here instead of the URL, with the inputs it applies to. */
export const LONG_INPUT_FIELDS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  "/audit/contract": ["source"],
  "/contract/audit": ["source"],
  // An invoice as JSON, or a whole e-invoice XML (14 Nov 2026).
  "/einvoice/create": ["invoice"],
  "/einvoice/validate": ["xml"],
  "/einvoice/to-json": ["xml"],
  "/pack/einvoice-check": ["xml"],
});
/** Shorter values stay in the URL as before. */
export const LONG_INPUT_MIN = 1_500;

const held = new Map<string, { text: string; holders: number }>();
const REF = /^@sha256:[0-9a-f]{64}$/;

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Holds `text` for the running request and returns the reference to put in the URL. Pair every call with release(). */
export async function holdLongInput(text: string): Promise<string> {
  const ref = `@sha256:${await sha256Hex(text)}`;
  const entry = held.get(ref);
  if (entry) entry.holders++;
  else held.set(ref, { text, holders: 1 });
  return ref;
}

export function releaseLongInput(ref: string): void {
  const entry = held.get(ref);
  if (!entry) return;
  if (--entry.holders <= 0) held.delete(ref);
}

/**
 * The text a tool input stands for: the held text for a reference, the value itself otherwise. A reference that is
 * not held (a GET someone built by hand from a quote URL) is `null`: the caller must send the text in a POST body.
 */
export function longInput(value: string | undefined): string | undefined | null {
  if (value === undefined || !REF.test(value.trim())) return value;
  return held.get(value.trim())?.text ?? null;
}

export const __test = { held };

/**
 * The prompt-style inputs (21 Nov 2026). A POSTed chat history of about 8 KB made a 17.5 KB PAYMENT-REQUIRED header on
 * /ai/chat (the quote repeats the URL the body was flattened into), above the 16 KB that Node's fetch accepts, so the
 * buyer could not read the price. On any tool that takes one of these inputs, a long value travels as a reference too;
 * the shared input wrapper (normalizedInput in src/tools.ts) resolves it for every tool.
 */
export const PROMPT_LONG_FIELDS: readonly string[] = ["messages", "prompt", "system", "tools", "input", "text"];

/** The inputs of `path` that travel as references when long: the tool's own list, else its prompt-style inputs. */
export function longFieldsFor(path: string, params: Readonly<Record<string, unknown>>): readonly string[] | undefined {
  if (Object.hasOwn(LONG_INPUT_FIELDS, path)) return LONG_INPUT_FIELDS[path];
  const prompt = PROMPT_LONG_FIELDS.filter((name) => Object.hasOwn(params, name));
  return prompt.length ? prompt : undefined;
}

/** A prompt-style input as sent, with a held reference resolved; a reference that is not held is refused with 400. */
export function resolvedPromptInput(name: string, value: string | undefined): string | undefined {
  if (value === undefined || !PROMPT_LONG_FIELDS.includes(name)) return value;
  const text = longInput(value);
  if (text === null) throw new HttpError(400, `${name} is a reference to a text that is not held here; send the text itself in the POST body`);
  return text;
}
