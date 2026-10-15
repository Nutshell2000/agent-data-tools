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
  accountNonce: number;
  tokenCount: number;
  tokens: TokenHolding[];
  labels: string[];
  limitations: string[];
  lastUpdatedBlock: number;
}

function assessRisk(riskFlags: readonly string[]): "low" | "medium" | "high" {
  if (riskFlags.length >= 2) return "high";
  if (riskFlags.length === 1) return "medium";
  return "low";
}

function getLabels(accountNonce: number, ethBalance: string): string[] {
  const labels: string[] = [];
  const ethNum = parseFloat(ethBalance);

  if (ethNum > 10) labels.push("high-eth-balance");
  if (accountNonce === 0) labels.push("zero-account-nonce");
  if (accountNonce === 1) labels.push("account-nonce-one");

  return labels;
}

export async function walletAudit(env: Env, address: string): Promise<WalletAuditResult> {
  if (!isAddress(address)) throw new HttpError(400, "address must be a 0x-prefixed 20-byte hex address");

  const client = baseClient(env);
  const [balance, accountNonce, code, calls, blockNumber] = await Promise.all([
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
    const riskLevel: "low" | "medium" | "high" | "unknown" = "unknown";

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

  const riskFlags: string[] = [];

  if (accountNonce === 0) riskFlags.push("zero-account-nonce");
  if (accountNonce === 1) riskFlags.push("account-nonce-one");
  if (parseFloat(ethFormatted) < 0.0001 && accountNonce < 3) riskFlags.push("low-balance-low-nonce");

  const riskLevel = assessRisk(riskFlags);
  const labels = getLabels(accountNonce, ethFormatted);

  return {
    chain: "base",
    address,
    type,
    riskLevel,
    riskFlags,
    summary: `${riskLevel} risk: ${riskFlags.length} flag(s). ${tokens.length} token(s) held. Account nonce: ${accountNonce}.`,
    eth: { wei: balance.toString(), formatted: ethFormatted },
    accountNonce,
    tokenCount: tokens.length,
    tokens,
    labels,
    limitations: [
      "accountNonce is the Base EVM account nonce; for EOAs it reflects outgoing transactions only, not full transaction, token-transfer, or trading history.",
    ],
    lastUpdatedBlock: Number(blockNumber),
  };
}
