// Token flows (18 Nov 2026, the owner: "Yes, build it"). Measured on the Coinbase Bazaar that day (34,791 listings, 30-day
// payers and calls): the token-flow jobs are bought again and again by the same wallets. Nansen's "who bought/sold" had 62
// payers at about 5 calls each, its "flow intelligence" 19 payers at about 18 calls each, its smart-money netflow 15 payers at
// $0.05 and about 31 calls each. /token/buyers (5 Nov) already answers "who bought and who sold"; this file adds the other
// half, the flow over time, and a pack that answers both with the token's price and a sanctions screen of the top wallets.
// Both read the token's own Transfer logs (address-filtered, so every log node answers) the way /token/buyers does; that
// tool's code is not changed.
import { formatUnits, getAddress } from "viem";
import { entry, need, num, opt, type Entry, type Input } from "../family";
import { HttpError, type Env } from "../lib/env";
import { recentBlockSeconds } from "../lib/block-time";
import { erc20Abi } from "../lib/rpc";
import { tokenAddress } from "../lib/tickers";
import { CHAINS, LOG_WINDOW_MAX, client, codeKind, logsClient, recentLogs, rpc, scaledBlocks } from "./chain-reads";
import { CHAIN_MORE } from "./chain-more";
import { PRICES } from "./prices";
import { SANCTIONS } from "./sanctions";
import { runSections } from "./packs";
import { chainSlug } from "./whale";

const ZERO = "0x0000000000000000000000000000000000000000";
const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef" as const;
const def = (slug: string) => CHAINS.find((c) => c.slug === slug)!;
const tokenInput = (raw: string, slug: string) => {
  try { return tokenAddress(raw, slug); } catch (e) { if (e instanceof HttpError) throw e; throw new HttpError(400, "token must be a 0x address or a known ticker"); }
};

export type Edge = { from: string; to: string; amount: bigint; block: bigint };

/** Pools, routers and aggregators: addresses that dealt with 3+ others in 4+ transfers (the 30 busiest, checked for code).
 *  The same rule as /token/buyers, so the two tools agree on what a buy is. */
export function hubCandidates(edges: Edge[]): string[] {
  const degree = new Map<string, { n: number; peers: Set<string> }>();
  for (const e of edges) for (const [a, b] of [[e.from, e.to], [e.to, e.from]]) {
    const d = degree.get(a) ?? { n: 0, peers: new Set<string>() };
    d.n++; d.peers.add(b); degree.set(a, d);
  }
  return [...degree.entries()].filter(([a, d]) => a !== ZERO && d.n >= 4 && d.peers.size >= 3).sort((x, y) => y[1].n - x[1].n).slice(0, 30).map(([a]) => a);
}

/** Buckets of equal block ranges, newest last: DEX buys (hub to wallet), DEX sells (wallet to hub), mints and burns. */
export function flowBuckets(edges: Edge[], hubs: Set<string>, fromBlock: bigint, toBlock: bigint, count: number) {
  const span = toBlock - fromBlock + 1n;
  const size = span / BigInt(count) > 0n ? span / BigInt(count) : 1n;
  const buckets = Array.from({ length: count }, (_, i) => {
    const start = fromBlock + size * BigInt(i);
    const end = i === count - 1 ? toBlock : start + size - 1n;
    return { fromBlock: start, toBlock: end, bought: 0n, sold: 0n, buys: 0, sells: 0 };
  });
  const totals = { bought: 0n, sold: 0n, buys: 0, sells: 0, minted: 0n, burned: 0n };
  const buyers = new Map<string, bigint>(), sellers = new Set<string>();
  for (const e of edges) {
    if (e.from === ZERO) { totals.minted += e.amount; continue; }
    if (e.to === ZERO) { totals.burned += e.amount; continue; }
    const buy = hubs.has(e.from) && !hubs.has(e.to);
    const sell = hubs.has(e.to) && !hubs.has(e.from);
    if (!buy && !sell) continue;
    let i = Number((e.block - fromBlock) / size);
    if (i < 0) i = 0;
    if (i >= count) i = count - 1;
    const b = buckets[i];
    if (buy) { b.bought += e.amount; b.buys++; totals.bought += e.amount; totals.buys++; buyers.set(e.to, (buyers.get(e.to) ?? 0n) + e.amount); }
    else { b.sold += e.amount; b.sells++; totals.sold += e.amount; totals.sells++; sellers.add(e.from); }
  }
  return { buckets, totals, buyers: buyers.size, sellers: sellers.size, buyerAmounts: buyers };
}

