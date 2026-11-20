/**
 * Category hosts (19 Nov 2026): hosts that answer ONLY one family of tools, so routers that group listings by host see a
 * service named for that task.
 *
 * Why: Mercator (the router behind our biggest buyer) imports sellers from the Coinbase Bazaar as one service per host and
 * names the service after one of its listings. All 700+ of our tools share one host, so the service is named "Web, crypto
 * and security data", and Mercator's relevance score (95% of rank) reads the service name: /ai/speech is #8 for "text to
 * speech" (relevance 0.38 vs 0.73 at the top), and the 18 Nov service rename moved /cve from #12 to #1. Mercator's buyer
 * agents search with the full task, take the top 5-10 results and pin the provider they pick for the whole job.
 *   - tts.glyphcall.com: speech (Mercator paid another seller $39.80 in 14 days for generic TTS at $0.10 a call).
 *   - web.glyphcall.com: page reading, scraping, PDFs and site audits (scraping is Mercator's third-busiest job class;
 *     a website-audit job paid HubVibe $83.70 in 30 days while our /audit/website ranks #1 without a service name to match).
 * URL safety deliberately has NO category host: the URL-safety fan-out pays several independent vendors per link, and a
 * second service that is really us would pose as an independent opinion.
 *
 * Tools, prices, payment terms and wallet are the same as on every other host (the 402 resource URL follows the request
 * host). Every other path answers 404 on a category host with the address that serves it, so no other listing can ever be
 * settled there and change the service's name. A host is listed only after a tool's first settlement on it.
 */
export interface CategoryHost { service: string; about: string; docs: string; paths: ReadonlySet<string> }

export const CATEGORY_HOSTS: Readonly<Record<string, CategoryHost>> = Object.freeze({
  "tts.glyphcall.com": {
    service: "Text to speech",
    about: "Text to speech API: natural voices, MP3 audio from text, paid per call with x402 (USDC) or a prepaid key. Call a tool URL without payment to get its price and payment terms.",
    docs: "https://glyphcall.com/text-to-speech-api",
    paths: new Set(["/ai/speech", "/ai/tts", "/text-to-speech", "/text-to-speech/lite", "/v1/audio/speech"]),
  },
  "web.glyphcall.com": {
    service: "Web page to Markdown",
    about: "Web reading API for agents: any URL as clean Markdown or text, rendered pages, PDFs and documents, page metadata, feeds, sitemaps, screenshots and website audits, paid per call with x402 (USDC) or a prepaid key. Call a tool URL without payment to get its price and payment terms.",
    docs: "https://glyphcall.com/bulk-web-reader-api",
    paths: new Set(["/page/markdown", "/scrape", "/extract", "/web/fetch", "/contents", "/extract/rendered", "/url/meta", "/pdf/text", "/pdf/extract", "/document/text", "/summarize", "/sitemap", "/feed", "/screenshot/website", "/audit/website", "/seo/audit"]),
  },
});

/**
 * Discovery documents a category host answers itself, filtered to its own tools and named for its task (19 Nov 2026).
 * Why: Mercator refreshes its services daily from MPPScan and the x402 registries (Tempo, 19 Nov), and those register an
 * ORIGIN by reading its discovery documents. Without its own documents a category host could not be registered, so it
 * never became the separate, task-named service it exists for.
 */
export const CATEGORY_DISCOVERY_PATHS: ReadonlySet<string> = new Set(["/.well-known/x402", "/.well-known/x402.json", "/openapi.json", "/discovery/resources"]);

/** The category host a request was made to, or undefined on every other host. */
export function categoryHostOf(requestUrl: string): CategoryHost | undefined {
  const name = new URL(requestUrl).hostname;
  return Object.hasOwn(CATEGORY_HOSTS, name) ? CATEGORY_HOSTS[name] : undefined;
}

/** Where everything else lives. */
export const CATEGORY_HOST_ELSEWHERE = "https://api.glyphcall.com";

/**
 * What a category host answers before anything else runs, or null to let the request through unchanged.
 * Only requests to a host in CATEGORY_HOSTS are touched; on any other host this always returns null.
 */
export function categoryHostAnswer(requestUrl: string): Response | null {
  const url = new URL(requestUrl);
  const host = Object.hasOwn(CATEGORY_HOSTS, url.hostname) ? CATEGORY_HOSTS[url.hostname] : undefined;
  if (!host) return null;
  if (host.paths.has(url.pathname) || CATEGORY_DISCOVERY_PATHS.has(url.pathname)) return null;
  const tools = [...host.paths].map((p) => `https://${url.hostname}${p}`);
  if (url.pathname === "/") {
    return Response.json({ service: host.service, about: host.about, tools, docs: host.docs, everythingElse: CATEGORY_HOST_ELSEWHERE },
      { headers: { "Cache-Control": "public, max-age=3600" } });
  }
  return Response.json({
    error: `${url.hostname} serves ${host.service.toLowerCase()} only; this path is served at ${CATEGORY_HOST_ELSEWHERE}${url.pathname}`,
    code: "NOT_ON_THIS_HOST",
    tools,
    use: `${CATEGORY_HOST_ELSEWHERE}${url.pathname}${url.search}`,
  }, { status: 404, headers: { "Cache-Control": "public, max-age=3600" } });
}

// Names kept from the first version (one TTS host) for the middleware and tests.
export const TTS_HOST = "tts.glyphcall.com";
export const TTS_HOST_PATHS: ReadonlySet<string> = CATEGORY_HOSTS[TTS_HOST].paths;
export const TTS_HOST_ELSEWHERE = CATEGORY_HOST_ELSEWHERE;
export const ttsHostAnswer = categoryHostAnswer;
