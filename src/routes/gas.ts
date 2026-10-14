import { formatEther, formatGwei } from "viem";
import { HttpError, type Env } from "../lib/env";
import { baseClient } from "../lib/rpc";

// Gas used by the two commonest transactions.
const ETH_TRANSFER_GAS = 21_000n;
const ERC20_TRANSFER_GAS = 65_000n;

/** Current gas prices on Base, read from the chain. */
export async function baseGas(env: Env) {
  const client = baseClient(env);
  let block, priorityFee;
  try {
    [block, priorityFee] = await Promise.all([client.getBlock({ blockTag: "latest" }), client.estimateMaxPriorityFeePerGas()]);
  } catch {
    throw new HttpError(502, "the Base network did not respond");
  }
  const baseFee = block.baseFeePerGas ?? 0n;
  const total = baseFee + priorityFee;
  // Headroom for the base fee rising over the next few blocks.
  const suggestedMaxFee = baseFee * 2n + priorityFee;
  return {
    chain: "base",
    chainId: 8453,
    blockNumber: Number(block.number),
    blockTime: new Date(Number(block.timestamp) * 1000).toISOString(),
    baseFeeGwei: formatGwei(baseFee),
    priorityFeeGwei: formatGwei(priorityFee),
    gasPriceGwei: formatGwei(total),
    suggested: { maxFeePerGasWei: suggestedMaxFee.toString(), maxPriorityFeePerGasWei: priorityFee.toString() },
    blockUsedPercent: Math.round((Number(block.gasUsed) / Number(block.gasLimit)) * 1000) / 10,
    // Execution cost on Base only. Base also adds a small fee for posting the transaction to Ethereum.
    estimatedExecutionFeeEth: {
      ethTransfer: formatEther(total * ETH_TRANSFER_GAS),
      erc20Transfer: formatEther(total * ERC20_TRANSFER_GAS),
    },
    checkedAt: new Date().toISOString(),
  };
}
