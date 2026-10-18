// Plain blockchain reads on five EVM networks, generated from one table.
// These "boring chain reads" are the most-paid category in the Coinbase Bazaar (crawl of 13 Oct 2026).
import { createPublicClient, fallback, formatEther, formatGwei, formatUnits, http, isHash, type Chain, type PublicClient } from "viem";
import { arbitrum, base, mainnet, optimism, polygon } from "viem/chains";
import { entry, num, opt, type Entry } from "../family";
import { HttpError, type Env } from "../lib/env";

const isAddress = (v: string): v is `0x${string}` => /^0x[0-9a-fA-F]{40}$/.test(v);
import { erc20Abi } from "../lib/rpc";

interface ChainDef {
  slug: string;
  name: string;
  chain: Chain;
  symbol: string;
  rpcs: string[];
}

// Keyless public RPCs, first answer wins with fallback on failure. Base uses BASE_RPC_URL first.
export const CHAINS: ChainDef[] = [
  { slug: "base", name: "Base", chain: base, symbol: "ETH", rpcs: ["https://mainnet.base.org", "https://base.drpc.org", "https://base-rpc.publicnode.com"] },
  { slug: "eth", name: "Ethereum", chain: mainnet, symbol: "ETH", rpcs: ["https://ethereum-rpc.publicnode.com", "https://eth.drpc.org", "https://eth.llamarpc.com"] },
  { slug: "arb", name: "Arbitrum One", chain: arbitrum, symbol: "ETH", rpcs: ["https://arb1.arbitrum.io/rpc", "https://arbitrum.drpc.org", "https://arbitrum-one-rpc.publicnode.com"] },
  { slug: "op", name: "Optimism", chain: optimism, symbol: "ETH", rpcs: ["https://mainnet.optimism.io", "https://optimism.drpc.org", "https://optimism-rpc.publicnode.com"] },
  { slug: "polygon", name: "Polygon PoS", chain: polygon, symbol: "POL", rpcs: ["https://polygon-rpc.com", "https://polygon.drpc.org", "https://polygon-bor-rpc.publicnode.com"] },
];

