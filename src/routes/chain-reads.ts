// Plain blockchain reads on five EVM networks, generated from one table.
// These "boring chain reads" are the most-paid category in the Coinbase Bazaar (crawl of 13 Oct 2026).
import { createPublicClient, fallback, formatEther, formatGwei, formatUnits, http, isHash, type Chain, type PublicClient } from "viem";
import { arbitrum, base, mainnet, optimism, polygon } from "viem/chains";
import { entry, num, opt, type Entry } from "../family";
import { HttpError, type Env } from "../lib/env";

const isAddress = (v: string): v is `0x${string}` => /^0x[0-9a-fA-F]{40}$/.test(v);
import { EDGE_RPCS, LOG_RPCS, erc20Abi, requestClient, rpcUrls } from "../lib/rpc";
import { tokenAddress } from "../lib/tickers";

interface ChainDef {
  slug: string;
  name: string;
  chain: Chain;
  symbol: string;
  rpcs: string[];
}

// Keyless public RPCs, first answer wins with fallback on failure; order measured from Cloudflare (lib/rpc.ts).
export const CHAINS: ChainDef[] = [
  { slug: "base", name: "Base", chain: base, symbol: "ETH", rpcs: [...EDGE_RPCS.base] },
  { slug: "eth", name: "Ethereum", chain: mainnet, symbol: "ETH", rpcs: [...EDGE_RPCS.eth] },
  { slug: "arb", name: "Arbitrum One", chain: arbitrum, symbol: "ETH", rpcs: [...EDGE_RPCS.arb] },
  { slug: "op", name: "Optimism", chain: optimism, symbol: "ETH", rpcs: [...EDGE_RPCS.op] },
  { slug: "polygon", name: "Polygon PoS", chain: polygon, symbol: "POL", rpcs: [...EDGE_RPCS.polygon] },
];

export function client(env: Env, c: ChainDef): PublicClient {
  const urls = c.slug in EDGE_RPCS ? rpcUrls(c.slug as keyof typeof EDGE_RPCS, env) : c.rpcs;
  // 5 s per node with one quick retry: a transient node error moves on instead of costing the whole request budget.
  const options = { timeout: 5_000, retryCount: 1, retryDelay: 100 };
  return requestClient(`${c.slug}|${urls.join("|")}`, () =>
    createPublicClient({ chain: c.chain, transport: fallback(urls.map((u) => http(u, options)), { rank: false }), batch: { multicall: true } }) as PublicClient);
}

/** A client whose node order suits eth_getLogs (LOG_RPCS); everything else keeps client()'s order. */
export function logsClient(env: Env, c: ChainDef): PublicClient {
  const slug = c.slug as keyof typeof LOG_RPCS;
  if (!(slug in LOG_RPCS)) return client(env, c);
  const custom = slug === "base" ? env?.BASE_RPC_URL?.trim() : undefined;
  const urls = custom && !LOG_RPCS[slug].includes(custom) && !(EDGE_RPCS.base as readonly string[]).includes(custom) ? [custom, ...LOG_RPCS[slug]] : [...LOG_RPCS[slug]];
  const options = { timeout: 5_000, retryCount: 1, retryDelay: 100 };
  return requestClient(`logs|${c.slug}|${urls.join("|")}`, () =>
    createPublicClient({ chain: c.chain, transport: fallback(urls.map((u) => http(u, options)), { rank: false }) }) as PublicClient);
}

/** Runs an RPC call; node failures become 502 so the caller is not charged. */
export async function rpc<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof HttpError) throw e;
    const msg = String((e as Error)?.message ?? e);
    if (/could not be found|not found/i.test(msg)) throw new HttpError(404, "not found on this network");
    throw new HttpError(502, "the network's public nodes did not answer; try again");
  }
}

const address = (v: string | undefined, name = "address") => {
  const a = v?.trim();
  if (!a || !isAddress(a)) throw new HttpError(400, `${name} must be a 0x address (40 hex characters)`);
  return a;
};
/** What 2,000 blocks cover per chain (Base, Optimism and Polygon 2 s blocks, Arbitrum 0.25 s, Ethereum 12 s). */
const BLOCK_WINDOW: Record<string, string> = { base: "67 minutes", op: "67 minutes", polygon: "67 minutes", arb: "8 minutes", eth: "6.7 hours" };

