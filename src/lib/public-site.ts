/**
 * The public home of the human pages (owner's decision, 10 Nov 2026: tools.funwords.eu for now, a dedicated domain later).
 *
 * The same Worker answers on workers.dev and on the public host, and each host used to name itself as canonical, so
 * Google held two competing copies: on workers.dev it indexed 1 of 608 pages, on the public host it shows them. Pages
 * served from any other host now name the public host's URL as canonical (and as og:url), so every signal lands on one
 * address. Only those two tags change: request examples, payment terms and catalogs keep the host that was asked.
 * When the dedicated domain arrives, change PUBLIC_SITE_ORIGIN (wrangler.jsonc) and redirect the old public host.
 */
export function withPublicCanonical(html: string, here: string, site: string | undefined): string {
  const target = site?.trim().replace(/\/+$/, "");
  if (!target || !/^https:\/\/[a-z0-9.-]+$/i.test(target) || target === here) return html;
  return html
    .replaceAll(`<link rel="canonical" href="${here}`, `<link rel="canonical" href="${target}`)
    .replaceAll(`<meta property="og:url" content="${here}`, `<meta property="og:url" content="${target}`);
}