const clients = new Map<string, PublicClient>();
export function client(env: Env, c: ChainDef): PublicClient {
  const urls = c.slug === "base" && env.BASE_RPC_URL ? [env.BASE_RPC_URL, ...c.rpcs.filter((u) => u !== env.BASE_RPC_URL)] : c.rpcs;
  const key = `${c.slug}|${urls[0]}`;
  let cl = clients.get(key);
  if (!cl) {
    const options = { timeout: 8_000, retryCount: 0 };
    cl = createPublicClient({ chain: c.chain, transport: fallback(urls.map((u) => http(u, options)), { rank: false }), batch: { multicall: true } }) as PublicClient;
    clients.set(key, cl);
  }
  return cl;
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
      `Native ${c.symbol} balance of any address on ${c.name}, in wei and in ${c.symbol}, read live from the chain at the latest block. Use to check whether a wallet is funded before sending, paying gas or settling.`,
      tags("balance", "wallet"), { address: { type: "string", description: "0x wallet or contract address", required: true, example: EX_ADDR } },
      head({ address: EX_ADDR, balanceWei: "1234500000000000000", balance: "1.2345", symbol: c.symbol, block: 123456789 }),
      async (env, q) => {
        const a = address(q("address"));
        const cl = client(env, c);
        const [wei, block] = await rpc(() => Promise.all([cl.getBalance({ address: a }), cl.getBlockNumber()]));
        return head({ address: a, balanceWei: wei.toString(), balance: formatEther(wei), symbol: c.symbol, block: Number(block) });
      }),

    entry(p("token-balance"), `${c.name} ERC-20 balance`,
      `ERC-20 token balance of a wallet on ${c.name}: raw amount, decimals, token symbol and the human-readable amount, read live from the token contract. Use to check stablecoin or token holdings before a transfer, payment or trade.`,
      tags("erc20", "token", "balance"), {
        token: { type: "string", description: "0x ERC-20 token contract address", required: true, example: USDC[c.slug] },
        address: { type: "string", description: "0x wallet address", required: true, example: EX_ADDR },
      },
      head({ token: USDC[c.slug], symbol: "USDC", decimals: 6, address: EX_ADDR, raw: "2500000", balance: "2.5" }),
      async (env, q) => {
        const token = address(q("token"), "token");
        const a = address(q("address"));
        const cl = client(env, c);
        const [raw, decimals, symbol] = await rpc(() => Promise.all([
          cl.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [a] }),
          cl.readContract({ address: token, abi: erc20Abi, functionName: "decimals" }),
          cl.readContract({ address: token, abi: erc20Abi, functionName: "symbol" }).catch(() => null),
        ]));
        return head({ token, symbol, decimals: Number(decimals), address: a, raw: raw.toString(), balance: formatUnits(raw, Number(decimals)) });
      }),

    entry(p("token-info"), `${c.name} ERC-20 token info`,
      `Name, symbol, decimals and total supply of any ERC-20 token contract on ${c.name}, read live from the contract. Use to identify an unknown token address or to format raw token amounts correctly.`,
      tags("erc20", "token", "metadata"), { token: { type: "string", description: "0x ERC-20 token contract address", required: true, example: USDC[c.slug] } },
      head({ token: USDC[c.slug], name: "USD Coin", symbol: "USDC", decimals: 6, totalSupply: "1000000000.0", totalSupplyRaw: "1000000000000000" }),
      async (env, q) => {
        const token = address(q("token"), "token");
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
      `A block on ${c.name} by number, or the latest one: hash, timestamp, transaction count, gas used and limit, base fee in gwei and producer address. Use for timestamps, confirmations and chain-activity checks.`,
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
      `Current gas on ${c.name}: gas price, base fee and suggested priority fee in gwei, plus what a plain ${c.symbol} transfer (21,000 gas) costs right now. Use before sending a transaction or to decide whether to wait.`,
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
      `A transaction on ${c.name} by hash: sender, recipient, value in ${c.symbol}, nonce, gas limit, the 4-byte function selector of the call data, and its block. Use to check what a transaction did or whether it exists.`,
      tags("transaction", "chain-data"), { hash: { type: "string", description: "0x transaction hash", required: true, example: EX_TX[c.slug] } },
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
      `Receipt of a ${c.name} transaction: success or reverted, gas used, effective gas price, fee paid in ${c.symbol}, number of event logs and any contract created. Use to confirm a payment or call went through.`,
      tags("transaction", "receipt", "confirmation"), { hash: { type: "string", description: "0x transaction hash", required: true, example: EX_TX[c.slug] } },
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
      `Transaction count (nonce) of an address on ${c.name}, both confirmed and including pending transactions. Use to build the next transaction or to tell whether an address has ever sent anything.`,
      tags("nonce", "wallet"), { address: { type: "string", description: "0x address", required: true, example: EX_ADDR } },
      head({ address: EX_ADDR, nonce: 1204, pendingNonce: 1204, hasSent: true }),
      async (env, q) => {
        const a = address(q("address"));
        const cl = client(env, c);
        const [n, pending] = await rpc(() => Promise.all([cl.getTransactionCount({ address: a }), cl.getTransactionCount({ address: a, blockTag: "pending" })]));
        return head({ address: a, nonce: n, pendingNonce: pending, hasSent: n > 0 });
      }),

    entry(p("is-contract"), `${c.name} contract check`,
      `Whether an address on ${c.name} is a smart contract or a plain wallet, with the size of its bytecode and whether it is a minimal proxy (EIP-1167) and which implementation it points to. Use before sending funds or approving a spender.`,
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
      `Recent event logs emitted by a contract on ${c.name} over the last N blocks (up to 1,000), optionally filtered by topic0 (event signature hash). Returns up to 100 logs with block, transaction hash and topics. Use to watch transfers or contract events.`,
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
        const fromBlock = latest - span + 1n;
        const logs = await rpc(() => cl.request({
          method: "eth_getLogs",
          params: [{ address: a, fromBlock: `0x${fromBlock.toString(16)}`, toBlock: `0x${latest.toString(16)}`, ...(topic0 ? { topics: [topic0 as `0x${string}`] } : {}) }],
        }));
        const list = (logs as Array<{ blockNumber: string; transactionHash: string; logIndex: string; topics: string[]; data: string }>);
        return head({
          address: a, fromBlock: Number(fromBlock), toBlock: Number(latest), count: list.length, truncated: list.length > 100,
          logs: list.slice(0, 100).map((l) => ({ block: Number(l.blockNumber), tx: l.transactionHash, logIndex: Number(l.logIndex), topics: l.topics, data: l.data.length > 514 ? `${l.data.slice(0, 514)}…` : l.data })),
        });
      }),
  ];
}

export const CHAIN_READS: Entry[] = CHAINS.flatMap(chainEntries);