/** A token input: a 0x contract address, or a ticker this network knows (USDC, USDT, WETH…). */
const tokenInput = (v: string | undefined, slug: string) => {
  const t = v?.trim();
  if (!t) throw new HttpError(400, "token is required: a ticker such as USDC or a 0x token contract address");
  return /^0x/i.test(t) ? address(t, "token") : tokenAddress(t, slug);
};
const txHash = (v: string | undefined) => {
  const h = v?.trim();
  if (!h || !isHash(h)) throw new HttpError(400, "hash must be a 0x transaction hash (64 hex characters)");
  return h as `0x${string}`;
};
const iso = (seconds: bigint | number) => new Date(Number(seconds) * 1000).toISOString();
const EX_ADDR = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
export const USDC: Record<string, `0x${string}`> = {
  base: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  eth: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  arb: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
  op: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
  polygon: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
};
const EX_TX: Record<string, string> = {
  base: "0x7d108fa131ed949c76d50caf2e7dfe25fc9903b9d276c40a0446d8afbdfe86b0",
  // Real finalized transactions (18 Oct 2026), so the listed examples work.
  eth: "0x9531467e03a57bbb5cd080439ac3b10c0cefed147282eb2ff709b02c897afcbf",
  arb: "0xf03682db039f7b1b72ddf4d17572738f142cf63ecb36c90afa570430ea9774c4",
  op: "0x721f3e9a996da49e2a8929bd2dd42e0f51344c11d7ca7bc3328fda349cdfae89",
  polygon: "0x23e86c30c46638b2e9798692fe89327a66aa8569a5d4a566125f655aeb8f80c7",
};

