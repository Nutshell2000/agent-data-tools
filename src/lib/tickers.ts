// Token tickers agents ask for ("USDC", "ETH", "BTC") and the contract each names on a network. Shared by the price
// tools and the chain token reads.
import { getAddress, type Address } from "viem";
import { HttpError } from "./env";

/**
 * Tickers agents ask for, per network; each address was checked against the contract's symbol() on 2026-10-20
 * (Arbitrum's and Polygon's USDT now report "USD₮0"/"USDT0", the same contracts). ETH and BTC name the wrapped tokens the pools trade.
 */
export const TICKERS: Record<string, Record<string, Address>> = {
  base: { WETH: "0x4200000000000000000000000000000000000006", USDC: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", CBBTC: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf", AERO: "0x940181a94A35A4569E4529A3CDfB74e38FD98631", DAI: "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb", CBETH: "0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22", EURC: "0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42", USDBC: "0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA", USOL: "0x9B8Df6E244526ab5F6e6400d331DB28C8fdDdb55", CBXRP: "0xcb585250f852C6c6bf90434AB21A00f02833a4af",
    // Base's most-asked tokens, each checked against symbol() on 2026-10-26 (a DEGEN price request was refused in the probe).
    DEGEN: "0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed", BRETT: "0x532f27101965dd16442E59d40670FaF5eBB142E4", TOSHI: "0xAC1Bd2486aAf3B5C0fc3Fd868558b082a531B2B4", VIRTUAL: "0x0b3e328455c4059EEb9e3f84b5543F74E24e7E1b", ZORA: "0x1111111111166b7FE7bd91427724B487980aFc69", MORPHO: "0xBAa5CC21fd487B8Fcc2F632f3F4E8D37262a0842", WELL: "0xA88594D404727625A9437C3f886C7643872296AE", USDT: "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2", WSTETH: "0xc1CBa3fCea344f92D9239c08C0568f6F2F0ee452", KAITO: "0x98d0baa52b2D063E780DE12F615f963Fe8537553" },
  eth: { WETH: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", USDC: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", USDT: "0xdAC17F958D2ee523a2206206994597C13D831ec7", DAI: "0x6B175474E89094C44Da98b954EedeAC495271d0F", WBTC: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599", CBBTC: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf", LINK: "0x514910771AF9Ca656af840dff83E8264EcF986CA", UNI: "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984", AAVE: "0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9", BNB: "0xB8c77482e45F1F44dE1745F52C74426C631bDD52", POL: "0x455e53CBB86018Ac2B8092FdCd39d8444aFFC3F6" },
  arb: { WETH: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1", USDC: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", USDT: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9", ARB: "0x912CE59144191C1204E64559FE8253a0e49E6548", WBTC: "0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f", LINK: "0xf97f4df75117a78c1A5a0DBb814Af92458539FB4", DAI: "0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1", GMX: "0xfc5A1A6EB076a2C7aD06eD22C90d7E710E35ad0a" },
  polygon: { WETH: "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619", USDC: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", USDT: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F", WBTC: "0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6", DAI: "0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063", WPOL: "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270", LINK: "0x53E0bca35eC356BD5ddDFebbD1Fc0fD03FaBad39", AAVE: "0xD6DF932A45C0f255f85145f286eA0b292B21C90B" },
  op: { WETH: "0x4200000000000000000000000000000000000006", USDC: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85", USDT: "0x94b008aA00579c1307B0EF2c499aD98a8ce58e58", OP: "0x4200000000000000000000000000000000000042", DAI: "0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1", WBTC: "0x68f180fcCe6836688e9084f035309E29Bf0A2095", LINK: "0x350a791Bfc2C21F9Ed5d10980Dad2e2638ffa7f6" },
};
const ALIASES: Record<string, Record<string, string>> = {
  base: { ETH: "WETH", BTC: "CBBTC", SOL: "USOL", XRP: "CBXRP" },
  eth: { ETH: "WETH", BTC: "WBTC", MATIC: "POL" },
  arb: { ETH: "WETH", BTC: "WBTC" },
  op: { ETH: "WETH", BTC: "WBTC" },
  polygon: { ETH: "WETH", BTC: "WBTC", POL: "WPOL", MATIC: "WPOL" },
};

/** A 0x address as given, or the address of a known ticker on this network; 400 lists the tickers otherwise. */
export function tokenAddress(input: string, slug: string): Address {
  // "$ETH" is how tickers are written in chat; the dollar sign is not part of the ticker.
  const v = input.trim().replace(/^\$(?=[A-Za-z])/, "");
  if (/^0x[0-9a-fA-F]{40}$/.test(v)) return getAddress(v);
  const key = v.toUpperCase();
  const hit = TICKERS[slug]?.[ALIASES[slug]?.[key] ?? key];
  if (hit) return getAddress(hit);
  const known = [...Object.keys(ALIASES[slug] ?? {}), ...Object.keys(TICKERS[slug] ?? {})].join(", ");
  throw new HttpError(400, `"${v.slice(0, 20)}" is not a 0x token address or a ticker known on this network (${known}); pass the token's 0x address`);
}
