// Pages removed from glyphcall.com on the owner's order (17 Nov 2026: "Remove compare pages ... we are gonna just have
// the better products, people will compare themselves and write reviews in time"). Each old path answers a 301 to the
// product page it was about, so links and search results land on a real page instead of a 404. Rival figures are kept
// only in the owner's internal benchmark files, never served.
const INVOICE = "/invoice-data-extraction-api";
const INVOICE_RIVALS = ["veryfi", "mindee", "aws-textract", "nanonets", "reducto", "parseur", "docparser", "llamaparse"];

export const REMOVED_PAGES: Readonly<Record<string, string>> = {
  "/compare": INVOICE,
  ...Object.fromEntries(INVOICE_RIVALS.map((r) => [`/compare/${r}-alternative`, INVOICE])),
  "/compare/elevenlabs-alternative": "/text-to-speech-api",
  "/compare/whisper-api-alternative": "/speech-to-text-api",
  "/benchmarks": "/eu-law-search-api",
  "/exa-alternative-api": "/company-check-api",
};

/** Where a removed page now lives: its own entry, or the invoice page for any other /compare/... path. */
export function removedPageTarget(path: string): string | undefined {
  const p = path.length > 1 ? path.replace(/\/+$/, "") : path;
  if (Object.hasOwn(REMOVED_PAGES, p)) return REMOVED_PAGES[p];
  if (p.startsWith("/compare/")) return INVOICE;
  return undefined;
}
