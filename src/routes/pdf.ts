// PDF to text. Few x402 sellers offer it and buyers pay for it (Bazaar payment data, Oct 2026).
// Parsing runs inside the Worker with unpdf (PDF.js build for serverless runtimes), so there is
// no upstream service and no per-call cost beyond CPU.
import { entry, num, type Entry } from "../family";
import { HttpError } from "../lib/env";
import { TARGET_UNAVAILABLE, fetchFile, parseTarget } from "../lib/fetch";
import { FILE_REF_INPUT, heldFile, isFileRef } from "../lib/file-input";

const MAX_BYTES = 10 * 1024 * 1024;
const MAX_PAGES = 200;

const tidy = (s: string) => s.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

/** Text of pages firstPage..firstPage+want-1, at most maxChars in total. */
export async function readPdf(bytes: Uint8Array, firstPage: number, want: number, maxChars: number) {
  if (!(bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46)) {
    const head = new TextDecoder().decode(bytes.slice(0, 200)).trimStart().toLowerCase();
    throw new HttpError(415, head.startsWith("<!doctype html") || head.startsWith("<html")
      ? "url returned a web page, not a PDF file; read web pages with extract (nothing was charged)"
      : "url did not return a PDF file (nothing was charged)");
  }
  // PDF.js is large: load it on the first PDF call rather than on every isolate start.
  let engine: typeof import("unpdf");
  try { engine = await import("unpdf"); } catch (e) { console.error(`unpdf load: ${e}`); throw new HttpError(502, "the PDF engine is unavailable; try again"); }
  const { getDocumentProxy, getMeta } = engine;
  let doc: Awaited<ReturnType<typeof getDocumentProxy>>;
  try {
    doc = await getDocumentProxy(bytes);
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    throw new HttpError(422, /password/i.test(msg) ? "the PDF is encrypted" : "the PDF could not be parsed");
  }
  const totalPages = doc.numPages;
  if (firstPage > totalPages) throw new HttpError(400, `firstPage is beyond the last page (${totalPages})`);
  const last = Math.min(totalPages, firstPage + want - 1);
  const meta = await getMeta(doc).catch(() => ({ info: {} as Record<string, unknown> }));
  // Only the requested pages, one at a time, stopping at maxChars. unpdf's extractText reads every page of the document
  // in parallel, so a one-page read of a 300-page report spent the CPU and memory of all 300 (the /pdf/text 5xx of
  // 21-23 Oct 2026). Same text as extractText: each item's str, plus a newline where PDF.js marks an end of line.
  const pages: { page: number; chars: number; text: string }[] = [];
  let used = 0;
  let truncated = false;
  for (let p = firstPage; p <= last; p++) {
    let raw: string;
    try {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      raw = (content.items as { str?: string; hasEOL?: boolean }[]).filter((i) => i.str != null).map((i) => i.str + (i.hasEOL ? "\n" : "")).join("");
      page.cleanup();
    } catch (e) {
      // The caller's document, not our failure: PDF.js could open it but not read this page.
      throw new HttpError(422, `the PDF could not be read at page ${p}: ${String((e as Error)?.message ?? e).slice(0, 120)}`);
    }
    let t = tidy(raw);
    if (used + t.length > maxChars) {
      t = t.slice(0, maxChars - used);
      truncated = true;
    }
    used += t.length;
    pages.push({ page: p, chars: t.length, text: t });
    if (truncated) break;
  }
  if (used === 0) throw new HttpError(422, "no text layer on these pages (scanned or image-only PDF); /document/text reads scanned PDFs by OCR");
  const info = (meta.info ?? {}) as Record<string, unknown>;
  return {
    title: str(info.Title), author: str(info.Author), totalPages, firstPage,
    pagesRead: pages.length, chars: used, truncated: truncated || last < totalPages, pages,
  };
}

const isPdf = (b: Uint8Array) => b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46;
const WAYBACK = "https://web.archive.org/web/2id_/";

/** The target refused or lacks the file (401/403/451/429/404/410), or answered a bot-check page instead of a PDF. */
// Also a site that is down, slow, loops redirects or breaks the connection (TARGET_UNAVAILABLE: 5xx, 429, timeouts):
// /status of 14 Nov 2026 showed 124 of 571 refused /pdf/text calls in that class ("target responded with HTTP 5xx" 83,
// timeouts 33, redirect limit 5, broken connection 3) and paid calls ending in execution_failed, while /extract already
// read the archive for the same class.
const fallbackWorthy = (e: unknown) =>
  e instanceof HttpError && (e.code === TARGET_UNAVAILABLE || (e.status === 422 && /refused automated access|was not found/.test(e.message)) || (e.status === 415 && /web page/.test(e.message)));

/**
 * The PDF's bytes. Many PDF hosts refuse Cloudflare's shared egress addresses (bot walls answering 403, or a 200 with a
 * challenge page), which made /pdf/text fail on about half of the real targets (audit of 11 Nov 2026). When the site
 * itself refuses, the Internet Archive's copy is read instead, and the answer says so (`source`, `snapshot`): the caller
 * gets the text of a dated copy and knows it is one. Nothing is spoofed: we never pretend to be a browser.
 */
