import { HttpError, isAddress, type Env } from "../lib/env";
import { baseClient, erc20Abi } from "../lib/rpc";
import { getAddress } from "viem";

interface ContractRiskResult {
  chain: string;
  address: string;
  type: "eoa" | "contract" | "proxy" | "unknown";
  riskLevel: "low" | "medium" | "high" | "critical";
  riskFlags: string[];
  summary: string;
  facts: {
    bytecodeSize: number;
    deployedAt: string | null;
    hasCode: boolean;
    isProxy: boolean;
    proxyImplementation: string | null;
  };
  tokenProperties?: {
    name: string | null;
    symbol: string | null;
    decimals: number | null;
    totalSupply: string | null;
    ownershipRenounced: boolean;
    pausable: boolean;
  };
  lastUpdatedBlock: number;
}

async function detectProxyPattern(env: Env, address: `0x${string}`): Promise<{ isProxy: boolean; impl?: string }> {
  const client = baseClient(env);

  // EIP-1967: implementation slot 0x360894a13ba1a3210667c828492db98dca3e2f703ccf0b462f8b1d7b7ba7b206
  const slot = "0x360894a13ba1a3210667c828492db98dca3e2f703ccf0b462f8b1d7b7ba7b206";
  try {
    const val = await client.getStorageAt({ address, slot });
    if (val && val !== "0x0000000000000000000000000000000000000000000000000000000000000000") {
      const impl = `0x${val.slice(-40)}`;
      return { isProxy: true, impl };
    }
  } catch {
    // Not a proxy or error reading slot
  }

  return { isProxy: false };
}

export async function contractRisk(env: Env, address: string): Promise<ContractRiskResult> {
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
  const type: "eoa" | "contract" | "proxy" | "unknown" = !hasCode ? "eoa" : "contract";

  if (!hasCode) {
    return {
      chain: "base",
      address: checksummed,
      type: "eoa",
      riskLevel: "low",
      riskFlags: [],
      summary: "EOA address, not a contract.",
      facts: {
        bytecodeSize: 0,
        deployedAt: null,
        hasCode: false,
        isProxy: false,
        proxyImplementation: null,
      },
      lastUpdatedBlock: Number(blockNumber),
    };
  }

  const bytecodeSize = (code.length - 2) / 2;
  const flags: string[] = [];
  if (bytecodeSize < 100) flags.push("very-small-bytecode");

  const proxyInfo = await detectProxyPattern(env, checksummed);

  // Try to read ERC-20 properties if it looks like a token
  let tokenProps: ContractRiskResult["tokenProperties"] | undefined;
  if (bytecodeSize > 500 && bytecodeSize < 50000) {
    try {
      const [name, symbol, decimals, supply] = await Promise.all([
        client.readContract({ address: checksummed, abi: erc20Abi, functionName: "name" }).catch(() => null),
        client.readContract({ address: checksummed, abi: erc20Abi, functionName: "symbol" }).catch(() => null),
        client.readContract({ address: checksummed, abi: erc20Abi, functionName: "decimals" }).catch(() => null),
        client.readContract({ address: checksummed, abi: erc20Abi, functionName: "totalSupply" }).catch(() => null),
      ]);

      if (symbol && decimals !== undefined) {
        const ownershipRenounced = (name === "UNCLAIMED") || ((name?.includes("burned")) ?? false);
        const pausable = false;

        if (supply && (BigInt(supply) as bigint) === 0n) flags.push("zero-total-supply");

        tokenProps = {
          name: name || null,
          symbol: symbol,
          decimals: decimals,
          totalSupply: supply?.toString() || null,
          ownershipRenounced,
          pausable,
        };
      }
    } catch {
      // Not an ERC-20 or read failed
    }
  }

  // Risk assessment
  const riskFlags = flags.filter(Boolean);
  if (proxyInfo.isProxy) riskFlags.push("proxy-pattern");
  if (txCount === 0) riskFlags.push("no-init-calls");
  if (bytecodeSize < 100) riskFlags.push("bytecode-too-small");
  if (tokenProps?.totalSupply === "0") riskFlags.push("zero-supply-token");
  if (proxyInfo.isProxy && !proxyInfo.impl) riskFlags.push("proxy-impl-unset");

  let riskLevel: "low" | "medium" | "high" | "critical" = "low";
  if (riskFlags.includes("zero-supply-token") || riskFlags.includes("proxy-impl-unset")) riskLevel = "critical";
  else if (riskFlags.length >= 3) riskLevel = "high";
  else if (riskFlags.length >= 2) riskLevel = "medium";

  return {
    chain: "base",
    address: checksummed,
    type: proxyInfo.isProxy ? "proxy" : type,
    riskLevel,
    riskFlags: riskFlags.sort(),
    summary: `${riskLevel} risk: ${riskFlags.length} flag(s). Bytecode ${bytecodeSize} bytes.`,
    facts: {
      bytecodeSize,
      deployedAt: null,
      hasCode: true,
      isProxy: proxyInfo.isProxy,
      proxyImplementation: proxyInfo.impl || null,
    },
    tokenProperties: tokenProps,
    lastUpdatedBlock: Number(blockNumber),
  };
}
