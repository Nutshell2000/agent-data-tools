import { allowedValue } from "../family";
import { HttpError } from "../lib/env";
import { archivedCopy } from "../lib/archive";
import { TARGET_UNAVAILABLE, capBytes, fetchPublic, parseTarget } from "../lib/fetch";
import { pageContent } from "../lib/page-content";
import { clipMarkdown } from "../lib/markdown";
import { emptySourceMetadata } from "../lib/page-metadata";

export const EXTRACT_BUDGET_MS = 15_000;

/** Validated /extract options, shared with /extract/rendered. */
export function extractOptions(
  rawUrl: string | undefined,
  maxCharsParam?: string,
  formatParam = "text",
  sectionParam?: string,
) {
  const target = parseTarget(rawUrl);
  const asked = maxCharsParam === undefined ? 20000 : Number(maxCharsParam);
  if (!Number.isInteger(asked) || asked < 1)
    throw new HttpError(400, "maxChars must be an integer from 500 to 100000");
  // Agents ask for small previews (maxChars=300 in the 26 Oct 2026 probe) and big dumps; a refused call wins nobody, so
  // whole numbers outside the range are held to it.
  const maxChars = Math.min(100000, Math.max(500, asked));
  // Same forgiveness as the paywall's enum check ("Markdown", "md", "plain"), so a call it let through is never refused here.
  const format = allowedValue(formatParam, ["text", "markdown", "both"] as const);
  if (!format) throw new HttpError(400, "format must be text, markdown or both");
  formatParam = format;
  // An empty section (a form or planner that sends every listed input, filled or not) means no section, not a bad one.
  if (sectionParam !== undefined && !sectionParam.trim()) sectionParam = undefined;
  if (sectionParam !== undefined && (sectionParam.length > 500 || sectionParam.length > 500 || /[\u0000-\u001f\u007f]/.test(sectionParam)))
    throw new HttpError(400, "section must be an exact HTML ID from 1 to 500 characters without control characters");
  return { target, maxChars, formatParam, sectionParam };
}

export interface ExtractRunOptions {
  /** Total time for the live fetch (default 15 s). */
  budgetMs?: number;
  /** Serve the Internet Archive's latest capture when the live target is down or slow (default true). */
  archiveFallback?: boolean;
}

/** Text formats read as they are when a URL is not a page: JSON, XML, CSV, YAML, feeds and any other text/* type. */
const OTHER_TEXT = /^(?:text\/[a-z0-9.+-]+|application\/(?:json|xml|csv|yaml|x-yaml|x-ndjson|javascript|[a-z0-9.-]+\+(?:json|xml)))(?:;|$)/i;
/** A PDF met by a page reader: at most this size and this many pages; /pdf/text reads larger files and page ranges. */
const PDF_MAX_BYTES = 10 * 1024 * 1024;
const PDF_PAGES = 5;

const PAGE_ACCEPT ="text/html,application/xhtml+xml;q=0.9,text/markdown;q=0.9,text/plain;q=0.8";

export async function extract(
  rawUrl: string | undefined,
  maxCharsParam?: string,
  formatParam = "text",
  sectionParam?: string,
  { budgetMs = EXTRACT_BUDGET_MS, archiveFallback = true }: ExtractRunOptions = {},
) {
  const options = extractOptions(rawUrl, maxCharsParam, formatParam, sectionParam);
  const { target, maxChars } = options;
  formatParam = options.formatParam;
  sectionParam = options.sectionParam;
  // 15 s, not the default 8 s (5 Nov 2026): github.com repository pages took longer than 8 s from Cloudflare and paid
  // reads of heavy pages timed out as 504s that the buyer could have had.
  let res: Response;
  let archived: { capturedAt: string; snapshotUrl: string } | null = null;
  try {
    res = await fetchPublic(target, PAGE_ACCEPT, [], { budgetMs });
  } catch (e) {
    // Down, slow or rate-limiting targets (TARGET_UNAVAILABLE: 5xx, 429, timeouts) get the archive's latest capture; a
    // refusal or a missing page (422) is final (src/lib/archive.ts).
    if (!archiveFallback || !(e instanceof HttpError) || e.code !== TARGET_UNAVAILABLE) throw e;
    const copy = await archivedCopy(target, PAGE_ACCEPT);
    if (!copy) throw e;
    res = copy.res;
    archived = { capturedAt: copy.capturedAt, snapshotUrl: copy.snapshotUrl };
  }
  // An archived page's links resolve against the page it copies, not the archive's address.
  const result = await readResponse(res, target, maxChars, formatParam, sectionParam, archived ? target.href : undefined);
  if (!archived) return result;
  // The answer names the page the caller asked for; the archive copy is stated, never passed off as live.
  result.warnings.push("archived_snapshot");
  return { ...result, finalUrl: target.href, archived: { source: "Internet Archive (web.archive.org)", ...archived, reason: "the live page was down or did not answer in time" } };
}

