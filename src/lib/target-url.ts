// A caller's target URL whose own query was cut at "&" (21 Nov 2026). Callers build
//   /describe?url=https://cdn.example/img.jpg?w=600&q=80&sig=abc
// without percent-encoding the target, so the service received url=https://cdn.example/img.jpg?w=600 and two inputs it
// does not know (q, sig), read the wrong address and answered the target's 400, 403 or a wrong page. Image hosts with
// signed or sized URLs are the usual case: /describe failed on 11 of 31 paid calls in the nine days to 21 Nov.
//
// Rule, kept narrow on purpose: only when the `url` value already holds a "?" (so the target clearly has a query), and
// only for inputs that are neither one of the tool's own inputs, nor an alias of one, nor a control parameter of this
// service. Those are put back on the target in the order they were sent. A target without a query is never changed:
// an unknown input next to it is more likely an option meant for us.

/**
 * A request path in its plain form: lower case, single slashes, no trailing slash, no ".json" ending. Undefined when the
 * path is already plain or cannot be a tool path. The caller checks that the result is a tool before using it.
 */
export function plainToolPath(path: string): string | undefined {
  if (path.length > 200 || !/^\/[A-Za-z0-9/._-]*$/.test(path)) return undefined;
  const plain = path.toLowerCase().replace(/\/{2,}/g, "/").replace(/\.json$/, "").replace(/\/+$/, "") || "/";
  return plain !== path && plain !== "/" ? plain : undefined;
}

const NAME =/^[A-Za-z0-9_.~\-[\]]{1,64}$/;

/**
 * The `url` input with the rest of its query put back, or the value as sent. `ours(name)` is true for every query name
 * that belongs to this service (the tool's inputs, their aliases, control parameters).
 */
export function rejoinedTargetUrl(params: URLSearchParams, ours: (name: string) => boolean): string | undefined {
  const sent = params.get("url") ?? undefined;
  if (!sent || !/^https?:\/\/[^?#\s]+\?/i.test(sent.trim()) || sent.includes("#")) return sent;
  const stray: [string, string][] = [];
  let after = false;
  for (const [name, value] of params) {
    if (name === "url") { after = true; continue; }
    // Only what follows `url` can be the cut-off tail of its query.
    if (!after || ours(name) || !NAME.test(name)) continue;
    stray.push([name, value]);
  }
  if (!stray.length || stray.length > 20) return sent;
  return `${sent.trim()}&${stray.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&")}`;
}
