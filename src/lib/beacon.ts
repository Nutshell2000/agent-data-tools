// Cookieless measurement on Workers Analytics Engine (16 Nov 2026). Why: Search Console shows almost no clicks, a
// referrer header is not proof of a person, and the funnel counters live in a Durable Object with a write budget. A data
// point here is one non-blocking `writeDataPoint`: no Durable Object or KV write, nothing awaited, and nothing at all
// when the `ANALYTICS` binding is missing (tests, local runs).
//
// What a data point may hold: an event name, a path without its query, FAMILY names (referrer family, software family of
// the user agent, AI crawler name, MCP client software name), a two-letter country, a validated `src` tag and one of our
// own host names. Never an IP address, a full user agent, a full referrer, a cookie, a key, or any other query value.
//
// Four things live here, behind the one `measurement()` hook in src/index.ts:
//   1. GET /e?ev=<event>&p=<path>      the beacon pages call (also HEAD and POST, for navigator.sendBeacon). Always 204.
//   2. MCP `initialize` on any /mcp…    the client's software name and the `?src=` of the connection URL.
//   3. AI crawlers                      one point per GET of a page or discovery file by a crawler in lib/ai-crawlers.ts.
//   4. utm into Stripe links            a page opened with utm_source (or src) hands it to its Stripe payment links as
//                                       client_reference_id=utm_<source>[_<medium>[_<campaign>]]; needs no binding.
// Layouts, SQL and the page snippet: docs/cloud-reports/2026-11-16-measurement.md and scripts/analytics-queries.mjs.
import type { Context, MiddlewareHandler } from "hono";
import type { Env } from "./env";
import { aiCrawlerName } from "./ai-crawlers";
import { callerFamily, mcpClientName } from "./caller";
import { apiKeyFrom } from "./credits";
import { isCatalogFile, isHumanPage, referrerFamily, safeSource } from "./funnel";

export const BEACON_PATH = "/e";
/** Events only the Worker itself may write; a beacon that names one is answered 204 and dropped. */
export const SERVER_EVENTS: ReadonlySet<string> = new Set(["mcp_initialize", "ai_crawler"]);

// The binding is declared here, not in lib/env.ts, so this file is the only one that knows it.
interface Dataset { writeDataPoint(point: { indexes?: string[]; blobs?: string[]; doubles?: number[] }): void }
const dataset = (env: Env) => (env as Env & { ANALYTICS?: Dataset }).ANALYTICS;
type Ctx = Context<{ Bindings: Env }>;

/** One counted data point: index and blob1 are the event, doubles [1]. Never throws and never waits. */
export function writeEvent(env: Env, event: string, blobs: string[]): void {
  try { dataset(env)?.writeDataPoint({ indexes: [event], blobs: [event, ...blobs], doubles: [1] }); }
  catch { console.error("measurement: data point not written"); }
}

const hostOf = (url: string | undefined) => { try { return url ? new URL(url).hostname.toLowerCase() : undefined; } catch { return undefined; } };
/** Our own hosts: the one this request came to and the public site, with their subdomains (voice.glyphcall.com). */
const ownHosts = (c: Ctx) => [hostOf(c.req.url), hostOf(c.env.PUBLIC_SITE_ORIGIN)].filter((h): h is string => Boolean(h));
const isOwn = (host: string, own: string[]) => own.some((h) => host === h || host.endsWith(`.${h}`));

/**
 * A path that is safe to store: starts with "/", query and fragment dropped, URL path characters only, at most `max`.
 * A key in a connector URL (/mcp/k/<key>) and the id of a published page (/p/<id>) are replaced by a placeholder.
 */
