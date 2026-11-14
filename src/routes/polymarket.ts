/**
 * Polymarket prediction-market data (5 Nov 2026). Demand: BlockRun's Polymarket listings had 74 (markets), 36 and 29
 * (events), 29 (leaderboard) and 25 (trades) payers at $0.009 on the Bazaar; we sold nothing on prediction markets.
 * Sources: Gamma (gamma-api.polymarket.com: markets, events, search) and the CLOB read API (clob.polymarket.com: order
 * books, price history), both public and keyless. The trades, holders and leaderboard Data API answered 410 Gone on
 * 5 Nov, so those are not offered.
 * Licence: Polymarket's terms bar market-data redistributors without a written agreement. The owner lifted our
 * commercial-licence rule on 5 Nov 2026 and accepts that risk (worst case: Cloudflare egress blocked or a takedown
 * request; then pause these in PAUSED_FAMILY_TOOLS). Read-only: nothing here trades or places orders.
 */
import { entry, getJson, num, opt, flag, type Entry, type Input } from "../family";
import { HttpError } from "../lib/env";

const GAMMA = "https://gamma-api.polymarket.com";
const CLOB = "https://clob.polymarket.com";
const NOTE = "Polymarket public data at call time; prices are the market's implied probability (0-1). Not financial advice.";
const EX_SLUG = "will-jd-vance-win-the-2028-republican-presidential-nomination"; // open until Nov 2028

interface GammaMarket {
  question?: string; slug?: string; conditionId?: string; outcomes?: string; outcomePrices?: string; clobTokenIds?: string;
  volume24hr?: number | string; volume?: number | string; liquidity?: number | string; bestBid?: number; bestAsk?: number;
  lastTradePrice?: number; oneDayPriceChange?: number; endDate?: string; active?: boolean; closed?: boolean;
  groupItemTitle?: string; events?: { slug?: string }[];
}
interface GammaEvent {
  title?: string; slug?: string; endDate?: string; volume24hr?: number | string; volume?: number | string;
  liquidity?: number | string; active?: boolean; closed?: boolean; markets?: GammaMarket[]; tags?: { label?: string }[];
}

const n = (v: unknown) => { const x = Number(v); return Number.isFinite(x) ? x : null; };
const round = (v: number | null, d = 2) => (v === null ? null : Math.round(v * 10 ** d) / 10 ** d);
const list = (s: string | undefined): string[] => { try { const v = JSON.parse(s ?? "[]"); return Array.isArray(v) ? v.map(String) : []; } catch { return []; } };

export function shapeMarket(m: GammaMarket, eventSlug?: string) {
  const names = list(m.outcomes), prices = list(m.outcomePrices), tokens = list(m.clobTokenIds);
  const ev = eventSlug ?? m.events?.[0]?.slug;
  return {
    question: m.question ?? null,
    slug: m.slug ?? null,
    conditionId: m.conditionId ?? null,
    outcomes: names.map((name, i) => ({ name, price: n(prices[i]), tokenId: tokens[i] ?? null })),
    volume24h: round(n(m.volume24hr)), volume: round(n(m.volume)), liquidity: round(n(m.liquidity)),
    bestBid: n(m.bestBid), bestAsk: n(m.bestAsk), lastTradePrice: n(m.lastTradePrice), dayChange: n(m.oneDayPriceChange),
    endDate: m.endDate ?? null, active: m.active ?? null, closed: m.closed ?? null,
    url: ev ? `https://polymarket.com/event/${ev}` : null,
  };
}

const enc = encodeURIComponent;
const queryOf = (q: Input) => opt(q, "q", 200) ?? opt(q, "query", 200);