/** The part of all buying done by the five largest buyers that are wallets. Contracts (vaults, routers outside the 30 busiest,
 *  bots' own contracts) are left out, as in /token/buyers' lists: 18 Nov 2026, AERO read 0.89 with them, the top wallet bought
 *  2,260 of 31,186. `isContract` is asked for the 15 largest buyers only. */
export async function topWalletShare(buyers: Map<string, bigint>, bought: bigint, isContract: (a: string) => Promise<boolean>) {
  if (bought <= 0n) return null;
  const largest = [...buyers.entries()].sort((x, y) => (y[1] > x[1] ? 1 : y[1] < x[1] ? -1 : 0)).slice(0, 15);
  const code = await Promise.all(largest.map(([a]) => isContract(a)));
  const top5 = largest.filter((_, i) => !code[i]).slice(0, 5).reduce((s, [, v]) => s + v, 0n);
  return Number((top5 * 10_000n) / bought) / 10_000;
}

const direction = (bought: bigint, sold: bigint) => {
  const all = bought + sold;
  if (all === 0n) return "no DEX trades";
  const net = Number(((bought - sold) * 1000n) / all) / 1000;
  return net > 0.1 ? "net buying" : net < -0.1 ? "net selling" : "balanced";
};

const FLOW_EXAMPLE = {
  chain: "Base", token: { address: "0x940181a94A35A4569E4529A3CDfB74e38FD98631", symbol: "AERO", decimals: 18 },
  fromBlock: 37000000, toBlock: 37017999, minutes: 60, transfersRead: 2840, truncated: false, dexContractsSeen: 14,
  direction: "net buying",
  totals: { bought: "182340.5", sold: "121002.1", netViaDex: "61338.4", buys: 412, sells: 305, buyers: 188, sellers: 140, minted: "0", burned: "0", topBuyerShare: 0.31 },
  buckets: [{ fromBlock: 37000000, toBlock: 37002999, minutesAgo: 60, bought: "30110.2", sold: "20044.9", net: "10065.3", buys: 70, sells: 51 }],
  note: "Bought: transfers from DEX contracts to wallets; sold: the reverse.",
};

