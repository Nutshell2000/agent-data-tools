// Website agent-readiness scan (5 Nov 2026). asterpay's agent-readiness scan ("scores 0-100 on MCP server,
// /.well-known/agent…") had 36 payers at $0.03; we sold no such check. It reads only public files a site publishes for
// agents and crawlers, each with its own short fetch, and scores what an AI agent can find and use.
import { entry, need, type Entry } from "../family";
import { HttpError } from "../lib/env";
import { fetchPublic } from "../lib/fetch";
import { robotsVerdict } from "./lookups";

const AI_CRAWLERS = ["GPTBot", "ClaudeBot", "PerplexityBot", "Google-Extended", "CCBot", "Applebot-Extended"];
type Check = { id: string; label: string; weight: number; paths: string[]; valid: (body: string, type: string) => boolean; fix: string };
const isJson = (body: string) => { try { return typeof JSON.parse(body) === "object"; } catch { return false; } };
const CHECKS: Check[] = [
  { id: "llms_txt", label: "llms.txt", weight: 20, paths: ["/llms.txt"], valid: (b, t) => !/html/i.test(t) && /^\s*#/.test(b), fix: "Publish /llms.txt: a Markdown summary of the site with links to its key pages (llmstxt.org)." },
  { id: "sitemap", label: "sitemap.xml", weight: 10, paths: ["/sitemap.xml", "/sitemap_index.xml"], valid: (b) => /<(urlset|sitemapindex)\b/i.test(b), fix: "Publish a sitemap (usually /sitemap.xml) and name it in robots.txt with a Sitemap: line." },
  // Large specs pass the 300 KB read cut and no longer parse, so only the head is checked.
  { id: "openapi", label: "OpenAPI spec", weight: 15, paths: ["/openapi.json", "/.well-known/openapi.json", "/swagger.json"], valid: (b) => /^\s*\{/.test(b) && /"(openapi|swagger)"\s*:\s*"/.test(b.slice(0, 5000)), fix: "Publish an OpenAPI document at /openapi.json so agents can call your API without docs scraping." },
  { id: "mcp", label: "MCP server card", weight: 20, paths: ["/.well-known/mcp/server-card.json", "/.well-known/mcp.json", "/.well-known/mcp"], valid: (b) => isJson(b) && /"(serverInfo|name|endpoint|url|tools)"\s*:/.test(b), fix: "Run an MCP server and describe it at /.well-known/mcp/server-card.json." },
  { id: "a2a", label: "A2A agent card", weight: 15, paths: ["/.well-known/agent-card.json", "/.well-known/agent.json"], valid: (b) => isJson(b) && /"name"\s*:/.test(b) && /"(skills|capabilities|url)"\s*:/.test(b), fix: "Publish an A2A agent card at /.well-known/agent-card.json (name, url, skills)." },
  { id: "x402", label: "x402 payments discovery", weight: 10, paths: ["/.well-known/x402", "/.well-known/x402.json"], valid: (b) => isJson(b), fix: "If you sell API calls, list them for agent payments at /.well-known/x402." },
];

async function grab(origin: string, path: string) {
  const res = await fetchPublic(new URL(path, origin), "*/*", Array.from({ length: 200 }, (_, i) => 300 + i), { budgetMs: 6_000 }).catch(() => null);
  if (!res || res.status >= 300) { await res?.body?.cancel().catch(() => {}); return null; }
  const text = (await res.text().catch(() => "")).slice(0, 300_000);
  return { url: new URL(path, origin).href, type: res.headers.get("content-type") ?? "", text };
}

export const AGENT_READINESS: Entry[] = [
  entry("/agent-readiness", "Agent readiness, llms.txt check",
    "Score how ready a website is for AI agents, 0-100: llms.txt, sitemap, OpenAPI spec, MCP server card, A2A agent card and x402 payment discovery, each found or missing with its URL, which AI crawlers (GPTBot, ClaudeBot, PerplexityBot and others) robots.txt lets in, and a list of fixes. Reads only the public files a site publishes; nothing is signed in or submitted. Use to audit your own site or vet a service before an agent relies on it.",
    ["agent-readiness", "llms-txt", "mcp", "a2a", "ai-crawlers", "seo", "web"], {
      url: { type: "string", description: "The site: a domain or any URL on it (its origin is checked)", required: true, example: "https://stripe.com" },
    },
    { origin: "https://example.com", score: 45, grade: "C", checks: [{ id: "llms_txt", label: "llms.txt", found: true, url: "https://example.com/llms.txt", weight: 20 }, { id: "mcp", label: "MCP server card", found: false, weight: 20 }], aiCrawlers: { robotsTxt: true, allowed: ["GPTBot", "ClaudeBot"], blocked: ["CCBot"] }, fixes: ["Run an MCP server and describe it at /.well-known/mcp/server-card.json."] },
    async (_env, q) => {
      const raw = need(q, "url", 2_000).trim();
      let origin: string;
      try { origin = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`).origin; } catch { throw new HttpError(400, "url must be a domain or an http(s) URL"); }
      const [home, robots, ...found] = await Promise.all([grab(origin, "/"), grab(origin, "/robots.txt"), ...CHECKS.map(async (c) => {
        // All of a check's paths at once (one after another took 18 s on github.com), first valid one in listed order.
        const rs = await Promise.all(c.paths.map((p) => grab(origin, p)));
        return rs.find((r) => r && c.valid(r.text, r.type))?.url ?? null;
      })]);
      // A sitemap anywhere counts when robots.txt names it (11 Nov 2026: stripe.com names /sitemap/sitemap.xml there and was
      // told to publish a sitemap). One more read, only when the usual paths had none.
      const sitemapAt = CHECKS.findIndex((c) => c.id === "sitemap");
      if (sitemapAt >= 0 && !found[sitemapAt] && robots) {
        const named = /^\s*sitemap:\s*(https?:\/\/\S+)/im.exec(robots.text)?.[1];
        const page = named ? await grab(origin, named) : null;
        if (page && CHECKS[sitemapAt].valid(page.text, page.type)) found[sitemapAt] = page.url;
      }
      // Crawlers count as reachable if robots.txt is missing or lets them read the home page.
      const verdicts = AI_CRAWLERS.map((a) => ({ a, ok: robots ? robotsVerdict(robots.text, a, "/").allowed : true }));
      const crawlerShare = verdicts.filter((v) => v.ok).length / AI_CRAWLERS.length;
      const checks = CHECKS.map((c, i) => ({ id: c.id, label: c.label, found: !!found[i], ...(found[i] ? { url: found[i] } : {}), weight: c.weight }));
      const score = Math.round(checks.reduce((s, c) => s + (c.found ? c.weight : 0), 0) + 10 * crawlerShare);
      const fixes = CHECKS.filter((_, i) => !found[i]).map((c) => c.fix);
      if (crawlerShare < 1) fixes.push(`robots.txt blocks ${verdicts.filter((v) => !v.ok).map((v) => v.a).join(", ")}: allow the AI crawlers you want to be found by.`);
      // A site with nothing for agents scores F; only a site that does not answer at all is refused.
      if (!home && !robots && checks.every((c) => !c.found)) throw new HttpError(422, "the site did not answer; check the domain (nothing was charged)");
      return {
        origin, score, grade: score >= 80 ? "A" : score >= 60 ? "B" : score >= 40 ? "C" : score >= 20 ? "D" : "F", checks,
        aiCrawlers: { robotsTxt: !!robots, allowed: verdicts.filter((v) => v.ok).map((v) => v.a), blocked: verdicts.filter((v) => !v.ok).map((v) => v.a) },
        fixes,
      };
    }),
];
