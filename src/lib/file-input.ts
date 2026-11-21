// Files sent in a POST body (14 Nov 2026). Automation tools (Make, n8n, Power Automate, Zapier) and upload forms hold
// a file, not a public URL, so a tool that reads only `url` cannot serve them. A POST to a tool is forwarded as the GET
// with its fields in the query (src/index.ts), and bytes cannot travel in a URL: the file waits here, in this isolate,
// until the forwarded request has finished, and the URL carries a short reference, "@file:<sha256 of the bytes>". The
// reference is the hash of the bytes, so the unpaid quote and the paid retry of the same file name the same resource
// URL. Same idea as lib/long-input.ts, for bytes.

/** Tools that accept an uploaded file, with the largest file each takes. */
export const FILE_INPUT_PATHS: Readonly<Record<string, number>> = Object.freeze({
  // E-invoices (XML, or a ZUGFeRD / Factur-X PDF that embeds one).
  "/einvoice/validate": 5 * 1024 * 1024,
  "/einvoice/to-json": 5 * 1024 * 1024,
  "/pack/einvoice-check": 5 * 1024 * 1024, // runs the two tools above on the same file
  // 1.256.0: /pdf/text reads 10-20 MB URLs at a bounded one-time retry, so an automation tool that holds the
  // PDF rather than a URL gets the same ceiling. A 12 MB upload used to get a 413 while the same file over a URL worked.
  "/pdf/text": 20 * 1024 * 1024,
  "/pdf/extract": 10 * 1024 * 1024,
  // Audio (14 Nov 2026, voice plan): the same 5 MB as a URL fetch, so the price per call covers the longest file.
  "/transcribe": 5 * 1024 * 1024,
  "/audio/transcribe": 5 * 1024 * 1024, // 15 Nov 2026: the door to /transcribe
  "/transcribe/long": 25 * 1024 * 1024,
  "/transcribe/summary": 25 * 1024 * 1024, // 1.195.0: uploads (the Obsidian plugin and the voice pages send files)
  // 1.204.0: speaker labels, dubbing and the voice agent take uploads like the other transcription tools.
  "/transcribe/speakers": 25 * 1024 * 1024,
  "/dub": 25 * 1024 * 1024,
  "/voice/agent": 25 * 1024 * 1024,
  // Same alignment as /pdf/text: the URL path retries 10-20 MB once at the bounded ceiling (1.244.0).
  "/document/text": 20 * 1024 * 1024,
  "/document/extract": 10 * 1024 * 1024,
  "/invoice/check": 10 * 1024 * 1024,
});
/** The query name the reference travels under. */
export const FILE_INPUT = "file";
/** Reserved input the HTTP route sets from that query value (never a declared tool input): the tool reads the reference here. */
export const FILE_REF_INPUT = "@file";

import { readCapped } from "./read-capped";

const held = new Map<string, { bytes: Uint8Array; holders: number }>();
const REF = /^@file:[0-9a-f]{64}$/;

export const isFileRef = (value: string | undefined): boolean => value !== undefined && REF.test(value.trim());

