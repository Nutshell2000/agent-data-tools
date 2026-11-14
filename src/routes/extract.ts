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

const PAGE_ACCEPT = "text/html,application/xhtml+xml;q=0.9,text/markdown;q=0.9,text/plain;q=0.8";

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
  if (!html && !plain && !markdownMime) {
    await res.body?.cancel();
    // A PDF link is the most common wrong file here (/status, 14 Nov 2026: 2 of 3 content-type refusals): name the tool
    // that reads it, with the same URL, so the caller's next paid call succeeds instead of the job ending here.
    if (/^application\/(x-)?pdf(?:;|$)/i.test(contentType) || /\.pdf$/i.test(new URL(finalUrl).pathname))
      throw new HttpError(415, `this URL is a PDF file, not a web page; read it with /pdf/text?url=${encodeURIComponent(target.href)} (nothing was charged)`, "EXTRACTION_PDF");
    throw new HttpError(
      415,
      `unsupported content type: ${contentType || "unknown"}`,
    );
  }
  if (!html && sectionParam !== undefined) {
    await res.body?.cancel();
    throw new HttpError(415, "section selection requires static HTML", "EXTRACTION_SECTION_UNSUPPORTED");
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
    return await buildExtraction({ target, finalUrl, status: res.status, contentType, source, html, markdownSource, markdownPath, inputTruncated, maxChars, formatParam, sectionParam });
  } catch (e) {
    // An empty static HTML page is usually built by JavaScript: point to the rendered route.
    if (html && e instanceof HttpError && e.code === "EXTRACTION_EMPTY" && !e.message.includes("maxChars"))
      throw new HttpError(422, `${e.message}. For pages built with JavaScript, use /extract/rendered ($0.01).`, "EXTRACTION_EMPTY");
    throw e;
  }
}

/** Turns fetched or browser-rendered source into the /extract result. */
export async function buildExtraction(input: {
  target: URL; finalUrl: string; status: number; contentType: string; source: string;
  html: boolean; markdownSource: boolean; markdownPath: boolean; inputTruncated: boolean;
  maxChars: number; formatParam: string; sectionParam?: string;
}) {
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
