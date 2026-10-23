// Which software sends requests, from the User-Agent, without storing it: bots announce
// themselves as "compatible; Name", browsers start with Mozilla, and HTTP libraries and
// agents lead with a product token ("python-requests/2.32", "agentcash/0.17"). Only that
// name is kept, lowercased and trimmed, so the stored value identifies software, not people.
/** Lowercase software name, safe to store: letters, digits, dot, dash and underscore, at most 32 characters. */
export const softwareName = (raw: string) => raw.toLowerCase().replace(/[^a-z0-9._-]/g, "").slice(0, 32) || "other";

/** The MCP client's self-reported name (clientInfo.name) from an initialize request body, if this is one. */
export function mcpClientName(body: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(body);
    for (const msg of Array.isArray(parsed) ? parsed : [parsed]) {
      const m = msg as { method?: unknown; params?: { clientInfo?: { name?: unknown } } };
      if (m?.method === "initialize") return typeof m.params?.clientInfo?.name === "string" ? softwareName(m.params.clientInfo.name) : "unnamed";
    }
  } catch { /* not JSON: not an initialize request */ }
  return undefined;
}

/** `marketplace` is the proxy's name ("rapidapi", "fluxa"), or true for RapidAPI (the original only one). */
export function callerFamily(userAgent: string | undefined, marketplace: boolean | string = false): string {
  if (marketplace) return typeof marketplace === "string" ? marketplace : "rapidapi";
  const ua = (userAgent ?? "").trim();
  if (!ua) return "none";
  const named = /compatible;\s*([A-Za-z][\w.-]{1,40})/.exec(ua)?.[1];
  const raw = named ?? (/^Mozilla\//.test(ua) ? "browser" : /^([A-Za-z][\w.-]{0,40})/.exec(ua)?.[1] ?? "other");
  return softwareName(raw);
}
