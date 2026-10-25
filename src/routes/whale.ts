// Large stablecoin transfers (25 Oct 2026). Bazaar search "whale alert" summed 53 payers over the top 20 (#1 has 26) and
// nothing of ours was in it. Read straight from each network's public nodes (eth_getLogs on the USDC/USDT contracts),
// so the data is our own: no explorer or labelling service. Mints and burns are marked; addresses are not labelled.
import { formatUnits } from "viem";
import { entry, num, opt, type Entry } from "../family";
import { HttpError, type Env } from "../lib/env";
import { tokenAddress } from "../lib/tickers";
import { CHAINS, logsClient, rpc } from "./chain-reads";

const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const ZERO_TOPIC = "0x" + "0".repeat(64);
// Seconds per block, blocks per eth_getLogs window (keeps each answer to a few thousand logs) and the most blocks one call
// scans. Base USDC carries ~270 transfers a block, so Base covers the fewest minutes.
const PACE: Record<string, { secs: number; window: number; max: number }> = {
  eth: { secs: 12, window: 10, max: 75 },
  base: { secs: 2, window: 10, max: 90 },
  arb: { secs: 0.25, window: 400, max: 2400 },
  op: { secs: 2, window: 50, max: 300 },
  polygon: { secs: 2, window: 30, max: 300 },
};
const CHAIN_NAMES: Record<string, string> = { ethereum: "eth", eth: "eth", mainnet: "eth", base: "base", arbitrum: "arb", arb: "arb", "arbitrum one": "arb", optimism: "op", op: "op", polygon: "polygon", matic: "polygon", pol: "polygon", "polygon pos": "polygon" };

export function chainSlug(raw: string | undefined): string {
  const key = (raw ?? "ethereum").trim().toLowerCase();
  const slug = Object.hasOwn(CHAIN_NAMES, key) ? CHAIN_NAMES[key] : null;
  if (!slug) throw new HttpError(400, "chain must be ethereum, base, arbitrum, optimism or polygon");
  return slug;
}

type RawLog = { blockNumber: string; transactionHash: string; logIndex: string; topics: string[]; data: string };
const addr = (topic: string) => "0x" + topic.slice(26);

/** Keeps transfers of at least `min` base units, largest first, as plain records. */
export function largeTransfers(logs: RawLog[], symbolOf: (address: string) => string, min: bigint, decimals = 6) {
  return logs
    .filter((l) => l.topics[0] === TRANSFER && l.topics.length === 3 && l.data && l.data !== "0x" && BigInt(l.data) >= min)
    .map((l) => {
      const raw = BigInt(l.data);
      const from = addr(l.topics[1]), to = addr(l.topics[2]);
      return {
        token: symbolOf((l as RawLog & { address?: string }).address ?? ""),
        amount: Number(formatUnits(raw, decimals)),
        from, to,
        kind: l.topics[1] === ZERO_TOPIC ? "mint" : l.topics[2] === ZERO_TOPIC ? "burn" : "transfer",
        txHash: l.transactionHash,
        block: Number(BigInt(l.blockNumber)),
      };
    })
    .sort((a, b) => b.amount - a.amount);
}

