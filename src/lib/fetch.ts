import { HttpError } from "./env";
import { retryDelayMs, sleep } from "./retry";
import { peekBody } from "./read-capped";
import { isOwnHost } from "./self-fetch";

/** Rejects targets that are never legitimate for a public fetch service. */
export function parseTarget(raw: string | undefined): URL {
  if (!raw) throw new HttpError(400, "missing required query parameter: url");
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new HttpError(400, "url must be an absolute http(s) URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new HttpError(400, "only http and https URLs are supported");
  if (url.username || url.password) throw new HttpError(400, "URLs with credentials are not supported");
  if (url.port) throw new HttpError(400, "only standard HTTP and HTTPS ports are supported");
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  const ipv4 = /^\d+\.\d+\.\d+\.\d+$/.test(host) ? host.split(".").map(Number) : null;
  const privateHost =
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host.startsWith("[") ||
    /^(0|10|127)\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    Boolean(ipv4 && ((ipv4[0] === 100 && ipv4[1] >= 64 && ipv4[1] <= 127) ||
      (ipv4[0] === 198 && (ipv4[1] === 18 || ipv4[1] === 19)) || ipv4[0] >= 224)) ||
    !host.includes(".");
  if (privateHost) throw new HttpError(400, "private, loopback and IPv6-literal hosts are not supported");
  return url;
}

/**
 * Refuses this service's own hostnames on the network path (21 Nov 2026). A tool that reads a caller's URL must not
 * be turned on the service itself: the inner request arrives from the platform's shared egress address, could use
 * that address's free calls, and one paid call could fan out into many requests against our own Worker. Tools that
 * have a reason to read our own pages (the x402 and payee checks, agent readiness) use the service binding instead
 * (lib/self-fetch.ts) and never come here for those hosts.
 */
export function refuseOwnHost(url: URL): void {
  if (isOwnHost(url.hostname)) throw new HttpError(400, "this URL is on this service's own host, which the tools do not fetch; call the tool you want directly (nothing was charged)");
}

/** Passes at most `limit` bytes through, then ends the stream. */
export function capBytes(body: ReadableStream<Uint8Array>, limit: number, onTruncate: () => void) {
  let seen = 0;
  return body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        if (seen >= limit) { onTruncate(); controller.terminate(); return; }
        const room = limit - seen;
        seen += chunk.byteLength;
        if (chunk.byteLength > room) {
          controller.enqueue(chunk.subarray(0, room));
          onTruncate();
          controller.terminate();
        } else {
          controller.enqueue(chunk);
        }
      },
    }),
  );
}

const BUDGET_MS = 8_000;
/** Bodies above this are served but not kept in the edge cache. */
const CACHE_MAX_BYTES = 12 * 1024 * 1024;

/**
 * What a target's 4xx means for the caller. Medium, nytimes.com, Stack Overflow and Reuters answer automated readers
 * 401/403 (checked 24 Oct 2026); "check that the URL is public and correct" sent agents to fix a URL that was fine.
 */
/**
 * Error code on failures of the target the caller named (down, slow, broken redirects, 5xx): uncharged, and counted
 * as the caller's input in /status rather than as our server errors (31 Oct 2026: agents' page readers sent dead URLs
 * to /extract and /pdf/text and took the success rate from 98% to 95%).
 */
export const TARGET_UNAVAILABLE = "TARGET_UNAVAILABLE";
const targetDown = (status: 502 | 504, message: string) => new HttpError(status, message, TARGET_UNAVAILABLE);

export function targetRefusal(status: number) {
  if (status === 401 || status === 403 || status === 451) return `the site refused automated access (HTTP ${status}): it blocks bots or needs a login, so this URL cannot be read here (nothing was charged)`;
  if (status === 404 || status === 410) return `the page was not found (HTTP ${status}); check the URL (nothing was charged)`;
  return `target responded with HTTP ${status}; check that the URL is public and correct (nothing was charged)`;
}

