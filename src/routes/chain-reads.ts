// Plain blockchain reads on five EVM networks, generated from one table.
// These "boring chain reads" are the most-paid category in the Coinbase Bazaar (crawl of 13 Oct 2026).
import { createPublicClient, decodeFunctionResult, encodeFunctionData, fallback, formatEther, formatGwei, formatUnits, http, isHash, parseAbiItem, type AbiFunction, type Chain, type PublicClient } from "viem";
import { arbitrum, avalanche, base, berachain, celo, gnosis, hyperEvm, ink, linea, mainnet, mantle, optimism, polygon, scroll, sei, sonic, unichain, zksync } from "viem/chains";
import { PRICE, entry, num, opt, type Entry } from "../family";
import { HttpError, type Env } from "../lib/env";

const isAddress = (v: string): v is `0x${string}` => /^0x[0-9a-fA-F]{40}$/.test(v);
import { EDGE_RPCS, LOG_RPCS, erc20Abi, requestClient, rpcUrls } from "../lib/rpc";
import { tokenAddress } from "../lib/tickers";
import { fetchFile } from "../lib/fetch";

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

/**
 * More EVM networks for the same per-network reads (1.81.0, 26 Oct 2026). Every node, the USDC contract, an example
 * transaction, the NFT example and the block time were checked from the PC that day (release/train/chain-probe.mjs).
 * Free public nodes first, rate-limited drpc last. Left out: BNB Smart Chain (its free node refuses receipts older than
 * a few seconds as "archive" requests) and Blast (no USDC, only USDB). These networks are not in the multi-network
 * wallet and stablecoin tools, and the signed-in MCP servers leave them out (EXTRA_CHAIN_PATHS) to keep tools/list short.
 */
export const EXTRA_CHAINS: ChainDef[] = [
  { slug: "avax", name: "Avalanche", chain: avalanche, symbol: "AVAX", rpcs: ["https://avalanche-c-chain-rpc.publicnode.com", "https://api.avax.network/ext/bc/C/rpc", "https://avalanche.drpc.org"] },
  { slug: "gnosis", name: "Gnosis", chain: gnosis, symbol: "xDAI", rpcs: ["https://gnosis-rpc.publicnode.com", "https://rpc.gnosischain.com", "https://gnosis.drpc.org"] },
  { slug: "linea", name: "Linea", chain: linea, symbol: "ETH", rpcs: ["https://linea-rpc.publicnode.com", "https://rpc.linea.build", "https://linea.drpc.org"] },
  { slug: "zksync", name: "zkSync Era", chain: zksync, symbol: "ETH", rpcs: ["https://mainnet.era.zksync.io", "https://zksync.drpc.org"] },
  { slug: "scroll", name: "Scroll", chain: scroll, symbol: "ETH", rpcs: ["https://scroll-rpc.publicnode.com", "https://rpc.scroll.io", "https://scroll.drpc.org"] },
  { slug: "mantle", name: "Mantle", chain: mantle, symbol: "MNT", rpcs: ["https://mantle-rpc.publicnode.com", "https://rpc.mantle.xyz", "https://mantle.drpc.org"] },
  { slug: "celo", name: "Celo", chain: celo, symbol: "CELO", rpcs: ["https://celo-rpc.publicnode.com", "https://forno.celo.org", "https://celo.drpc.org"] },
  { slug: "sonic", name: "Sonic", chain: sonic, symbol: "S", rpcs: ["https://sonic-rpc.publicnode.com", "https://rpc.soniclabs.com", "https://sonic.drpc.org"] },
  { slug: "unichain", name: "Unichain", chain: unichain, symbol: "ETH", rpcs: ["https://unichain-rpc.publicnode.com", "https://mainnet.unichain.org", "https://unichain.drpc.org"] },
  { slug: "hyperevm", name: "HyperEVM", chain: hyperEvm, symbol: "HYPE", rpcs: ["https://rpc.hyperliquid.xyz/evm", "https://hyperliquid.drpc.org"] },
  { slug: "bera", name: "Berachain", chain: berachain, symbol: "BERA", rpcs: ["https://rpc.berachain.com", "https://berachain-rpc.publicnode.com", "https://berachain.drpc.org"] },
  { slug: "ink", name: "Ink", chain: ink, symbol: "ETH", rpcs: ["https://ink-rpc.publicnode.com", "https://ink.api.pocket.network", "https://rpc-gel.inkonchain.com", "https://rpc-qnd.inkonchain.com", "https://ink.drpc.org"] },
  { slug: "sei", name: "Sei", chain: sei, symbol: "SEI", rpcs: ["https://sei.drpc.org", "https://evm-rpc.sei-apis.com", "https://sei-evm-rpc.publicnode.com"] },
];

export function client(env: Env, c: ChainDef): PublicClient {
  const urls = c.slug in EDGE_RPCS ? rpcUrls(c.slug as keyof typeof EDGE_RPCS, env) : c.rpcs;
  // 5 s per node with one quick retry: a transient node error moves on instead of costing the whole request budget.
  const options = { timeout: 5_000, retryCount: 1, retryDelay: 100 };
  return requestClient(`${c.slug}|${urls.join("|")}`, () =>
    createPublicClient({ chain: c.chain, transport: fallback(urls.map((u) => http(u, options)), { rank: false }), batch: { multicall: true } }) as PublicClient);
}

const isNotFound = (e: unknown) => /could not be found|not found/i.test(String((e as Error)?.message ?? e));

/**
 * A lookup of past data (a transaction or receipt) that asks each node in turn when one says "not found". Pruned nodes answer
 * null for old transactions instead of failing, so the fallback transport never moves on: on 6 Nov 2026 /avax/tx and
 * /avax/receipt answered 404 for a 2024 transaction that two of the three Avalanche nodes still had.
 */
