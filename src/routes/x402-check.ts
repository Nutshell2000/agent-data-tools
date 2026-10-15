import { formatUnits } from "viem";
import { HttpError, isAddress, type Env } from "../lib/env";
import { parseTarget } from "../lib/fetch";
import { baseClient, erc20Abi } from "../lib/rpc";
import { sanctionedAssets } from "../lib/sanctions";
import { domainInfo } from "./domain";

type Flag = { level: "high" | "medium" | "info"; code: string; message: string };

// x402 v1 used short network names; v2 uses CAIP-2 ids.
const NETWORKS: Record<string, { id: string; name: string; testnet: boolean }> = {
  base: { id: "eip155:8453", name: "Base", testnet: false },
  "base-sepolia": { id: "eip155:84532", name: "Base Sepolia", testnet: true },
  ethereum: { id: "eip155:1", name: "Ethereum", testnet: false },
  polygon: { id: "eip155:137", name: "Polygon", testnet: false },
  "polygon-amoy": { id: "eip155:80002", name: "Polygon Amoy", testnet: true },
  avalanche: { id: "eip155:43114", name: "Avalanche", testnet: false },
  "avalanche-fuji": { id: "eip155:43113", name: "Avalanche Fuji", testnet: true },
  arbitrum: { id: "eip155:42161", name: "Arbitrum", testnet: false },
  optimism: { id: "eip155:10", name: "Optimism", testnet: false },
  solana: { id: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp", name: "Solana", testnet: false },
  "solana-devnet": { id: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1", name: "Solana Devnet", testnet: true },
};
const BY_ID = Object.fromEntries(Object.values(NETWORKS).map((n) => [n.id, n]));

// Stablecoins x402 sellers price in, keyed by "network id|asset" (EVM assets lower case).
const KNOWN_ASSETS: Record<string, { symbol: string; decimals: number }> = {
  "eip155:8453|0x833589fcd6edb6e08f4c7c32d4f71b54bda02913": { symbol: "USDC", decimals: 6 },
  "eip155:8453|0x60a3e35cc302bfa44cb288bc5a4f316fdb1adb42": { symbol: "EURC", decimals: 6 },
  "eip155:84532|0x036cbd53842c5426634e7929541ec2318f3dcf7e": { symbol: "USDC", decimals: 6 },
  "eip155:1|0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48": { symbol: "USDC", decimals: 6 },
  "eip155:137|0x3c499c542cef5e3811e1192ce70d8cc03d5c3359": { symbol: "USDC", decimals: 6 },
  "eip155:43114|0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e": { symbol: "USDC", decimals: 6 },
  "eip155:42161|0xaf88d065e77c8cc2239327c5edb3a432268e5831": { symbol: "USDC", decimals: 6 },
  "eip155:10|0x0b2c639c533813f4aa9d7837caf62653d097ff85": { symbol: "USDC", decimals: 6 },
  "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp|EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v": { symbol: "USDC", decimals: 6 },
};
const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

interface RawAccept {
  scheme?: string;
  network?: string;
  amount?: string;
  maxAmountRequired?: string;
  asset?: string;
  payTo?: string;
  resource?: string;
  description?: string;
  maxTimeoutSeconds?: number;
}
interface RawChallenge {
  x402Version?: number;
  error?: string;
  resource?: { url?: string; description?: string } | string;
  accepts?: RawAccept[];
}

/** Probes a URL without paying it. A 402 is the expected answer, so it is not an error here. */
async function probe(url: URL, method: string): Promise<Response> {
  try {
    const headers: Record<string, string> = { "user-agent": "AgentDataTools/1.0 (x402-check)", accept: "application/json" };
    if (method === "POST") headers["content-type"] = "application/json";
    const res = await fetch(url, {
      method,
      redirect: "follow",
      signal: AbortSignal.timeout(8_000),
      headers,
      body: method === "POST" ? "{}" : undefined,
    });
    parseTarget(res.url || url.href);
    return res;
  } catch (e) {
    if (e instanceof HttpError) throw e;
    const timedOut = e instanceof Error && e.name === "TimeoutError";
    throw new HttpError(timedOut ? 504 : 502, timedOut ? "the endpoint did not respond within 8 seconds" : "could not reach the endpoint");
  }
}

function decodeBase64Json(value: string): RawChallenge | null {
  try {
    const bin = atob(value.trim());
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
  } catch {
    return null;
  }
}

/** Reads the payment request from the v2 header, or from the v1 JSON body. */
export async function readChallenge(res: Response): Promise<{ challenge: RawChallenge; from: "header" | "body" } | null> {
  const header = res.headers.get("payment-required");
  const fromHeader = header ? decodeBase64Json(header) : null;
  if (fromHeader?.accepts?.length) return { challenge: fromHeader, from: "header" };
  try {
    const body = (await res.json()) as RawChallenge;
    if (Array.isArray(body?.accepts) && body.accepts.length) return { challenge: body, from: "body" };
  } catch {
    // Not JSON.
  }
  return null;
}

export function normalizeAccept(a: RawAccept) {
  const network = (a.network && (NETWORKS[a.network] ?? BY_ID[a.network])) || null;
  const networkId = network?.id ?? a.network ?? null;
  const evm = networkId?.startsWith("eip155:") ?? false;
  const asset = a.asset ? (evm ? a.asset.toLowerCase() : a.asset) : null;
  const known = networkId && asset ? KNOWN_ASSETS[`${networkId}|${asset}`] : undefined;
  const rawAmount = a.amount ?? a.maxAmountRequired ?? null;
  const amount = rawAmount && /^\d+$/.test(rawAmount) ? BigInt(rawAmount) : null;
  return {
    scheme: a.scheme ?? null,
    network: networkId,
    networkName: network?.name ?? null,
    testnet: network?.testnet ?? null,
    asset: a.asset ?? null,
    assetSymbol: known?.symbol ?? null,
    amount: rawAmount,
    price: known && amount != null ? Number(formatUnits(amount, known.decimals)) : null,
    payTo: a.payTo ?? null,
    resource: a.resource ?? null,
    maxTimeoutSeconds: a.maxTimeoutSeconds ?? null,
  };
}

type Option = ReturnType<typeof normalizeAccept>;

/** On-chain facts about a Base payTo address. */
async function baseReceiver(env: Env, payTo: `0x${string}`) {
  const client = baseClient(env);
  const [code, nonce, usdc] = await Promise.all([
    client.getCode({ address: payTo }),
    client.getTransactionCount({ address: payTo }),
    client.readContract({ address: BASE_USDC, abi: erc20Abi, functionName: "balanceOf", args: [payTo] }),
  ]);
  const hex = (code ?? "0x").toLowerCase();
  return {
    type: hex.startsWith("0xef0100") ? "eoa-delegated" : hex === "0x" ? "eoa" : "contract",
    transactionCount: nonce,
    usdcBalance: Number(formatUnits(usdc, 6)),
  };
}

/** Checks an x402 endpoint before an agent pays it. */
export async function x402Check(env: Env, rawUrl: string | undefined, methodInput?: string, maxPriceInput?: string) {
  const url = parseTarget(rawUrl);
  const method = (methodInput || "GET").toUpperCase();
  if (method !== "GET" && method !== "POST") throw new HttpError(400, "method must be GET or POST");
  const maxPrice = maxPriceInput ? Number(maxPriceInput) : null;
  if (maxPrice != null && !(maxPrice > 0)) throw new HttpError(400, "maxPrice must be a positive number of dollars, e.g. 0.05");

  const [res, domain] = await Promise.all([probe(url, method), domainInfo(url.hostname).catch(() => null)]);
  const flags: Flag[] = [];
  const parsed = res.status === 402 ? await readChallenge(res) : null;

  if (!parsed) {
    return {
      url: url.href,
      verdict: "not_x402",
      summary:
        res.status === 402
          ? "The endpoint answered 402 but without a readable x402 payment request, so an x402 client cannot pay it."
          : `The endpoint answered HTTP ${res.status} instead of 402, so it did not ask for an x402 payment with ${method}.`,
      httpStatus: res.status,
      x402Version: null,
      options: [],
      flags: [],
      checkedAt: new Date().toISOString(),
    };
  }

  const { challenge } = parsed;
  const options: Option[] = (challenge.accepts ?? []).slice(0, 10).map(normalizeAccept);

  if (url.protocol !== "https:") flags.push({ level: "medium", code: "no_tls", message: "The endpoint is served over plain HTTP." });
  const age = domain?.registration?.ageDays;
  if (age != null && age < 30) flags.push({ level: "medium", code: "new_domain", message: `The domain was registered ${age} day(s) ago.` });
  if (!domain) flags.push({ level: "info", code: "domain_unchecked", message: "Domain registration could not be checked." });

  const payable = options.filter((o) => o.testnet === false);
  if (payable.length === 0) flags.push({ level: "high", code: "no_mainnet_option", message: "No payment option is on a known mainnet." });
  if (options.some((o) => o.scheme !== "exact" && o.scheme !== "upto")) {
    flags.push({ level: "info", code: "unusual_scheme", message: "An option uses a payment scheme other than exact or upto." });
  }
  if (options.some((o) => !o.assetSymbol)) {
    flags.push({ level: "medium", code: "unknown_asset", message: "An option asks for a token that is not a known stablecoin, so its dollar price is unknown." });
  }

  const prices = payable.map((o) => o.price).filter((p): p is number => p != null);
  const cheapest = prices.length ? Math.min(...prices) : null;
  if (cheapest != null && cheapest > 1) flags.push({ level: "medium", code: "high_price", message: `The cheapest option costs $${cheapest}.` });
  if (maxPrice != null && cheapest != null && cheapest > maxPrice) {
    flags.push({ level: "high", code: "over_budget", message: `The cheapest option costs $${cheapest}, more than maxPrice $${maxPrice}.` });
  }

  for (const o of options) {
    if (o.resource) {
      try {
        if (new URL(o.resource).hostname !== url.hostname) {
          flags.push({ level: "medium", code: "resource_mismatch", message: `The payment is for a resource on another host (${new URL(o.resource).hostname}).` });
        }
      } catch {
        // Not a URL; nothing to compare.
      }
    }
  }

  const receivers = [...new Set(options.map((o) => o.payTo).filter((p): p is string => !!p))];
  const sanctioned = (await Promise.all(receivers.map(async (r) => ({ r, assets: await sanctionedAssets(r) })))).filter((s) => s.assets.length);
  for (const s of sanctioned) {
    flags.push({ level: "high", code: "payto_sanctioned", message: `The receiving address ${s.r} is on the OFAC SDN list.` });
  }

  const basePayTo = options.find((o) => o.network === "eip155:8453" && o.payTo && isAddress(o.payTo))?.payTo as `0x${string}` | undefined;
  const receiver = basePayTo ? await baseReceiver(env, basePayTo).catch(() => null) : null;
  if (receiver?.type === "contract") flags.push({ level: "info", code: "payto_contract", message: "The Base receiving address is a contract, such as a payment splitter or smart wallet." });
  if (receiver && receiver.type === "eoa" && receiver.transactionCount === 0 && receiver.usdcBalance === 0) {
    flags.push({ level: "info", code: "payto_unused", message: "The Base receiving address holds no USDC and has never sent a transaction, so no one has paid it yet." });
  }

  const high = flags.filter((f) => f.level === "high").length;
  const medium = flags.filter((f) => f.level === "medium").length;
  const verdict = high > 0 ? "avoid" : medium > 0 ? "caution" : "pay";
  const resource = typeof challenge.resource === "string" ? { url: challenge.resource } : challenge.resource;
  return {
    url: url.href,
    verdict,
    summary: `${verdict}: ${high} high and ${medium} medium flag(s). ${cheapest != null ? `Cheapest mainnet option $${cheapest}.` : "No dollar price could be read."}`,
    httpStatus: 402,
    x402Version: challenge.x402Version ?? null,
    description: resource?.description || challenge.accepts?.find((a) => a.description)?.description || null,
    cheapestPrice: cheapest,
    options,
    receiver: receiver ? { address: basePayTo, network: "eip155:8453", ...receiver } : null,
    domain: domain
      ? { name: domain.domain, registrar: domain.registration?.registrar ?? null, ageDays: domain.registration?.ageDays ?? null }
      : null,
    flags,
    note: "Nothing was paid. Checks the payment request, receiving address and domain only; it cannot prove what the endpoint returns after payment.",
    checkedAt: new Date().toISOString(),
  };
}
