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
 * Where a page on a retired public host now lives: the same path and query on the public site, or null when this host
 * is not retired (14 Nov 2026: glyphcall.com replaces tools.funwords.eu as the public home). `retired` is a comma list
 * of host names (RETIRED_PUBLIC_HOSTS). The paid origin on workers.dev is never listed: it only names the public
 * site as canonical, because wallets, listings and clients call it by that address.
 */
export function movedPageUrl(requestUrl: string, site: string | undefined, retired: string | undefined): string | null {
  const target = site?.trim().replace(/\/+$/, "");
  if (!target || !/^https:\/\/[a-z0-9.-]+$/i.test(target) || !retired) return null;
  const url = new URL(requestUrl);
  const hosts = retired.split(",").map((h) => h.trim().toLowerCase()).filter(Boolean);
  if (!hosts.includes(url.hostname.toLowerCase()) || `https://${url.hostname.toLowerCase()}` === target.toLowerCase()) return null;
  return `${target}${url.pathname}${url.search}`;
}