/** Top markets by 24-hour volume, or the markets matching a search, open ones by default. */
export async function polymarketMarkets(q: Input) {
  const limit = num(q, "limit", { min: 1, max: 20, fallback: 10, integer: true });
  const closed = flag(q, "closed");
  const search = queryOf(q);
  let markets: ReturnType<typeof shapeMarket>[];
  if (search) {
    const r = await getJson<{ events?: GammaEvent[] }>(`${GAMMA}/public-search?q=${enc(search)}&limit_per_type=10&events_status=${closed ? "closed" : "active"}`);
    markets = (r.events ?? []).flatMap((e) => (e.markets ?? []).filter((m) => Boolean(m.closed) === closed).map((m) => shapeMarket(m, e.slug)));
    markets.sort((a, b) => (b.volume24h ?? 0) - (a.volume24h ?? 0));
  } else {
    const r = await getJson<GammaMarket[]>(`${GAMMA}/markets?limit=${limit}&active=true&closed=${closed}&order=volume24hr&ascending=false`);
    markets = (Array.isArray(r) ? r : []).map((m) => shapeMarket(m));
  }
  if (search && !markets.length) throw new HttpError(404, `no ${closed ? "closed" : "open"} Polymarket market matches "${search}"`);
  return { query: search ?? null, closed, count: Math.min(limit, markets.length), markets: markets.slice(0, limit), note: NOTE, checkedAt: new Date().toISOString() };
}

/** Events (a question with one or more markets, e.g. an election) by 24-hour volume or by search. */
export async function polymarketEvents(q: Input) {
  const limit = num(q, "limit", { min: 1, max: 10, fallback: 5, integer: true });
  const search = queryOf(q);
  const events: GammaEvent[] = search
    ? ((await getJson<{ events?: GammaEvent[] }>(`${GAMMA}/public-search?q=${enc(search)}&limit_per_type=10&events_status=active`)).events ?? []).sort((x, y) => (n(y.volume24hr) ?? 0) - (n(x.volume24hr) ?? 0))
    : await getJson<GammaEvent[]>(`${GAMMA}/events?limit=${limit}&active=true&closed=false&order=volume24hr&ascending=false`);
  if (search && !events.length) throw new HttpError(404, `no open Polymarket event matches "${search}"`);
  return {
    query: search ?? null,
    count: Math.min(limit, events.length),
    events: events.slice(0, limit).map((e) => {
      const open = (e.markets ?? []).filter((m) => !m.closed).map((m) => ({ ...shapeMarket(m, e.slug), title: m.groupItemTitle || m.question || null }));
      const yes = (m: ReturnType<typeof shapeMarket>) => m.outcomes[0]?.price ?? 0;
      // Placeholder candidates sit at 0.5 with no trading; rank only markets that have traded and hold liquidity.
      const traded = open.filter((m) => (m.volume ?? 0) > 0 && (m.liquidity ?? 0) > 0);
      return {
        title: e.title ?? null, slug: e.slug ?? null, url: e.slug ? `https://polymarket.com/event/${e.slug}` : null, endDate: e.endDate ?? null,
        volume24h: round(n(e.volume24hr)), volume: round(n(e.volume)), liquidity: round(n(e.liquidity)),
        tags: (e.tags ?? []).map((t) => t.label).filter(Boolean).slice(0, 6),
        openMarkets: open.length,
        leading: (traded.length ? traded : open).sort((a, b) => yes(b) - yes(a)).slice(0, 5).map((m) => ({ title: m.title, slug: m.slug, yesPrice: m.outcomes[0]?.price ?? null, volume24h: m.volume24h })),
      };
    }),
    note: NOTE, checkedAt: new Date().toISOString(),
  };
}

