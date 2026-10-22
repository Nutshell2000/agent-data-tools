// Three tools to try next, for the bot that just bought (or was quoted) one of ours. Bot C reached
// /check/counterparty through our discovery file after buying /btc-fees; this puts that next step in the answer
// itself: a `Link: …; rel="related"` header on every tool response, and a `related` list in the readable 402 body.
// Same category first, then the best sellers (salesOrdered), never the tool itself. Nothing here changes a tool's
// output body or its output contract.
import { ENDPOINTS, type Endpoint } from "../endpoints";
import { categoryOf } from "../discovery";
import { listingName } from "./bazaar-extension";
import { salesOrdered } from "./discovery-index";

const cache = new Map<string, Endpoint[]>();

export function relatedTools(path: string, max = 3): Endpoint[] {
  let related = cache.get(path);
  if (!related) {
    const category = categoryOf(path);
    const others = salesOrdered(ENDPOINTS).filter((e) => e.path !== path);
    related = [...others.filter((e) => categoryOf(e.path) === category), ...others.filter((e) => categoryOf(e.path) !== category)].slice(0, max);
    cache.set(path, related);
  }
  return related;
}

/** RFC 8288 Link header value: `<url>; rel="related"; title="…"` per tool. */
export function relatedLinkHeader(origin: string, path: string): string {
  return relatedTools(path).map((e) => `<${origin}${e.path}>; rel="related"; title="${listingName(e.summary).replace(/"/g, "")}"`).join(", ");
}

/** The same three tools for a JSON body: url, name and price. */
export function relatedList(origin: string, path: string) {
  return relatedTools(path).map((e) => ({ url: `${origin}${e.path}`, name: listingName(e.summary), price: e.price }));
}
