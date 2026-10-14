import { HttpError, type Env } from "../lib/env";
import { baseClient } from "../lib/rpc";
import { formatGwei, parseGwei } from "viem";

interface MEVSimulatorResult {
  chain: string;
  scenario: "standard" | "high-mev" | "low-gas";
  gasPrice: {
    baseFeeGwei: string;
    priorityFeeGwei: string;
    maxFeeGwei: string;
  };
  estimatedCosts: {
    simpleSwap: { gasUnits: number; costEth: string; costUsd: string | null };
    complexSwap: { gasUnits: number; costEth: string; costUsd: string | null };
    addLiquidity: { gasUnits: number; costEth: string; costUsd: string | null };
  };
  mevRisk: "low" | "medium" | "high";
  recommendations: string[];
  blockNumber: number;
}

export async function mevSimulator(env: Env, scenario: string = "standard"): Promise<MEVSimulatorResult> {
  const client = baseClient(env);

  const [feeData, blockNumber, ethPrice] = await Promise.all([
    client.estimateFeesPerGas(),
    client.getBlockNumber(),
    fetch("https://api.coinbase.com/v2/prices/ETH/USD", {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(5000),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: any) => parseFloat(d?.data?.amount ?? "0"))
      .catch(() => null),
  ]).catch((e) => {
    throw new HttpError(502, `Chain/market data error: ${(e as any)?.message}`);
  });

  const baseFee = feeData.maxFeePerGas ? feeData.maxFeePerGas - (feeData.maxPriorityFeePerGas || 0n) : 1000000n;
  const priorityFee = feeData.maxPriorityFeePerGas || 1000000n;

  let adjustedPriority = priorityFee;
  let mevRisk: "low" | "medium" | "high" = "medium";
  const recommendations: string[] = [];

  if (scenario === "high-mev") {
    adjustedPriority = (priorityFee * 3n) / 1n;
    mevRisk = "high";
    recommendations.push("High MEV risk: Use MEV protection (MEV-Blocker, Flashbots Protect)");
  } else if (scenario === "low-gas") {
    adjustedPriority = priorityFee / 2n;
    mevRisk = "low";
    recommendations.push("Low priority: Consider batch execution or delayed settlement");
  } else {
    recommendations.push("Standard conditions: No special precautions needed");
  }

  const maxFee = baseFee + adjustedPriority;

  // Typical gas usage estimates for Base L2
  const estimates = {
    simpleSwap: 100000,
    complexSwap: 250000,
    addLiquidity: 180000,
  };

  const makeCost = (gas: number) => {
    const costWei = BigInt(gas) * maxFee;
    const costEth = formatGwei(costWei);
    const costUsd = ethPrice ? (parseFloat(costEth) * ethPrice).toFixed(2) : null;
    return { gasUnits: gas, costEth, costUsd };
  };

  if (mevRisk === "high") {
    recommendations.push("Monitor mempool for sandwich attacks");
    recommendations.push("Consider private tx pool: bloxroute.com or MEV-Blocker");
  }

  return {
    chain: "base",
    scenario: (scenario as any) ?? "standard",
    gasPrice: {
      baseFeeGwei: formatGwei(baseFee),
      priorityFeeGwei: formatGwei(adjustedPriority),
      maxFeeGwei: formatGwei(maxFee),
    },
    estimatedCosts: {
      simpleSwap: makeCost(estimates.simpleSwap),
      complexSwap: makeCost(estimates.complexSwap),
      addLiquidity: makeCost(estimates.addLiquidity),
    },
    mevRisk,
    recommendations,
    blockNumber: Number(blockNumber),
  };
}