/** Holds `bytes` for the running request and returns the reference to put in the URL. Pair every call with release(). */
export async function holdFile(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const ref = `@file:${[...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
  const entry = held.get(ref);
  if (entry) entry.holders++;
  else held.set(ref, { bytes, holders: 1 });
  return ref;
}

export function releaseFile(ref: string): void {
  const entry = held.get(ref);
  if (!entry) return;
  if (--entry.holders <= 0) held.delete(ref);
}

/** The bytes a reference stands for, or null when nothing is held under it (a GET built by hand from a quote URL). */
export function heldFile(value: string | undefined): Uint8Array | null {
  if (!isFileRef(value)) return null;
  return held.get(value!.trim())?.bytes ?? null;
}

function fromBase64(text: string): Uint8Array | null {
  const clean = text.replace(/^data:[^,]*,/, "").replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/");
  if (clean.length < 8 || !/^[A-Za-z0-9+/]+={0,2}$/.test(clean)) return null;
  try {
    const raw = atob(clean);
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  } catch { return null; }
}

export type SentFile =
  | { kind: "none"; fields: Record<string, string> }
  | { kind: "too-large"; limit: number }
  | { kind: "file"; bytes: Uint8Array; fields: Record<string, string> };

/**
 * The file in a POST, however the caller sent it: the raw bytes as the body (application/pdf, an office type, application/octet-stream
 * or no type), a multipart form with a `file` part (the other parts are returned as fields), or JSON with `file`,
 * `data` or `content` holding base64 or a data: URL. `kind: "none"` means the body holds no file and the request is
 * handled as before. Reads a clone, so the caller can still read the request as JSON.
 */
export async function sentFile(request: Request, limit: number): Promise<SentFile> {
  const type = (request.headers.get("content-type") ?? "").toLowerCase();
  const declared = Number(request.headers.get("content-length") ?? "0");
  // Base64 in JSON is a third larger than the file it holds; a form adds its boundaries and other fields.
  const wrapped = limit * 1.4 + 4096;
  if (declared > wrapped) return { kind: "too-large", limit };
  const fields: Record<string, string> = {};
  let bytes: Uint8Array | null = null;
  const multipart = type.startsWith("multipart/form-data");
  const json = !multipart && type.includes("json");
  // audio/* and video/* (1.195.0): browsers, the voice pages and the Obsidian plugin send a recording with its own type;
  // until then only application/octet-stream reached the transcription tools as a file.
  // image/*: a scan or a photo sent as the body. Until 1.187.0 it was read as "no file" and the caller was asked for a
  // url, although the document tools read PNG, JPEG and WebP (found 14 Nov 2026 by sending invoice2data's PNG invoices).
  const raw = !multipart && !json && (type === "" || /^(application\/(pdf|xml|octet-stream|zip|x-zip-compressed|msword|vnd\.|ogg)|binary\/|image\/|audio\/|video\/|text\/xml)/.test(type));
  if (!multipart && !json && !raw) return { kind: "none", fields };
  // 21 Nov 2026: the body is read through a counter and dropped at the limit. It used to be read whole
  // (arrayBuffer / formData / json) before its size was known, and the only earlier test was the declared
  // Content-Length, which a chunked upload does not send: an unpaid 100 MB POST was buffered in full, twice (body and
  // clone), before the 402 quote. Now a body over the tool's limit is refused after at most that many bytes.
  let body: { bytes: Uint8Array; over: boolean };
  try { body = await readCapped(request.clone().body, Math.floor(raw ? limit : wrapped)); }
  catch { return { kind: "none", fields }; }
  if (body.over) return { kind: "too-large", limit };
  if (multipart) {
    // Parsed from the counted bytes, with the request's own boundary.
    const form = await new Response(body.bytes, { headers: { "content-type": request.headers.get("content-type") ?? "" } }).formData().catch(() => null);
    if (!form) return { kind: "none", fields };
    for (const [name, value] of form.entries()) {
      if (typeof value === "string") { if (value.length <= 2000) fields[name] = value; continue; }
      if (bytes) continue; // the first file part is the file
      const part = value as unknown as Blob;
      if (part.size > limit) return { kind: "too-large", limit };
      bytes = new Uint8Array(await part.arrayBuffer());
    }
  } else if (json) {
    let parsed: unknown = null;
    try { parsed = JSON.parse(new TextDecoder().decode(body.bytes)); } catch { /* not JSON: no file */ }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { kind: "none", fields };
    const record = parsed as Record<string, unknown>;
    for (const name of [FILE_INPUT, "data", "content", "base64", "pdf", "document", "image"]) {
      // Own keys only: the body is the caller's, and "constructor" or "__proto__" must never read as a field.
      const value = Object.hasOwn(record, name) ? record[name] : undefined;
      if (typeof value !== "string" || value.length < 16) continue;
      bytes = fromBase64(value);
      if (bytes) break;
    }
  } else if (body.bytes.byteLength > 0) {
    bytes = body.bytes;
  }
  if (!bytes) return { kind: "none", fields };
  if (bytes.byteLength > limit) return { kind: "too-large", limit };
  return { kind: "file", bytes, fields };
}

export const __test = { held, fromBase64 };