export interface FetchPublicOptions {
  /** Keep a successful answer in the edge cache this long, keyed by final URL and Accept (0 = never). */
  cacheSeconds?: number;
  /** Total time for the request, redirects, retry and body (default 8 s). Large files need more: arXiv sends a 2.2 MB
   *  paper in about 8 s (26 Oct 2026), so /pdf/text timed out on it. */
  budgetMs?: number;
  /** The most the caller will read. With `cacheSeconds`, a body is held in memory only up to this (and never beyond
   *  the cache's own ceiling); a larger one is handed on as a stream for the caller's own cap to refuse or cut. */
  maxBytes?: number;
}

/**
 * Fetches a public URL with the same guards as /extract. Throws HttpError on any failure.
 * `allowStatus` lists non-2xx answers to return instead of failing (e.g. 402 for /x402/check).
 * A target's 429/5xx or a network error is retried once within the 8 s budget (Workers share egress IPs, so an
 * upstream's per-IP limit can refuse a caller who sent nothing before); a target's other 4xx answers are the
 * caller's input and are never retried. With `cacheSeconds`, a 2xx body is kept in the edge cache so repeated reads
 * of the same document do not spend the target's limit again (never for `allowStatus` answers).
 */
export async function fetchPublic(target: URL, accept: string, allowStatus: readonly number[] = [], { cacheSeconds = 0, budgetMs = BUDGET_MS, maxBytes }: FetchPublicOptions = {}): Promise<Response> {
  let current = parseTarget(target.href);
  const deadline = Date.now() + budgetMs;
  const cache = cacheSeconds > 0 && typeof caches !== "undefined" ? (caches as unknown as { default: Cache }).default : undefined;
  const cacheKey = cache ? new Request(`https://fetch-cache.internal/?u=${encodeURIComponent(current.href)}&a=${encodeURIComponent(accept)}`) : undefined;
  if (cache && cacheKey) {
    const hit = await cache.match(cacheKey).catch(() => undefined);
    if (hit) {
      Object.defineProperty(hit, "url", { value: hit.headers.get("x-final-url") ?? current.href });
      return hit;
    }
  }
  // One signal for the whole budget: redirects and the one retry share the same 8 s deadline.
  const signal = AbortSignal.timeout(budgetMs);
  let retried = false;
  for (let redirects = 0; redirects <= 5;) {

    let res: Response;
    try {
      res = await fetch(current, {
        redirect: "manual", signal,
        headers: { "user-agent": "Mozilla/5.0 (compatible; AgentDataTools/1.0)", accept, "accept-language": "en" },
      });
    } catch (e) {
      const timedOut = signal.aborted || (e instanceof Error && e.name === "TimeoutError");
      if (!timedOut && !retried && Date.now() + 700 < deadline) { retried = true; await sleep(700); continue; }
      throw targetDown(timedOut ? 504 : 502, timedOut ? `target did not respond within ${Math.round(budgetMs / 1000)} seconds` : "could not reach target URL");
    }
    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const location = res.headers.get("location");
      await res.body?.cancel().catch(() => {});
      if (!location) throw targetDown(502, "target redirect has no location");
      if (redirects === 5) throw targetDown(502, "target exceeded the five redirect limit");
      let next: URL;
      try { next = new URL(location, current); }
      catch { throw targetDown(502, "target redirect location is invalid"); }
      // Validate BEFORE making the redirected request, never after automatic follow.
      current = parseTarget(next.href);
      redirects++;
      continue;
    }
    const allowed = allowStatus.includes(res.status);
    if (!res.ok && !allowed) {
      await res.body?.cancel().catch(() => {});
      // A missing, gone or forbidden page is the caller's input, not our failure: 422 keeps it out of our server-error
      // count (/status, directory health checks). Rate limits, timeouts and the target's own 5xx stay 502.
      const callerSide = res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429;
      if (!callerSide && !retried) {
        // null: the source asked for a longer wait than our budget allows, so answer 502 now instead of retrying.
        const wait = retryDelayMs(res);
        if (wait !== null && Date.now() + wait < deadline) { retried = true; await sleep(wait); continue; }
      }
      throw callerSide ? new HttpError(422, targetRefusal(res.status)) : targetDown(502, `target responded with HTTP ${res.status}`);
    }
    if (!res.body && !allowed) throw targetDown(502, "target returned an empty body");
    if (cache && cacheKey && res.ok && res.body) {
      // 21 Nov 2026: this used to be `res.arrayBuffer()`, the whole body whatever its size, before any caller's limit
      // could run (the runtime also inflates gzip, so a 1 MB answer could be 1 GB here). Now at most the cache ceiling
      // (or the caller's own limit, when smaller) is held; a larger body is not cached and goes on as a stream,
      // exactly like an uncached fetch, so the caller's cap refuses or cuts it without it ever being buffered.
      const held = await bodyWithin(peekBody(res.body, Math.min(CACHE_MAX_BYTES, maxBytes ?? CACHE_MAX_BYTES)), budgetMs);
      const headers = new Headers(res.headers);
      headers.delete("set-cookie");
      headers.delete("content-length");
      if ("complete" in held) {
        const stored = new Headers(headers);
        stored.set("cache-control", `max-age=${cacheSeconds}`);
        stored.set("x-final-url", current.href);
        await cache.put(cacheKey, new Response(held.complete.slice(0), { status: 200, headers: stored })).catch(() => undefined);
      }
      const out = new Response("complete" in held ? held.complete : held.rest, { status: res.status, headers });
      Object.defineProperty(out, "url", { value: current.href });
      return out;
    }
    // A response from a manual redirect chain otherwise loses its effective URL.
    Object.defineProperty(res, "url", { value: current.href });
    return res;
  }
  throw new HttpError(502, "target exceeded the redirect limit");
}

