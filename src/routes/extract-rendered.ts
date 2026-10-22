// /extract for pages that need JavaScript: render in Cloudflare's hosted browser, then run the
// same extractor on the rendered DOM. Costs browser time from the account's free daily budget,
// so it is a separate, higher-priced route and reports exhaustion as an uncharged 503.
import { entry, type Entry } from "../family";
import { withBrowserPage } from "../lib/browser";
import { EXTRACT_OUTPUT_EXAMPLE } from "../lib/extract-example";
import { buildExtraction, extractOptions } from "./extract";

const MAX_SOURCE_CHARS = 2 * 1024 * 1024;

export const EXTRACT_RENDERED: Entry[] = [
  entry("/extract/rendered", "Web page to Markdown, rendered: a JavaScript-rendered page as text or Markdown",
    "Same output as /extract, but the page is first rendered in a real browser, so single-page apps and pages that build their content with JavaScript come back with their text instead of an empty shell. Waits for the network to settle (up to 15 seconds). Public pages only; no login. Use when /extract returns EXTRACTION_EMPTY or too little text for a page you can read in a browser.",
    ["web", "extract", "javascript", "rendering", "markdown", "scraping"], {
      url: { type: "string", description: "Absolute public http(s) URL of the page", required: true, example: "https://example.com/" },
      format: { type: "string", description: "text (default), markdown or both", enum: ["text", "markdown", "both"], example: "markdown" },
      maxChars: { type: "integer", description: "Output limit, 500-100000 characters (default 20000)", example: 20000 },
      section: { type: "string", description: "Optional exact HTML id to read only that element", example: "main" },
    },
    { ...EXTRACT_OUTPUT_EXAMPLE, rendered: true },
    async (env, q) => {
      const { target, maxChars, formatParam, sectionParam } = extractOptions(q("url"), q("maxChars"), q("format") ?? "text", q("section"));
      const page = await withBrowserPage(env, target, { width: 1280, height: 800 }, async (p, status) => ({
        source: await p.content(), finalUrl: p.url(), status,
      }));
      const result = await buildExtraction({
        target, finalUrl: page.finalUrl, status: page.status ?? 200, contentType: "text/html; rendered",
        source: page.source.slice(0, MAX_SOURCE_CHARS), html: true, markdownSource: false, markdownPath: false,
        inputTruncated: page.source.length > MAX_SOURCE_CHARS, maxChars, formatParam, sectionParam,
      });
      return { ...result, rendered: true };
    }, "$0.01"),
];