export function safePath(raw: string | undefined, max = 200): string | undefined {
  const path = (raw ?? "").split(/[?#]/)[0];
  if (path.length > max || !/^\/[A-Za-z0-9._~%/-]*$/.test(path)) return undefined;
  return path.replace(/^\/mcp\/k\/[^/]+/, "/mcp/k/:key").replace(/^\/p\/[^/]+/, "/p/:id");
}

/** The family a visit came from, from the page's own `document.referrer` (param `r`); only the family name is kept. */
function beaconReferrer(r: string | undefined, own: string[]): string {
  if (r === undefined) return "unknown";
  if (r.length > 2_000) return "other";
  const host = hostOf(r);
  return referrerFamily(r || undefined, host && isOwn(host, own) ? host : "");
}

function beacon(c: Ctx): Response {
  c.header("Cache-Control", "no-store");
  const ev = safeSource(c.req.query("ev"));
  const path = safePath(c.req.query("p"));
  if (ev && path && !SERVER_EVENTS.has(ev) && dataset(c.env)) {
    const own = ownHosts(c);
    // Which of our sites sent it: the calling page's host when it is one of ours, never a foreign host name.
    const from = hostOf(c.req.header("origin")) ?? hostOf(c.req.header("referer"));
    const country = (c.req.raw as { cf?: { country?: unknown } }).cf?.country;
    writeEvent(c.env, ev, [
      path,
      beaconReferrer(c.req.query("r"), own),
      callerFamily(c.req.header("user-agent")),
      typeof country === "string" && /^[A-Z0-9]{2}$/.test(country) ? country : "",
      safeSource(c.req.query("src")) ?? safeSource(c.req.query("utm_source")) ?? "",
      !from ? "unknown" : isOwn(from, own) ? from.slice(0, 60) : "other",
    ]);
  }
  return c.body(null, 204);
}

/** At most `max` bytes of a request body, read from a clone so the handler still gets the whole body. */
async function boundedBody(request: Request, max = 16_384): Promise<string | undefined> {
  try {
    if (Number(request.headers.get("content-length") ?? 0) > max) return undefined;
    const reader = request.clone().body?.getReader();
    if (!reader) return undefined;
    const chunks: Uint8Array[] = [];
    for (let size = 0; ;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > max) { void reader.cancel().catch(() => undefined); return undefined; }
      chunks.push(value);
    }
    return await new Blob(chunks).text();
  } catch { return undefined; }
}

/** The MCP route without anything secret (/mcp, /mcp/chain, /mcp/account, /mcp/k/:key/compact) and how the caller is known. */
export function mcpRoute(path: string, hasKeyHeader: boolean): { route: string; mode: "open" | "key" | "account" } {
  const parts = path.split("/").filter(Boolean).slice(1);
  const keyed = parts[0] === "k";
  const rest = keyed ? parts.slice(2) : parts;
  const route = rest.length <= 2 && rest.every((s) => /^[a-z0-9-]{1,40}$/.test(s)) ? `/mcp${keyed ? "/k/:key" : ""}${rest.map((s) => `/${s}`).join("")}` : "/mcp/other";
  return { route, mode: parts[0] === "account" || parts[0] === "chatgpt" ? "account" : keyed || hasKeyHeader ? "key" : "open" };
}

/** Pages and discovery files whose reads by an AI crawler are counted: never a tool call, never anything under /mcp. */
function crawlerCounted(path: string, res: Response, paidPaths: ReadonlySet<string>): boolean {
  if (paidPaths.has(path) || /^\/mcp(\/|$)/.test(path) || path === BEACON_PATH) return false;
  if (isHumanPage(path) || isCatalogFile(path) || path === "/sitemap.xml" || path === "/robots.txt") return true;
  // Every other page for people (legal pages, e-invoice rules, comparisons, payee records…): an HTML answer that is not an error.
  return res.status < 400 && (res.headers.get("content-type") ?? "").includes("text/html");
}

/** One part of a campaign tag as Stripe's client_reference_id takes it: a-z, 0-9 and dashes, at most 40 characters. */
const utmPart = (raw: string | null) => (raw ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+/, "").slice(0, 40).replace(/-+$/, "");

/**
 * `utm_<source>[_<medium>[_<campaign>]]` from a page URL's utm_source (or src), utm_medium and utm_campaign; undefined
 * without a source. At most 126 characters of [a-z0-9_-], inside Stripe's 200. A missing medium before a campaign is "-".
 * It never starts with "topup_", so the top-up parser (keyHashFromReference in lib/credits.ts) reads it as "no key named".
 */
export function utmReference(params: URLSearchParams): string | undefined {
  const source = utmPart(params.get("utm_source")) || utmPart(params.get("src"));
  if (!source) return undefined;
  const medium = utmPart(params.get("utm_medium")), campaign = utmPart(params.get("utm_campaign"));
  return ["utm", source, ...(medium || campaign ? [medium || "-"] : []), ...(campaign ? [campaign] : [])].join("_");
}

/** Adds the reference to every Stripe payment link of a page that carries none yet; top-up links keep their own. */
export const withUtmOnStripeLinks = (html: string, reference: string) =>
  html.replace(/(href="https:\/\/buy\.stripe\.com\/[A-Za-z0-9]+)(?=")/g, `$1?client_reference_id=${reference}`);

/** The one hook: mount it after CORS and before the routes. `paidPaths` are the tool and purchase paths, which it never touches. */
export function measurement(paidPaths: ReadonlySet<string>): MiddlewareHandler<{ Bindings: Env }> {
  return async (c, next) => {
    const path = c.req.path, method = c.req.method;
    if (path === BEACON_PATH && (method === "GET" || method === "HEAD" || method === "POST")) return beacon(c);

    if (method === "POST" && /^\/mcp(\/|$)/.test(path) && dataset(c.env)) {
      // Counted on initialize only, like mcpConnections (src/mcp.ts), and only when the server accepted the request.
      const client = mcpClientName(await boundedBody(c.req.raw) ?? "");
      await next();
      if (client && c.res.status < 400) {
        const { route, mode } = mcpRoute(path, Boolean(apiKeyFrom((name) => c.req.header(name))));
        writeEvent(c.env, "mcp_initialize", [route, client, mode, "", safeSource(c.req.query("src")) ?? "", hostOf(c.req.url) ?? ""]);
      }
      return;
    }

    await next();
    if (method !== "GET") return;
    const crawler = dataset(c.env) ? aiCrawlerName(c.req.header("user-agent")) : undefined;
    if (crawler && crawlerCounted(path, c.res, paidPaths)) {
      writeEvent(c.env, "ai_crawler", [safePath(path, 120) ?? "/other", crawler, `${Math.floor(c.res.status / 100)}xx`, "", "", hostOf(c.req.url) ?? ""]);
    }
    // A visitor who arrived with a campaign tag keeps it through the Stripe checkout. Pages only (200, HTML, not a tool
    // path), so it never reaches a quote, a 402 body or a JSON answer; the page is rewritten for this request alone.
    if (c.res.status !== 200 || paidPaths.has(path) || !(c.res.headers.get("content-type") ?? "").includes("text/html")) return;
    const reference = utmReference(new URL(c.req.url).searchParams);
    if (!reference) return;
    const headers = new Headers(c.res.headers);
    headers.delete("content-length");
    const tagged = new Response(withUtmOnStripeLinks(await c.res.text(), reference), { status: 200, headers });
    c.res = undefined as never;
    c.res = tagged;
  };
}
