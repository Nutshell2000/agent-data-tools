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

/**
 * Paths that never move off the paid origin, whatever is asked: a path equal to one of these or below it (`/mcp`,
 * `/mcp/voice`) is answered where it was called. Tool paths are refused separately (`isToolPath`), because the
 * catalog decides them.
 */
export const NEVER_MOVED_PREFIXES = [
  "/mcp", "/v1", "/credits", "/.well-known", "/keys", "/oauth", "/discovery",
  "/openapi.json", "/openapi-marketplace.json", "/llms.txt", "/llms-full.txt", "/robots.txt", "/sitemap.xml",
  "/store", "/buy", "/order", "/order-debug", "/p", "/payee", "/examples", "/skills", "/clients", "/review",
  "/status", "/revenue", "/metrics", "/health", "/find",
] as const;

const PAYING_HEADERS = ["payment-signature", "x-payment", "authorization", "x-api-key"] as const;

/**
 * Where a browser is sent for a human page asked on the paid origin (16 Nov 2026, the owner's rule): the same path
 * and query on the public site, or null. Only a GET whose Accept header asks for text/html, on a host listed in
 * `hosts` (BROWSER_PAGES_MOVED_HOSTS, a comma list), for a page that answered 200 text/html, and never a tool path,
 * a path under NEVER_MOVED_PREFIXES or a request that carries a payment or a key. Everything else on that host
 * (quotes, paid and free calls, MCP, /v1, /credits, catalogs, HEAD and POST, clients that do not ask for HTML)
 * is answered there as before. `header` reads a request header by lower-case name.
 */
export function movedBrowserPageUrl(
  req: { method: string; url: string; header: (name: string) => string | undefined },
  res: { status: number; contentType: string | null },
  site: string | undefined,
  hosts: string | undefined,
  isToolPath: (path: string) => boolean,
): string | null {
  const target = site?.trim().replace(/\/+$/, "");
  if (!target || !/^https:\/\/[a-z0-9.-]+$/i.test(target) || !hosts) return null;
  if (req.method !== "GET" || res.status !== 200 || !/text\/html/i.test(res.contentType ?? "")) return null;
  if (!/text\/html/i.test(req.header("accept") ?? "")) return null;
  if (PAYING_HEADERS.some((name) => req.header(name))) return null;
  const url = new URL(req.url);
  const host = url.hostname.toLowerCase();
  if (!hosts.split(",").map((h) => h.trim().toLowerCase()).filter(Boolean).includes(host) || `https://${host}` === target.toLowerCase()) return null;
  const path = url.pathname;
  if (isToolPath(path) || NEVER_MOVED_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`))) return null;
  return `${target}${path}${url.search}`;
}

/** robots.txt on a host other than the public site names the public site's sitemap (the pages live there). */
export function withPublicSitemap(robots: string, here: string, site: string | undefined): string {
  const target = site?.trim().replace(/\/+$/, "");
  if (!target || !/^https:\/\/[a-z0-9.-]+$/i.test(target) || target === here) return robots;
  return robots.replace(`Sitemap: ${here}/sitemap.xml`, `Sitemap: ${target}/sitemap.xml`);
}

/** The service icon in payment terms and service cards: on the public site when one is set, else `fallback`. */
export function serviceIconUrl(site: string | undefined, fallback: string): string {
  const target = site?.trim().replace(/\/+$/, "");
  return target && /^https:\/\/[a-z0-9.-]+$/i.test(target) ? `${target}/logo.png` : fallback;
}
