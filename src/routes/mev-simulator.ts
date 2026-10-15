import { HttpError, type Env } from "../lib/env";
import { baseClient } from "../lib/rpc";
import { formatEther, formatGwei } from "viem";

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
  scenarioNotes: string[];
  blockNumber: number;
}

const SCENARIOS = ["standard", "high-mev", "low-gas"] as const;
type Scenario = (typeof SCENARIOS)[number];
const GAS_ESTIMATE_NOTE =
  "Gas units use typical fixed assumptions (100,000 simple swap, 250,000 complex swap, 180,000 add-liquidity), not a transaction-specific estimate or quote.";

function isScenario(value: string): value is Scenario {
  return SCENARIOS.some((scenario) => scenario === value);
}

export async function mevSimulator(env: Env, scenario: string = "standard"): Promise<MEVSimulatorResult> {
  if (!isScenario(scenario)) {
    throw new HttpError(400, `scenario must be one of: ${SCENARIOS.join(", ")}`);
  }

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
  const scenarioNotes: string[] = [GAS_ESTIMATE_NOTE];

  if (scenario === "high-mev") {
    adjustedPriority = (priorityFee * 3n) / 1n;
    scenarioNotes.push("This preset triples the current priority fee; it does not measure MEV risk or exposure.");
  } else if (scenario === "low-gas") {
    adjustedPriority = priorityFee / 2n;
    scenarioNotes.push("This preset halves the current priority fee; inclusion time and MEV exposure are not estimated.");
  } else {
    scenarioNotes.push("This preset uses the current priority fee without adjustment.");
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
    const costEth = formatEther(costWei);
    const costUsd = ethPrice ? (parseFloat(costEth) * ethPrice).toFixed(2) : null;
    return { gasUnits: gas, costEth, costUsd };
  };

  return {
    chain: "base",
    scenario,
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
    scenarioNotes,
    blockNumber: Number(blockNumber),
  };
}
