/**
 * Permissions-Policy, Vary: Accept, HSTS for subdomains and social tags (security scan M3/L2 and SEO audit P1-9/P2-1,
 * 21 Nov 2026).
 *
 * - Framing (CSP frame-ancestors, X-Frame-Options), nosniff and Referrer-Policy on HTML come from
 *   lib/response-headers.ts (release 1.328.0); this file adds only what that one does not: Permissions-Policy on HTML,
 *   Vary: Accept, and the HSTS value with includeSubDomains.
 * - The microphone stays allowed for this origin: the voice pages record audio in the browser.
 * - Responses whose body depends on the Accept header ("/" and the pages that answer JSON to programs) say so with
 *   Vary: Accept, so no cache hands a JSON copy to a browser or a crawler.
 * - 987 of 993 pages had no twitter:card, a few no og:image; on the Glyphcall brand the old service image is replaced
 *   by the Glyphcall one.
 */
import { VOICE_TEST_PATH, CREDITS_TRIAL_PATH } from "./voice-keys";

/** Added to every HTML answer that does not carry it. */
export const PERMISSIONS_POLICY = "camera=(), geolocation=(), usb=(), microphone=(self)";

/** HSTS for every response: every glyphcall.com subdomain serves HTTPS (security scan, 21 Nov 2026). */
export const HSTS = "max-age=31536000; includeSubDomains";

/** Paths whose body is HTML or JSON depending on the Accept header (lib/negotiate.ts prefersHtml and its callers). */
export const NEGOTIATED_PATHS: ReadonlySet<string> = new Set(["/", "/credits", "/credits/claim", "/keys/free", "/keys/free/confirm", VOICE_TEST_PATH, CREDITS_TRIAL_PATH]);

/** Permissions-Policy on an HTML answer, when the route did not set one. Nothing else changes. */
export function setHtmlHeaders(headers: Headers): void {
  if (!headers.has("permissions-policy")) headers.set("Permissions-Policy", PERMISSIONS_POLICY);
}

/** Adds "Accept" to Vary, keeping what is there. */
export function varyOnAccept(headers: Headers): void {
  const vary = headers.get("Vary");
  if (!vary) headers.set("Vary", "Accept");
  else if (!/(^|,)\s*(accept|\*)\s*(,|$)/i.test(vary)) headers.set("Vary", `${vary}, Accept`);
}

/**
 * The page with twitter:card and og:image when it has none (inserted before </head>), and, on the Glyphcall brand,
 * the old service image swapped for the Glyphcall image. `origin` is the host that answered (both images are served
 * on every host). Unchanged when the page has no </head>.
 */
export function withSocialTags(html: string, origin: string, brand: string): string {
  const head = html.indexOf("</head>");
  if (head < 0) return html;
  const glyphcall = brand === "Glyphcall";
  const image = `${origin}/${glyphcall ? "og-glyphcall.png" : "og.png"}`;
  let out = glyphcall ? html.replaceAll(`content="${origin}/og.png"`, `content="${image}"`) : html;
  const add: string[] = [];
  if (!/<meta\s+name="twitter:card"/i.test(out)) add.push('<meta name="twitter:card" content="summary_large_image">');
  if (!/<meta\s+property="og:image"/i.test(out)) add.push(`<meta property="og:image" content="${image}">`);
  if (!add.length) return out;
  const at = out.indexOf("</head>");
  out = `${out.slice(0, at)}${add.join("")}${out.slice(at)}`;
  return out;
}
