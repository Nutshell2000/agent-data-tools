import { HttpError, isAddress, type Env } from "../lib/env";
import { baseClient, erc20Abi } from "../lib/rpc";
import { getAddress } from "viem";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

function rpcErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) return "unknown";
  return "shortMessage" in error && typeof error.shortMessage === "string" ? error.shortMessage : error.message;
}

interface ContractRiskResult {
  chain: string;
  address: string;
  type: "eoa" | "contract" | "proxy" | "unknown";
  riskLevel: "not-applicable" | "low" | "medium" | "high" | "critical";
  riskFlags: string[];
  summary: string;
  facts: {
    bytecodeSize: number;
    deployedAt: string | null;
    hasCode: boolean;
    isProxy: boolean | null;
    proxyImplementation: string | null;
  };
  tokenProperties?: {
    name: string | null;
    symbol: string | null;
    decimals: number | null;
    totalSupply: string | null;
    owner: string | null;
    ownershipRenounced: boolean | null;
    paused: boolean | null;
  };
  lastUpdatedBlock: number;
}

async function detectProxyPattern(env: Env, address: `0x${string}`): Promise<{ isProxy: boolean | null; impl?: string }> {
  const client = baseClient(env);

  // EIP-1967: implementation slot 0x360894a13ba1a3210667c828492db98dca3e2f703ccf0b462f8b1d7b7ba7b206
  const slot = "0x360894a13ba1a3210667c828492db98dca3e2f703ccf0b462f8b1d7b7ba7b206";
  try {
    const val = await client.getStorageAt({ address, slot });
    if (!val || val === "0x") return { isProxy: null };
    if (val === "0x0000000000000000000000000000000000000000000000000000000000000000") return { isProxy: false };
    const impl = `0x${val.slice(-40)}`;
    if (impl.toLowerCase() === ZERO_ADDRESS) return { isProxy: true };
    return { isProxy: true, impl };
  } catch (e) {
    throw new HttpError(502, `Base RPC error: ${rpcErrorMessage(e)}`);
  }
}

export async function contractRisk(env: Env, address: string): Promise<ContractRiskResult> {
  if (!isAddress(address)) throw new HttpError(400, "address must be a 0x-prefixed 20-byte hex address");

  const checksummed = getAddress(address);
  const client = baseClient(env);

  const [code, blockNumber] = await Promise.all([
    client.getBytecode({ address: checksummed }),
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
      riskLevel: "not-applicable",
      riskFlags: [],
      summary: "Not applicable: no contract deployed at this address.",
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

  const proxyInfo = await detectProxyPattern(env, checksummed);

  // Try to read ERC-20 properties if it looks like a token
  let tokenProps: ContractRiskResult["tokenProperties"] | undefined;
  if (bytecodeSize > 500 && bytecodeSize < 50000) {
    const contract = { address: checksummed, abi: erc20Abi } as const;
    const calls = await client.multicall({
      allowFailure: true,
      contracts: [
        { ...contract, functionName: "name" },
        { ...contract, functionName: "symbol" },
        { ...contract, functionName: "decimals" },
        { ...contract, functionName: "totalSupply" },
        { ...contract, functionName: "owner" },
        { ...contract, functionName: "paused" },
      ],
    }).catch((e) => {
      throw new HttpError(502, `Base RPC error: ${e?.shortMessage ?? e?.message ?? "unknown"}`);
    });
    const [nameResult, symbolResult, decimalsResult, supplyResult, ownerResult, pausedResult] = calls;
    const name = nameResult.status === "success" ? nameResult.result : null;
    const symbol = symbolResult.status === "success" ? symbolResult.result : null;
    const decimals = decimalsResult.status === "success" ? decimalsResult.result : null;
    const supply = supplyResult.status === "success" ? supplyResult.result : null;
    const owner = ownerResult.status === "success" ? ownerResult.result : null;
    const paused = pausedResult.status === "success" ? pausedResult.result : null;

    if ([name, symbol, decimals, supply, owner, paused].some((value) => value !== null)) {
      tokenProps = {
        name,
        symbol,
        decimals,
        totalSupply: supply?.toString() ?? null,
        owner,
        ownershipRenounced: owner === null ? null : owner.toLowerCase() === ZERO_ADDRESS,
        paused,
      };
    }

    if (supply === 0n) flags.push("zero-supply-token");
  }

  // Risk assessment
  const riskFlags = flags.filter(Boolean);
  if (proxyInfo.isProxy) riskFlags.push("proxy-pattern");
  if (bytecodeSize < 100) riskFlags.push("bytecode-too-small");
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
