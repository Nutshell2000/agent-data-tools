/**
 * Find paid x402 APIs for a task (6 Nov 2026). Demand: an "x402 service finder" was paid by 6 of the 47 open shoppers in a
 * two-day sample of Base transfers; agents that buy from many sellers pay to pick one. Source: the Coinbase Bazaar's public
 * discovery search (hybrid text and semantic), which carries each listing's 30-day payers and calls. Listings are shown as
 * the Bazaar returns them, ours included and marked, never boosted; sorting by use or price is the caller's choice.
 * Bazaar search on 6 Nov 2026: "x402 service finder" 8 results, 18 payers summed (leader 7 payers at $0.002).
 */
import { entry, flag, getJson, need, num, opt, type Entry } from "../family";
import { HttpError, type Env } from "../lib/env";

const SEARCH = "https://api.cdp.coinbase.com/platform/v2/x402/discovery/search";
const USDC_DECIMALS = 6;
const NETWORKS: Record<string, string> = { "eip155:8453": "base", "eip155:84532": "base-sepolia", "eip155:137": "polygon", "eip155:42161": "arbitrum", "eip155:10": "optimism", "eip155:1": "ethereum", "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp": "solana" };

interface BazaarItem {
  resource?: string; serviceName?: string; description?: string; type?: string; lastUpdated?: string; tags?: string[];
  accepts?: { amount?: string; maxAmountRequired?: string; network?: string; payTo?: string; asset?: string; extra?: { name?: string } }[];
  quality?: { l30DaysTotalCalls?: number; l30DaysUniquePayers?: number; lastCalledAt?: string };
  extensions?: { bazaar?: { info?: { input?: { method?: string } } } };
}

export function listing(it: BazaarItem, ourPayTo: string) {
  const offers = (it.accepts ?? []).map((a) => ({
    network: NETWORKS[a.network ?? ""] ?? a.network ?? null,
    priceUsd: a.amount ?? a.maxAmountRequired ? Number(a.amount ?? a.maxAmountRequired) / 10 ** USDC_DECIMALS : null,
    asset: a.extra?.name ?? null,
  }));
  const cheapest = offers.map((o) => o.priceUsd).filter((p): p is number => p !== null).sort((a, b) => a - b)[0] ?? null;
  return {
    name: it.serviceName ?? null,
    url: it.resource ?? null,
    method: it.extensions?.bazaar?.info?.input?.method ?? null,
    description: (it.description ?? "").slice(0, 300),
    priceUsd: cheapest,
    networks: [...new Set(offers.map((o) => o.network).filter(Boolean))],
    payers30d: it.quality?.l30DaysUniquePayers ?? null,
    calls30d: it.quality?.l30DaysTotalCalls ?? null,
    lastCalledAt: it.quality?.lastCalledAt ?? null,
    tags: (it.tags ?? []).slice(0, 5),
    ours: (it.accepts ?? []).some((a) => a.payTo?.toLowerCase() === ourPayTo.toLowerCase()),
  };
}

export const X402_FIND: Entry[] = [
  entry("/x402/find", "x402 service finder, find paid APIs",
    "Find pay-per-call x402 APIs for a task across the whole Coinbase Bazaar: up to 20 listings with name, URL, method, price in USD, networks, 30-day payers and calls, and when each was last paid for, in the Bazaar's relevance order or sorted by use or price, with a price cap and an active-only filter. Our own listings are marked, never boosted. Use when an agent needs a paid tool it does not have yet.",
    ["x402-service-finder", "find-api", "api-discovery", "x402", "bazaar-search", "agent-tools"], {
      q: { type: "string", description: "The task or tool to find, in words", required: true, example: "email verification" },
      limit: { type: "integer", description: "Number of listings (1-20, default 10)", example: 5 },
      sort: { type: "string", description: "relevance (default), payers, calls or price", example: "payers" },
      maxPrice: { type: "number", description: "Only listings at or under this price in USD", example: 0.05 },
      network: { type: "string", description: "Only listings that accept this network: base, polygon, arbitrum, solana…", example: "base" },
      active: { type: "string", description: "true: only listings paid for in the last 30 days", example: "true" },
    },
    {
      query: "email verification", count: 1, sort: "payers",
      results: [{ name: "Email verification, validation", url: "https://agent-data-tools.revmesh2074.workers.dev/email", method: "GET", description: "Check whether an email address can receive mail…", priceUsd: 0.01, networks: ["base", "polygon", "arbitrum", "solana"], payers30d: 2, calls30d: 7, lastCalledAt: "2026-10-25T12:07:20.614Z", tags: ["email-validation"], ours: true }],
      source: "Coinbase Bazaar discovery search",
    },
    async (env: Env, q) => {
      const query = need(q, "q", 200);
      const limit = num(q, "limit", { min: 1, max: 20, fallback: 10, integer: true });
      const sort = (opt(q, "sort", 20) ?? "relevance").toLowerCase();
      if (!["relevance", "payers", "calls", "price"].includes(sort)) throw new HttpError(400, "sort must be relevance, payers, calls or price");
      const maxPrice = q("maxPrice") === undefined || q("maxPrice") === "" ? undefined : num(q, "maxPrice", { min: 0, max: 1000 });
      const network = opt(q, "network", 40)?.toLowerCase();
      const activeOnly = flag(q, "active");
      // 20 is the search API's maximum page (25 and up answer 400, checked 6 Nov 2026).
      const data = await getJson<{ resources?: BazaarItem[]; items?: BazaarItem[] }>(`${SEARCH}?${new URLSearchParams({ query, limit: "20" })}`, { timeoutMs: 10_000 });
      let rows = (data.resources ?? data.items ?? []).map((it) => listing(it, env.PAY_TO ?? ""));
      if (maxPrice !== undefined) rows = rows.filter((r) => r.priceUsd !== null && r.priceUsd <= maxPrice);
      if (network) rows = rows.filter((r) => r.networks.some((n) => n === network || (network === "ethereum" && n === "ethereum")));
      if (activeOnly) rows = rows.filter((r) => (r.calls30d ?? 0) > 0);
      if (sort === "payers") rows.sort((a, b) => (b.payers30d ?? 0) - (a.payers30d ?? 0));
      if (sort === "calls") rows.sort((a, b) => (b.calls30d ?? 0) - (a.calls30d ?? 0));
      if (sort === "price") rows.sort((a, b) => (a.priceUsd ?? Infinity) - (b.priceUsd ?? Infinity));
      rows = rows.slice(0, limit);
      if (!rows.length) throw new HttpError(404, `no x402 listings match "${query}" with these filters; nothing was charged`);
      return { query, count: rows.length, sort, results: rows, source: "Coinbase Bazaar discovery search" };
    // $0.002, the floor: the finders open shoppers pay sell at $0.002-0.005 (6 Nov 2026, kagurazaka 7 payers at $0.002).
    }, "$0.002"),
];
