import { formatEther, formatUnits } from "viem";
import { HttpError, isAddress, type Env } from "../lib/env";
import { baseClient, erc20Abi } from "../lib/rpc";

const DEFAULT_TOKENS = [
  "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", // USDC
  "0x4200000000000000000000000000000000000006", // WETH
  "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf", // cbBTC
  "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb", // DAI
] as const;

interface TokenHolding {
  address: string;
  symbol: string | null;
  decimals: number;
  balance: string;
  balanceFormatted: string;
  riskLevel: "low" | "medium" | "high" | "unknown";
}

interface WalletAuditResult {
  chain: string;
  address: string;
  type: "eoa" | "contract" | "eoa-delegated";
  riskLevel: "low" | "medium" | "high";
  riskFlags: string[];
  summary: string;
  eth: { wei: string; formatted: string };
  transactionCount: number;
  tokenCount: number;
  tokens: TokenHolding[];
  labels: string[];
  lastUpdatedBlock: number;
}

// Simple heuristic labels based on activity and balance
function assessRisk(txCount: number, tokenCount: number, ethBalance: string): "low" | "medium" | "high" {
  const ethNum = parseFloat(ethBalance);
  const flags: string[] = [];

  if (txCount === 0) flags.push("no-activity");
  if (txCount === 1) flags.push("single-tx");
  if (ethNum < 0.001 && txCount < 5) flags.push("low-balance-low-activity");

  if (flags.length >= 2) return "high";
  if (flags.length === 1) return "medium";
  return "low";
}

function getLabels(address: string, txCount: number, ethBalance: string): string[] {
  const labels: string[] = [];
  const ethNum = parseFloat(ethBalance);

  if (ethNum > 10) labels.push("high-eth-holder");
  if (ethNum < 0.0001 && txCount > 10) labels.push("active-small-holder");
  if (txCount === 0) labels.push("new-address");
  if (txCount === 1) labels.push("single-transaction");

  return labels;
}

export async function walletAudit(env: Env, address: string): Promise<WalletAuditResult> {
  if (!isAddress(address)) throw new HttpError(400, "address must be a 0x-prefixed 20-byte hex address");

  const client = baseClient(env);
  const [balance, txCount, code, calls, blockNumber] = await Promise.all([
    client.getBalance({ address }),
    client.getTransactionCount({ address }),
    client.getCode({ address }),
    client.multicall({
      allowFailure: true,
      contracts: DEFAULT_TOKENS.flatMap((token) => [
        { address: token, abi: erc20Abi, functionName: "balanceOf", args: [address] } as const,
        { address: token, abi: erc20Abi, functionName: "symbol" } as const,
        { address: token, abi: erc20Abi, functionName: "decimals" } as const,
      ]),
    }),
    client.getBlockNumber(),
  ]).catch((e) => {
    throw new HttpError(502, `Base RPC error: ${e?.shortMessage ?? e?.message ?? "unknown"}`);
  });

  const hex = (code ?? "0x").toLowerCase();
  const delegatedTo = hex.startsWith("0xef0100") && hex.length === 48 ? `0x${hex.slice(8)}` : null;
  const type: "eoa" | "contract" | "eoa-delegated" = delegatedTo ? "eoa-delegated" : hex === "0x" ? "eoa" : "contract";

  const ethFormatted = formatEther(balance);
  const tokens: TokenHolding[] = DEFAULT_TOKENS.flatMap((token, i) => {
    const [bal, sym, dec] = calls.slice(i * 3, i * 3 + 3);
    if (bal.status !== "success" || dec.status !== "success") return [];
    const raw = bal.result as bigint;
    const decimals = dec.result as number;
    if (raw === 0n) return [];

    const balanceFormatted = formatUnits(raw, decimals);
    const riskLevel: "low" | "medium" | "high" | "unknown" = "low";

    return [
      {
        address: token,
        symbol: sym.status === "success" ? (sym.result as string) : null,
        decimals,
        balance: raw.toString(),
        balanceFormatted,
        riskLevel,
      },
    ];
  });

  const riskLevel = assessRisk(txCount, tokens.length, ethFormatted);
  const riskFlags: string[] = [];

  if (txCount === 0) riskFlags.push("no-transaction-history");
  if (txCount === 1) riskFlags.push("single-transaction-only");
  if (parseFloat(ethFormatted) < 0.0001 && txCount < 3) riskFlags.push("low-balance-low-activity");
  if (type === "contract" && !delegatedTo) riskFlags.push("contract-address");

  const labels = getLabels(address, txCount, ethFormatted);

  return {
    chain: "base",
    address,
    type,
    riskLevel,
    riskFlags,
    summary: `${riskLevel} risk: ${riskFlags.length} flag(s). ${tokens.length} token(s) held. ${txCount} transaction(s).`,
    eth: { wei: balance.toString(), formatted: ethFormatted },
    transactionCount: txCount,
    tokenCount: tokens.length,
    tokens,
    labels,
    lastUpdatedBlock: Number(blockNumber),
  };
}
