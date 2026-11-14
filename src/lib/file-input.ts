// Files sent in a POST body (14 Nov 2026). Automation tools (Make, n8n, Power Automate, Zapier) and upload forms hold
// a file, not a public URL, so a tool that reads only `url` cannot serve them. A POST to a tool is forwarded as the GET
// with its fields in the query (src/index.ts), and bytes cannot travel in a URL: the file waits here, in this isolate,
// until the forwarded request has finished, and the URL carries a short reference, "@file:<sha256 of the bytes>". The
// reference is the hash of the bytes, so the unpaid quote and the paid retry of the same file name the same resource
// URL. Same idea as lib/long-input.ts, for bytes.

/** Tools that accept an uploaded file, with the largest file each takes. */
export const FILE_INPUT_PATHS: Readonly<Record<string, number>> = Object.freeze({
  "/pdf/text": 10 * 1024 * 1024,
  "/pdf/extract": 10 * 1024 * 1024,
  // Audio (14 Nov 2026, voice plan): the same 5 MB as a URL fetch, so the price per call covers the longest file.
  "/transcribe": 5 * 1024 * 1024,
  "/document/text": 10 * 1024 * 1024,
  "/document/extract": 10 * 1024 * 1024,
});
/** The query name the reference travels under. */
export const FILE_INPUT = "file";
/** Reserved input the HTTP route sets from that query value (never a declared tool input): the tool reads the reference here. */
export const FILE_REF_INPUT = "@file";

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
  // Base64 in JSON is a third larger than the file it holds.
  if (declared > limit * 1.4 + 4096) return { kind: "too-large", limit };
  const fields: Record<string, string> = {};
  let bytes: Uint8Array | null = null;
  if (type.startsWith("multipart/form-data")) {
    const form = await request.clone().formData().catch(() => null);
    if (!form) return { kind: "none", fields };
    for (const [name, value] of form.entries()) {
      if (typeof value === "string") { if (value.length <= 2000) fields[name] = value; continue; }
      if (bytes) continue; // the first file part is the file
      const part = value as unknown as Blob;
      if (part.size > limit) return { kind: "too-large", limit };
      bytes = new Uint8Array(await part.arrayBuffer());
    }
  } else if (type.includes("json")) {
    const body = await request.clone().json().catch(() => null) as Record<string, unknown> | null;
    if (!body || typeof body !== "object" || Array.isArray(body)) return { kind: "none", fields };
    for (const name of [FILE_INPUT, "data", "content", "base64", "pdf", "document"]) {
      const value = body[name];
      if (typeof value !== "string" || value.length < 16) continue;
      bytes = fromBase64(value);
      if (bytes) break;
    }
  } else if (type === "" || /^(application\/(pdf|octet-stream|zip|x-zip-compressed|msword|vnd\.)|binary\/)/.test(type)) {
    const buffer = await request.clone().arrayBuffer().catch(() => null);
    if (buffer && buffer.byteLength > 0) bytes = new Uint8Array(buffer);
  }
  if (!bytes) return { kind: "none", fields };
  if (bytes.byteLength > limit) return { kind: "too-large", limit };
  return { kind: "file", bytes, fields };
}

export const __test = { held, fromBase64 };