/**
 * Reads a target's body under the request's own deadline. The timeout signal also covers the body, so a target that
 * answered in time but was still sending when the budget ran out threw a bare abort, which the error handler counted
 * as our server error ("an outside data source did not respond in time"): 72 /pdf/text calls in the week to 7 Nov.
 * It is the target being slow, like a late answer: 504 TARGET_UNAVAILABLE, uncharged, counted as the caller's input.
 */
export async function bodyWithin<T>(read: Promise<T>, budgetMs: number): Promise<T> {
  try {
    return await read;
  } catch (e) {
    if (e instanceof HttpError) throw e;
    const name = e instanceof Error ? e.name : "";
    if (name === "TimeoutError" || name === "AbortError") throw targetDown(504, `target did not finish sending within ${Math.round(budgetMs / 1000)} seconds`);
    throw targetDown(502, "target connection broke while sending");
  }
}

/** Downloads a file of an expected media type, refusing anything over `maxBytes`. */
export async function fetchFile(rawUrl: string | undefined, typePattern: RegExp, maxBytes: number, what: string, options: FetchPublicOptions = {}) {
  const target = parseTarget(rawUrl);
  // The limit goes down to the cached read too, so a file over it is never held whole (21 Nov 2026).
  const res = await fetchPublic(target, "*/*", [], { ...options, maxBytes });
  const contentType = res.headers.get("content-type") ?? "";
  if (!typePattern.test(contentType)) { await res.body?.cancel().catch(() => {}); throw new HttpError(415, `url must point to ${what}; got ${contentType || "an unknown type"}`); }
  let tooBig = Number(res.headers.get("content-length")) > maxBytes;
  if (tooBig) await res.body?.cancel().catch(() => {});
  const bytes = tooBig ? new Uint8Array() : new Uint8Array(await bodyWithin(new Response(capBytes(res.body!, maxBytes + 1, () => {})).arrayBuffer(), options.budgetMs ?? BUDGET_MS));
  tooBig ||= bytes.byteLength > maxBytes;
  if (tooBig) throw new HttpError(422, `file is larger than the ${Math.round(maxBytes / 1024 / 1024)} MB limit (nothing was charged)`);
  return { url: target.href, finalUrl: res.url || target.href, contentType: contentType.split(";")[0].trim(), bytes };
}
