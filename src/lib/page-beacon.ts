// The visit beacon on every page for people (21 Nov 2026).
//
// The receiver (lib/beacon.ts, GET/POST /e) had been live since 16 Nov, but no page ever called it: in the ten days to
// 21 Nov the dataset held 50,316 app connections, 9,112 crawler reads and not one event from a browser. The only
// page-view numbers came from the server, which counts every crawler that sends a browser-like user agent, so nobody
// could say how many people visited, what they did or where they left.
//
// One small inline script, added before </body> to every HTML page for people by one middleware (src/index.ts), so no
// page file has to carry it and a new page gets it without anyone remembering. It sends:
//   page_view        once per page load, with the referrer (only its family is stored) and a src/utm_source tag
//   engaged_15s      the page was still open and visible after 15 seconds
//   checkout_click   a click on a link to the card checkout (buy.stripe.com)
//   credits_click    a click on a link to /credits
//   pro_click        a click on a link to /transcribe-pro
//   free_key_click   a click on a link to /keys/free
//   install_app      a click on a link to /app
//   docs_click       a click on a link to /docs or /tools
//   free_key_submit  the free-key form was sent
//   voice_key_submit the voice test key form was sent
//   <name>           any element with data-ev="<name>" that is clicked (lower-case letters, digits, "_" and "-")
// No cookie, no storage, no identifier: each event is a path and a few family names, as lib/beacon.ts describes.

/** Event names the script may send by itself; a data-ev name must have the same shape (lib/funnel.ts `safeSource`). */
export const BEACON_EVENTS = ["page_view", "engaged_15s", "checkout_click", "credits_click", "pro_click", "free_key_click", "install_app", "docs_click", "free_key_submit", "voice_key_submit"] as const;

/** The marker that says a page already carries the script, so it is never added twice. */
export const BEACON_MARK = "data-gc-beacon";

// Kept small and dependency-free: it runs on every page. `navigator.sendBeacon` posts without a body; the receiver reads
// the query string only. Failing silently is deliberate: measurement must never break a page.
const SCRIPT = `(function(){try{var d=document,l=location,n=navigator,ok=/^[a-z0-9_-]{1,40}$/;function s(ev){try{if(!ok.test(ev))return;var q=new URLSearchParams(l.search),u="/e?ev="+ev+"&p="+encodeURIComponent(l.pathname)+"&r="+encodeURIComponent(d.referrer||""),t=q.get("src")||q.get("utm_source");if(t&&ok.test(t))u+="&src="+t;if(n.sendBeacon)n.sendBeacon(u);else(new Image).src=u}catch(e){}}s("page_view");setTimeout(function(){if(d.visibilityState!=="hidden")s("engaged_15s")},15000);d.addEventListener("click",function(e){var a=e.target&&e.target.closest?e.target.closest("[data-ev],a[href]"):null;if(!a)return;var v=a.getAttribute("data-ev"),h=a.getAttribute("href")||"";if(!v){if(/buy\\.stripe\\.com/.test(h))v="checkout_click";else if(/\\/transcribe-pro(\\?|#|$)/.test(h))v="pro_click";else if(/\\/keys\\/free(\\?|#|$)/.test(h))v="free_key_click";else if(/\\/credits(\\/|\\?|#|$)/.test(h))v="credits_click";else if(/\\/app(\\?|#|$)/.test(h))v="install_app";else if(/\\/(docs|tools)(\\/|\\?|#|$)/.test(h))v="docs_click"}if(v)s(v)},true);d.addEventListener("submit",function(e){var f=e.target,a=f&&f.getAttribute?f.getAttribute("action")||"":"";if(/\\/keys\\/free/.test(a))s("free_key_submit");else if(/\\/keys\\/voice-test/.test(a))s("voice_key_submit")},true)}catch(e){}})();`;

/** The script element as it is placed in a page. */
export const BEACON_TAG = `<script ${BEACON_MARK}>${SCRIPT}</script>`;

/**
 * Pages that never get the script: pages a caller published (/p/<id>, their content is not ours to script), the sign-in
 * and consent pages (nothing but the form belongs there), and anything that is not a page for people.
 */
export function beaconWanted(path: string): boolean {
  if (/^\/p\//.test(path) || /^\/oauth(\/|$)/.test(path) || /^\/mcp(\/|$)/.test(path) || /^\/credits\/claim/.test(path) || /^\/keys\/free\/confirm/.test(path)) return false;
  return true;
}

/** The page with the script before its closing body tag; unchanged when it has no body end or already carries it. */
export function withBeacon(html: string): string {
  if (html.includes(BEACON_MARK)) return html;
  const at = html.lastIndexOf("</body>");
  return at < 0 ? html : `${html.slice(0, at)}${BEACON_TAG}${html.slice(at)}`;
}

/**
 * A response with the script added when it is a successful HTML page for people. The body is read whole (our pages are
 * tens of kilobytes); a page above `maxBytes`, a streamed answer without a length we can trust, or any error leaves
 * the response as it was.
 */
export async function beaconed(response: Response, path: string, maxBytes = 2_000_000): Promise<Response> {
  if (response.status !== 200 || !beaconWanted(path)) return response;
  if (!/^text\/html\b/i.test(response.headers.get("content-type") ?? "")) return response;
  if (response.headers.has("content-encoding")) return response;
  if (Number(response.headers.get("content-length") ?? 0) > maxBytes) return response;
  try {
    const html = await response.clone().text();
    if (html.length > maxBytes) return response;
    const out = withBeacon(html);
    if (out === html) return response;
    const headers = new Headers(response.headers);
    headers.delete("content-length");
    return new Response(out, { status: response.status, statusText: response.statusText, headers });
  } catch {
    return response;
  }
}