/** The flow read itself, shared by the tool and the pack. */
async function tokenFlow(env: Env, q: Input) {
  const slug = chainSlug(opt(q, "chain", 30) ?? "base");
  const token = tokenInput(need(q, "token", 80), slug) as `0x${string}`;
  const span = BigInt(num(q, "blocks", { min: 100, max: scaledBlocks(slug, 10_000), fallback: scaledBlocks(slug, 1800), integer: true }));
  const count = num(q, "buckets", { min: 2, max: 12, fallback: 6, integer: true });
  const c = def(slug);
  const cl = client(env, c);
  const logs = logsClient(env, c);
  const latest = (await rpc(() => logs.getBlockNumber())) - 3n;
  const scan = await recentLogs(logs, { address: token, topics: [TRANSFER] }, latest, span, 3000, { max: LOG_WINDOW_MAX });
  const [decimals, symbol] = await Promise.all([
    (cl.readContract({ address: token, abi: erc20Abi, functionName: "decimals" }) as Promise<number>).then(Number).catch(() => null),
    (cl.readContract({ address: token, abi: erc20Abi, functionName: "symbol" }) as Promise<string>).catch(() => null),
  ]);
  if (decimals === null) throw new HttpError(404, "that address is not an ERC-20 token on this network (nothing was charged)");
  const edges: Edge[] = [];
  for (const l of scan.logs) {
    if (l.topics.length !== 3) continue;
    edges.push({ from: `0x${l.topics[1].slice(26)}`, to: `0x${l.topics[2].slice(26)}`, amount: BigInt(l.data === "0x" ? 0 : l.data.slice(0, 66)), block: BigInt(l.blockNumber) });
  }
  const isContract = (a: string) => cl.getCode({ address: a as `0x${string}` }).then((x) => codeKind(x ?? "0x").isContract).catch(() => false);
  const candidates = hubCandidates(edges);
  const code = await Promise.all(candidates.map(isContract));
  const hubs = new Set(candidates.filter((_, i) => code[i]));
  const fromBlock = scan.fromBlock;
  const flow = flowBuckets(edges, hubs, fromBlock, latest, count);
  const topBuyerShare = await topWalletShare(flow.buyerAmounts, flow.totals.bought, isContract);
  const secs = await recentBlockSeconds(cl, slug, latest);
  const f = (n: bigint) => formatUnits(n, decimals);
  const ago = (block: bigint) => Math.round((Number(latest - block) * secs) / 60);
  return {
    chain: c.name, token: { address: getAddress(token), symbol, decimals }, fromBlock: Number(fromBlock), toBlock: Number(latest),
    minutes: ago(fromBlock), transfersRead: scan.logs.length, truncated: !scan.complete, dexContractsSeen: hubs.size,
    direction: direction(flow.totals.bought, flow.totals.sold),
    totals: {
      bought: f(flow.totals.bought), sold: f(flow.totals.sold), netViaDex: f(flow.totals.bought - flow.totals.sold),
      buys: flow.totals.buys, sells: flow.totals.sells, buyers: flow.buyers, sellers: flow.sellers,
      minted: f(flow.totals.minted), burned: f(flow.totals.burned), topBuyerShare,
    },
    buckets: flow.buckets.map((b) => ({ fromBlock: Number(b.fromBlock), toBlock: Number(b.toBlock), minutesAgo: ago(b.fromBlock), bought: f(b.bought), sold: f(b.sold), net: f(b.bought - b.sold), buys: b.buys, sells: b.sells })),
    note: (hubs.size ? "Bought counts transfers from DEX pools, routers and other busy contracts to wallets, sold the reverse." : "No DEX contract seen in the window, so no buys or sells are counted.")
      + " Wallet-to-wallet moves, mints and burns are not trades. topBuyerShare is the part of all buying done by the five largest buyers that are wallets (contracts left out)."
      + (scan.complete ? "" : " A busy token filled the read early: fromBlock shows where it started."),
  };
}

const FLOW_PARAMS = {
  token: { type: "string", description: "Token: 0x ERC-20 address, or a ticker such as AERO, DEGEN or USDC", required: true, example: "0x940181a94A35A4569E4529A3CDfB74e38FD98631" },
  chain: { type: "string", description: "base (default), ethereum, arbitrum, optimism or polygon", example: "base" },
  blocks: { type: "integer", description: "How many recent blocks to read, 100 to 10000 (default 1800: about 6 hours on Ethereum); on Base, which makes a block every 0.2 s, ten times that (default 18000, about an hour, up to 100000)", example: 1800 },
} as const;

const BUYERS = CHAIN_MORE.find((e) => e.endpoint.path === "/token/buyers");
const PRICE = PRICES.find((e) => e.endpoint.path === "/price/token");
const SCREEN = SANCTIONS.find((e) => e.endpoint.path === "/sanctions/check");
const run = (e: Entry | undefined, env: Env, inputs: Record<string, string | number | undefined>) => {
  if (!e) throw new Error("token-flows pack references a missing tool");
  const q: Input = (n) => (inputs[n] === undefined ? undefined : String(inputs[n]));
  return Promise.resolve().then(() => e.run(env, q));
};

