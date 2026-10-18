// PDF to text. Few x402 sellers offer it and buyers pay for it (Bazaar payment data, Oct 2026).
// Parsing runs inside the Worker with unpdf (PDF.js build for serverless runtimes), so there is
// no upstream service and no per-call cost beyond CPU.
import { extractText, getDocumentProxy, getMeta } from "unpdf";
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
    throw new HttpError(415, "url did not return a PDF file");
  }
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
  const [{ text }, meta] = await Promise.all([
    extractText(doc, { mergePages: false }),
    getMeta(doc).catch(() => ({ info: {} as Record<string, unknown> })),
  ]);
  const pages: { page: number; chars: number; text: string }[] = [];
  let used = 0;
  let truncated = false;
  for (let p = firstPage; p <= last; p++) {
    let t = tidy(text[p - 1] ?? "");
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

export const PDF: Entry[] = [
  entry("/pdf/text", "PDF to text, page by page",
    "Download a public PDF (up to 10 MB) and return its text page by page, with title, author, page count and character counts. Choose a first page and how many pages to read (up to 200) and cap the output with maxChars. Scanned PDFs without a text layer, encrypted files and non-PDF URLs fail uncharged. Use to read papers, invoices, reports and manuals into an agent's context.",
    ["pdf", "documents", "text", "extract", "rag"], {
      url: { type: "string", description: "Absolute public http(s) URL of the PDF", required: true, example: "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf" },
      firstPage: { type: "integer", description: "First page to read (default 1)", example: 1 },
      pages: { type: "integer", description: "How many pages to read (1-200, default 50)", example: 50 },
      maxChars: { type: "integer", description: "Maximum characters of text returned across all pages (1000-200000, default 50000)", example: 50000 },
    },
    {
      url: "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf",
      title: null, author: null, totalPages: 1, firstPage: 1, pagesRead: 1, chars: 14, truncated: false,
      pages: [{ page: 1, chars: 14, text: "Dummy PDF file" }],
    },
    async (_env, q) => {
      const firstPage = num(q, "firstPage", { min: 1, max: 100_000, fallback: 1, integer: true });
      const want = num(q, "pages", { min: 1, max: MAX_PAGES, fallback: 50, integer: true });
      const maxChars = num(q, "maxChars", { min: 1000, max: 200_000, fallback: 50_000, integer: true });
      const file = await fetchFile(q("url"), /^application\/(pdf|x-pdf|octet-stream)/i, MAX_BYTES, "a PDF");
      return { url: file.url, ...(await readPdf(file.bytes, firstPage, want, maxChars)) };
    }, "$0.005"),
];
