import { HttpError, isAddress, type Env } from "../lib/env";
import { baseClient } from "../lib/rpc";
import { getAddress } from "viem";

interface PoolAuditResult {
  chain: string;
  poolAddress: string;
  type: "uniswap-v3" | "uniswap-v2" | "balancer" | "unknown";
  riskLevel: "low" | "medium" | "high" | "critical";
  riskFlags: string[];
  summary: string;
  facts: {
    hasCode: boolean;
    bytecodeSize: number;
    age: string | null;
  };
  metrics?: {
    poolExists: boolean;
    eventCount: number;
    lastActivity: string | null;
  };
  lastUpdatedBlock: number;
}

export async function liquidityPoolAudit(env: Env, address: string): Promise<PoolAuditResult> {
  if (!isAddress(address)) throw new HttpError(400, "address must be a 0x-prefixed 20-byte hex address");

  const checksummed = getAddress(address);
  const client = baseClient(env);

  const [code, txCount, blockNumber] = await Promise.all([
    client.getBytecode({ address: checksummed }),
    client.getTransactionCount({ address: checksummed }),
    client.getBlockNumber(),
  ]).catch((e) => {
    throw new HttpError(502, `Base RPC error: ${e?.shortMessage ?? e?.message ?? "unknown"}`);
  });

  const hasCode = code && code !== "0x";
  const bytecodeSize = hasCode ? (code.length - 2) / 2 : 0;

  // Heuristic pool detection by bytecode patterns and transaction count
  let poolType: "uniswap-v3" | "uniswap-v2" | "balancer" | "unknown" = "unknown";
  const riskFlags: string[] = [];

  if (!hasCode) {
    riskFlags.push("not-a-contract");
  } else if (bytecodeSize < 500) {
    riskFlags.push("bytecode-too-small");
  } else if (bytecodeSize > 100000) {
    riskFlags.push("bytecode-unusually-large");
  }

  // Uniswap V3 pools are typically 2000-3000 bytes
  if (bytecodeSize > 1500 && bytecodeSize < 4000) {
    if (txCount > 0) poolType = "uniswap-v3";
  }
  // Uniswap V2 pairs are typically 1200-1500 bytes
  else if (bytecodeSize > 800 && bytecodeSize < 2000) {
    if (txCount > 0) poolType = "uniswap-v2";
  }
  // Generic contract
  else if (hasCode && txCount > 0) {
    poolType = "unknown";
  }

  // Transaction count heuristic
  if (txCount === 0) {
    riskFlags.push("no-transactions");
  } else if (txCount < 5) {
    riskFlags.push("very-low-activity");
  }

  let riskLevel: "low" | "medium" | "high" | "critical" = "low";
  if (riskFlags.includes("not-a-contract") || riskFlags.includes("bytecode-too-small")) {
    riskLevel = "critical";
  } else if (riskFlags.length >= 2) {
    riskLevel = "high";
  } else if (riskFlags.length === 1) {
    riskLevel = "medium";
  }

  return {
    chain: "base",
    poolAddress: checksummed,
    type: poolType,
    riskLevel,
    riskFlags: riskFlags.sort(),
    summary: `${riskLevel} risk: ${riskFlags.length} flag(s). Type: ${poolType}. Activity: ${txCount} txs.`,
    facts: {
      hasCode,
      bytecodeSize,
      age: null,
    },
    metrics: {
      poolExists: hasCode,
      eventCount: txCount,
      lastActivity: null,
    },
    lastUpdatedBlock: Number(blockNumber),
  };
}