async function readResponse(res: Response, target: URL, maxChars: number, formatParam: string, sectionParam: string | undefined, baseUrl?: string) {
  const contentType = res.headers.get("content-type") ?? "";
  const html = /^(text\/html|application\/xhtml\+xml)(?:;|$)/i.test(
    contentType,
  );
  const plain = /^text\/plain(?:;|$)/i.test(contentType);
  const markdownMime = /^text\/markdown(?:;|$)/i.test(contentType);
  const finalUrl = baseUrl ?? (res.url || target.href);
  const markdownPath = plain && /\.(?:md|markdown)$/i.test(new URL(finalUrl).pathname);
  const markdownSource = markdownMime || markdownPath;
  // 21 Nov 2026: a caller's URL is often not an HTML page. In seven days /status counted 9 refusals on the page readers
  // for JSON and PDF links ("unsupported content type: application/json", "this URL is a PDF file"), each from a caller
  // ready to pay, and the hint to another tool was not followed. Both are now read here: a PDF through the PDF reader
  // (its first pages), other text formats as the text they are. Images, audio and other binary files are still refused.
  const pdf = /^application\/(x-)?pdf(?:;|$)/i.test(contentType) || (!html && !plain && !markdownMime && /\.pdf$/i.test(new URL(finalUrl).pathname));
  const otherText = !html && !plain && !markdownMime && !pdf && OTHER_TEXT.test(contentType);
  if (!html && !plain && !markdownMime && !pdf && !otherText) {
    await res.body?.cancel();
    throw new HttpError(
      415,
      `unsupported content type: ${contentType || "unknown"}; this tool reads web pages, PDF files and text formats (nothing was charged)`,
    );
  }
  if (!html && sectionParam !== undefined && !isFormerExample(sectionParam)) {
    await res.body?.cancel();
    throw new HttpError(415, "section selection requires static HTML", "EXTRACTION_SECTION_UNSUPPORTED");
  }
  if (!html) sectionParam = undefined;
  if (pdf) {
    let tooLarge = false;
    const file = new Uint8Array(await new Response(capBytes(res.body!, PDF_MAX_BYTES, () => { tooLarge = true; })).arrayBuffer());
    if (tooLarge) throw new HttpError(422, `this PDF is larger than ${PDF_MAX_BYTES / 1024 / 1024} MB; read it with /pdf/text?url=${encodeURIComponent(target.href)}, which takes page ranges (nothing was charged)`, "EXTRACTION_PDF");
    const { readPdf } = await import("./pdf");
    const read = await readPdf(file, 1, PDF_PAGES, maxChars) as { totalPages?: number; pages?: { text: string }[] };
    const source = (read.pages ?? []).map((p) => p.text).join("\n\n");
    if (!source.trim()) throw new HttpError(422, `this PDF has no text layer in its first ${PDF_PAGES} pages (a scan); read it with /document/text?url=${encodeURIComponent(target.href)} (nothing was charged)`, "EXTRACTION_EMPTY");
    const result = await buildExtraction({ target, finalUrl, status: res.status, contentType, source, html: false, markdownSource: false, markdownPath: false, inputTruncated: (read.totalPages ?? 0) > PDF_PAGES, maxChars, formatParam, sectionParam: undefined });
    result.warnings.push("pdf_source", ...((read.totalPages ?? 0) > PDF_PAGES ? [`pdf_first_${PDF_PAGES}_pages_of_${read.totalPages}`] : []));
    return result;
  }
  let inputTruncated = false;
  const bytes = await new Response(
    capBytes(res.body!, 2 * 1024 * 1024, () => {
      inputTruncated = true;
    }),
  ).arrayBuffer();
  let decoder: TextDecoder;
  try {
    decoder = new TextDecoder(
      /charset\s*=\s*["']?([^;\s"']+)/i.exec(contentType)?.[1] ?? "utf-8",
    );
  } catch {
    throw new HttpError(415, "unsupported source character encoding");
  }
  const source = decoder.decode(bytes);
  try {
    const result = await buildExtraction({ target, finalUrl, status: res.status, contentType, source, html, markdownSource, markdownPath, inputTruncated, maxChars, formatParam, sectionParam });
    if (otherText) result.warnings.push("non_html_source");
    return result;
  } catch (e) {
    // An empty static HTML page is usually built by JavaScript: point to the rendered route.
    if (html && e instanceof HttpError && e.code === "EXTRACTION_EMPTY" && !e.message.includes("maxChars"))
      throw new HttpError(422, `${e.message}. For pages built with JavaScript, use /extract/rendered ($0.01).`, "EXTRACTION_EMPTY");
    throw e;
  }
}

/**
 * Section IDs this service once published as the input's example. Routers keep their own copy of a listing and refresh it
 * rarely (Mercator's copy of 14 Nov 2026 still held section=retry-policy, and /status showed 9 refused calls in 7 days),
 * so a call carrying one comes from a stale planner, not a reader who wants that section: when the page has no such ID,
 * the whole page is read and `section_example_ignored` says so. Any other missing ID is still refused uncharged.
 */
const FORMER_SECTION_EXAMPLES = new Set(["retry-policy"]);
const isFormerExample = (section: string) => FORMER_SECTION_EXAMPLES.has(section);

/** Turns fetched or browser-rendered source into the /extract result. */
export async function buildExtraction(input: {
  target: URL; finalUrl: string; status: number; contentType: string; source: string;
  html: boolean; markdownSource: boolean; markdownPath: boolean; inputTruncated: boolean;
  maxChars: number; formatParam: string; sectionParam?: string;
}) {
  try {
    return await buildExtractionOnce(input);
  } catch (e) {
    if (!(input.sectionParam && isFormerExample(input.sectionParam) && e instanceof HttpError && e.code === "EXTRACTION_SECTION_NOT_FOUND")) throw e;
    const whole = await buildExtractionOnce({ ...input, sectionParam: undefined });
    whole.warnings.push("section_example_ignored");
    return whole;
  }
}

async function buildExtractionOnce(input: Parameters<typeof buildExtraction>[0]) {
  const { target, finalUrl, status, contentType, source, html, markdownSource, markdownPath, inputTruncated, maxChars, formatParam, sectionParam } = input;
  const content = html
    ? pageContent(source, finalUrl, maxChars, sectionParam)
    : {
        linkBaseUrl: finalUrl,
        sourceMetadata: emptySourceMetadata(),
        title: null,
        description: null,
        lang: null,
        canonical: null,
        headings: [],
        links: [],
        codeBlocks: [],
        tables: [],
        contentSelection: "plain",
        section: null,
        warnings: markdownSource ? ["markdown_source_preserved", "markdown_metadata_unparsed", ...(markdownPath ? ["markdown_inferred_from_path"] : [])] : [] as string[],
        text: markdownSource ? source : source.trim(),
        markdown: markdownSource ? source : source.trim().replace(/[\\`*_[\]<>|]/g, "\\$&"),
      };
  if (!content.text.trim())
    throw new HttpError(422, "No readable static content", "EXTRACTION_EMPTY");
  const { text: fullText, markdown: fullMarkdown, ...metadata } = content;
  const text = fullText.slice(0, maxChars),
    markdown = markdownSource ? fullMarkdown.slice(0, maxChars) : clipMarkdown(fullMarkdown, maxChars);
  if (!(formatParam === "markdown" ? markdown : text).trim())
    throw new HttpError(
      422,
      "The requested output limit contains no readable content; raise maxChars",
      "EXTRACTION_EMPTY",
    );
  const truncated =
    inputTruncated ||
    (formatParam !== "markdown" && fullText.length > maxChars) ||
    (formatParam !== "text" && fullMarkdown.length > maxChars);
  if (inputTruncated) metadata.warnings.push("input_truncated");
  if (truncated) metadata.warnings.push("output_may_be_incomplete");
  if (formatParam !== "text" && fullMarkdown.length > maxChars)
    metadata.warnings.push("markdown_truncated");
  if (markdownSource && (inputTruncated || fullMarkdown.length > maxChars))
    metadata.warnings.push("source_markdown_may_be_incomplete");
  const hashFormat = formatParam === "markdown" ? "markdown" : "text";
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(hashFormat === "text" ? text : markdown),
  );
  return {
    url: target.href,
    finalUrl,
    status,
    contentType,
    sourceFormat: html ? "html" : markdownSource ? "markdown" : "plain",
    ...metadata,
    format: formatParam,
    ...(formatParam !== "markdown" ? { text } : {}),
    ...(formatParam !== "text" ? { markdown } : {}),
    textLength: fullText.length,
    truncated,
    contentHash:
      "sha256:" +
      Array.from(new Uint8Array(digest), (b) =>
        b.toString(16).padStart(2, "0"),
      ).join(""),
    hashFormat,
    fetchedAt: new Date().toISOString(),
  };
}