/** One market by slug, with the CLOB token of the chosen outcome (default the first, usually "Yes"). */
async function resolveToken(q: Input) {
  const tokenIn = opt(q, "token_id", 100) ?? opt(q, "tokenId", 100);
  if (tokenIn) {
    if (!/^\d{10,90}$/.test(tokenIn)) throw new HttpError(400, "token_id must be a Polymarket CLOB token id (digits)");
    return { tokenId: tokenIn, market: null as ReturnType<typeof shapeMarket> | null, outcome: null as string | null };
  }
  const slug = opt(q, "slug", 300);
  if (!slug) throw new HttpError(400, "give slug (the market's Polymarket slug, from polymarket_markets) or token_id");
  const r = await getJson<GammaMarket[]>(`${GAMMA}/markets?slug=${enc(slug.replace(/^.*polymarket\.com\/(?:event|market)\//, "").split(/[/?#]/)[0])}`);
  const m = Array.isArray(r) ? r[0] : undefined;
  if (!m) throw new HttpError(404, `no Polymarket market with slug "${slug}"; event slugs hold several markets, use polymarket_events to list them`);
  const market = shapeMarket(m);
  const want = opt(q, "outcome", 100)?.toLowerCase();
  const pick = want ? market.outcomes.find((o) => o.name.toLowerCase() === want) : market.outcomes[0];
  if (!pick) throw new HttpError(400, `outcome must be one of: ${market.outcomes.map((o) => o.name).join(", ")}`);
  if (!pick.tokenId) throw new HttpError(404, "this market has no order book");
  return { tokenId: pick.tokenId, market, outcome: pick.name };
}

type Book = { bids?: { price: string; size: string }[]; asks?: { price: string; size: string }[]; timestamp?: string; market?: string };
/** How old a kept order book may be when the CLOB fails: the answer's `bookTime` and `fromEarlierRead` say it is not live. */
export const BOOK_KEEP_SECONDS = 120;

/**
 * The CLOB book with patience. 14 Nov 2026: 4 of 10 paid calls in a week ended "the data source answered HTTP 5xx"
 * while the same token answered from elsewhere a moment later. A failed read is tried once more after 400 ms; if that
 * fails too and this location read the same book in the last two minutes, that book is answered with
 * `fromEarlierRead: true`. A 404 (closed market) is never retried or replaced. `get`, `sleep` and `store` are for tests.
 */
export async function clobBook(tokenId: string, get: (url: string) => Promise<Book> = (url) => getJson<Book>(url, { notFound: "no order book for that token (the market may be closed)" }), sleep: (ms: number) => Promise<unknown> = (ms) => new Promise((r) => setTimeout(r, ms)), store: Cache | undefined = (globalThis as { caches?: { default?: Cache } }).caches?.default): Promise<Book & { fromEarlierRead?: boolean }> {
  const url = `${CLOB}/book?token_id=${tokenId}`;
  const key = `https://clob-book.cache.invalid/${tokenId}`;
  let last: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt) await sleep(400);
    try {
      const book = await get(url);
      await store?.put(key, new Response(JSON.stringify(book), { headers: { "content-type": "application/json", "cache-control": `public, max-age=${BOOK_KEEP_SECONDS}` } })).catch(() => {});
      return book;
    } catch (e) {
      const status = (e as { status?: unknown })?.status;
      if (typeof status === "number" && status !== 502) throw e;
      last = e;
    }
  }
  const kept = await store?.match(key).catch(() => undefined);
  const book = kept ? ((await kept.json().catch(() => null)) as Book | null) : null;
  if (book && (Array.isArray(book.bids) || Array.isArray(book.asks))) return { ...book, fromEarlierRead: true };
  throw last;
}

export async function polymarketOrderbook(q: Input) {
  const depth = num(q, "depth", { min: 1, max: 50, fallback: 10, integer: true });
  const { tokenId, market, outcome } = await resolveToken(q);
  const book = await clobBook(tokenId);
  const lv = (x: { price: string; size: string }) => ({ price: Number(x.price), size: Number(x.size) });
  const bids = (book.bids ?? []).map(lv).sort((a, b) => b.price - a.price);
  const asks = (book.asks ?? []).map(lv).sort((a, b) => a.price - b.price);
  const bestBid = bids[0]?.price ?? null, bestAsk = asks[0]?.price ?? null;
  // Depth near the price only: far orders at 0.001 or 0.999 hold huge sizes that say nothing about tradable liquidity.
  const mid0 = bestBid !== null && bestAsk !== null ? (bestBid + bestAsk) / 2 : null;
  const usd = (l: { price: number; size: number }[]) => round(l.filter((x) => mid0 === null || Math.abs(x.price - mid0) <= 0.05).reduce((s, x) => s + x.price * x.size, 0));
  return {
    question: market?.question ?? null, slug: market?.slug ?? null, outcome, tokenId, conditionId: book.market ?? market?.conditionId ?? null,
    bestBid, bestAsk, mid: bestBid !== null && bestAsk !== null ? round((bestBid + bestAsk) / 2, 4) : null,
    spread: bestBid !== null && bestAsk !== null ? round(bestAsk - bestBid, 4) : null,
    bidDepthUsd: usd(bids), askDepthUsd: usd(asks),
    bids: bids.slice(0, depth), asks: asks.slice(0, depth),
    bookTime: book.timestamp ? new Date(Number(book.timestamp)).toISOString() : null,
    ...(book.fromEarlierRead ? { fromEarlierRead: true } : {}),
    note: book.fromEarlierRead ? `${NOTE} The order book service did not answer just now, so this is the book read at bookTime (at most two minutes earlier).` : NOTE,
  };
}

