// Crypto prices by CoinGecko id for /crypto/price (7 Nov 2026). CoinGecko's keyless API answers Cloudflare Workers with
// HTTP 429 (checked from staging and in the 7 Nov egress replay), so every call of the listed example failed and the
// Bazaar could never list the tool. Coins with a Coinbase market are now priced from Coinbase's public, keyless APIs,
// which answer Workers (/btc-price uses them): the 24-hour change from the exchange's USD stats, other currencies from
// the spot price. CoinGecko is asked only for ids Coinbase does not trade, and its refusal leaves those under `missing`.
// The answer keeps CoinGecko's shape ({ id: { usd, usd_24h_change, usd_market_cap } }); Coinbase has no market cap (null).
import { getJson } from "../family";

/** CoinGecko id -> Coinbase ticker for the coins agents ask for most (all trade on Coinbase as <TICKER>-USD). */
export const COINBASE_TICKERS: Record<string, string> = {
  bitcoin: "BTC", ethereum: "ETH", solana: "SOL", "usd-coin": "USDC", tether: "USDT", ripple: "XRP", cardano: "ADA",
  dogecoin: "DOGE", "avalanche-2": "AVAX", chainlink: "LINK", polkadot: "DOT", litecoin: "LTC", "bitcoin-cash": "BCH",
  stellar: "XLM", uniswap: "UNI", "shiba-inu": "SHIB", near: "NEAR", aptos: "APT", sui: "SUI", arbitrum: "ARB",
  optimism: "OP", pepe: "PEPE", cosmos: "ATOM", dai: "DAI", "wrapped-bitcoin": "WBTC", "matic-network": "POL",
  "polygon-ecosystem-token": "POL", aave: "AAVE", "the-graph": "GRT", filecoin: "FIL", "internet-computer": "ICP",
  "ethereum-classic": "ETC", algorand: "ALGO", tezos: "XTZ", maker: "MKR", "render-token": "RENDER", injective: "INJ",
  bonk: "BONK", "dogwifcoin": "WIF", "worldcoin-wld": "WLD", ondo: "ONDO", "jupiter-exchange-solana": "JUP",
  "coinbase-wrapped-btc": "CBBTC", "first-digital-usd": "FDUSD", "hedera-hashgraph": "HBAR", "the-sandbox": "SAND",
  decentraland: "MANA", "curve-dao-token": "CRV", "lido-dao": "LDO", "compound-governance-token": "COMP",
};
/** Tickers and names agents send instead of CoinGecko ids. */
const ID_ALIASES: Record<string, string> = Object.fromEntries([
  ...Object.entries(COINBASE_TICKERS).map(([id, t]) => [t.toLowerCase(), id]),
  ["btc", "bitcoin"], ["eth", "ethereum"], ["usdc", "usd-coin"], ["usdt", "tether"], ["xrp", "ripple"], ["matic", "polygon-ecosystem-token"],
  ["polygon", "polygon-ecosystem-token"], ["avalanche", "avalanche-2"], ["avax", "avalanche-2"], ["bnb", "binancecoin"],
]);
export const canonicalId = (raw: string) => { const k = raw.trim().toLowerCase(); return Object.hasOwn(ID_ALIASES, k) ? ID_ALIASES[k] : k; };

type Quote = Record<string, number | null>;
export type Fetcher = <T>(url: string) => Promise<T>;
const defaultFetch: Fetcher = (url) => getJson(url, { timeoutMs: 5000 });

/** Prices one Coinbase-traded coin in every requested currency. Throws when Coinbase has no USD price for it. */
export async function coinbaseQuote(ticker: string, vs: string[], get: Fetcher = defaultFetch): Promise<Quote> {
  const stats = await get<{ open?: string; last?: string }>(`https://api.exchange.coinbase.com/products/${ticker}-USD/stats`).catch(() => null);
  const last = Number(stats?.last), open = Number(stats?.open);
  const change = Number.isFinite(last) && Number.isFinite(open) && open > 0 ? Math.round(((last - open) / open) * 10_000) / 100 : null;
  const out: Quote = {};
  await Promise.all(vs.map(async (cur) => {
    let price: number | null = cur === "usd" && Number.isFinite(last) && last > 0 ? last : null;
    if (price === null) {
      const spot = await get<{ data?: { amount?: string } }>(`https://api.coinbase.com/v2/prices/${ticker}-${cur.toUpperCase()}/spot`).catch(() => null);
      const a = Number(spot?.data?.amount);
      price = Number.isFinite(a) && a > 0 ? a : null;
    }
    out[cur] = price;
    out[`${cur}_24h_change`] = change; // Coinbase's 24-hour move is the same in every quote currency to within FX drift
    out[`${cur}_market_cap`] = null;
  }));
  if (vs.every((cur) => out[cur] === null)) throw new Error(`Coinbase has no price for ${ticker}`);
  return out;
}

/** The /crypto/price answer: Coinbase for the coins it trades, CoinGecko for the rest when it answers. */
export async function cryptoPrices(rawIds: string[], vs: string[], get: Fetcher = defaultFetch) {
  const ids = [...new Set(rawIds.map(canonicalId))];
  const prices: Record<string, Quote> = {};
  const sources = new Set<string>();
  const rest: string[] = [];
  await Promise.all(ids.map(async (id) => {
    const ticker = Object.hasOwn(COINBASE_TICKERS, id) ? COINBASE_TICKERS[id] : null;
    if (!ticker) { rest.push(id); return; }
    try { prices[id] = await coinbaseQuote(ticker, vs, get); sources.add("Coinbase"); } catch { rest.push(id); }
  }));
  if (rest.length) {
    const r = await get<Record<string, Quote>>(`https://api.coingecko.com/api/v3/simple/price?ids=${rest.join(",")}&vs_currencies=${vs.join(",")}&include_24hr_change=true&include_market_cap=true`).catch(() => null);
    if (r) for (const [id, q] of Object.entries(r)) { prices[id] = q; sources.add("CoinGecko"); }
  }
  return { prices, missing: ids.filter((i) => !(i in prices)), source: [...sources].join(" and ") || "none" };
}
