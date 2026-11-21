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

/**
 * A bound on the software names that become keys of the funnel's day row (21 Nov 2026, safety audit).
 *
 * Why: a read of a catalog file is counted at /read/<software name>, and the name is the caller's own User-Agent
 * token. All of a day's funnel counts are one stored row with no cap, so a few thousand requests with made-up names
 * could grow that row past the storage limit and stop every counter for the rest of the day.
 *
 * The rule: names on the list below always pass. Any other name passes only while this isolate has seen fewer than
 * NEW_FAMILIES_PER_ISOLATE_DAY different ones today; after that it is counted as "other". A new crawler therefore still
 * shows up under its own name, and made-up names cannot add more than that number of keys per isolate and day. It is
 * a per-isolate bound, not a global one: the exact cap belongs in the Metrics object, which holds the row.
 */
export const KNOWN_FAMILIES: ReadonlySet<string> = new Set([
  "browser", "none", "other", "unnamed", "rapidapi", "fluxa", "orthogonal",
  // HTTP libraries and tools
  "curl", "wget", "node", "node-fetch", "undici", "axios", "got", "bun", "deno", "python-requests", "python-httpx", "python-urllib", "python", "aiohttp", "httpx",
  "go-http-client", "okhttp", "java", "apache-httpclient", "ruby", "faraday", "guzzlehttp", "reqwest", "postmanruntime", "insomnia", "httpie", "libwww-perl", "dart",
  // Search and AI crawlers
  "googlebot", "google-extended", "googleother", "bingbot", "duckduckbot", "yandexbot", "baiduspider", "applebot", "applebot-extended", "petalbot", "amazonbot", "bytespider",
  "gptbot", "chatgpt-user", "oai-searchbot", "claudebot", "claude-user", "claude-searchbot", "anthropic-ai", "perplexitybot", "perplexity-user", "ccbot", "meta-externalagent",
  "facebookexternalhit", "twitterbot", "linkedinbot", "slackbot", "discordbot", "telegrambot", "ahrefsbot", "semrushbot", "mj12bot", "dotbot", "dataforseobot", "uptimerobot",
  // Agent payment clients and directories
  // This service's own tooling
  "agent-data-tools-release", "agent-data-tools-release-warm", "agent-data-tools-seed", "agent-data-tools-self-check", "agent-data-tools-survey", "agentdatatools",
  "agentcash", "x402scan", "x402", "x402-fetch", "x402-axios", "mppx", "mcp-client", "claude-code", "cursor", "openai-mcp", "glama", "smithery",
]);
export const NEW_FAMILIES_PER_ISOLATE_DAY = 25;
const newFamilies = { day: "", names: new Set<string>() };

/** The family name to count under: itself when known or within today's allowance of new names, else "other". */
export function boundedFamily(name: string, now: number = Date.now()): string {
  // The funnel writes "_" as "-" (its path pattern has no underscore), so both forms are one name here.
  const plain = name.replace(/_/g, "-");
  if (KNOWN_FAMILIES.has(plain) || KNOWN_FAMILIES.has(name)) return name;
  const day = new Date(now).toISOString().slice(0, 10);
  if (newFamilies.day !== day) { newFamilies.day = day; newFamilies.names.clear(); }
  if (newFamilies.names.has(plain)) return name;
  if (newFamilies.names.size >= NEW_FAMILIES_PER_ISOLATE_DAY) return "other";
  newFamilies.names.add(plain);
  return name;
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
