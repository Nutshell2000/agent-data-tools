import { HttpError } from "../lib/env";
import { capBytes, fetchPublic, parseTarget } from "../lib/fetch";
import { pageContent } from "../lib/page-content";
import { clipMarkdown } from "../lib/markdown";
import { emptySourceMetadata } from "../lib/page-metadata";

/** Validated /extract options, shared with /extract/rendered. */
export function extractOptions(
  rawUrl: string | undefined,
  maxCharsParam?: string,
  formatParam = "text",
  sectionParam?: string,
) {
  const target = parseTarget(rawUrl);
  const maxChars = maxCharsParam === undefined ? 20000 : Number(maxCharsParam);
  if (!Number.isInteger(maxChars) || maxChars < 500 || maxChars > 100000)
    throw new HttpError(400, "maxChars must be an integer from 500 to 100000");
  if (!["text", "markdown", "both"].includes(formatParam))
    throw new HttpError(400, "format must be text, markdown or both");
  if (sectionParam !== undefined && (!sectionParam || sectionParam.length > 500 || /[\u0000-\u001f\u007f]/.test(sectionParam)))
    throw new HttpError(400, "section must be an exact HTML ID from 1 to 500 characters without control characters");
  return { target, maxChars, formatParam, sectionParam };
}

export async function extract(
  rawUrl: string | undefined,
  maxCharsParam?: string,
  formatParam = "text",
  sectionParam?: string,
) {
  const { target, maxChars } = extractOptions(rawUrl, maxCharsParam, formatParam, sectionParam);
  const res = await fetchPublic(
    target,
    "text/html,application/xhtml+xml;q=0.9,text/markdown;q=0.9,text/plain;q=0.8",
  );
  const contentType = res.headers.get("content-type") ?? "";
  const html = /^(text\/html|application\/xhtml\+xml)(?:;|$)/i.test(
    contentType,
  );
  const plain = /^text\/plain(?:;|$)/i.test(contentType);
  const markdownMime = /^text\/markdown(?:;|$)/i.test(contentType);
  const finalUrl = res.url || target.href;
  const markdownPath = plain && /\.(?:md|markdown)$/i.test(new URL(finalUrl).pathname);
  const markdownSource = markdownMime || markdownPath;
  if (!html && !plain && !markdownMime) {
    await res.body?.cancel();
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
