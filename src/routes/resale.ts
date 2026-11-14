/**
 * LinkedIn and X data, resold from another x402 seller (14 Nov 2026, the owner: "Resell via provider"). See src/lib/resale.ts
 * for the payment guards and the data-protection terms. Why these three: Mercator's gateway spent about $92 in the week to
 * 14 Nov on LinkedIn person and company data and about $12 on X search, the largest jobs in its spend we did not sell.
 *
 * Paused (PAUSED_FAMILY_TOOLS in src/endpoints.ts) until the owner funds the resale hot wallet and RESALE_WALLET_KEY is set:
 * a listed tool that always answers 503 would lose its first payment and its trust grade.
 *
 * Price: the upstream's $0.007 plus our margin and the facilitator's $0.001: $0.012. Mercator buys the upstream directly at
 * $0.007, so these tools are for our own channels (keys, cards, n8n, MCP), not for winning the same marketplace listing.
 */
import { entry, need, num, opt, pick, type Entry } from "../family";
import { HttpError } from "../lib/env";
import type { Env } from "../lib/env";
import { buyUpstream, RESALE_TERMS, RESALE_UPSTREAMS } from "../lib/resale";

const PRICE = "$0.012";
const linkedinUrl = (raw: string, kind: "in" | "company") => {
  const s = raw.trim();
  if (s.length > 500) throw new HttpError(400, "url must be at most 500 characters");
  if (/^https?:\/\//i.test(s)) {
    let u: URL;
    try { u = new URL(s); } catch { throw new HttpError(400, "url is not a valid URL"); }
    if (!/(^|\.)linkedin\.com$/i.test(u.hostname)) throw new HttpError(400, "url must be a linkedin.com address");
    return s;
  }
  if (kind === "company") return `https://www.linkedin.com/company/${encodeURIComponent(s.replace(/^\/+|\/+$/g, ""))}`;
  if (!/^[A-Za-z0-9_\-%.]{2,100}$/.test(s)) throw new HttpError(400, "url must be a LinkedIn profile URL or its public slug, e.g. https://www.linkedin.com/in/reidhoffman or reidhoffman");
  return s;
};

export const RESALE: Entry[] = [
  entry("/linkedin/profile", "LinkedIn profile lookup: experience, education, skills",
    "Look up a public LinkedIn profile by URL or slug: name, headline, about, location, follower count, open-to-work status, and the experience, education, skills, certifications and languages sections. Use to research a business contact or a candidate you have a lawful reason to look up. Third-party data (API Direct); the caller needs a lawful basis under GDPR.",
    ["linkedin-profile", "linkedin", "people-data", "lead-enrichment", "recruiting", "b2b"], {
      url: { type: "string", description: "LinkedIn profile URL or public slug (https://www.linkedin.com/in/reidhoffman or reidhoffman)", required: true, example: "reidhoffman" },
    },
    { url: "reidhoffman", provider: "API Direct (apidirect.io)", profile: { name: "Reid Hoffman" }, terms: RESALE_TERMS },
    async (env, q) => {
      const url = linkedinUrl(need(q, "url", 500), "in");
      const profile = await buyUpstream(env as Env, RESALE_UPSTREAMS.linkedinPerson, { url });
      return { url, provider: RESALE_UPSTREAMS.linkedinPerson.provider, profile, terms: RESALE_TERMS };
    }, PRICE),

  entry("/linkedin/company-posts", "LinkedIn company posts: a company page's latest posts",
    "The latest posts of a LinkedIn company page, 10 per page (up to 50 pages): text, date, reactions, comments and reposts, optionally with an emotion score per post. Use to follow a competitor's or customer's announcements, hiring news and engagement. Third-party data (API Direct).",
    ["linkedin-company", "linkedin", "company-posts", "social-media", "competitor-monitoring", "b2b"], {
      url: { type: "string", description: "LinkedIn company page URL or its slug (https://www.linkedin.com/company/microsoft or microsoft)", required: true, example: "https://www.linkedin.com/company/microsoft" },
      page: { type: "integer", description: "Page number, 1-50 (10 posts a page; default 1)", example: 1 },
      sentiment: { type: "string", description: "true to add an emotion and polarity score to each post", enum: ["true", "false"], example: "false" },
    },
    { url: "https://www.linkedin.com/company/microsoft", page: 1, provider: "API Direct (apidirect.io)", posts: { posts: [{ text: "…", reactions: 1200 }] }, terms: RESALE_TERMS },
    async (env, q) => {
      const url = linkedinUrl(need(q, "url", 500), "company");
      const page = num(q, "page", { min: 1, max: 50, fallback: 1, integer: true });
      const sentiment = pick(q, "sentiment", ["true", "false"] as const, "false");
      const posts = await buyUpstream(env as Env, RESALE_UPSTREAMS.linkedinCompanyPosts, { url, page, get_sentiment: sentiment });
      return { url, page, provider: RESALE_UPSTREAMS.linkedinCompanyPosts.provider, posts, terms: RESALE_TERMS };
    }, PRICE),

  entry("/x/search", "X (Twitter) search: posts by keyword",
    "Search X (Twitter) posts by keyword with X's search operators (from:, to:, exact phrases, -exclude, lang:), newest first or by relevance, optionally limited to the past hour, day, week, month or year. Returns the posts with author and engagement counts. Use to monitor a brand, a topic or a launch. Third-party data (API Direct).",
    ["twitter-search", "x-search", "tweets", "social-media", "brand-monitoring", "sentiment"], {
      query: { type: "string", description: "Search query, up to 500 characters; X search operators work", required: true, example: "x402 payments" },
      sort: { type: "string", description: "most_recent (default) or relevance", enum: ["most_recent", "relevance"], example: "most_recent" },
      since: { type: "string", description: "Only posts from the past 1h, 24h, 7d, 30d or 12m", enum: ["1h", "24h", "7d", "30d", "12m"], example: "7d" },
    },
    { query: "x402 payments", provider: "API Direct (apidirect.io)", results: { posts: [{ text: "…", author: "…", likes: 12 }] }, terms: RESALE_TERMS },
    async (env, q) => {
      const query = need(q, "query", 500);
      const sort = pick(q, "sort", ["most_recent", "relevance"] as const, "most_recent");
      const since = opt(q, "since", 4);
      if (since && !["1h", "24h", "7d", "30d", "12m"].includes(since)) throw new HttpError(400, "since must be 1h, 24h, 7d, 30d or 12m");
      const results = await buyUpstream(env as Env, RESALE_UPSTREAMS.xPosts, { query, sort_by: sort, posted_ago: since, pages: 1 });
      return { query, provider: RESALE_UPSTREAMS.xPosts.provider, results, terms: RESALE_TERMS };
    }, PRICE),
];