export const TOKEN_FLOWS: Entry[] = [
  entry("/token/flow", "Token flow: net buy and sell volume over time",
    "Token flow of an ERC-20: DEX buy and sell volume, net flow, buy and sell counts, distinct buyers and sellers and the top-5 wallets' share of buying, in time buckets, from live Transfer logs on Base (default), Ethereum, Arbitrum, Optimism or Polygon. Use to see whether a token is being accumulated or dumped right now, and by how few wallets.",
    ["token-flow", "net-flow", "flow-intelligence", "buy-sell-volume", "token-flows", "dex", "smart-money"], {
      ...FLOW_PARAMS,
      buckets: { type: "integer", description: "Time buckets to split the window into, 2 to 12 (default 6)", example: 6 },
    }, FLOW_EXAMPLE, (env, q) => tokenFlow(env, q), "$0.01"),

  entry("/pack/token-flows", "Token flows pack: who bought, who sold, net flow and price",
    "Token flows in one call: USD price, net DEX buy and sell flow in time buckets, the top buyers and sellers, and an OFAC screen of the top three of each, on Base (default), Ethereum, Arbitrum, Optimism or Polygon. A failed part is listed in `failed`. Use before trading a token, for a trading agent's context, or to watch a launch.",
    ["token-flows", "who-bought-sold", "net-flow", "smart-money", "token-buyers", "pack"], {
      ...FLOW_PARAMS,
      limit: { type: "integer", description: "Buyers and sellers to return each, 1 to 10 (default 5)", example: 5 },
    },
    {
      pack: "token-flows", chain: "Base", token: { address: "0x940181a94A35A4569E4529A3CDfB74e38FD98631", symbol: "AERO" },
      price: { priceUsd: 1.12 },
      flow: { direction: "net buying", minutes: 60, totals: { bought: "182340.5", sold: "121002.1", netViaDex: "61338.4" } },
      buyers: [{ address: "0x3333333333333333333333333333333333333333", bought: "15230.5", sold: "0", netViaDex: "15230.5", netAll: "15230.5", transfers: 4 }],
      sellers: [],
      sanctions: { screened: 2, listed: [] },
      failed: {},
    },
    async (env, q) => {
      const token = need(q, "token", 80);
      const chain = opt(q, "chain", 30) ?? "base";
      const blocks = opt(q, "blocks", 12);
      const limit = num(q, "limit", { min: 1, max: 10, fallback: 5, integer: true });
      const { data, failed } = await runSections({
        flow: tokenFlow(env, q),
        who: run(BUYERS, env, { token, chain, blocks, limit }),
        price: run(PRICE, env, /^0x[0-9a-fA-F]{40}$/.test(token) ? { address: token, chain } : { symbol: token, chain }),
      });
      const who = data.who as { buyers?: { address: string }[]; sellers?: { address: string }[] } | undefined;
      const top = [...(who?.buyers ?? []).slice(0, 3), ...(who?.sellers ?? []).slice(0, 3)].map((w) => w.address);
      const screens = await Promise.all(top.map((address) => run(SCREEN, env, { address }).then((r) => ({ address, r: r as { listed?: boolean; verdict?: string } })).catch(() => ({ address, r: null }))));
      const fl = data.flow as Record<string, unknown> | undefined;
      const pr = data.price as Record<string, unknown> | undefined;
      return {
        pack: "token-flows", chain: (fl?.chain ?? null), token: fl?.token ?? null,
        price: pr ? { priceUsd: pr.priceUsd ?? pr.price ?? null } : null,
        flow: fl ? { direction: fl.direction, minutes: fl.minutes, fromBlock: fl.fromBlock, toBlock: fl.toBlock, totals: fl.totals, buckets: fl.buckets, truncated: fl.truncated } : null,
        buyers: who?.buyers ?? null, sellers: who?.sellers ?? null,
        sanctions: top.length ? { screened: screens.filter((s) => s.r).length, listed: screens.filter((s) => s.r?.listed || s.r?.verdict === "block").map((s) => s.address) } : null,
        failed: screens.some((s) => !s.r) ? { ...failed, sanctions: "the sanctions screen did not answer for every wallet" } : failed,
      };
    }, "$0.01"),
];
