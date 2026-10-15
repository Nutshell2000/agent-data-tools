import { HttpError } from "../lib/env";
import { capBytes, fetchPublic, parseTarget } from "../lib/fetch";
import { pageContent } from "../lib/page-content";
export async function extract(
  rawUrl: string | undefined,
  maxCharsParam?: string,
  formatParam = "text",
) {
  const target = parseTarget(rawUrl);
  const maxChars = maxCharsParam === undefined ? 20000 : Number(maxCharsParam);
  if (!Number.isInteger(maxChars) || maxChars < 500 || maxChars > 100000)
    throw new HttpError(400, "maxChars must be an integer from 500 to 100000");
  if (!["text", "markdown", "both"].includes(formatParam))
    throw new HttpError(400, "format must be text, markdown or both");
  const res = await fetchPublic(
    target,
    "text/html,application/xhtml+xml;q=0.9,text/plain;q=0.8",
  );
  const contentType = res.headers.get("content-type") ?? "";
  const html = /^(text\/html|application\/xhtml\+xml)(?:;|$)/i.test(
    contentType,
  );
  if (!html && !/^text\/plain(?:;|$)/i.test(contentType))
    throw new HttpError(
      415,
      `unsupported content type: ${contentType || "unknown"}`,
    );
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
  const source = decoder.decode(bytes),
    finalUrl = res.url || target.href;
  const content = html
    ? pageContent(source, finalUrl, maxChars)
    : {
        title: null,
        description: null,
        lang: null,
        canonical: null,
        headings: [],
        links: [],
        codeBlocks: [],
        tables: [],
        contentSelection: "plain",
        warnings: [] as string[],
        text: source.trim(),
        markdown: source.trim().replace(/[\\`*_[\]<>|]/g, "\\$&"),
      };
  if (!content.text)
    throw new HttpError(422, "No readable static content", "EXTRACTION_EMPTY");
  const { text: fullText, markdown: fullMarkdown, ...metadata } = content;
  const text = fullText.slice(0, maxChars),
    markdown = fullMarkdown.slice(0, maxChars);
  const truncated =
    inputTruncated ||
    fullText.length > maxChars ||
    (formatParam !== "text" && fullMarkdown.length > maxChars);
  if (inputTruncated) metadata.warnings.push("input_truncated");
  if (truncated) metadata.warnings.push("output_may_be_incomplete");
  if (formatParam !== "text" && fullMarkdown.length > maxChars)
    metadata.warnings.push("markdown_truncated");
  const hashFormat = formatParam === "markdown" ? "markdown" : "text";
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(hashFormat === "text" ? text : markdown),
  );
  return {
    url: target.href,
    finalUrl,
    status: res.status,
    contentType,
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