function chainEntries(c: ChainDef): Entry[] {
  const p = (op: string) => `/${c.slug}/${op}`;
  const tags = (...t: string[]) => [c.slug === "eth" ? "ethereum" : c.name.toLowerCase().split(" ")[0], "blockchain", "evm", ...t];
  const head = (extra: Record<string, unknown>) => ({ chain: c.name, chainId: c.chain.id, ...extra });

  return [
    entry(p("balance"), `${c.name} native balance`,
      `Native ${c.symbol} balance (eth_getBalance) of any 0x wallet address on ${c.name} at the latest block, in wei and in ${c.symbol}. Use to check whether a wallet can pay gas or a transfer; for ERC-20 tokens use ${c.slug}_token_balance, for all holdings at once use wallet_portfolio. A malformed address is rejected with 400, uncharged.`,
      tags("balance", "wallet"), { address: { type: "string", description: "0x wallet or contract address", required: true, example: EX_ADDR } },
      head({ address: EX_ADDR, balanceWei: "1234500000000000000", balance: "1.2345", symbol: c.symbol, block: 123456789 }),
      async (env, q) => {
        const a = address(q("address"));
        const cl = client(env, c);
        const [wei, block] = await rpc(() => Promise.all([cl.getBalance({ address: a }), cl.getBlockNumber()]));
        return head({ address: a, balanceWei: wei.toString(), balance: formatEther(wei), symbol: c.symbol, block: Number(block) });
      }),

    entry(p("token-balance"), `${c.name} ERC-20 balance`,
      `ERC-20 token balance of a wallet on ${c.name} (USDC, USDT, WETH or any token, via balanceOf): raw amount, decimals, symbol and the human-readable amount, live from the token contract. Use to check stablecoin or token holdings before a transfer or trade; for the native coin use ${c.slug}_balance. Both inputs are 0x addresses (40 hex characters); no contract returns 404 and a non-ERC-20 contract 422, both uncharged.`,
      tags("erc20", "token", "balance"), {
        token: { type: "string", description: "Token: a ticker such as USDC, USDT, WETH or DAI, or the 0x ERC-20 contract address", required: true, example: USDC[c.slug] },
        address: { type: "string", description: "0x wallet address", required: true, example: EX_ADDR },
      },
      head({ token: USDC[c.slug], symbol: "USDC", decimals: 6, address: EX_ADDR, raw: "2500000", balance: "2.5" }),
      async (env, q) => {
        const token = tokenInput(q("token"), c.slug);
        const a = address(q("address"));
        const cl = client(env, c);
        // Same rule as token-info: no code is 404; a contract that cannot answer ERC-20 reads is 422.
        const code = await rpc(() => cl.getCode({ address: token }));
        if (!code || code === "0x") throw new HttpError(404, "no contract at this address on this network");
        const [raw, decimals, symbol] = await rpc(() => Promise.all([
          cl.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [a] }),
          cl.readContract({ address: token, abi: erc20Abi, functionName: "decimals" }),
          cl.readContract({ address: token, abi: erc20Abi, functionName: "symbol" }).catch(() => null),
        ])).catch(() => { throw new HttpError(422, "this contract does not behave like an ERC-20 token"); });
        return head({ token, symbol, decimals: Number(decimals), address: a, raw: raw.toString(), balance: formatUnits(raw, Number(decimals)) });
      }),

    entry(p("token-info"), `${c.name} ERC-20 token info`,
      `Look up the name, symbol, decimals and total supply of an ERC-20 token contract on ${c.name}, live from the contract. Use to identify an unknown token address or to format raw amounts; for a holder's balance use ${c.slug}_token_balance. Input is a ticker (USDC, WETH…) or the token's 0x contract address; an address that is not an ERC-20 contract returns 422, uncharged.`,
      tags("erc20", "token", "metadata"), { token: { type: "string", description: "Token: a ticker such as USDC or WETH, or the 0x ERC-20 contract address", required: true, example: USDC[c.slug] } },
      head({ token: USDC[c.slug], name: "USD Coin", symbol: "USDC", decimals: 6, totalSupply: "1000000000.0", totalSupplyRaw: "1000000000000000" }),
      async (env, q) => {
        const token = tokenInput(q("token"), c.slug);
        const cl = client(env, c);
        const code = await rpc(() => cl.getCode({ address: token }));
        if (!code || code === "0x") throw new HttpError(404, "no contract at this address on this network");
        const [name, symbol, decimals, supply] = await rpc(() => Promise.all([
          cl.readContract({ address: token, abi: erc20Abi, functionName: "name" }).catch(() => null),
          cl.readContract({ address: token, abi: erc20Abi, functionName: "symbol" }).catch(() => null),
          cl.readContract({ address: token, abi: erc20Abi, functionName: "decimals" }),
          cl.readContract({ address: token, abi: erc20Abi, functionName: "totalSupply" }),
        ])).catch(() => { throw new HttpError(422, "this contract does not behave like an ERC-20 token"); });
        return head({ token, name, symbol, decimals: Number(decimals), totalSupply: formatUnits(supply, Number(decimals)), totalSupplyRaw: supply.toString() });
      }),

    entry(p("block"), `${c.name} block`,
      `Latest block number and block details on ${c.name}, or any block by decimal number: hash, timestamp, transaction count, gas used and limit, base fee in gwei and producer. Use for timestamps and confirmation counts; for current fees use ${c.slug}_gas. A block that does not exist yet returns 404, uncharged.`,
      tags("block", "chain-data"), { number: { type: "string", description: "Block number, or 'latest' (default)", example: "latest" } },
      head({ number: 123456789, hash: "0xabc…", timestamp: "2026-10-18T12:00:00.000Z", transactions: 154, gasUsed: "21000000", gasLimit: "30000000", baseFeeGwei: "0.012", miner: "0x…" }),
      async (env, q) => {
        const raw = q("number")?.trim();
        const cl = client(env, c);
        let blockNumber: bigint | undefined;
        if (raw && raw !== "latest") {
          if (!/^\d{1,12}$/.test(raw)) throw new HttpError(400, "number must be a block number or 'latest'");
          blockNumber = BigInt(raw);
        }
        const b = await rpc(() => (blockNumber === undefined ? cl.getBlock() : cl.getBlock({ blockNumber })));
        return head({
          number: Number(b.number), hash: b.hash, timestamp: iso(b.timestamp), transactions: b.transactions.length,
          gasUsed: b.gasUsed.toString(), gasLimit: b.gasLimit.toString(), baseFeeGwei: b.baseFeePerGas != null ? formatGwei(b.baseFeePerGas) : null, miner: b.miner,
        });
      }),

    entry(p("gas"), `${c.name} gas price`,
      `Current gas price on ${c.name} (eth_gasPrice): gas price, base fee and suggested priority fee in gwei, plus what a plain ${c.symbol} transfer (21,000 gas) costs right now. Takes no input. Use before sending a transaction or to decide whether to wait; for the fee a past transaction actually paid use ${c.slug}_receipt.`,
      tags("gas", "fees"), {},
      head({ gasPriceGwei: "0.015", baseFeeGwei: "0.012", priorityFeeGwei: "0.001", transferCost: "0.000000315", symbol: c.symbol, block: 123456789 }),
      async (env) => {
        const cl = client(env, c);
        const [price, block, tip] = await rpc(() => Promise.all([cl.getGasPrice(), cl.getBlock(), cl.estimateMaxPriorityFeePerGas().catch(() => null)]));
        return head({
          gasPriceGwei: formatGwei(price), baseFeeGwei: block.baseFeePerGas != null ? formatGwei(block.baseFeePerGas) : null,
          priorityFeeGwei: tip != null ? formatGwei(tip) : null, transferCost: formatEther(price * 21000n), symbol: c.symbol, block: Number(block.number),
        });
      }),

    entry(p("tx"), `${c.name} transaction`,
      `Look up ${/^[AEIOU]/.test(c.name) ? "an" : "a"} ${c.name} transaction by hash: sender, recipient, value in ${c.symbol}, nonce, gas limit, the 4-byte function selector and its block. Use to see what was sent or whether it exists; for success or failure and fees paid use ${c.slug}_receipt, for emitted events ${c.slug}_logs. Input is a 0x-prefixed 64-hex hash; an unknown hash returns 404, uncharged.`,
      tags("transaction", "chain-data"), { hash: { type: "string", description: "0x-prefixed transaction hash (64 hex characters)", required: true, example: EX_TX[c.slug] } },
      head({ hash: EX_TX[c.slug], from: "0x…", to: "0x…", value: "0.0", nonce: 12, gas: "65000", selector: "0xa9059cbb", inputBytes: 68, block: 123456789 }),
      async (env, q) => {
        const hash = txHash(q("hash"));
        const t = await rpc(() => client(env, c).getTransaction({ hash }));
        return head({
          hash: t.hash, from: t.from, to: t.to, value: formatEther(t.value), nonce: t.nonce, gas: t.gas.toString(),
          selector: t.input.length >= 10 ? t.input.slice(0, 10) : null, inputBytes: (t.input.length - 2) / 2, block: t.blockNumber != null ? Number(t.blockNumber) : null,
        });
      }),

    entry(p("receipt"), `${c.name} transaction receipt`,
      `Transaction receipt on ${c.name} (eth_getTransactionReceipt): success or reverted, gas used, effective gas price, fee paid in ${c.symbol}, number of event logs and any contract created. Use to confirm a payment or call went through; for sender, value and calldata use ${c.slug}_tx. Input is a 0x-prefixed 64-hex hash; a pending or unknown hash returns 404, uncharged.`,
      tags("transaction", "receipt", "confirmation"), { hash: { type: "string", description: "0x-prefixed transaction hash (64 hex characters)", required: true, example: EX_TX[c.slug] } },
      head({ hash: EX_TX[c.slug], status: "success", block: 123456789, gasUsed: "52000", effectiveGasPriceGwei: "0.012", fee: "0.000000624", logs: 1, contractAddress: null }),
      async (env, q) => {
        const hash = txHash(q("hash"));
        const r = await rpc(() => client(env, c).getTransactionReceipt({ hash }));
        return head({
          hash: r.transactionHash, status: r.status, block: Number(r.blockNumber), gasUsed: r.gasUsed.toString(),
          effectiveGasPriceGwei: formatGwei(r.effectiveGasPrice), fee: formatEther(r.gasUsed * r.effectiveGasPrice), logs: r.logs.length, contractAddress: r.contractAddress ?? null,
        });
      }),

    entry(p("nonce"), `${c.name} account nonce`,
      `Read the transaction count (nonce) of a 0x address on ${c.name}, both confirmed and including pending transactions. Use to build the next transaction or to tell whether an address has ever sent anything; for its balance use ${c.slug}_balance. A malformed address is rejected with 400, uncharged.`,
      tags("nonce", "wallet"), { address: { type: "string", description: "0x address", required: true, example: EX_ADDR } },
      head({ address: EX_ADDR, nonce: 1204, pendingNonce: 1204, hasSent: true }),
      async (env, q) => {
        const a = address(q("address"));
        const cl = client(env, c);
        const [n, pending] = await rpc(() => Promise.all([cl.getTransactionCount({ address: a }), cl.getTransactionCount({ address: a, blockTag: "pending" })]));
        return head({ address: a, nonce: n, pendingNonce: pending, hasSent: n > 0 });
      }),

    entry(p("is-contract"), `${c.name} contract check`,
      `Check whether a 0x address on ${c.name} is a smart contract or a plain wallet: bytecode size, and whether it is an EIP-1167 minimal proxy and which implementation it points to. Use before sending funds or approving a spender; for a fuller risk verdict use check_counterparty. A malformed address is rejected with 400, uncharged.`,
      tags("contract", "security", "address"), { address: { type: "string", description: "0x address", required: true, example: USDC[c.slug] } },
      head({ address: USDC[c.slug], isContract: true, codeBytes: 1855, minimalProxy: false, implementation: null }),
      async (env, q) => {
        const a = address(q("address"));
        const code = (await rpc(() => client(env, c).getCode({ address: a }))) ?? "0x";
        const bytes = (code.length - 2) / 2;
        const m = /^0x363d3d373d3d3d363d73([0-9a-f]{40})5af43d82803e903d91602b57fd5bf3$/i.exec(code);
        return head({ address: a, isContract: bytes > 0, codeBytes: bytes, minimalProxy: !!m, implementation: m ? `0x${m[1]}` : null });
      }),

    entry(p("logs"), `${c.name} recent event logs`,
      `Recent contract event logs on ${c.name} (eth_getLogs): the events a contract emitted over the last N blocks (1-1,000, default 50), optionally filtered by topic0 (the 0x 32-byte event signature hash). Returns up to 100 logs with block, transaction hash and topics. Use to watch transfers or contract events; for one transaction's outcome use ${c.slug}_receipt.`,
      tags("logs", "events", "chain-data"), {
        address: { type: "string", description: "0x contract address", required: true, example: USDC[c.slug] },
        blocks: { type: "integer", description: "How many recent blocks to scan (1-1000, default 50)", example: 50 },
        topic0: { type: "string", description: "Optional 0x event signature hash to filter by", example: "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef" },
      },
      head({ address: USDC[c.slug], fromBlock: 123456739, toBlock: 123456789, count: 2, truncated: false, logs: [{ block: 123456780, tx: "0x…", logIndex: 3, topics: ["0xddf2…"], data: "0x…" }] }),
      async (env, q) => {
        const a = address(q("address"));
        const span = BigInt(num(q, "blocks", { min: 1, max: 1000, fallback: 50, integer: true }));
        const topic0 = opt(q, "topic0", 66);
        if (topic0 && !isHash(topic0)) throw new HttpError(400, "topic0 must be a 0x 32-byte hash");
        const cl = client(env, c);
        const latest = await rpc(() => cl.getBlockNumber());
        const { logs: list, fromBlock, complete } = await recentLogs(logsClient(env, c), { address: a, ...(topic0 ? { topics: [topic0 as `0x${string}`] } : {}) }, latest, span, 100);
        // The newest 100, oldest first; fromBlock is where the scan stopped when a busy contract filled them early.
        return head({
          address: a, fromBlock: Number(fromBlock), toBlock: Number(latest), count: list.length, truncated: list.length > 100 || !complete,
          logs: list.slice(-100).map((l) => ({ block: Number(l.blockNumber), tx: l.transactionHash, logIndex: Number(l.logIndex), topics: l.topics, data: l.data.length > 514 ? `${l.data.slice(0, 514)}…` : l.data })),
        });
      }),

    entry(p("token-transfers"), `${c.name} wallet token transfers`,
      `List a wallet's recent transfers of one ERC-20 token (default USDC) on ${c.name}, in and out, over the last N blocks (1-2,000, default 1,000): direction, counterparty, amount and transaction, newest first, up to 50. Use to confirm a payment arrived or see what was sent; for the current balance use ${c.slug}_token_balance. Malformed addresses are rejected with 400, uncharged.`,
      tags("erc20", "transfers", "wallet", "history", "usdc", "payments"), {
        address: { type: "string", description: "0x wallet address", required: true, example: EX_ADDR },
        token: { type: "string", description: "Token: a ticker such as USDT or WETH, or the 0x ERC-20 contract (default: USDC on this network)", example: USDC[c.slug] },
        blocks: { type: "integer", description: `How many recent blocks to scan (1-2000, default 1000; 2,000 blocks is about ${BLOCK_WINDOW[c.slug]} on ${c.name})`, example: 1000 },
      },
      head({ address: EX_ADDR, fromBlock: 123456290, toBlock: 123456789, count: 1, truncated: false, transfers: [{ block: 123456780, tx: "0x…", token: USDC[c.slug], symbol: "USDC", direction: "in", counterparty: "0x…", amount: "2.5", raw: "2500000" }] }),
      async (env, q) => {
        const a = address(q("address"));
        const token = q("token") ? tokenInput(q("token"), c.slug) : USDC[c.slug];
        const span = BigInt(num(q, "blocks", { min: 1, max: 2000, fallback: 1000, integer: true }));
        const cl = client(env, c);
        const latest = await rpc(() => cl.getBlockNumber());
        const fromBlock = latest - span + 1n;
        const padded = `0x${a.slice(2).toLowerCase().padStart(64, "0")}`;
        type Log = { address: string; blockNumber: string; transactionHash: string; logIndex: string; topics: string[]; data: string };
        // Sent and received Transfer events of this one token, newest first in growing windows (recentLogs): public nodes
        // refuse or time out on a single 1,000-block eth_getLogs, which made this tool fail about one call in four.
        const logs = logsClient(env, c);
        const [sentScan, receivedScan] = await Promise.all([
          recentLogs(logs, { address: token, topics: [TRANSFER_TOPIC, padded as `0x${string}`] }, latest, span, 50),
          recentLogs(logs, { address: token, topics: [TRANSFER_TOPIC, null, padded as `0x${string}`] }, latest, span, 50),
        ]).catch((e) => { throw e instanceof HttpError && e.status === 502 ? new HttpError(502, "the network's public nodes could not scan that range; try fewer blocks") : e; });
        const sent = sentScan.logs, received = receivedScan.logs;
        const scannedFrom = sentScan.fromBlock > receivedScan.fromBlock ? sentScan.fromBlock : receivedScan.fromBlock;
        const partial = !sentScan.complete || !receivedScan.complete;
        const all = [...(sent as Log[]).map((l) => ({ l, direction: "out" as const })), ...(received as Log[]).map((l) => ({ l, direction: "in" as const }))]
          .filter(({ l }) => l.topics.length === 3)
          .sort((x, y) => Number(y.l.blockNumber) - Number(x.l.blockNumber) || Number(y.l.logIndex) - Number(x.l.logIndex));
        const shown = all.slice(0, 50);
        // Symbol and decimals for up to 10 distinct tokens (batched into one multicall); others show raw amounts.
        const tokens = [...new Set(shown.map(({ l }) => l.address.toLowerCase()))].slice(0, 10) as `0x${string}`[];
        const meta = new Map(await Promise.all(tokens.map(async (t) => {
          const [symbol, decimals] = await Promise.all([
            cl.readContract({ address: t, abi: erc20Abi, functionName: "symbol" }).catch(() => null),
            cl.readContract({ address: t, abi: erc20Abi, functionName: "decimals" }).catch(() => null),
          ]);
          return [t, { symbol: symbol as string | null, decimals: decimals === null ? null : Number(decimals) }] as const;
        })));
        return head({
          address: a, fromBlock: Number(partial ? scannedFrom : fromBlock), toBlock: Number(latest), count: all.length, truncated: all.length > 50 || partial,
          transfers: shown.map(({ l, direction }) => {
            const raw = BigInt(l.data === "0x" ? 0 : l.data.slice(0, 66));
            const m = meta.get(l.address.toLowerCase() as `0x${string}`);
            const other = `0x${(direction === "out" ? l.topics[2] : l.topics[1]).slice(26)}`;
            return { block: Number(l.blockNumber), tx: l.transactionHash, token: l.address, symbol: m?.symbol ?? null, direction, counterparty: other,
              amount: m?.decimals != null ? formatUnits(raw, m.decimals) : null, raw: raw.toString() };
          }),
        });
      }),
  ];
}