export async function loadPdf(rawUrl: string | undefined) {
  const url = pdfUrl(rawUrl);
  let first: unknown;
  try {
    const file = await fetchFile(url, /^/, MAX_BYTES, "a PDF", { cacheSeconds: 600, budgetMs: 20_000 });
    if (isPdf(file.bytes)) return { url: file.url, bytes: file.bytes, source: "origin" as const, snapshot: null };
    first = new HttpError(415, "url returned a web page, not a PDF file; read web pages with extract (nothing was charged)");
  } catch (e) {
    if (!fallbackWorthy(e)) throw e;
    first = e;
  }
  const target = parseTarget(url).href;
  try {
    // After a timeout the caller has already waited 20 s: give the archive less, so the whole call stays near 35 s.
    const late = first instanceof HttpError && first.status === 504;
    const copy = await fetchFile(WAYBACK + target, /^/, MAX_BYTES, "a PDF", { cacheSeconds: 600, budgetMs: late ? 15_000 : 25_000 });
    if (isPdf(copy.bytes)) {
      const stamp = /\/web\/(\d{14})/.exec(copy.finalUrl)?.[1] ?? null;
      const snapshot = stamp ? `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}` : null;
      return { url: target, bytes: copy.bytes, source: "internet-archive" as const, snapshot };
    }
  } catch { /* no archived copy: the site's own answer is the better error */ }
  throw first;
}

/** An arXiv abstract page (arxiv.org/abs/2401.01234) becomes its PDF (arxiv.org/pdf/2401.01234); other URLs are kept. */
export function pdfUrl(raw: string | undefined) {
  if (!raw) return raw;
  const m = /^https?:\/\/(?:www\.)?arxiv\.org\/abs\/([^?#\s]+)$/i.exec(raw.trim());
  return m ? `https://arxiv.org/pdf/${m[1]}` : raw;
}

/**
 * Reserved input the HTTP route sets for a free browser try (never read from the query): the try reads at most
 * PDF_TRY_PAGES pages and PDF_TRY_CHARS characters, and says so. Off unless the owner sets PDF_TRY=on (lib/pdf-try.ts).
 */
export const PDF_TRY_INPUT = "@pdf-try";
export const PDF_TRY_PAGES = 2;
export const PDF_TRY_CHARS = 6000;

export const PDF: Entry[] = [
  entry("/pdf/text", "PDF to text, PDF text extraction",
    "Extract the text of a public PDF (up to 10 MB) from its URL, page by page, with title, author and page count. Choose the first page, how many pages (up to 200) and maxChars. arXiv abstract links work. If a site blocks our fetch, the Internet Archive's dated copy is read and the answer says so. Scanned, encrypted and non-PDF files fail uncharged. Use to read papers, invoices, reports and manuals into an agent.",
    ["pdf", "documents", "text", "extract", "rag"], {
      // The example must load from Cloudflare's network: w3.org's dummy PDF answers Workers with 403.
      url: { type: "string", description: "Absolute public http(s) URL of the PDF", required: true, example: "https://bitcoin.org/bitcoin.pdf" },
      firstPage: { type: "integer", description: "First page to read (default 1)", example: 1 },
      pages: { type: "integer", description: "How many pages to read (1-200, default 20)", example: 1 },
      maxChars: { type: "integer", description: "Maximum characters of text returned across all pages (1000-200000, default 50000)", example: 1000 },
    },
    {
      url: "https://bitcoin.org/bitcoin.pdf",
      title: null, author: null, totalPages: 9, firstPage: 1, pagesRead: 1, chars: 46, truncated: true,
      pages: [{ page: 1, chars: 46, text: "Bitcoin: A Peer-to-Peer Electronic Cash System" }],
    },
    async (_env, q) => {
      const firstPage = num(q, "firstPage", { min: 1, max: 100_000, fallback: 1, integer: true });
      const freeTry = q(PDF_TRY_INPUT) === "1";
      const asked = num(q, "pages", { min: 1, max: MAX_PAGES, fallback: 20, integer: true });
      const askedChars = num(q, "maxChars", { min: 1000, max: 200_000, fallback: 50_000, integer: true });
      const want = freeTry ? Math.min(asked, PDF_TRY_PAGES) : asked;
      const maxChars = freeTry ? Math.min(askedChars, PDF_TRY_CHARS) : askedChars;
      // Any content type: servers label PDFs binary/octet-stream, application/download or nothing at all, and readPdf
      // checks the %PDF signature itself, so the type check only refused real PDFs.
      // A file sent in a POST body (lib/file-input.ts) is read as it is; nothing is fetched.
      const sent = q(FILE_REF_INPUT);
      if (isFileRef(sent)) {
        const bytes = heldFile(sent);
        if (!bytes) throw new HttpError(400, "send the PDF file in a POST body (raw bytes, a multipart `file` part, or base64 in JSON); a file reference cannot be used in a GET");
        if (!isPdf(bytes)) throw new HttpError(415, "the file sent is not a PDF (nothing was charged)");
        return { url: null, source: "upload", bytes: bytes.byteLength, ...(await readPdf(bytes, firstPage, want, maxChars)) };
      }
      const file = await loadPdf(q("url"));
      return {
        url: file.url,
        ...(await readPdf(file.bytes, firstPage, want, maxChars)),
        ...(freeTry ? { freeTry: `this free try reads at most ${PDF_TRY_PAGES} pages and ${PDF_TRY_CHARS} characters; a paid call reads up to ${MAX_PAGES} pages` } : {}),
        ...(file.source === "origin" ? {} : { source: file.source, snapshot: file.snapshot, note: `the site refused our fetch, so this is the Internet Archive's copy${file.snapshot ? ` from ${file.snapshot}` : ""}; it may differ from the live file` }),
      };
      // $0.005 for a wallet paying per call; a prepaid key pays less (KEY_PRICES in lib/credits.ts, the owner, 10 Nov 2026).
  }, "$0.005"),
];
