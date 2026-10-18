/**
 * Whether "/" should get the HTML page rather than the JSON service card. Browsers ask for
 * text/html, but directory scrapers (x402scan's metadata scraper, link unfurlers) send a
 * browser-style User-Agent with no Accept header and read <title>, meta and OpenGraph tags.
 * Programs that want JSON say so, or send a non-browser User-Agent, and keep getting the card.
 */
export function prefersHtml(accept: string | undefined, userAgent: string | undefined): boolean {
  const a = (accept ?? "").toLowerCase();
  if (a.includes("text/html")) return true;
  if (a.includes("application/json")) return false;
  return /^mozilla\//i.test(userAgent ?? "");
}