const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef" as const;

type RawLog = { blockNumber: string; transactionHash: string; logIndex: string; topics: string[]; data: string };

/**
 * eth_getLogs over the last `span` blocks, newest first, in windows of 10, 40, 160… blocks, stopping once `want` logs
 * are in. One busy contract (USDC on Base: ~270 logs a block) fills them from the first small window instead of
 * pulling megabytes over the whole span; a quiet one covers 1,000 blocks in five calls. Small windows also suit nodes
 * that cap the range. Returns the logs oldest first and the first block actually scanned.
 */
export async function recentLogs(cl: PublicClient, filter: { address: `0x${string}`; topics?: (`0x${string}` | null)[] }, latest: bigint, span: bigint, want: number) {
  const floor = latest - span + 1n;
  let logs: RawLog[] = [];
  let to = latest;
  let size = 10n;
  while (to >= floor) {
    const from = to - size + 1n > floor ? to - size + 1n : floor;
    const chunk = await rpc(() => cl.request({ method: "eth_getLogs", params: [{ ...filter, fromBlock: `0x${from.toString(16)}`, toBlock: `0x${to.toString(16)}` }] })) as RawLog[];
    logs = chunk.concat(logs);
    if (logs.length >= want || from === floor) return { logs, fromBlock: from, complete: from === floor };
    to = from - 1n;
    size *= 4n;
  }
  return { logs, fromBlock: floor, complete: true };
}