export async function whaleTransfers(env: Env, chainRaw?: string, tokenRaw?: string, minUsd = 100_000, minutes = 5) {
  const slug = chainSlug(chainRaw);
  const def = CHAINS.find((c) => c.slug === slug)!;
  const pace = PACE[slug];
  const want = (tokenRaw ?? "stablecoins").trim().toUpperCase();
  const symbols = want === "STABLECOINS" || want === "BOTH" || want === "ALL" ? ["USDC", "USDT"] : [want];
  if (symbols.some((s) => s !== "USDC" && s !== "USDT")) throw new HttpError(400, "token must be USDC, USDT or stablecoins (both)");
  const tokens: { symbol: string; address: string }[] = [];
  for (const s of symbols) { try { tokens.push({ symbol: s, address: tokenAddress(s, slug).toLowerCase() }); } catch { if (symbols.length === 1) throw new HttpError(400, `${s} is not tracked on ${def.name}`); } }
  const cl = logsClient(env, def);
  const latest = await rpc(() => cl.getBlockNumber());
  const span = BigInt(Math.min(pace.max, Math.max(1, Math.round((minutes * 60) / pace.secs))));
  const floor = latest - span + 1n;
  const min = BigInt(Math.round(minUsd)) * 1_000_000n;
  const bySymbol = new Map(tokens.map((t) => [t.address, t.symbol]));
  const found: ReturnType<typeof largeTransfers> = [];
  let scanned = 0, to = latest, lagRetries = 0;
  while (to >= floor) {
    const from = to - BigInt(pace.window) + 1n > floor ? to - BigInt(pace.window) + 1n : floor;
    let chunk: (RawLog & { address: string })[];
    try {
      chunk = await rpc(() => cl.request({ method: "eth_getLogs", params: [{ address: tokens.map((t) => t.address as `0x${string}`), topics: [TRANSFER], fromBlock: `0x${from.toString(16)}`, toBlock: `0x${to.toString(16)}` }] })) as (RawLog & { address: string })[];
    } catch (e) {
      // A log node a few blocks behind answers "header not found" (404 here) for the newest range: step back, as recentLogs does.
      if (e instanceof HttpError && e.status === 404 && lagRetries < 3 && to - 5n >= floor) { lagRetries++; to -= 5n; continue; }
      if (scanned > 0) break; // keep what was read; `complete` says the window was cut short
      throw e;
    }
    scanned += chunk.length;
    found.push(...largeTransfers(chunk, (a) => bySymbol.get(a.toLowerCase()) ?? "?", min));
    to = from - 1n;
  }
  found.sort((a, b) => b.amount - a.amount);
  const fromBlock = Number(to + 1n > floor ? to + 1n : floor);
  return {
    chain: def.name,
    tokens: tokens.map((t) => t.symbol),
    minUsd,
    fromBlock, toBlock: Number(latest),
    minutesCovered: Math.round(((Number(latest) - fromBlock + 1) * pace.secs) / 6) / 10,
    complete: to < floor,
    transfersScanned: scanned,
    count: found.length,
    totalUsd: Math.round(found.reduce((a, t) => a + t.amount, 0)),
    transfers: found.slice(0, 50),
    note: "Amounts are token units of USD stablecoins (1 unit is about 1 USD). Addresses are not labelled; mints and burns are marked.",
  };
}

export const WHALE: Entry[] = [
  entry("/whale/transfers", "Whale alert, large transfers: big USDC and USDT moves on 5 networks",
    "Large stablecoin transfers in the last minutes, read live from the network: every USDC and USDT transfer of at least min USD (default 100,000) on Ethereum, Base, Arbitrum, Optimism or Polygon, largest first, with sender, receiver, transaction and block, mints and burns marked. Covers up to 15 minutes on Ethereum and 3 on Base (busiest). Addresses are not labelled. Use to watch whale flows, treasury moves or stablecoin mints.",
    ["whale-alert", "whale-tracking", "large-transfers", "stablecoin-flows", "usdc"], {
      chain: { type: "string", description: "ethereum (default), base, arbitrum, optimism or polygon", example: "ethereum" },
      token: { type: "string", description: "USDC, USDT or stablecoins (both, default)", example: "stablecoins" },
      min: { type: "string", description: "Smallest transfer in USD, 10000 or more (default 100000)", example: "100000" },
      minutes: { type: "string", description: "How far back, 1 to 15 minutes (default 5; Base covers at most 3)", example: "5" },
    },
    { chain: "Ethereum", tokens: ["USDC", "USDT"], minUsd: 100000, fromBlock: 23650001, toBlock: 23650025, minutesCovered: 5, complete: true, transfersScanned: 2400, count: 3, totalUsd: 1850000, transfers: [{ token: "USDC", amount: 1000000, from: "0x28c6c06298d514db089934071355e5743bf21d60", to: "0x3cd751e6b0078be393132286c442345e5dc49699", kind: "transfer", txHash: "0x…", block: 23650020 }], note: "Amounts are token units of USD stablecoins (1 unit is about 1 USD). Addresses are not labelled; mints and burns are marked." },
    (env, q) => whaleTransfers(env, opt(q, "chain", 30), opt(q, "token", 20),
      num(q, "min", { min: 10_000, max: 1e12, fallback: 100_000 }), num(q, "minutes", { min: 1, max: 15, fallback: 5 })),
    "$0.01"),
];
