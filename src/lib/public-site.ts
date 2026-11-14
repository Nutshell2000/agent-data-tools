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

/**
 * The name people see on the pages written for them (product, VAT and register pages): `PUBLIC_BRAND` when the owner
 * has set one, otherwise the service name. Agent-facing surfaces (MCP, OpenAPI, registries, payment terms) keep the
 * service name: their records are keyed on it (rebrand plan of 11 Nov 2026: brand layer only).
 */
export const publicBrand = (env: { PUBLIC_BRAND?: string }, fallback: string): string => {
  const brand = env.PUBLIC_BRAND?.trim();
  return brand && /^[\p{L}\p{N} .&'-]{2,40}$/u.test(brand) ? brand : fallback;
};

/**
 * Where a page for people has moved to: when the request came in on a host listed in `PREVIOUS_SITE_ORIGINS`
 * (comma-separated origins that used to be the public home) and a public home is set, the same path and query on the
 * public home. Only for the pages people read (the caller checks the path): tool URLs, keys and payment requests keep
 * working on every host, because clients and listings hold them.
 */
export function movedTo(requestUrl: string, site: string | undefined, previous: string | undefined): string | undefined {
  const target = site?.trim().replace(/\/+$/, "");
  if (!target || !/^https:\/\/[a-z0-9.-]+$/i.test(target) || !previous) return undefined;
  const url = new URL(requestUrl);
  const old = previous.split(",").map((o) => o.trim().replace(/\/+$/, "").toLowerCase()).filter(Boolean);
  if (!old.includes(url.origin.toLowerCase()) || url.origin.toLowerCase() === target.toLowerCase()) return undefined;
  return `${target}${url.pathname}${url.search}`;
}
