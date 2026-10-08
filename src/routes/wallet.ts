import { formatEther, formatUnits } from "viem";
import { HttpError, isAddress, type Env } from "../lib/env";
import { baseClient, erc20Abi } from "../lib/rpc";

// Widely held Base tokens checked on every call. Symbol and decimals are read from chain.
const DEFAULT_TOKENS = [
  "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", // USDC
  "0x4200000000000000000000000000000000000006", // WETH
  "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf", // cbBTC
  "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb", // DAI
  "0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA", // USDbC
  "0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22", // cbETH
  "0x940181a94A35A4569E4529A3CDfB74e38FD98631", // AERO
  "0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42", // EURC
] as const;
const MAX_EXTRA_TOKENS = 20;

export async function walletInfo(env: Env, address: string, extraTokens?: string) {
  if (!isAddress(address)) throw new HttpError(400, "address must be a 0x-prefixed 20-byte hex address");
  const extras = (extraTokens ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  if (extras.length > MAX_EXTRA_TOKENS) throw new HttpError(400, `tokens accepts at most ${MAX_EXTRA_TOKENS} addresses`);
  if (!extras.every(isAddress)) throw new HttpError(400, "tokens must be comma-separated 0x addresses");

  const tokens = [...new Set([...DEFAULT_TOKENS, ...extras].map((t) => t.toLowerCase()))] as `0x${string}`[];
  const client = baseClient(env);

  const [balance, txCount, code, calls, blockNumber] = await Promise.all([
    client.getBalance({ address }),
    client.getTransactionCount({ address }),
    client.getCode({ address }),
    client.multicall({
      allowFailure: true,
      contracts: tokens.flatMap((token) => [
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
  // EIP-7702: an EOA that delegates execution has code 0xef0100 || address.
  const delegatedTo = hex.startsWith("0xef0100") && hex.length === 48 ? `0x${hex.slice(8)}` : null;

  const balances = tokens.flatMap((token, i) => {
    const [bal, sym, dec] = calls.slice(i * 3, i * 3 + 3);
    if (bal.status !== "success" || dec.status !== "success") return [];
    const raw = bal.result as bigint;
    const decimals = dec.result as number;
    return [
      {
        address: token,
        symbol: sym.status === "success" ? (sym.result as string) : null,
        decimals,
        balance: raw.toString(),
        balanceFormatted: formatUnits(raw, decimals),
      },
    ];
  });

  return {
    chain: "base",
    chainId: 8453,
    address,
    type: delegatedTo ? "eoa-delegated" : hex === "0x" ? "eoa" : "contract",
    delegatedTo,
    eth: { wei: balance.toString(), formatted: formatEther(balance) },
    transactionCount: txCount,
    tokens: balances.filter((t) => t.balance !== "0"),
    tokensChecked: balances.length,
    blockNumber: Number(blockNumber),
  };
}
