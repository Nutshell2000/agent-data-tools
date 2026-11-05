/**
 * Trending crypto coins (5 Nov 2026). Repeat demand on the Bazaar: kadec0's trending-coins listing had 7 payers and 1,266
 * calls at 2 cents. Source: CoinGecko's keyless trending endpoint; its free terms limit commercial reuse, and the owner
 * lifted our licence rule on 5 Nov 2026 and accepts the risk (if CoinGecko blocks Cloudflare, pause the tool in
 * PAUSED_FAMILY_TOOLS).
 */
import { entry, getJson, type Entry } from "../family";
import { HttpError } from "../lib/env";
// ---------- CoinGecko trending ----------
const money = (v: unknown) => { const n = Number(String(v ?? "").replace(/[^0-9.\-]/g, "")); return Number.isFinite(n) && String(v ?? "") !== "" ? n : null; };
export async function cryptoTrending() {
  const r = await getJson<{ coins?: { item?: any }[]; categories?: any[] }>("https://api.coingecko.com/api/v3/search/trending");
  const coins = (r.coins ?? []).map(({ item: c }) => ({
    rank: (c?.score ?? 0) + 1, id: c?.id ?? null, name: c?.name ?? null, symbol: c?.symbol ?? null, marketCapRank: c?.market_cap_rank ?? null,
    priceUsd: typeof c?.data?.price === "number" ? c.data.price : money(c?.data?.price), change24hPct: c?.data?.price_change_percentage_24h?.usd ?? null,
    marketCapUsd: money(c?.data?.market_cap), volume24hUsd: money(c?.data?.total_volume),
  }));
  if (!coins.length) throw new HttpError(502, "the trending list came back empty; try again");
  const categories = (r.categories ?? []).slice(0, 6).map((c) => ({ name: c?.name ?? null, slug: c?.slug ?? null, marketCapChange1hPct: c?.market_cap_1h_change ?? null, marketCapUsd: c?.data?.market_cap ?? null }));
  return { count: coins.length, coins, categories, source: "CoinGecko trending searches (most searched coins in the last 24 hours)", checkedAt: new Date().toISOString() };
}

export const CRYPTO_TRENDING: Entry[] = [
  entry("/crypto/trending", "Trending crypto coins",
    "Trending crypto coins right now: the coins most searched on CoinGecko in the last 24 hours, in order, with price, 24-hour change, market cap, volume and market-cap rank, plus the trending categories. Use to spot what the market is watching, feed a crypto news or trading agent, or pick coins to research next.",
    ["trending-coins", "crypto-trending", "coingecko", "crypto", "market-sentiment"],
    {},
    { count: 1, coins: [{ rank: 1, id: "bitcoin", name: "Bitcoin", symbol: "BTC", marketCapRank: 1, priceUsd: 76078.15, change24hPct: -5.1, marketCapUsd: 1529157316276, volume24hUsd: 61000000000 }], categories: [{ name: "Privacy Blockchain", slug: "privacy-blockchain", marketCapChange1hPct: 1.48, marketCapUsd: 7254828327.54 }], source: "CoinGecko trending searches (most searched coins in the last 24 hours)", checkedAt: "2026-11-05T20:00:00.000Z" },
    () => cryptoTrending()),
];
