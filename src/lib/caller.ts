// Which software sends requests, from the User-Agent, without storing it: bots announce
// themselves as "compatible; Name", browsers start with Mozilla, and HTTP libraries and
// agents lead with a product token ("python-requests/2.32", "agentcash/0.17"). Only that
// name is kept, lowercased and trimmed, so the stored value identifies software, not people.
export function callerFamily(userAgent: string | undefined, marketplace = false): string {
  if (marketplace) return "rapidapi";
  const ua = (userAgent ?? "").trim();
  if (!ua) return "none";
  const named = /compatible;\s*([A-Za-z][\w.-]{1,40})/.exec(ua)?.[1];
  const raw = named ?? (/^Mozilla\//.test(ua) ? "browser" : /^([A-Za-z][\w.-]{0,40})/.exec(ua)?.[1] ?? "other");
  return raw.toLowerCase().replace(/[^a-z0-9._-]/g, "").slice(0, 32) || "other";
}