const INTERVALS: Record<string, number> = { "1h": 1, "6h": 5, "1d": 60, "1w": 240, "1m": 720, max: 1440 };
export async function polymarketPriceHistory(q: Input) {
  const interval = (opt(q, "interval", 10) ?? "1w").toLowerCase();
  if (!Object.hasOwn(INTERVALS, interval)) throw new HttpError(400, `interval must be one of: ${Object.keys(INTERVALS).join(", ")}`);
  const { tokenId, market, outcome } = await resolveToken(q);
  const r = await getJson<{ history?: { t: number; p: number }[] }>(`${CLOB}/prices-history?market=${tokenId}&interval=${interval}&fidelity=${INTERVALS[interval]}`);
  const pts = (r.history ?? []).filter((x) => Number.isFinite(x.t) && Number.isFinite(x.p)).map((x) => ({ time: new Date(x.t * 1000).toISOString(), price: x.p }));
  if (!pts.length) throw new HttpError(404, "no price history for that market and interval");
  const ps = pts.map((x) => x.price);
  return {
    question: market?.question ?? null, slug: market?.slug ?? null, outcome, tokenId, interval, points: pts.length,
    first: ps[0], last: ps[ps.length - 1], change: round(ps[ps.length - 1] - ps[0], 4), high: Math.max(...ps), low: Math.min(...ps),
    history: pts.slice(-200), note: NOTE,
  };
}

const MARKET_INPUTS = {
  slug: { type: "string", description: "The market's Polymarket slug (from polymarket_markets) or its polymarket.com URL", example: EX_SLUG },
  outcome: { type: "string", description: "Outcome name, e.g. Yes or No (default the first outcome)", example: "Yes" },
  token_id: { type: "string", description: "Instead of slug: the CLOB token id of one outcome", example: "40081275558852222228080198821361202017557872256707631666334039001378518619916" },
} as const;

