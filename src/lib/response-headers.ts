/**
 * Browser safety headers for pages and JSON answers (21 Nov 2026, safety audit).
 *
 * Why: the HTML pages carried only HSTS, so another site could show the credits or tool pages inside a frame
 * (clickjacking), a browser could guess a content type, and a full page address could leak to other sites as referrer.
 *
 * What is added, and only when the route did not set it itself:
 *   - every `text/html` answer: `X-Content-Type-Options: nosniff`, a `Referrer-Policy`, and a framing rule in both the
 *     old and the new form (`X-Frame-Options` and `Content-Security-Policy: frame-ancestors`);
 *   - every JSON answer: `X-Content-Type-Options: nosniff`.
 *
 * What is deliberately NOT added: any script-src, style-src or default-src rule. The pages use inline styles and
 * scripts, and a wrong rule would break them. A route that sets its own Content-Security-Policy (the hosted pages
 * under /p/) keeps it untouched. A route that already forbids framing with `X-Frame-Options: DENY` (the sign-in
 * consent page) keeps that strength: the policy written here repeats it as 'none', because a browser that knows
 * frame-ancestors ignores X-Frame-Options, and 'self' would have loosened the page's own rule.
 *
 * No page of this service is meant to be shown inside a frame on another site (checked on 21 Nov 2026: no page builder
 * writes a frame, and no route answers for an embed), so nothing is exempt.
 *
 * One exception to "only when the route did not set it": a request whose address holds an API key (`?api_key=` or
 * `/mcp/k/<key>`, lib/url-keys.ts) is answered with `Referrer-Policy: no-referrer` whatever the content type and
 * whatever the route chose, so a browser never passes that address on to another site.
 *
 * Status, body and every other header a route wrote stay as they are: a 402 quote keeps its status, PAYMENT-REQUIRED and
 * WWW-Authenticate byte for byte, with one small header more.
 */
import { urlCarriesKey } from "./url-keys";

export const DEFAULT_REFERRER_POLICY = "strict-origin-when-cross-origin";

/** The header names this module may add. Nothing else is ever written, and none of them is ever replaced. */
export const SAFETY_HEADER_NAMES = ["x-content-type-options", "referrer-policy", "content-security-policy", "x-frame-options"] as const;

/** The headers to add to an answer with these headers: [name, value] pairs, empty when nothing is missing. */
export function missingSafetyHeaders(headers: Headers): [string, string][] {
  const type = (headers.get("content-type") ?? "").toLowerCase();
  const html = type.startsWith("text/html");
  const json = /^application\/(?:[a-z0-9.-]+\+)?json\b/.test(type);
  if (!html && !json) return [];
  const add: [string, string][] = [];
  if (!headers.has("x-content-type-options")) add.push(["X-Content-Type-Options", "nosniff"]);
  if (!html) return add;
  if (!headers.has("referrer-policy")) add.push(["Referrer-Policy", DEFAULT_REFERRER_POLICY]);
  if (!headers.has("content-security-policy")) {
    const own = (headers.get("x-frame-options") ?? "").trim().toUpperCase();
    add.push(["Content-Security-Policy", `frame-ancestors ${own === "DENY" ? "'none'" : "'self'"}`]);
    if (!own) add.push(["X-Frame-Options", "SAMEORIGIN"]);
  }
  return add;
}

/**
 * The same answer with the missing safety headers; the very same object when nothing is missing. With the request's
 * address, an answer to a request that carried an API key in it also gets `Referrer-Policy: no-referrer`.
 */
export function withSafetyHeaders(response: Response, requestUrl?: string): Response {
  let add = missingSafetyHeaders(response.headers);
  if (requestUrl && urlCarriesKey(requestUrl) && (response.headers.get("referrer-policy") ?? "").trim().toLowerCase() !== "no-referrer") {
    add = [...add.filter(([name]) => name !== "Referrer-Policy"), ["Referrer-Policy", "no-referrer"]];
  }
  if (!add.length) return response;
  try {
    for (const [name, value] of add) response.headers.set(name, value);
    return response;
  } catch {
    // Some answers (static assets, answers passed through from a fetch) have headers that cannot be changed: copy first.
    const copy = new Response(response.body, response);
    for (const [name, value] of add) copy.headers.set(name, value);
    return copy;
  }
}