/** Native coin and USDC on every supported network in one call: the "where are this wallet's funds?" question. */
const WALLET_BALANCES: Entry = entry("/wallet/balances", "Wallet balance, USDC balance: native and USDC balances on 5 networks",
  `Read a wallet's native coin and USDC balances on Base, Ethereum, Arbitrum, Optimism and Polygon in one call, live from each network, plus the USDC total. Use to find where a wallet's funds are before a payment or bridge; for one token on one network use <chain>_token_balance, for all tokens on Base use wallet_portfolio. A network whose nodes do not answer is listed with an error instead of failing the call.`,
  ["wallet", "balance", "multichain", "usdc", "evm", "blockchain"],
  { address: { type: "string", description: "0x wallet address", required: true, example: EX_ADDR } },
  { address: EX_ADDR, usdcTotal: "12.5", networks: [{ chain: "Base", chainId: 8453, native: "0.0123", nativeSymbol: "ETH", usdc: "12.5", error: null }] },
  async (env, q) => {
    const a = address(q("address"));
    const networks = await Promise.all(CHAINS.map(async (c) => {
      const cl = client(env, c);
      try {
        const [wei, usdc] = await Promise.all([
          cl.getBalance({ address: a }),
          cl.readContract({ address: USDC[c.slug], abi: erc20Abi, functionName: "balanceOf", args: [a] }),
        ]);
        return { chain: c.name, chainId: c.chain.id, native: formatEther(wei), nativeSymbol: c.symbol, usdc: formatUnits(usdc as bigint, 6), usdcRaw: (usdc as bigint).toString(), error: null as string | null };
      } catch {
        return { chain: c.name, chainId: c.chain.id, native: null, nativeSymbol: c.symbol, usdc: null, usdcRaw: null, error: "the network's public nodes did not answer" };
      }
    }));
    if (networks.every((n) => n.error)) throw new HttpError(502, "no network answered; try again");
    const total = networks.reduce((s, n) => s + (n.usdcRaw ? BigInt(n.usdcRaw) : 0n), 0n);
    return { address: a, usdcTotal: formatUnits(total, 6), networks: networks.map(({ usdcRaw: _r, ...n }) => n) };
  },
  "$0.005");

export const CHAIN_READS: Entry[] = [...CHAINS.flatMap(chainEntries), WALLET_BALANCES];