export const POLYMARKET: Entry[] = [
  entry("/polymarket/markets", "Polymarket markets, odds",
    "Polymarket prediction markets: the most traded open markets by 24-hour volume, or the markets matching a search, each with outcome prices (implied probability), best bid and ask, last trade, day change, volume, liquidity, end date, slug and CLOB token ids. Use to get the odds on an election, sports, crypto or news event, or to find a market before reading its order book.",
    ["polymarket", "prediction-markets", "odds", "betting-odds", "event-probability"],
    {
      q: { type: "string", description: "Optional search, e.g. bitcoin, election, fed rates; without it the top markets by 24h volume", example: "bitcoin" },
      limit: { type: "integer", description: "Markets to return, 1-20 (default 10)", example: 5 },
      closed: { type: "string", description: "true for resolved or closed markets instead of open ones", example: "false" },
    },
    { query: "bitcoin", closed: false, count: 1, markets: [{ question: "Will the price of Bitcoin be above $72,000 on November 5?", slug: "bitcoin-above-72k-on-november-5-2026", conditionId: "0x…", outcomes: [{ name: "Yes", price: 0.9955, tokenId: "7755…" }, { name: "No", price: 0.0045, tokenId: "8888…" }], volume24h: 98817.32, volume: 250000.5, liquidity: 40000, bestBid: 0.995, bestAsk: 0.996, lastTradePrice: 0.996, dayChange: 0.01, endDate: "2026-11-05T17:00:00Z", active: true, closed: false, url: "https://polymarket.com/event/bitcoin-above-on-november-5-2026" }], note: NOTE, checkedAt: "2026-11-05T16:40:00.000Z" },
    (_env, q) => polymarketMarkets(q)),
  entry("/polymarket/events", "Prediction markets, Polymarket events",
    "Polymarket events (one question with one or several markets, such as an election with many candidates): the busiest open events by 24-hour volume or those matching a search, with volume, liquidity, end date, tags, the number of open markets and the five leading outcomes by price. Use to see who leads a multi-candidate market or to browse what is being traded now.",
    ["polymarket-events", "prediction-markets", "polymarket", "election-odds", "odds"],
    {
      q: { type: "string", description: "Optional search, e.g. president 2028; without it the busiest events by 24h volume", example: "president" },
      limit: { type: "integer", description: "Events to return, 1-10 (default 5)", example: 3 },
    },
    { query: "president", count: 1, events: [{ title: "Republican Presidential Nominee 2028", slug: "republican-presidential-nominee-2028", url: "https://polymarket.com/event/republican-presidential-nominee-2028", endDate: "2028-11-08T04:59:00Z", volume24h: 2470204.52, volume: 727850358.28, liquidity: 32474302.97, tags: ["Politics"], openMarkets: 128, leading: [{ title: "J.D. Vance", slug: "will-jd-vance-win-the-2028-republican-presidential-nomination", yesPrice: 0.52, volume24h: 300000 }] }], note: NOTE, checkedAt: "2026-11-05T16:40:00.000Z" },
    (_env, q) => polymarketEvents(q)),
  entry("/polymarket/orderbook", "Polymarket order book",
    "Polymarket order book for one market outcome from the CLOB: bids and asks (price and size) up to 50 levels, best bid and ask, mid, spread and USD depth within 5 cents of the mid on each side. Give the market slug and outcome, or a CLOB token id. Use to check liquidity and slippage before a trade, or to read a sharper price than the last trade.",
    ["polymarket-orderbook", "order-book", "polymarket", "prediction-markets", "market-depth"],
    { ...MARKET_INPUTS, depth: { type: "integer", description: "Levels per side, 1-50 (default 10)", example: 10 } },
    { question: "Will JD Vance win the 2028 Republican presidential nomination?", slug: EX_SLUG, outcome: "Yes", tokenId: "7213…", conditionId: "0x19d2…", bestBid: 0.946, bestAsk: 0.95, mid: 0.948, spread: 0.004, bidDepthUsd: 120000.5, askDepthUsd: 9000.25, bids: [{ price: 0.946, size: 1200 }], asks: [{ price: 0.95, size: 800 }], bookTime: "2026-11-05T16:40:00.000Z", note: NOTE },
    (_env, q) => polymarketOrderbook(q)),
  entry("/polymarket/price-history", "Polymarket price history",
    "Polymarket price history of one market outcome from the CLOB: time and price points over the last hour, 6 hours, day, week, month or all time, with first, last, change, high and low. Give the market slug and outcome, or a CLOB token id. Use to chart how the odds moved, spot a swing after news, or backtest a signal.",
    ["polymarket-price-history", "odds-history", "polymarket", "prediction-markets", "historical-odds"],
    { ...MARKET_INPUTS, interval: { type: "string", description: "1h, 6h, 1d, 1w (default), 1m or max", enum: ["1h", "6h", "1d", "1w", "1m", "max"], example: "1d" } },
    { question: "Will JD Vance win the 2028 Republican presidential nomination?", slug: EX_SLUG, outcome: "Yes", tokenId: "7213…", interval: "1d", points: 24, first: 0.9625, last: 0.948, change: -0.0145, high: 0.9625, low: 0.919, history: [{ time: "2026-11-04T16:00:22.000Z", price: 0.9625 }], note: NOTE },
    (_env, q) => polymarketPriceHistory(q)),
];
