import { createPublicClient, fallback, formatEther, formatGwei, formatUnits, http, type PublicClient } from "viem";
import { mainnet } from "viem/chains";
import { normalize } from "viem/ens";
import { HttpError, isAddress, type Env } from "../lib/env";
import { baseClient, erc20Abi, rpcUrls } from "../lib/rpc";

const allowanceAbi = [
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [{ type: "address" }, { type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

// Above this, an approval is "unlimited" for every practical purpose.
const UNLIMITED = 2n ** 255n;

/** One Base transaction: who, what, whether it succeeded and what it cost. */
export async function baseTransaction(env: Env, input: string) {
  const hash = input.trim();
  if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new HttpError(400, "hash must be a transaction hash: 0x followed by 64 hex characters");
  const client = baseClient(env);
  let tx, receipt, head;
  try {
    [tx, receipt, head] = await Promise.all([
      client.getTransaction({ hash: hash as `0x${string}` }).catch(() => null),
      client.getTransactionReceipt({ hash: hash as `0x${string}` }).catch(() => null),
      client.getBlockNumber(),
    ]);
  } catch {
    throw new HttpError(502, "the Base network did not respond");
  }
  if (!tx) throw new HttpError(404, "no transaction with this hash on Base");
  const block = receipt ? await client.getBlock({ blockNumber: receipt.blockNumber }).catch(() => null) : null;
  return {
    chain: "base",
    hash: tx.hash,
    status: receipt ? receipt.status : "pending",
    from: tx.from,
    to: tx.to,
    // Set when the transaction created a contract.
    contractCreated: receipt?.contractAddress ?? null,
    valueEth: formatEther(tx.value),
    nonce: tx.nonce,
    // First four bytes of the call data: which function was called. Null for a plain transfer.
    methodId: tx.input.length >= 10 ? tx.input.slice(0, 10) : null,
    blockNumber: receipt ? Number(receipt.blockNumber) : null,
    blockTime: block ? new Date(Number(block.timestamp) * 1000).toISOString() : null,
    confirmations: receipt ? Number(head - receipt.blockNumber) + 1 : 0,
    gasUsed: receipt ? Number(receipt.gasUsed) : null,
    gasPriceGwei: receipt ? formatGwei(receipt.effectiveGasPrice) : null,
    // Execution cost on Base only, without the small fee for posting to Ethereum.
    executionFeeEth: receipt ? formatEther(receipt.gasUsed * receipt.effectiveGasPrice) : null,
    logCount: receipt ? receipt.logs.length : null,
    checkedAt: new Date().toISOString(),
  };
}

/** How much of an owner's token a spender is allowed to move. */
export async function baseAllowance(env: Env, tokenInput: string, ownerInput: string, spenderInput: string) {
  const [token, owner, spender] = [tokenInput, ownerInput, spenderInput].map((v) => v.trim());
  if (!isAddress(token)) throw new HttpError(400, "token must be an ERC-20 contract address on Base (0x...)");
  if (!isAddress(owner)) throw new HttpError(400, "owner must be a wallet address (0x...)");
  if (!isAddress(spender)) throw new HttpError(400, "spender must be an address (0x...)");
  const client = baseClient(env);
  let allowance: bigint, decimals: number, symbol: string | null;
  try {
    [allowance, decimals, symbol] = await Promise.all([
      client.readContract({ address: token, abi: allowanceAbi, functionName: "allowance", args: [owner, spender] }),
      client.readContract({ address: token, abi: erc20Abi, functionName: "decimals" }),
      client.readContract({ address: token, abi: erc20Abi, functionName: "symbol" }).catch(() => null),
    ]);
  } catch {
    throw new HttpError(422, "this address does not answer as an ERC-20 token on Base");
  }
  return {
    chain: "base",
    token,
    symbol,
    decimals,
    owner,
    spender,
    allowance: allowance.toString(),
    allowanceFormatted: formatUnits(allowance, decimals),
    unlimited: allowance >= UNLIMITED,
    approved: allowance > 0n,
    checkedAt: new Date().toISOString(),
  };
}

let ethereum: PublicClient | undefined;

/** ENS lives on Ethereum mainnet, so it needs its own client. */
function ethereumClient(): PublicClient {
  const options = { timeout: 8_000, retryCount: 0 };
  return (ethereum ??= createPublicClient({
    chain: mainnet,
    transport: fallback(rpcUrls("eth").map((u) => http(u, options)), { rank: false }),
  }) as PublicClient);
}

/** ENS name to address, or address to its primary ENS name. */
export async function ensLookup(input: string) {
  const query = input.trim();
  const client = ethereumClient();
  if (isAddress(query)) {
    let name: string | null;
    try {
      name = await client.getEnsName({ address: query });
    } catch {
      throw new HttpError(502, "the Ethereum network did not respond");
    }
    if (name === null) throw new HttpError(404, "this address has no primary ENS name");
    return { query, type: "address", address: query, name, checkedAt: new Date().toISOString() };
  }
  let name: string;
  try {
    name = normalize(query);
  } catch {
    throw new HttpError(400, "name must be an ENS name such as vitalik.eth, or an address (0x...)");
  }
  if (!name.includes(".")) throw new HttpError(400, "name must be an ENS name such as vitalik.eth, or an address (0x...)");
  let address: string | null, avatar: string | null;
  try {
    [address, avatar] = await Promise.all([client.getEnsAddress({ name }), client.getEnsAvatar({ name }).catch(() => null)]);
  } catch {
    throw new HttpError(502, "the Ethereum network did not respond");
  }
  if (address === null) throw new HttpError(404, "this ENS name is not registered or has no address set");
  return { query, type: "name", name, address, avatar, checkedAt: new Date().toISOString() };
}