export async function historyRead<T>(env: Env, c: ChainDef, fn: (cl: PublicClient) => Promise<T>): Promise<T> {
  try {
    return await fn(client(env, c));
  } catch (e) {
    if (!isNotFound(e)) return rpc(() => Promise.reject(e));
  }
  const urls = c.slug in EDGE_RPCS ? rpcUrls(c.slug as keyof typeof EDGE_RPCS, env) : c.rpcs;
  for (const u of urls.slice(1)) {
    const one = requestClient(`${c.slug}|one|${u}`, () => createPublicClient({ chain: c.chain, transport: http(u, { timeout: 5_000, retryCount: 0 }) }) as PublicClient);
    try {
      return await fn(one);
    } catch {
      // the next node, or the 404 below
    }
  }
  throw new HttpError(404, "not found on this network");
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
/**
 * What 2,000 blocks cover per chain, from block times measured on 11 Nov 2026 over 20,000 blocks of each public node
 * (`NOMINAL_BLOCK_SECONDS` in src/lib/block-time.ts). Base went from 2 s to 0.2 s blocks around 5 Nov 2026; zkSync,
 * Linea, Polygon, Arbitrum and Sonic had also drifted from the 24 Oct table. Re-measure before trusting a row.
 */
const BLOCK_WINDOW: Record<string, string> = { base: "7 minutes", op: "67 minutes", polygon: "50 minutes", arb: "10 minutes", eth: "6.7 hours",
  avax: "32 minutes", gnosis: "2.8 hours", linea: "5.6 hours", zksync: "2.4 hours", scroll: "4.1 hours", mantle: "67 minutes", celo: "33 minutes",
  sonic: "53 minutes", unichain: "33 minutes", hyperevm: "33 minutes", bera: "67 minutes", ink: "33 minutes", sei: "16 minutes" };

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
/**
 * The example address of the transfer scans, per network: one that moves USDC all day, so the published example answers
 * with transfers. With EX_ADDR (a personal wallet) the example returned an empty list on 17 networks and on both wallet
 * scans (sweep of 11 Nov 2026), which is what a buyer's first try and a marketplace's test call saw. Uniswap's v4 pool
 * manager where the network has one, otherwise the busiest USDC pool in the newest 1,000 blocks that day; each returned
 * transfers through the tool itself. Recheck with the example sweep (business/agentic/release/train/sweep-shape.cjs).
 */
const EX_BUSY: Record<string, string> = {
  base: "0x498581ff718922c3f8e6a244956af099b2652b2b", eth: "0x000000000004444c5dc75cb358380d2e3de08a90", arb: "0x360e68faccca8ca495c1b759fd9eee466db9fb32",
  op: "0x9a13f98cb987694c9f086b1f5eb990eea8264ec3", polygon: "0x67366782805870060151383f4bbff9dab53e5cd6", avax: "0x06380c0e0912312b5150364b9dc4542ba0dbbc85",
  unichain: "0x1f98400000000000000000000000000000000004", gnosis: "0xb45373129b4220160b92bd2320869f44d48ecd01", linea: "0x90e8a5b881d211f418d77ba8978788b62544914b",
  scroll: "0x04566bf83399e4f750728d1ef57008aedda00e71", sonic: "0xcfd41df89d060b72ebdd50d65f9021e4457c477e", bera: "0x69fbaa80b560e425ff0ab0222335dc7f1eca7d90",
  sei: "0xe62fd4661c85e126744cc335e9bca8ae3d5d19d1", celo: "0x1a810e0b6c2dd5629afa2f0c898b9512c6f78846", mantle: "0xa875ac23d106394d1baaae5bc42b951268bc04e2",
  zksync: "0xdd6f2bc0f4f15329a9a712e46b2d988529df80e4", ink: "0xdfa03426d54e4f19ce789973731b82a2e7f5dc87",
};
const busyAddress = (slug: string) => EX_BUSY[slug] ?? EX_ADDR;
/**
 * The example contract of the event-log read where USDC is quiet (under one transfer in the default 50 blocks on
 * 11 Nov 2026, so the example answered with no logs): the network's wrapped native token.
 */
const EX_LOGS: Record<string, string> = {
  mantle: "0x78c1b0C915c4FAA5FffA6CAbf0219DA63d7f4cb8", ink: "0x4200000000000000000000000000000000000006",
  zksync: "0x5AEa5775959fBC2557Cc8789bC1bf90A239D9a91", celo: "0x471EcE3750Da237f93B8E339c536989b8978a438",
};
export const USDC: Record<string, `0x${string}`> = {
  base: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  eth: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  arb: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
  op: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
  polygon: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
  // USDC (or Circle-bridged USDC.e) per extra network, checked with symbol() and decimals() on 26 Oct 2026.
  avax: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E", gnosis: "0x2a22f9c3b484c3629090FeED35F17Ff8F88f76F0", linea: "0x176211869cA2b568f2A7D4EE941E073a821EE1ff",
  zksync: "0x1d17CBcF0D6D143135aE902365D2E5e2A16538D4", scroll: "0x06eFdBFf2a14a7c8E15944D1F4A48F9F95F663A4", mantle: "0x09Bc4E0D864854c6aFB6eB9A9cdF58aC190D0dF9",
  celo: "0xcebA9300f2b948710d2653dD7B07f33A8B32118C", sonic: "0x29219dd400f2Bf60E5a23d13Be72B486D4038894", unichain: "0x078D782b760474a361dDA0AF3839290b0EF57AD6",
  hyperevm: "0xb88339CB7199b77E23DB6E890353E22632Ba630f", bera: "0x549943e04f40284185054145c6E4e9568C1D3241", ink: "0xF1815bd50389c46847f0Bda824eC8da914045D14",
  sei: "0xe15fC38F6D8c56aF07bbCBe3BAf5708A2Bf42392",
};
const EX_TX: Record<string, string> = {
  base: "0x7d108fa131ed949c76d50caf2e7dfe25fc9903b9d276c40a0446d8afbdfe86b0",
  // Real finalized transactions (18 Oct 2026), so the listed examples work.
  eth: "0x9531467e03a57bbb5cd080439ac3b10c0cefed147282eb2ff709b02c897afcbf",
  arb: "0xf03682db039f7b1b72ddf4d17572738f142cf63ecb36c90afa570430ea9774c4",
  op: "0x721f3e9a996da49e2a8929bd2dd42e0f51344c11d7ca7bc3328fda349cdfae89",
  polygon: "0x23e86c30c46638b2e9798692fe89327a66aa8569a5d4a566125f655aeb8f80c7",
  // Successful transactions picked from recent blocks on 26 Oct 2026 (chain-probe.mjs).
  avax: "0x186570f66bdbd9565ee4f5fe7ef9fc110ec5417f5838c3e7e322967cd1a7d3e2", gnosis: "0x2b56c1dabbef9c9a07d0f94c6ff931c3e1f93cc398fa06296ff79770d4a4487f",
  linea: "0x638169f15ccab7f5491b46b3a883fa1aa5b5399ba5c56fa0110355d47a526a93", zksync: "0xc0003ffe194dfc1be40e1b1e6dfdf7609f89cc1393ff774dcd657f226558c5b3",
  scroll: "0x0176fb42be8ea0058d1ac56cb253f0df883ba4b564489e71b83fb7e27e912abd", mantle: "0xa93012fcae16a5b4b9d6f7c7469ed2838cd27eb387b28e7334678add918d174f",
  celo: "0xc6a38b860427aa5bd7f65f8a879a7d369e77b3767200c68cde4002014ad50444", sonic: "0xcc6a5594962b5211496391d0e1e9082f5060f218fad60f907a23e85a7b02bf85",
  unichain: "0xefe004f02c8907dc61735fe378eb5d2f3730d66cd8d4f385ef13076ad1eacdce", hyperevm: "0xdcf371c993312e793176e32cdfa78af2101b4aa54df88f8f0051c3fe463e374a",
  bera: "0x19db8c305092673a73e777b690469a0962145d4289a2608e8f62881c3a9ac18a", ink: "0x31e16195b9b6d9da5303988095e0dd5ee278693cb920de7d09fcee624c4f4733",
  sei: "0x51ee2bca2ed878b0f576071a0cd21c0f8f129d4de4a545c5a7b3511fa6d048bb",
};

function chainEntries(c: ChainDef): Entry[] {
  const p = (op: string) => `/${c.slug}/${op}`;
  const tags = (...t: string[]) => [c.slug === "eth" ? "ethereum" : c.name.toLowerCase().split(" ")[0], "blockchain", "evm", ...t];
  const head = (extra: Record<string, unknown>) => ({ chain: c.name, chainId: c.chain.id, ...extra });
  // Names lead with the chain as agents search ("base balance", "arbitrum transaction", "ethereum block number"; 5 Nov 2026).
  const lead = c.name.split(" ")[0];

  return [
    entry(p("balance"), `${lead} balance, native coin`,
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
      `ERC-20 token balance of a wallet on ${c.name} (USDC, USDT, WETH or any token, via balanceOf): raw amount, decimals, symbol and the human-readable amount, live from the token contract. Use to check stablecoin or token holdings before a transfer or trade; for the native coin use ${c.slug}_balance. Both inputs are 0x addresses (40 hex characters); no contract or a non-ERC-20 contract returns 422, uncharged.`,
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

    entry(p("token-info"), `${lead} token info, ERC-20`,
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

    // 25 Oct 2026: inside a payer tier a name that STARTS with the searched phrase wins 67% of ties (name-shape.mjs), so the
    // generic-phrase reads lead with the phrase and name the chain after it; chain-named searches ("base balance") keep
    // the chain first.
    entry(p("block"), `${lead} block number`,
      `Latest block number and block details on ${c.name}, or any block by decimal number: hash, timestamp, transaction count, gas used and limit, base fee in gwei and producer. Use for timestamps and confirmation counts; for current fees use ${c.slug}_gas. A block that does not exist yet returns 422, uncharged.`,
      tags("block", "chain-data"), { number: { type: "string", description: "Block number, or 'latest' (default)", example: "latest" } },
      head({ number: 123456789, hash: "0xabc…", timestamp: "2026-10-18T12:00:00.000Z", transactions: 154, gasUsed: "21000000", gasLimit: "30000000", baseFeeGwei: "0.012", miner: "0x…" }),
      async (env, q) => {
        const raw = q("number")?.trim();
        const cl = client(env, c);
        let blockNumber: bigint | undefined;
        // 11 Nov 2026 truth audit: hex numbers (as JSON-RPC and explorers write them) and "30,000,000" were refused.
        const n = raw?.toLowerCase().replace(/[,_\s]/g, "");
        if (n && n !== "latest") {
          if (/^\d{1,12}$/.test(n)) blockNumber = BigInt(n);
          else if (/^0x[0-9a-f]{1,10}$/.test(n)) blockNumber = BigInt(n);
          else throw new HttpError(400, "number must be a block number (decimal or 0x hex) or 'latest'");
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

    entry(p("tx"), `${lead} transaction`,
      `Look up ${/^[AEIOU]/.test(c.name) ? "an" : "a"} ${c.name} transaction by hash: sender, recipient, value in ${c.symbol}, nonce, gas limit, the 4-byte function selector and its block. Use to see what was sent or whether it exists; for success or failure and fees paid use ${c.slug}_receipt, for emitted events ${c.slug}_logs. Input is a 0x-prefixed 64-hex hash; an unknown hash returns 422, uncharged.`,
      tags("transaction", "chain-data"), { hash: { type: "string", description: "0x-prefixed transaction hash (64 hex characters)", required: true, example: EX_TX[c.slug] } },
      head({ hash: EX_TX[c.slug], from: "0x…", to: "0x…", value: "0.0", nonce: 12, gas: "65000", selector: "0xa9059cbb", inputBytes: 68, block: 123456789 }),
      async (env, q) => {
        const hash = txHash(q("hash"));
        const t = await historyRead(env, c, (cl) => cl.getTransaction({ hash }));
        return head({
          // Some nodes leave the nonce out of an OP-stack deposit transaction: null then, never a missing field.
          hash: t.hash, from: t.from, to: t.to, value: formatEther(t.value), nonce: t.nonce ?? null, gas: t.gas.toString(),
          selector: t.input.length >= 10 ? t.input.slice(0, 10) : null, inputBytes: (t.input.length - 2) / 2, block: t.blockNumber != null ? Number(t.blockNumber) : null,
        });
      }),

    entry(p("receipt"), `${c.name} transaction receipt`,
      `Transaction receipt on ${c.name} (eth_getTransactionReceipt): success or reverted, gas used, effective gas price, fee paid in ${c.symbol}, number of event logs and any contract created. Use to confirm a payment or call went through; for sender, value and calldata use ${c.slug}_tx. Input is a 0x-prefixed 64-hex hash; a pending or unknown hash returns 422, uncharged.`,
      tags("transaction", "receipt", "confirmation"), { hash: { type: "string", description: "0x-prefixed transaction hash (64 hex characters)", required: true, example: EX_TX[c.slug] } },
      head({ hash: EX_TX[c.slug], status: "success", block: 123456789, gasUsed: "52000", effectiveGasPriceGwei: "0.012", fee: "0.000000624", logs: 1, contractAddress: null }),
      async (env, q) => {
        const hash = txHash(q("hash"));
        const r = await historyRead(env, c, (cl) => cl.getTransactionReceipt({ hash }));
        return head({
          hash: r.transactionHash, status: r.status, block: Number(r.blockNumber), gasUsed: r.gasUsed.toString(),
          effectiveGasPriceGwei: formatGwei(r.effectiveGasPrice), fee: formatEther(r.gasUsed * r.effectiveGasPrice), logs: r.logs.length, contractAddress: r.contractAddress ?? null,
        });
      }),

    entry(p("nonce"), `${lead} nonce, account nonce`,
      `Read the transaction count (nonce) of a 0x address on ${c.name}, both confirmed and including pending transactions. Use to build the next transaction or to tell whether an address has ever sent anything; for its balance use ${c.slug}_balance. A malformed address is rejected with 400, uncharged.`,
      tags("nonce", "wallet"), { address: { type: "string", description: "0x address", required: true, example: EX_ADDR } },
      head({ address: EX_ADDR, nonce: 1204, pendingNonce: 1204, hasSent: true }),
      async (env, q) => {
        const a = address(q("address"));
        const cl = client(env, c);
        const [n, pending] = await rpc(() => Promise.all([cl.getTransactionCount({ address: a }), cl.getTransactionCount({ address: a, blockTag: "pending" })]));
        return head({ address: a, nonce: n, pendingNonce: pending, hasSent: n > 0 });
      }),

    entry(p("is-contract"), `${lead} is-contract check`,
      `Check whether a 0x address on ${c.name} is a smart contract or a plain wallet: bytecode size, whether it is an EIP-1167 minimal proxy and which implementation it points to, and whether it is a wallet that delegates to contract code (EIP-7702; delegatedTo names the code, isContract stays false). Use before sending funds or approving a spender; for a fuller risk verdict use check_counterparty. A malformed address is rejected with 400, uncharged.`,
      tags("contract", "security", "address"), { address: { type: "string", description: "0x address", required: true, example: USDC[c.slug] } },
      head({ address: USDC[c.slug], isContract: true, codeBytes: 1855, minimalProxy: false, implementation: null, delegatedTo: null }),
      async (env, q) => {
        const a = address(q("address"));
        const code = (await rpc(() => client(env, c).getCode({ address: a }))) ?? "0x";
        return head({ address: a, ...codeKind(code) });
      }),

    entry(p("logs"), `${lead} event logs`,
      `Recent contract event logs on ${c.name} (eth_getLogs): the events a contract emitted over the last N blocks (1-1,000, default 50), optionally filtered by topic0 (the 0x 32-byte event signature hash). Returns up to 100 logs with block, transaction hash and topics. Use to watch transfers or contract events; for one transaction's outcome use ${c.slug}_receipt.`,
      tags("logs", "events", "chain-data"), {
        address: { type: "string", description: "0x contract address", required: true, example: EX_LOGS[c.slug] ?? USDC[c.slug] },
        blocks: { type: "integer", description: "How many recent blocks to scan (1-1000, default 50)", example: 50 },
        topic0: { type: "string", description: "Optional 0x event signature hash to filter by", example: "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef" },
      },
      head({ address: EX_LOGS[c.slug] ?? USDC[c.slug], fromBlock: 123456739, toBlock: 123456789, count: 2, truncated: false, logs: [{ block: 123456780, tx: "0x…", logIndex: 3, topics: ["0xddf2…"], data: "0x…" }] }),
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

    entry(p("token-transfers"), `Token transfers, ${c.name}`,
      `List a wallet's recent transfers of one ERC-20 token (default USDC) on ${c.name}, in and out, over the last N blocks (1-2,000, default 1,000): direction, counterparty, amount and transaction, newest first, up to 50. Use to confirm a payment arrived or see what was sent; for the current balance use ${c.slug}_token_balance. Malformed addresses are rejected with 400, uncharged.`,
      tags("erc20", "transfers", "wallet", "history", "usdc", "payments"), {
        address: { type: "string", description: "0x wallet or contract address", required: true, example: busyAddress(c.slug) },
        token: { type: "string", description: "Token: a ticker such as USDT or WETH, or the 0x ERC-20 contract (default: USDC on this network)", example: USDC[c.slug] },
        blocks: { type: "integer", description: `How many recent blocks to scan (1-2000, default 1000; 2,000 blocks is about ${BLOCK_WINDOW[c.slug]} on ${c.name})`, example: 1000 },
      },
      head({ address: busyAddress(c.slug), fromBlock: 123456290, toBlock: 123456789, count: 1, truncated: false, transfers: [{ block: 123456780, tx: "0x…", token: USDC[c.slug], symbol: "USDC", direction: "in", counterparty: "0x…", amount: "2.5", raw: "2500000" }] }),
      async (env, q) => {
        const a = address(q("address"));
        const token = q("token") ? tokenInput(q("token"), c.slug) : USDC[c.slug];
        const span = BigInt(num(q, "blocks", { min: 1, max: 2000, fallback: 1000, integer: true }));
        const cl = client(env, c);
        // The newest block as the log nodes see it: the main client's node can be ahead of them, and the scan of its newest
        // blocks then answered "header not found" (404 to buyers: 7 of 14 Base calls on 23-25 Oct, and a listing payment).
        const logs = logsClient(env, c);
        const latest = await rpc(() => logs.getBlockNumber());
        const fromBlock = latest - span + 1n;
        const padded = `0x${a.slice(2).toLowerCase().padStart(64, "0")}`;
        type Log = { address: string; blockNumber: string; transactionHash: string; logIndex: string; topics: string[]; data: string };
        // Sent and received Transfer events of this one token, newest first in growing windows (recentLogs): public nodes
        // refuse or time out on a single 1,000-block eth_getLogs, which made this tool fail about one call in four.
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
    ...contractEntries(c),
  ];
}

// ---- NFTs, storage, proxies, calls, gas estimates and allowances (1.52.0) --------------------------------------------
// The single reads with the most one-call payers on the Bazaar (onesource.io, 23 Oct 2026: nft-metadata 163 payers,
// estimate-gas 150, allowance 144, code 137, call 133, nft-owner 100, proxy 86, storage 79) that we did not sell yet.

/** Uniswap V3 position manager: an ERC-721 contract on all five networks; position #1 exists on each (checked 23 Oct). */
const NFT_EXAMPLE: Record<string, `0x${string}`> = {
  base: "0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1",
  eth: "0xC36442b4a4522E871399CD717aBDD847Ab11FE88",
  arb: "0xC36442b4a4522E871399CD717aBDD847Ab11FE88",
  op: "0xC36442b4a4522E871399CD717aBDD847Ab11FE88",
  polygon: "0xC36442b4a4522E871399CD717aBDD847Ab11FE88",
  // Uniswap v3 position managers where token #1 exists (26 Oct 2026); networks without one get no NFT tools.
  avax: "0x655C406EBFa14EE2006250925e54ec43AD184f8B", zksync: "0x0616e5762c1E7Dc3723c50663dF10a162D690a86",
  celo: "0x3d79EdAaBC0EaB6F08ED885C05Fc0B014290D95A", unichain: "0x943e6e07a7E8E791dAFC44083e54041D743C46E9",
};
/** Uniswap's Permit2, deployed at one address on every network: a real spender for the allowance example. */
const PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3";
const DEAD = "0x000000000000000000000000000000000000dEaD";
const nftAbi = [
  { type: "function", name: "ownerOf", stateMutability: "view", inputs: [{ name: "tokenId", type: "uint256" }], outputs: [{ name: "", type: "address" }] },
  { type: "function", name: "tokenURI", stateMutability: "view", inputs: [{ name: "tokenId", type: "uint256" }], outputs: [{ name: "", type: "string" }] },
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "owner", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "name", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "string" }] },
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "string" }] },
] as const;
const allowanceAbi = [{ type: "function", name: "allowance", stateMutability: "view", inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], outputs: [{ name: "", type: "uint256" }] }] as const;
const beaconAbi = [{ type: "function", name: "implementation", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] }] as const;

/** Proxy storage slots: EIP-1967 (implementation, beacon, admin), EIP-1822 UUPS and the older OpenZeppelin (zos) layout. */
export const PROXY_SLOTS = {
  eip1967: "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc",
  beacon: "0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50",
  admin: "0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103",
  eip1822: "0xc5f16f0fcc639fa48a6947836d9850f504798523bf8c9a3a87d5876cf622bcf7",
  zos: "0x7050c9e0f4ca769c69bd3a8ef740bc37934f8e2c036e5a723fd8ee048ed3f8c3",
  zosAdmin: "0x10d6a54a4754c8869d6886b5f5d7fbfa5b4522237ea5c60d11bc4e7a1ff9390b",
} as const;

const tokenIdInput = (v: string | undefined) => {
  const t = v?.trim();
  if (!t) throw new HttpError(400, "tokenId is required: the NFT's token id, a whole number");
  if (/^\d{1,78}$/.test(t)) return BigInt(t);
  if (/^0x[0-9a-fA-F]{1,64}$/.test(t)) return BigInt(t);
  throw new HttpError(400, "tokenId must be a whole number (decimal, or 0x hex up to 32 bytes)");
};
/** A 32-byte word as an address when its top 12 bytes are zero and the rest is not; otherwise null. */
export const wordAddress = (word: string | undefined | null) => {
  const w = (word ?? "0x").toLowerCase().replace(/^0x/, "").padStart(64, "0");
  if (!/^0{24}[0-9a-f]{40}$/.test(w) || /^0{64}$/.test(w)) return null;
  return `0x${w.slice(24)}`;
};
/** Reverts and missing contracts are the caller's input (uncharged 4xx); node failures stay 502. */
async function contractRead<T>(fn: () => Promise<T>, revert: string): Promise<T> {
  try { return await fn(); }
  catch (e) {
    if (e instanceof HttpError) throw e;
    const msg = String((e as Error)?.message ?? e);
    if (/revert|execution reverted|returned no data|out of gas|invalid opcode/i.test(msg)) throw new HttpError(422, revert);
    return rpc(() => Promise.reject(e));
  }
}
const needCode = async (cl: PublicClient, a: `0x${string}`) => {
  const code = await rpc(() => cl.getCode({ address: a }));
  if (!code || code === "0x") throw new HttpError(404, "no contract at this address on this network");
  return code;
};
export const hexInput = (v: string | undefined, name: string, maxBytes: number, required = true) => {
  // Agents send calldata without the 0x prefix, with a 0X prefix or wrapped in whitespace (8 refused /polygon/call and 36
  // refused /arb/call in the 6 Nov 2026 /status); the meaning is unambiguous, so accept it. An odd digit count stays refused.
  const raw = v?.trim().replace(/\s+/g, "");
  const h = raw && /^(0x)?[0-9a-f]+$/i.test(raw) && !/^0x/i.test(raw) ? `0x${raw}` : raw?.replace(/^0X/, "0x");
  if (!h) { if (required) throw new HttpError(400, `${name} is required: 0x-prefixed hex`); return undefined; }
  if (!/^0x([0-9a-fA-F]{2})*$/.test(h)) throw new HttpError(400, `${name} must be 0x-prefixed hex with whole bytes`);
  if ((h.length - 2) / 2 > maxBytes) throw new HttpError(400, `${name} is longer than ${maxBytes} bytes`);
  return h.toLowerCase() as `0x${string}`;
};
/** `data` that is a function signature rather than calldata: a name and a parameter list, e.g. "balanceOf(address)". */
export const isSignature = (v: string | undefined) => !!v && /^\s*(function\s+)?[A-Za-z_$][\w$]*\s*\(/.test(v) && !/^\s*(0x)?[0-9a-f]+\s*$/i.test(v);
const jsonSafe = (v: unknown): unknown => typeof v === "bigint" ? v.toString() : Array.isArray(v) ? v.map(jsonSafe) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, jsonSafe(x)])) : v;
const STANDARD_RETURNS: Readonly<Record<string, string>> = {
  "totalSupply()": "uint256", "decimals()": "uint8", "symbol()": "string", "name()": "string", "balanceOf(address)": "uint256", "allowance(address,address)": "uint256",
  "owner()": "address", "ownerOf(uint256)": "address", "tokenURI(uint256)": "string", "paused()": "bool", "getOwner()": "address", "nonces(address)": "uint256",
};
/** One argument as sent (text) in the shape viem's encoder wants for its ABI type. Arrays and tuples come as JSON. */
function abiValue(raw: unknown, type: string): unknown {
  if (type.endsWith("]")) { if (!Array.isArray(raw)) throw new HttpError(400, `the ${type} argument must be a JSON array (send args as a JSON array)`); const inner = type.replace(/\[\d*\]$/, ""); return raw.map((x) => abiValue(x, inner)); }
  if (type.startsWith("tuple") || type.startsWith("(")) return raw;
  const s = typeof raw === "string" ? raw.trim().replace(/^["']|["']$/g, "") : raw;
  if (/^u?int\d*$/.test(type)) { try { return BigInt(String(s).replace(/[,_]/g, "")); } catch { throw new HttpError(400, `the ${type} argument must be a whole number, got "${String(s).slice(0, 40)}"`); } }
  if (type === "bool") return s === true || /^(true|1|yes)$/i.test(String(s));
  if (type === "address") return address(String(s), "an address argument").toLowerCase();
  return s;
}
/**
 * A contract call from a function signature (11 Nov 2026): agents cannot ABI-encode, so /polygon/call and /hyperevm/call
 * refused more paid calls ("the call reverted", "data must be 0x-prefixed hex") than they answered in the week before.
 * `balanceOf(address)` with `args` is encoded here; result types, from the signature's `returns (…)` or the `returns`
 * input, decode the answer. A signature the ABI parser rejects, or arguments that do not fit it, is a 400.
 */
export function callFromSignature(sig: string, argsRaw?: string, returnsRaw?: string) {
  const m = /^\s*(?:function\s+)?([A-Za-z_$][\w$]*)\s*\((.*?)\)\s*(?:(?:external|public|view|pure|payable|\s)*returns\s*\((.*)\))?\s*;?\s*$/s.exec(sig);
  if (!m) throw new HttpError(400, "data must be 0x calldata or a function signature such as balanceOf(address)");
  // The standard token and ownership getters decode without being told their result type.
  const standard = Object.hasOwn(STANDARD_RETURNS, `${m[1]}(${m[2].replace(/\s+/g, "")})`) ? STANDARD_RETURNS[`${m[1]}(${m[2].replace(/\s+/g, "")})`] : "";
  const outputs = (m[3] ?? returnsRaw ?? standard).trim().replace(/^\(|\)$/g, "");
  let item: AbiFunction;
  try { item = parseAbiItem(`function ${m[1]}(${m[2]}) view${outputs ? ` returns (${outputs})` : ""}`) as AbiFunction; }
  catch { throw new HttpError(400, `could not read the function signature ${m[1]}(${m[2].slice(0, 80)})${outputs ? ` returns (${outputs.slice(0, 60)})` : ""}; use Solidity types, for example balanceOf(address) returns (uint256)`); }
  const text = argsRaw?.trim() ?? "";
  let sent: unknown[];
  if (text.startsWith("[")) { try { sent = JSON.parse(text) as unknown[]; } catch { throw new HttpError(400, "args is not a valid JSON array"); } if (!Array.isArray(sent)) throw new HttpError(400, "args must be a JSON array or a comma-separated list"); }
  else sent = text ? text.split(",").map((s) => s.trim()) : [];
  if (sent.length !== item.inputs.length) throw new HttpError(400, `${item.name} takes ${item.inputs.length} argument(s) (${item.inputs.map((i) => i.type).join(", ") || "none"}); args has ${sent.length}`);
  let data: `0x${string}`;
  try { data = encodeFunctionData({ abi: [item], functionName: item.name, args: sent.map((v, i) => abiValue(v, item.inputs[i].type)) }); }
  catch (e) { if (e instanceof HttpError) throw e; throw new HttpError(400, `the arguments do not fit ${item.name}(${item.inputs.map((i) => i.type).join(", ")}): ${String((e as { shortMessage?: string })?.shortMessage ?? (e as Error)?.message ?? e).split("\n")[0].slice(0, 160)}`); }
  return {
    data, signature: `${item.name}(${item.inputs.map((i) => i.type).join(",")})`,
    /** `decoded` when result types are known: one value, or a list for several. Undecodable data says so and keeps the raw result. */
    decode(result: `0x${string}`): { decoded?: unknown; decodeNote?: string } {
      if (!item.outputs.length) return { decodeNote: "add returns (for example returns=uint256) to have the result decoded" };
      try { return { decoded: jsonSafe(decodeFunctionResult({ abi: [item], functionName: item.name, data: result })) }; }
      catch { return { decodeNote: `the result does not decode as (${item.outputs.map((o) => o.type).join(", ")})` }; }
    },
  };
}
/** Shortens long strings inside NFT metadata (on-chain SVG images run to tens of kilobytes). */
function trimLong(v: unknown, depth = 0): unknown {
  if (typeof v === "string") return v.length > 1_000 ? `${v.slice(0, 120)}… (${v.length} characters, shortened)` : v;
  if (depth > 4 || v === null || typeof v !== "object") return v;
  if (Array.isArray(v)) return v.slice(0, 50).map((x) => trimLong(x, depth + 1));
  return Object.fromEntries(Object.entries(v as Record<string, unknown>).slice(0, 50).map(([k, x]) => [k, trimLong(x, depth + 1)]));
}
const IPFS_GATEWAY = "https://ipfs.io/ipfs/";
/** Reads tokenURI metadata: data: URIs locally, http(s) and ipfs:// through the public-URL fetcher (SSRF checks, 8 s). */
export async function readMetadata(uri: string): Promise<{ metadata: unknown; source: string; error: string | null }> {
  const data = /^data:([^,;]*)(;base64)?,(.*)$/s.exec(uri);
  try {
    if (data) {
      const text = data[2] ? new TextDecoder().decode(Uint8Array.from(atob(data[3]), (ch) => ch.charCodeAt(0))) : decodeURIComponent(data[3]);
      return { metadata: trimLong(JSON.parse(text)), source: "data-uri", error: null };
    }
    const url = /^ipfs:\/\//i.test(uri) ? `${IPFS_GATEWAY}${uri.replace(/^ipfs:\/\/(ipfs\/)?/i, "")}` : uri;
    if (!/^https?:\/\//i.test(url)) return { metadata: null, source: "unsupported", error: "the token URI is not a data:, http(s) or ipfs:// address" };
    const file = await fetchFile(url, /json|text|octet-stream|^$/i, 256 * 1024, "metadata", { cacheSeconds: 600 });
    return { metadata: trimLong(JSON.parse(new TextDecoder().decode(file.bytes))), source: url, error: null };
  } catch (e) {
    const why = e instanceof HttpError ? e.message : e instanceof SyntaxError ? "the metadata is not valid JSON" : "the metadata could not be fetched";
    return { metadata: null, source: data ? "data-uri" : uri, error: why };
  }
}

// What the code at an address says about it. Since EIP-7702 (Ethereum's Pectra upgrade, May 2025) a plain wallet can
// carry 23 bytes of code, 0xef0100 followed by the address whose code it runs. It is still a wallet with a private key,
// so it must not read as a contract: found on 11 Nov 2026, when the example wallet of /pack/wallet-profile read
// "isContract: true" (an independent node returned 0xef0100… for it on Ethereum and Base).
export function codeKind(code: string): { isContract: boolean; codeBytes: number; minimalProxy: boolean; implementation: string | null; delegatedTo: string | null } {
  const hex = /^0x[0-9a-f]*$/i.test(code) ? code.toLowerCase() : "0x";
  const bytes = (hex.length - 2) / 2;
  const delegated = /^0xef0100([0-9a-f]{40})$/.exec(hex);
  const m = /^0x363d3d373d3d3d363d73([0-9a-f]{40})5af43d82803e903d91602b57fd5bf3$/.exec(hex);
  return { isContract: bytes > 0 && !delegated, codeBytes: bytes, minimalProxy: !!m, implementation: m ? `0x${m[1]}` : null, delegatedTo: delegated ? `0x${delegated[1]}` : null };
}

function contractEntries(c: ChainDef): Entry[] {
  const p = (op: string) => `/${c.slug}/${op}`;
  const short = c.name.split(" ")[0];
  const tags = (...t: string[]) => [c.slug === "eth" ? "ethereum" : c.name.toLowerCase().split(" ")[0], "blockchain", "evm", ...t];
  const head = (extra: Record<string, unknown>) => ({ chain: c.name, chainId: c.chain.id, ...extra });
  const nft = NFT_EXAMPLE[c.slug];
  const list: Entry[] = [
    entry(p("nft-owner"), `${short} NFT owner`,
      `Owner of an NFT on ${c.name}: the wallet that holds one ERC-721 token id right now (ownerOf), plus the collection's name and symbol. Use to verify who holds an NFT before a trade, a mint gate or an airdrop; for how many a wallet holds use ${c.slug}_nft_balance, for the token's metadata ${c.slug}_nft_metadata. A missing contract or a token that does not exist is 422, uncharged.`,
      tags("nft", "nft-owner", "erc721", "owner"), {
        contract: { type: "string", description: "0x ERC-721 collection contract address", required: true, example: nft },
        tokenId: { type: "string", description: "Token id, a whole number", required: true, example: "1" },
      },
      head({ contract: nft, tokenId: "1", owner: "0x69e67aad5495a48c4ef3f770d93a99935e1dc90d", name: "Uniswap V3 Positions NFT-V1", symbol: "UNI-V3-POS" }),
      async (env, q) => {
        const contract = address(q("contract"), "contract");
        const id = tokenIdInput(q("tokenId"));
        const cl = client(env, c);
        await needCode(cl, contract);
        const [owner, name, symbol] = await Promise.all([
          contractRead(() => cl.readContract({ address: contract, abi: nftAbi, functionName: "ownerOf", args: [id] }), "this token id does not exist in this collection, or the contract is not ERC-721"),
          cl.readContract({ address: contract, abi: nftAbi, functionName: "name" }).catch(() => null),
          cl.readContract({ address: contract, abi: nftAbi, functionName: "symbol" }).catch(() => null),
        ]);
        return head({ contract, tokenId: id.toString(), owner: owner.toLowerCase(), name, symbol });
      }),

    entry(p("nft-balance"), `NFT balance, ${short}`,
      `How many NFTs of one ERC-721 collection a wallet holds on ${c.name} (balanceOf), with the collection's name and symbol. Use to check a holder before a token-gated action or to see whether a wallet still holds a collection; for who holds one token id use ${c.slug}_nft_owner. Both inputs are 0x addresses; a missing contract or one that is not ERC-721 is 422, uncharged.`,
      tags("nft", "erc721", "balance", "wallet"), {
        contract: { type: "string", description: "0x ERC-721 collection contract address", required: true, example: nft },
        address: { type: "string", description: "0x wallet address", required: true, example: EX_ADDR },
      },
      head({ contract: nft, address: EX_ADDR, balance: "2", name: "Uniswap V3 Positions NFT-V1", symbol: "UNI-V3-POS" }),
      async (env, q) => {
        const contract = address(q("contract"), "contract");
        const a = address(q("address"));
        const cl = client(env, c);
        await needCode(cl, contract);
        const [balance, name, symbol] = await Promise.all([
          contractRead(() => cl.readContract({ address: contract, abi: nftAbi, functionName: "balanceOf", args: [a] }), "this contract does not answer ERC-721 balanceOf"),
          cl.readContract({ address: contract, abi: nftAbi, functionName: "name" }).catch(() => null),
          cl.readContract({ address: contract, abi: nftAbi, functionName: "symbol" }).catch(() => null),
        ]);
        return head({ contract, address: a, balance: balance.toString(), name, symbol });
      }),

    entry(p("nft-metadata"), `NFT metadata, ${short}`,
      `NFT metadata on ${c.name}: the token URI of one ERC-721 token id (tokenURI) and the JSON it points to (name, description, image, attributes), read from data: URIs, https or ipfs:// (through ipfs.io). Strings over 1,000 characters, such as on-chain SVG images, are shortened. Use to show or check what an NFT is; for its owner use ${c.slug}_nft_owner. A token that does not exist is 422, uncharged; unreachable metadata is reported in metadataError.`,
      tags("nft", "nft-metadata", "erc721", "metadata"), {
        contract: { type: "string", description: "0x ERC-721 collection contract address", required: true, example: nft },
        tokenId: { type: "string", description: "Token id, a whole number", required: true, example: "1" },
      },
      head({ contract: nft, tokenId: "1", name: "Uniswap V3 Positions NFT-V1", symbol: "UNI-V3-POS", tokenUri: "data:application/json;base64,eyJuYW1lIjo… (14121 characters, shortened)", metadata: { name: "Uniswap - 0.3% - USDC/WETH - 1500<>2000", description: "This NFT represents a liquidity position…", image: "data:image/svg+xml;base64,… (shortened)" }, metadataSource: "data-uri", metadataError: null }),
      async (env, q) => {
        const contract = address(q("contract"), "contract");
        const id = tokenIdInput(q("tokenId"));
        const cl = client(env, c);
        await needCode(cl, contract);
        const [uri, name, symbol] = await Promise.all([
          contractRead(() => cl.readContract({ address: contract, abi: nftAbi, functionName: "tokenURI", args: [id] }), "this token id does not exist in this collection, or the contract has no ERC-721 tokenURI"),
          cl.readContract({ address: contract, abi: nftAbi, functionName: "name" }).catch(() => null),
          cl.readContract({ address: contract, abi: nftAbi, functionName: "symbol" }).catch(() => null),
        ]);
        const meta = await readMetadata(uri);
        return head({ contract, tokenId: id.toString(), name, symbol, tokenUri: trimLong(uri), metadata: meta.metadata, metadataSource: meta.source, metadataError: meta.error });
      }),

    entry(p("storage"), `Storage slot read, ${short}`,
      `Read one raw storage slot of a contract on ${c.name} (eth_getStorageAt): the 32-byte word, as a number and, when it holds one, as an address. Slot is a decimal index or a 0x 32-byte key (mapping and proxy slots). Use to inspect contract state that has no getter, owners or implementation pointers; for proxies use ${c.slug}_proxy. A malformed address or slot is rejected with 400, uncharged.`,
      tags("storage", "contract", "chain-data"), {
        address: { type: "string", description: "0x contract address", required: true, example: USDC[c.slug] },
        slot: { type: "string", description: "Slot: a decimal index (0, 1, 2…) or a 0x 32-byte key", example: PROXY_SLOTS.zos },
      },
      head({ address: USDC[c.slug], slot: PROXY_SLOTS.zos, value: "0x0000000000000000000000002ce6311ddae708829bc0784c967b7d77d19fd779", asNumber: "251560…", asAddress: "0x2ce6311ddae708829bc0784c967b7d77d19fd779", block: 123456789 }),
      async (env, q) => {
        const a = address(q("address"));
        const raw = q("slot")?.trim() || "0";
        let slot: `0x${string}`;
        if (/^\d{1,78}$/.test(raw)) slot = `0x${BigInt(raw).toString(16).padStart(64, "0")}`;
        else if (/^0x[0-9a-fA-F]{1,64}$/.test(raw)) slot = `0x${raw.slice(2).toLowerCase().padStart(64, "0")}`;
        else throw new HttpError(400, "slot must be a decimal index or a 0x hex key of up to 32 bytes");
        const cl = client(env, c);
        const [value, block] = await rpc(() => Promise.all([cl.getStorageAt({ address: a, slot }), cl.getBlockNumber()]));
        const v = (value ?? "0x").toLowerCase().replace(/^0x$/, `0x${"0".repeat(64)}`);
        return head({ address: a, slot, value: v, asNumber: BigInt(v).toString(), asAddress: wordAddress(v), block: Number(block) });
      }),

    entry(p("proxy"), `Proxy implementation, ${short}`,
      `Find the implementation behind a proxy contract on ${c.name}: reads the EIP-1967 implementation, beacon and admin slots, EIP-1822 (UUPS), the older OpenZeppelin layout and EIP-1167 minimal-proxy bytecode, and names the kind found. Use before trusting or decoding a contract whose code can be swapped by its admin; for a fuller risk verdict use contract_risk. A malformed address is 400; an address without code is 422, both uncharged.`,
      tags("proxy", "contract", "security", "upgradeable"), { address: { type: "string", description: "0x contract address", required: true, example: USDC[c.slug] } },
      head({ address: USDC[c.slug], isProxy: true, kind: "openzeppelin-legacy", implementation: "0x2ce6311ddae708829bc0784c967b7d77d19fd779", admin: "0x…", beacon: null, upgradeable: true }),
      async (env, q) => {
        const a = address(q("address"));
        const cl = client(env, c);
        const code = await needCode(cl, a);
        const minimal = /^0x363d3d373d3d3d363d73([0-9a-f]{40})5af43d82803e903d91602b57fd5bf3$/i.exec(code);
        if (minimal) return head({ address: a, isProxy: true, kind: "eip1167-minimal", implementation: `0x${minimal[1].toLowerCase()}`, admin: null, beacon: null, upgradeable: false });
        const words = await rpc(() => Promise.all(Object.values(PROXY_SLOTS).map((slot) => cl.getStorageAt({ address: a, slot }))));
        const [impl, beacon, admin, uups, zos, zosAdmin] = words.map(wordAddress);
        let implementation = impl ?? uups ?? zos;
        let beaconImpl: string | null = null;
        if (!implementation && beacon) {
          beaconImpl = await cl.readContract({ address: beacon as `0x${string}`, abi: beaconAbi, functionName: "implementation" }).then((x) => x.toLowerCase()).catch(() => null);
          implementation = beaconImpl;
        }
        const kind = impl ? "eip1967" : beacon ? "eip1967-beacon" : uups ? "eip1822-uups" : zos ? "openzeppelin-legacy" : "none";
        return head({ address: a, isProxy: kind !== "none", kind, implementation: implementation ?? null, admin: admin ?? zosAdmin ?? null, beacon: beacon ?? null, upgradeable: kind !== "none" });
      }),

    entry(p("call"), `Eth call, ${short} contract call`.length <= 32 ? `Eth call, ${short} contract call` : `Eth call, contract call, ${short}`.length <= 32 ? `Eth call, contract call, ${short}` : `Eth call, ${short}`,
      `Read-only contract call on ${c.name} (eth_call) at the latest block, without a transaction or gas: send ABI-encoded calldata, or a function signature such as balanceOf(address) with args and the call is encoded and its result decoded for you. Use to read any view function that has no dedicated tool (the example reads USDC totalSupply). Calldata up to 8 KB; a call that reverts is 422 with the reason, uncharged.`,
      tags("eth-call", "contract", "read", "chain-data"), {
        to: { type: "string", description: "0x contract address to call", required: true, example: USDC[c.slug] },
        data: { type: "string", description: "0x ABI-encoded calldata (4-byte selector plus arguments), or a function signature: totalSupply(), balanceOf(address), or with its result types, balanceOf(address) returns (uint256)", required: true, example: "0x18160ddd" },
        args: { type: "string", description: "Arguments for a function signature in data: comma separated, or a JSON array for arrays and tuples", example: EX_ADDR },
        returns: { type: "string", description: "Result types to decode when data is a signature without them, for example uint256 or address,uint8", example: "uint256" },
        from: { type: "string", description: "Optional 0x sender address for calls that check msg.sender", example: EX_ADDR },
      },
      head({ to: USDC[c.slug], data: "0x18160ddd", result: "0x00000000000000000000000000000000000000000000000000038d7ea4c68000", resultBytes: 32, block: 123456789 }),
      async (env, q) => {
        const to = address(q("to"), "to").toLowerCase() as `0x${string}`;
        const named = isSignature(q("data")) ? callFromSignature(q("data")!, q("args"), q("returns")) : null;
        const data = named?.data ?? hexInput(q("data"), "data", 8_192)!;
        const from = q("from")?.trim() ? address(q("from"), "from").toLowerCase() as `0x${string}` : undefined;
        const cl = client(env, c);
        const block = await rpc(() => cl.getBlockNumber());
        const res = await contractRead(() => cl.call({ to, data, account: from, blockNumber: block }), "the call reverted");
        const result = (res.data ?? "0x").toLowerCase() as `0x${string}`;
        return head({ to, data, from: from ?? null, result, resultBytes: (result.length - 2) / 2, block: Number(block), ...(named ? { function: named.signature, ...named.decode(result) } : {}) });
      }),

    entry(p("estimate-gas"), `Estimate gas, ${short}`,
      `Estimate the gas a transaction would use on ${c.name} (eth_estimateGas) and what it would cost at the current gas price, in gas units, gwei and ${c.symbol}. Give to, plus value in ${c.symbol} and calldata for a contract call, and the sender when the call depends on it. Use before sending a transaction or to price a batch; for the gas price alone use ${c.slug}_gas. A transaction that would revert is 422 with the reason, uncharged.`,
      tags("gas", "estimate-gas", "fees", "transaction"), {
        to: { type: "string", description: "0x recipient or contract address", required: true, example: DEAD },
        from: { type: "string", description: "0x sender address (default: an empty address)", example: EX_ADDR },
        value: { type: "string", description: `Amount of ${c.symbol} to send, in ${c.symbol} (default 0)`, example: "0" },
        data: { type: "string", description: "Optional 0x calldata for a contract call", example: "0x" },
      },
      head({ to: DEAD, from: EX_ADDR, value: "0", gas: "21000", gasPriceGwei: "0.012", cost: "0.000000252", symbol: c.symbol, block: 123456789 }),
      async (env, q) => {
        const to = address(q("to"), "to").toLowerCase() as `0x${string}`;
        const from = q("from")?.trim() ? address(q("from"), "from").toLowerCase() as `0x${string}` : undefined;
        const rawValue = q("value")?.trim() || "0";
        if (!/^\d{1,12}(\.\d{1,18})?$/.test(rawValue)) throw new HttpError(400, `value must be an amount of ${c.symbol}, such as 0.01`);
        const [whole, frac = ""] = rawValue.split(".");
        const wei = BigInt(whole) * 10n ** 18n + BigInt((frac + "0".repeat(18)).slice(0, 18) || "0");
        const data = hexInput(q("data"), "data", 8_192, false);
        const cl = client(env, c);
        const [gas, price, block] = await Promise.all([
          contractRead(() => cl.estimateGas({ to, account: from, value: wei, data: data && data !== "0x" ? data : undefined }), "the transaction would revert or the sender cannot pay for it"),
          rpc(() => cl.getGasPrice()),
          rpc(() => cl.getBlockNumber()),
        ]);
        return head({ to, from: from ?? null, value: rawValue, gas: gas.toString(), gasPriceGwei: formatGwei(price), cost: formatEther(gas * price), symbol: c.symbol, block: Number(block) });
      }),

    // 11 Nov 2026: was "<Chain> gas history, gas price". The Bazaar search for "base gas" then put /base/gas-history
    // (2 payers) above /base-gas (5 payers), and the paid Service Finder keeps at most two listings per seller per job, so
    // the sibling took the slot of the listing with the payers. The current price is <chain>_gas; this one is history only.
    entry(p("gas-history"), `${short} gas history, fee history`,
      `Fee history on ${c.name} (eth_feeHistory): base fee in gwei for each of the last N blocks (5-100, default 20), how full each block was, and the 10th, 50th and 90th percentile priority fees, with the low, average and high base fee over the window. Use to judge whether fees are rising, pick a priority fee or time a transaction; for the current price alone use ${c.slug}_gas.`,
      tags("gas", "gas-history", "fees", "fee-history"), {
        blocks: { type: "integer", description: "How many recent blocks, 5-100 (default 20)", example: 20 },
      },
      head({ fromBlock: 123456770, toBlock: 123456789, blocks: 20, baseFeeGwei: { low: 0.011, average: 0.012, high: 0.014, latest: 0.012, next: 0.012 }, priorityFeeGwei: { p10: 0.0005, p50: 0.001, p90: 0.01 }, history: [{ block: 123456789, baseFeeGwei: 0.012, gasUsedRatio: 0.48, priorityFeeGwei: [0.0005, 0.001, 0.01] }] }),
      async (env, q) => {
        const blocks = num(q, "blocks", { min: 5, max: 100, fallback: 20, integer: true });
        const h = await rpc(() => client(env, c).getFeeHistory({ blockCount: blocks, rewardPercentiles: [10, 50, 90] }));
        const gwei = (v: bigint) => Number(formatGwei(v));
        const base = h.baseFeePerGas.slice(0, -1).map(gwei);
        const first = Number(h.oldestBlock);
        const rewards = (h.reward ?? []).map((r) => r.map(gwei));
        const pct = (i: number) => { const xs = rewards.map((r) => r[i]).filter((x) => Number.isFinite(x)).sort((a, b) => a - b); return xs.length ? xs[Math.floor(xs.length / 2)] : null; };
        const avg = base.length ? base.reduce((s, x) => s + x, 0) / base.length : null;
        return head({
          fromBlock: first, toBlock: first + base.length - 1, blocks: base.length,
          baseFeeGwei: { low: base.length ? Math.min(...base) : null, average: avg === null ? null : Number(avg.toPrecision(6)), high: base.length ? Math.max(...base) : null, latest: base.at(-1) ?? null, next: h.baseFeePerGas.length ? gwei(h.baseFeePerGas.at(-1)!) : null },
          priorityFeeGwei: { p10: pct(0), p50: pct(1), p90: pct(2) },
          history: base.map((b, i) => ({ block: first + i, baseFeeGwei: b, gasUsedRatio: Math.round((h.gasUsedRatio[i] ?? 0) * 1000) / 1000, priorityFeeGwei: rewards[i] ?? null })),
        });
      }),
  ];
  // Base already sells this read as /base-allowance (the published chain client promises that path and price).
  if (c.slug !== "base") list.push(
    entry(p("allowance"), `Token allowance, ${short} ERC-20`.length <= 32 ? `Token allowance, ${short} ERC-20` : `Token allowance, ${short}`,
      `ERC-20 token allowance on ${c.name}: how much a spender may move from an owner's wallet (allowance), raw and in token units, and whether the approval is unlimited. Use to check an approval before a swap or to audit risky open approvals; for the owner's balance use ${c.slug}_token_balance. Token is a ticker (USDC, USDT, WETH…) or a 0x contract; a missing contract or a non-ERC-20 one is 422, uncharged.`,
      tags("erc20", "allowance", "approval", "token"), {
        token: { type: "string", description: "Token: a ticker such as USDC or WETH, or the 0x ERC-20 contract address", required: true, example: USDC[c.slug] },
        owner: { type: "string", description: "0x wallet that gave the approval", required: true, example: EX_ADDR },
        spender: { type: "string", description: "0x contract or wallet allowed to spend (the example is Uniswap Permit2)", required: true, example: PERMIT2 },
      },
      head({ token: USDC[c.slug], symbol: "USDC", decimals: 6, owner: EX_ADDR, spender: PERMIT2, raw: "0", allowance: "0", unlimited: false }),
      async (env, q) => {
        const token = tokenInput(q("token"), c.slug);
        const owner = address(q("owner"), "owner");
        const spender = address(q("spender"), "spender");
        const cl = client(env, c);
        await needCode(cl, token);
        const [raw, decimals, symbol] = await Promise.all([
          contractRead(() => cl.readContract({ address: token, abi: allowanceAbi, functionName: "allowance", args: [owner, spender] }), "this contract does not behave like an ERC-20 token"),
          contractRead(() => cl.readContract({ address: token, abi: erc20Abi, functionName: "decimals" }), "this contract does not behave like an ERC-20 token"),
          cl.readContract({ address: token, abi: erc20Abi, functionName: "symbol" }).catch(() => null),
        ]);
        return head({ token, symbol, decimals: Number(decimals), owner, spender, raw: raw.toString(), allowance: formatUnits(raw, Number(decimals)), unlimited: raw >= 2n ** 255n });
      }));
  // No verified NFT example on this network: leave the three NFT reads out rather than list a failing example.
  return nft ? list : list.filter((e) => !/\/nft-/.test(e.endpoint.path));
}

const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef" as const;

type RawLog = { blockNumber: string; transactionHash: string; logIndex: string; topics: string[]; data: string };

/**
 * eth_getLogs over the last `span` blocks, newest first, in windows of 10, 40, 160… blocks, stopping once `want` logs
 * are in. One busy contract (USDC on Base: ~270 logs a block) fills them from the first small window instead of
 * pulling megabytes over the whole span; a quiet one covers 1,000 blocks in five calls. Small windows also suit nodes
 * that cap the range. Returns the logs oldest first and the first block actually scanned.
 */
export async function recentLogs(cl: PublicClient, filter: { address?: `0x${string}`; topics?: (`0x${string}` | `0x${string}`[] | null)[] }, latest: bigint, span: bigint, want: number, window: { first?: bigint; max?: bigint } = {}) {
  const floor = latest - span + 1n;
  let logs: RawLog[] = [];
  let to = latest;
  let size = window.first ?? 10n;
  const maxSize = window.max;
  let lagRetries = 0;
  while (to >= floor) {
    const from = to - size + 1n > floor ? to - size + 1n : floor;
    let chunk: RawLog[];
    try {
      chunk = await rpc(() => cl.request({ method: "eth_getLogs", params: [{ ...filter, fromBlock: `0x${from.toString(16)}`, toBlock: `0x${to.toString(16)}` }] })) as RawLog[];
    } catch (e) {
      // A log node a few blocks behind the node that gave `latest` answers "header not found" for the newest range, which
      // rpc() reads as 404. Production, 25 Oct 2026: every Base scan over ~200 blocks failed this way. Step back past the
      // newest blocks (up to 3 times, 5 blocks each) instead of failing the call.
      if (e instanceof HttpError && e.status === 404 && logs.length === 0 && lagRetries < 5 && to - 10n >= floor) { lagRetries++; to -= 10n; continue; }
      // An older range a node cannot serve after some logs are in (production 5 Nov 2026: /token/buyers answered 404 on
      // every third call): return what was read, marked partial, rather than nothing.
      if (e instanceof HttpError && logs.length > 0) return { logs, fromBlock: to + 1n, complete: false };
      throw e;
    }
    logs = chunk.concat(logs);
    if (logs.length >= want || from === floor) return { logs, fromBlock: from, complete: from === floor };
    to = from - 1n;
    size *= 4n;
    if (maxSize !== undefined && size > maxSize) size = maxSize;
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

/**
 * Who a wallet deals with (5 Nov 2026). The wallet-profiler cluster had the most real payers among tools we lacked:
 * Nansen's related-wallets 54 payers, counterparties, PnL and transactions 40-62 each, at $0.01-0.05. Built from public
 * ERC-20 Transfer logs only (no outside data licence): every token the wallet sent or received over recent blocks,
 * grouped by the other side.
 */
const RELATED_CHAINS = ["base", "eth", "arb", "op", "polygon"] as const;
const ZERO_ADDR = "0x0000000000000000000000000000000000000000";
const WALLET_SCAN_PARAMS = {
  address: { type: "string", description: "0x wallet or contract address", required: true, example: EX_BUSY.base },
  chain: { type: "string", description: "Network: base (default), eth, arb, op or polygon", enum: [...RELATED_CHAINS], example: "base" },
  blocks: { type: "integer", description: "How many recent blocks to scan (100-10000, default 2000; Base makes a block every 0.2 s, so 2,000 is about 7 minutes there, 67 minutes on Optimism; Ethereum every 12 s)", example: 2000 },
} as const;

/**
 * Nodes that answer eth_getLogs with no contract address over 1,000 blocks (probed 5 Nov 2026). publicnode refuses
 * address-less filters, BlastAPI caps at 10 blocks, Nodies and 1rpc at 50, drpc's free plan refuses them.
 */
const TOPIC_LOG_RPCS: Record<(typeof RELATED_CHAINS)[number], readonly string[]> = {
  // drpc, 1rpc and Nodies take address-less filters up to 25-50 blocks (5 Nov 2026): enough for /dex/trending's slices.
  base: ["https://base.gateway.tenderly.co", "https://base.drpc.org", "https://1rpc.io/base", "https://base-pokt.nodies.app"],
  eth: ["https://mainnet.gateway.tenderly.co", "https://rpc.mevblocker.io"],
  arb: ["https://arb1.arbitrum.io/rpc", "https://arbitrum.gateway.tenderly.co"],
  op: ["https://mainnet.optimism.io", "https://optimism.gateway.tenderly.co"],
  polygon: ["https://polygon.gateway.tenderly.co", "https://rpc-mainnet.matic.quiknode.pro"],
};
export function topicLogsClient(c: ChainDef): PublicClient {
  const urls = TOPIC_LOG_RPCS[c.slug as (typeof RELATED_CHAINS)[number]];
  const options = { timeout: 6_000, retryCount: 1, retryDelay: 150 };
  return requestClient(`topiclogs|${c.slug}`, () =>
    createPublicClient({ chain: c.chain, transport: fallback(urls.map((u) => http(u, options)), { rank: false }) }) as PublicClient);
}

/** Every ERC-20 Transfer log a wallet sent or received over recent blocks (any token), newest first, `want` each way. */
async function walletScan(env: Env, q: (name: string) => string | undefined, want: number) {
  const a = address(q("address"));
  const slug = q("chain")?.trim().toLowerCase() || "base";
  const c = CHAINS.find((x) => x.slug === slug && (RELATED_CHAINS as readonly string[]).includes(x.slug));
  if (!c) throw new HttpError(400, `chain must be one of: ${RELATED_CHAINS.join(", ")}`);
  const span = BigInt(num(q, "blocks", { min: 100, max: 10000, fallback: 2000, integer: true }));
  const cl = client(env, c);
  const padded = `0x${a.slice(2).toLowerCase().padStart(64, "0")}` as `0x${string}`;
  // One wallet's own transfers are sparse: start at the nodes' 1,000-block limit instead of 10-block steps.
  const win = { first: 1000n, max: 1000n };
  const scanWith = async (logs: PublicClient, address?: `0x${string}`[]) => {
    // The newest block as the log nodes see it, minus a few: a node a little behind answers "header not found" otherwise.
    const latest = (await rpc(() => logs.getBlockNumber())) - 3n;
    const f = (topics: (`0x${string}` | null)[]) => (address ? { address: address as unknown as `0x${string}`, topics } : { topics });
    const [sentScan, receivedScan] = await Promise.all([
      recentLogs(logs, f([TRANSFER_TOPIC, padded]), latest, span, want, win),
      recentLogs(logs, f([TRANSFER_TOPIC, null, padded]), latest, span, want, win),
    ]);
    return { latest, sentScan, receivedScan };
  };
  // Any token first, on the few nodes that take address-less filters. Those throttle Cloudflare's shared egress (production
  // 5 Nov 2026: every call 502 for an hour), so fall back to the chain's main tokens on the ordinary log nodes, which take
  // a list of token addresses, and say so in `coverage`.
  try {
    return { a, c, cl, span, coverage: "all ERC-20 tokens", ...(await scanWith(topicLogsClient(c))) };
  } catch {
    const tokens = MAIN_TOKENS.map((s) => { try { return tokenAddress(s, c.slug); } catch { return null; } }).filter((t): t is `0x${string}` => !!t);
    const r = await scanWith(logsClient(env, c), [...new Set(tokens)])
      .catch((e) => { throw e instanceof HttpError && e.status === 502 ? new HttpError(502, "the network's public nodes could not scan that range; try fewer blocks") : e; });
    return { a, c, cl, span, coverage: `main tokens only (${MAIN_TOKENS.join(", ")}): the all-token scan was not available`, ...r };
  }
}
/** Fallback token set for wallet scans: the tokens most wallets move; tickers that do not exist on a chain are skipped. */
const MAIN_TOKENS = ["USDC", "USDT", "WETH", "DAI", "WBTC", "cbBTC", "AERO", "DEGEN", "ARB", "OP", "LINK", "UNI"];
const WALLET_RELATED: Entry = entry("/wallet/related", "Related wallets, counterparties",
  "Related wallets of a 0x address: who it sent ERC-20 tokens to or got them from over recent blocks, ranked by transfers, with sent and received counts, tokens, USDC in and out, first and last block, and wallet or contract. Live Transfer logs on Base (default), Ethereum, Arbitrum, Optimism or Polygon; native-coin transfers are not included. Use to map who a wallet trades with, find linked wallets before paying, or trace where funds went.",
  ["related-wallets", "counterparties", "wallet", "onchain-analytics", "evm", "blockchain"],
  { ...WALLET_SCAN_PARAMS },
  { address: EX_BUSY.base, chain: "Base", chainId: 8453, fromBlock: 123454790, toBlock: 123456789, transfersScanned: 2, truncated: false, counterparties: [
    { address: "0x2074c40346ae2a90e0e4a391bcee6f16bf5277f5", kind: "wallet", transfers: 2, sent: 1, received: 1, tokens: ["USDC"], usdcSent: "1.5", usdcReceived: "0.25", firstBlock: 123452001, lastBlock: 123456700 },
  ], coverage: "all ERC-20 tokens", note: "ERC-20 Transfer logs only; native-coin transfers are not included." },
  async (env, q) => {
    const { a, c, cl, latest, span, sentScan, receivedScan, coverage } = await walletScan(env, q, 400);
    type L = RawLog & { address: string };
    const usdc = USDC[c.slug].toLowerCase();
    const groups = new Map<string, { transfers: number; sent: number; received: number; tokens: Set<string>; usdcSent: bigint; usdcReceived: bigint; firstBlock: number; lastBlock: number }>();
    const tokenSet = new Set<string>();
    let scanned = 0;
    for (const [list, dir] of [[sentScan.logs, "out"], [receivedScan.logs, "in"]] as const) {
      for (const l of list as L[]) {
        if (l.topics.length !== 3) continue; // ERC-721 transfers carry the token id as a fourth topic
        const other = `0x${(dir === "out" ? l.topics[2] : l.topics[1]).slice(26)}`.toLowerCase();
        if (other === a.toLowerCase()) continue;
        scanned++;
        const token = l.address.toLowerCase();
        tokenSet.add(token);
        const block = Number(l.blockNumber);
        const g = groups.get(other) ?? { transfers: 0, sent: 0, received: 0, tokens: new Set<string>(), usdcSent: 0n, usdcReceived: 0n, firstBlock: block, lastBlock: block };
        g.transfers++;
        if (dir === "out") g.sent++; else g.received++;
        g.tokens.add(token);
        if (token === usdc) { const raw = BigInt(l.data === "0x" ? 0 : l.data.slice(0, 66)); if (dir === "out") g.usdcSent += raw; else g.usdcReceived += raw; }
        g.firstBlock = Math.min(g.firstBlock, block); g.lastBlock = Math.max(g.lastBlock, block);
        groups.set(other, g);
      }
    }
    const top = [...groups.entries()].sort((x, y) => y[1].transfers - x[1].transfers || y[1].lastBlock - x[1].lastBlock).slice(0, 25);
    // Symbols for the tokens these counterparties used (up to 15), and contract-or-wallet for each shown counterparty.
    const shownTokens = [...new Set(top.flatMap(([, g]) => [...g.tokens]))].slice(0, 15) as `0x${string}`[];
    const [symbols, kinds] = await Promise.all([
      Promise.all(shownTokens.map(async (t) => [t, await cl.readContract({ address: t, abi: erc20Abi, functionName: "symbol" }).catch(() => null) as string | null] as const)),
      Promise.all(top.map(async ([o]) => (o === ZERO_ADDR ? "mint/burn" : await cl.getCode({ address: o as `0x${string}` }).then((code) => (codeKind(code ?? "0x").isContract ? "contract" : "wallet")).catch(() => null)))),
    ]);
    const sym = new Map(symbols);
    const partial = !sentScan.complete || !receivedScan.complete;
    const scannedFrom = sentScan.fromBlock > receivedScan.fromBlock ? sentScan.fromBlock : receivedScan.fromBlock;
    return {
      address: a, chain: c.name, chainId: c.chain.id, fromBlock: Number(partial ? scannedFrom : latest - span + 1n), toBlock: Number(latest),
      transfersScanned: scanned, truncated: partial,
      counterparties: top.map(([o, g], i) => ({
        address: o, kind: kinds[i], transfers: g.transfers, sent: g.sent, received: g.received,
        tokens: [...g.tokens].map((t) => sym.get(t as `0x${string}`) ?? t),
        usdcSent: formatUnits(g.usdcSent, 6), usdcReceived: formatUnits(g.usdcReceived, 6), firstBlock: g.firstBlock, lastBlock: g.lastBlock,
      })),
      coverage, note: "ERC-20 Transfer logs only; native-coin transfers are not included." + (partial ? " A busy wallet filled the scan early: fromBlock shows where it stopped." : ""),
    };
  });

/**
 * A wallet's recent token activity across every ERC-20 (5 Nov 2026): Nansen's transactions listing had 40 payers and the
 * Bazaar search for "wallet transactions" only 6 sellers. Same public logs as /wallet/related, listed instead of grouped.
 */
const WALLET_TRANSACTIONS: Entry = entry("/wallet/transactions", "Wallet transactions, history",
  "Recent token transactions of any 0x address across every ERC-20 it holds: the newest 50 transfers in or out over recent blocks, each with token symbol, amount, counterparty, direction, block and transaction hash. Live Transfer logs on Base (default), Ethereum, Arbitrum, Optimism or Polygon; native-coin transfers are not included. Use to see what a wallet did lately, confirm a payment in any token, or audit activity before a deal.",
  ["wallet-transactions", "transaction-history", "token-transfers", "wallet", "evm", "blockchain"],
  { ...WALLET_SCAN_PARAMS },
  { address: EX_BUSY.base, chain: "Base", chainId: 8453, fromBlock: 123454790, toBlock: 123456789, count: 1, truncated: false, transfers: [
    { block: 123456700, tx: "0x…", token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", symbol: "USDC", direction: "out", counterparty: "0x2074c40346ae2a90e0e4a391bcee6f16bf5277f5", amount: "1.5", raw: "1500000" },
  ], coverage: "all ERC-20 tokens", note: "ERC-20 Transfer logs only; native-coin transfers are not included." },
  async (env, q) => {
    const { a, c, cl, latest, span, sentScan, receivedScan, coverage } = await walletScan(env, q, 60);
    type L = RawLog & { address: string };
    const self = a.toLowerCase();
    const all = [...(sentScan.logs as L[]).map((l) => ({ l, direction: "out" as const })), ...(receivedScan.logs as L[]).map((l) => ({ l, direction: "in" as const }))]
      .filter(({ l }) => l.topics.length === 3)
      .sort((x, y) => Number(y.l.blockNumber) - Number(x.l.blockNumber) || Number(y.l.logIndex) - Number(x.l.logIndex));
    // A transfer to oneself shows up in both scans: keep it once.
    const seen = new Set<string>();
    const unique = all.filter(({ l }) => { const k = `${l.transactionHash}:${l.logIndex}`; if (seen.has(k)) return false; seen.add(k); return true; });
    const shown = unique.slice(0, 50);
    const tokens = [...new Set(shown.map(({ l }) => l.address.toLowerCase()))].slice(0, 15) as `0x${string}`[];
    const meta = new Map(await Promise.all(tokens.map(async (t) => {
      const [symbol, decimals] = await Promise.all([
        cl.readContract({ address: t, abi: erc20Abi, functionName: "symbol" }).catch(() => null),
        cl.readContract({ address: t, abi: erc20Abi, functionName: "decimals" }).catch(() => null),
      ]);
      return [t, { symbol: symbol as string | null, decimals: decimals === null ? null : Number(decimals) }] as const;
    })));
    const partial = !sentScan.complete || !receivedScan.complete;
    const scannedFrom = sentScan.fromBlock > receivedScan.fromBlock ? sentScan.fromBlock : receivedScan.fromBlock;
    return {
      address: a, chain: c.name, chainId: c.chain.id, fromBlock: Number(partial ? scannedFrom : latest - span + 1n), toBlock: Number(latest),
      count: unique.length, truncated: unique.length > 50 || partial,
      transfers: shown.map(({ l, direction }) => {
        const raw = BigInt(l.data === "0x" ? 0 : l.data.slice(0, 66));
        const m = meta.get(l.address.toLowerCase() as `0x${string}`);
        const other = `0x${(direction === "out" ? l.topics[2] : l.topics[1]).slice(26)}`;
        return { block: Number(l.blockNumber), tx: l.transactionHash, token: l.address, symbol: m?.symbol ?? null, direction: other.toLowerCase() === self ? "self" : direction, counterparty: other,
          amount: m?.decimals != null ? formatUnits(raw, m.decimals) : null, raw: raw.toString() };
      }),
      coverage, note: "ERC-20 Transfer logs only; native-coin transfers are not included." + (partial ? " A busy wallet filled the scan early: fromBlock shows where it stopped." : ""),
    };
  });

/**
 * Reads whose published example fails on that network (smoke run, 26 Oct 2026): zkSync estimates need a sender holding ETH
 * there, and HyperEVM's public node refuses the wider log ranges the transfer scan uses. Left out rather than listed broken.
 */
const EXTRA_SKIP: ReadonlySet<string> = new Set(["/zksync/estimate-gas", "/hyperevm/token-transfers"]);
const EXTRA_READS: Entry[] = EXTRA_CHAINS.flatMap(chainEntries).filter((e) => !EXTRA_SKIP.has(e.endpoint.path));
/**
 * One-week price test, 26 Oct to 2 Nov 2026 (Peter's choice): the repeat-buying bots on Base pay $0.002-0.003 a call
 * (Claw402's chain reads at $0.003 drew 161k calls from 72 payers in a week) and almost never $0.01. Single-network reads
 * that cost $0.01 go to $0.003; the sweeper still pays every listing at or below $0.01. Keep it if repeat payers and calls
 * come; revert to PRICE if they do not (business/agentic/base-bots/payments-to-us.mjs, payer-profile.mjs).
 * Ended 27 Oct 2026 (Peter): the sweeper, our main payer, pays each listing at its live price about 1.3 times a week
 * whatever the price, so the test cut its income on the 403 repriced tools by about 70% (~$3.5 a week), and the shopper
 * bots had not bought. Equal to PRICE, testPriced changes nothing; set it again to rerun the test.
 */
export const READ_TEST_PRICE = PRICE;
export const testPriced = (e: Entry): Entry => (e.endpoint.price === PRICE ? { ...e, endpoint: { ...e.endpoint, price: READ_TEST_PRICE } } : e);
export const CHAIN_READS: Entry[] = [...CHAINS.flatMap(chainEntries).map(testPriced), WALLET_BALANCES, WALLET_RELATED, WALLET_TRANSACTIONS, ...EXTRA_READS.map(testPriced)];
/** The extra networks' tool paths: HTTP and the /mcp/chain bundle only (mcp.ts). */
export const EXTRA_CHAIN_PATHS: ReadonlySet<string> = new Set(EXTRA_READS.map((e) => e.endpoint.path));
