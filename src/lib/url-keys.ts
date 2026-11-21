// API keys that travel in a URL (21 Nov 2026, safety audit). Two forms exist for clients that cannot send a header:
// `?api_key=adt_…` on a tool URL and `/mcp/k/<key>` as an MCP connector address. A URL is written down in more places
// than a header is (logs, error reports, the Referer a browser sends on), so:
//   - nothing this service logs or counts may hold a key: `redactKeys` cuts every key in a text to its first six
//     characters, and `keylessPath` names the connector route without the key;
//   - an answer to a request that carried a key in its URL tells the browser to send no referrer at all
//     (`urlCarriesKey`, used by lib/response-headers.ts).

const KEY = /adt_[A-Za-z0-9_-]{8,}/g;

/** The text with every API key cut to its first six characters and "…". Text without a key is returned as it is. */
export const redactKeys = (text: string): string => text.replace(KEY, (key) => `${key.slice(0, 6)}…`);

/** A request path that can be counted: the key of an MCP connector address is replaced by the word "key". */
export const keylessPath = (path: string): string => path.replace(/^\/mcp\/k\/[^/]+/, "/mcp/k/key");

/** True when the address of a request holds an API key: in the connector path or in a query parameter. */
export function urlCarriesKey(url: string): boolean {
  try {
    const u = new URL(url, "https://relative.invalid");
    if (/^\/mcp\/k\/[^/]/.test(u.pathname)) return true;
    return ["api_key", "apikey", "key"].some((name) => u.searchParams.getAll(name).some((v) => /^adt_/.test(v.trim())));
  } catch {
    return false;
  }
}

/**
 * What to hand to console.error for a caught error: the error itself, or, when its text holds a key (a failure that
 * quotes the request address), the same text with the key cut short.
 */
export function loggable(err: unknown): unknown {
  const text = err instanceof Error ? `${err.stack ?? `${err.name}: ${err.message}`}` : typeof err === "string" ? err : null;
  if (text === null) return err;
  const cut = redactKeys(text);
  return cut === text ? err : cut;
}
