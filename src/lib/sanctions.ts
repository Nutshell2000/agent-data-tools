import { HttpError } from "./env";

// Digital currency addresses on the OFAC SDN list, one file per asset, regenerated daily
// from the official list by https://github.com/0xB10C/ofac-sanctioned-digital-currency-addresses.
const LISTS = "https://raw.githubusercontent.com/0xB10C/ofac-sanctioned-digital-currency-addresses/lists/sanctioned_addresses_";
const ASSETS = ["ETH", "USDT", "USDC", "ARB", "BSC", "ETC", "XBT", "LTC", "BCH", "BSV", "BTG", "DASH", "ZEC", "XVG", "TRX", "SOL", "XMR", "XRP"];
const REFRESH_MS = 3 * 60 * 60 * 1000;

export const SANCTIONS_SOURCE =
  "OFAC SDN list, digital currency address entries (exact address matches only), via github.com/0xB10C/ofac-sanctioned-digital-currency-addresses, refreshed daily";

/**
 * EVM, bech32 and Bitcoin Cash addresses are case-insensitive, so they are compared in lower case.
 * Base58 addresses (legacy Bitcoin, Tron, Solana) are case-sensitive and kept as written.
 */
export const normalizeAddress = (raw: string) => {
  const a = raw.replace(/^bitcoincash:/i, "");
  return /^0x[0-9a-f]{40}$/i.test(a) || /^(bc|tb|bcrt|ltc)1[02-9ac-hj-np-z]{6,}$/i.test(a) || /^[qp][02-9ac-hj-np-z]{41}$/i.test(a) ? a.toLowerCase() : a;
};

let loaded: { at: number; index: Map<string, string[]>; size: number } | undefined;
let loading: Promise<NonNullable<typeof loaded>> | undefined;

async function fetchList(asset: string): Promise<string[]> {
  const res = await fetch(`${LISTS}${asset}.txt`, {
    signal: AbortSignal.timeout(8_000),
    headers: { "user-agent": "AgentDataTools/1.0" },
    cf: { cacheTtl: 3600, cacheEverything: true },
  });
  if (!res.ok) throw new Error(`${asset}: HTTP ${res.status}`);
  return (await res.text())
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

async function load() {
  const lists = await Promise.all(ASSETS.map(fetchList)).catch((e) => {
    console.error(`sanctions list: ${e instanceof Error ? e.message : e}`);
    throw new HttpError(502, "the OFAC sanctions list could not be loaded; you were not charged, try again shortly");
  });
  const index = new Map<string, string[]>();
  lists.forEach((addresses, i) => {
    for (const a of addresses) {
      const key = normalizeAddress(a);
      const assets = index.get(key) ?? [];
      if (!assets.includes(ASSETS[i])) assets.push(ASSETS[i]);
      index.set(key, assets);
    }
  });
  if (index.size < 500) throw new HttpError(502, "the OFAC sanctions list looked incomplete; you were not charged, try again shortly");
  return { at: Date.now(), index, size: index.size };
}

/** The address index, kept per isolate and refreshed every few hours. */
export async function sanctionsIndex() {
  if (loaded && Date.now() - loaded.at < REFRESH_MS) return loaded;
  loading ??= load().finally(() => (loading = undefined));
  try {
    loaded = await loading;
  } catch (e) {
    // A stale list is better than none if the refresh fails.
    if (!loaded) throw e;
  }
  return loaded;
}

/** OFAC asset codes for each match, or an empty list when the address is not listed. */
export async function sanctionedAssets(address: string): Promise<string[]> {
  return (await sanctionsIndex()).index.get(normalizeAddress(address.trim())) ?? [];
}
