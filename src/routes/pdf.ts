// PDF to text. Few x402 sellers offer it and buyers pay for it (Bazaar payment data, Oct 2026).
// Parsing runs inside the Worker with unpdf (PDF.js build for serverless runtimes), so there is
// no upstream service and no per-call cost beyond CPU.
import { entry, num, type Entry } from "../family";
import { HttpError } from "../lib/env";
import { fetchFile } from "../lib/fetch";

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
  if (used === 0) throw new HttpError(422, "no text layer on these pages (scanned or image-only PDF)");
  const info = (meta.info ?? {}) as Record<string, unknown>;
  return {
    title: str(info.Title), author: str(info.Author), totalPages, firstPage,
    pagesRead: pages.length, chars: used, truncated: truncated || last < totalPages, pages,
  };
}

/** An arXiv abstract page (arxiv.org/abs/2401.01234) becomes its PDF (arxiv.org/pdf/2401.01234); other URLs are kept. */
export function pdfUrl(raw: string | undefined) {
  if (!raw) return raw;
  const m = /^https?:\/\/(?:www\.)?arxiv\.org\/abs\/([^?#\s]+)$/i.exec(raw.trim());
  return m ? `https://arxiv.org/pdf/${m[1]}` : raw;
}

export const PDF: Entry[] = [
  entry("/pdf/text", "PDF to text, page by page",
    "Download a public PDF (up to 10 MB) and return its text page by page, with title, author, page count and character counts. Choose a first page and how many pages to read (up to 200) and cap the output with maxChars. arXiv abstract links are read as their PDF. Scanned PDFs without a text layer, encrypted files and non-PDF URLs fail uncharged. Use to read papers, invoices, reports and manuals into an agent's context.",
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
      const want = num(q, "pages", { min: 1, max: MAX_PAGES, fallback: 20, integer: true });
      const maxChars = num(q, "maxChars", { min: 1000, max: 200_000, fallback: 50_000, integer: true });
      // Any content type: servers label PDFs binary/octet-stream, application/download or nothing at all, and readPdf
      // checks the %PDF signature itself, so the type check only refused real PDFs.
      const file = await fetchFile(pdfUrl(q("url")), /^/, MAX_BYTES, "a PDF", { cacheSeconds: 600 });
      return { url: file.url, ...(await readPdf(file.bytes, firstPage, want, maxChars)) };
    }, "$0.005"),
];
