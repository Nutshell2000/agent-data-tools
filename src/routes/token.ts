import { formatUnits, hexToBigInt, keccak256, toBytes, toFunctionSelector, toHex } from "viem";
import { HttpError, isAddress, type Env } from "../lib/env";
import { baseClient, erc20Abi } from "../lib/rpc";

const ZERO = "0x0000000000000000000000000000000000000000";
const DEAD = "0x000000000000000000000000000000000000dead";
// EIP-1967 storage slots are keccak256(label) - 1. The older ZeppelinOS layout
// (used by USDC's FiatTokenProxy) is keccak256(label) with no offset.
const eip1967Slot = (label: string) => toHex(hexToBigInt(keccak256(toBytes(label))) - 1n, { size: 32 });
type Slot = `0x${string}`;
let slots: { impl: Slot; admin: Slot; legacyImpl: Slot; legacyAdmin: Slot } | undefined;
const proxySlots = () =>
  (slots ??= {
    impl: eip1967Slot("eip1967.proxy.implementation"),
    admin: eip1967Slot("eip1967.proxy.admin"),
    legacyImpl: keccak256(toBytes("org.zeppelinos.proxy.implementation")),
    legacyAdmin: keccak256(toBytes("org.zeppelinos.proxy.admin")),
  });
const MINIMAL_PROXY_PREFIX = "363d3d373d3d3d363d73";

// Function signatures looked for in the bytecode. Presence is a heuristic, not proof.
const CAPABILITIES: Record<string, string[]> = {
  mint: ["mint(address,uint256)", "mint(uint256)"],
  burn: ["burn(uint256)", "burnFrom(address,uint256)"],
  pause: ["pause()", "unpause()"],
  blacklist: [
    "blacklist(address)",
    "addBlackList(address)",
    "setBlacklist(address,bool)",
    "blacklistAddress(address,bool)",
    "freeze(address)",
  ],
  feeSetter: ["setFee(uint256)", "setTaxFee(uint256)", "setFees(uint256,uint256)", "setTax(uint256)"],
  ownershipTransfer: ["transferOwnership(address)"],
};

let selectors: Record<string, string[]> | undefined;
const capabilitySelectors = () =>
  (selectors ??= Object.fromEntries(
    Object.entries(CAPABILITIES).map(([k, sigs]) => [
      k,
      sigs.map((s) => toFunctionSelector(`function ${s}`).slice(2)),
    ]),
  ));

const slotAddress = (word?: string) =>
  word && BigInt(word) !== 0n ? (`0x${word.slice(-40)}` as const) : null;

export async function tokenInfo(env: Env, address: string) {
  if (!isAddress(address)) throw new HttpError(400, "address must be a 0x-prefixed 20-byte hex address");
  const client = baseClient(env);
  const contract = { address, abi: erc20Abi } as const;

  const [code, calls, implWord, adminWord, legacyImplWord, legacyAdminWord, blockNumber] = await Promise.all([
    client.getCode({ address }),
    client.multicall({
      allowFailure: true,
      contracts: [
        { ...contract, functionName: "name" },
        { ...contract, functionName: "symbol" },
        { ...contract, functionName: "decimals" },
        { ...contract, functionName: "totalSupply" },
        { ...contract, functionName: "owner" },
        { ...contract, functionName: "paused" },
      ],
    }),
    client.getStorageAt({ address, slot: proxySlots().impl }),
    client.getStorageAt({ address, slot: proxySlots().admin }),
    client.getStorageAt({ address, slot: proxySlots().legacyImpl }),
    client.getStorageAt({ address, slot: proxySlots().legacyAdmin }),
    client.getBlockNumber(),
  ]).catch((e) => {
    throw new HttpError(502, `Base RPC error: ${e?.shortMessage ?? e?.message ?? "unknown"}`);
  });

  if (!code || code === "0x") throw new HttpError(404, "no contract deployed at this address on Base");

  const val = <T>(r: { status: string; result?: unknown }) => (r.status === "success" ? (r.result as T) : null);
  const [name, symbol, decimals, totalSupply, owner, paused] = [
    val<string>(calls[0]),
    val<string>(calls[1]),
    val<number>(calls[2]),
    val<bigint>(calls[3]),
    val<string>(calls[4]),
    val<boolean>(calls[5]),
  ];
  if (decimals === null && totalSupply === null) {
    throw new HttpError(422, "contract does not implement the ERC-20 interface");
  }

  const hex = code.slice(2).toLowerCase();
  const eip1967Impl = slotAddress(implWord);
  const implementation = eip1967Impl ?? slotAddress(legacyImplWord);
  const minimalProxy = hex.startsWith(MINIMAL_PROXY_PREFIX);
  const capabilities = Object.fromEntries(
    Object.entries(capabilitySelectors()).map(([k, sels]) => [k, sels.some((s) => hex.includes(s))]),
  );
  const ownerLc = owner?.toLowerCase() ?? null;

  return {
    chain: "base",
    chainId: 8453,
    address,
    name,
    symbol,
    decimals,
    totalSupply: totalSupply?.toString() ?? null,
    totalSupplyFormatted: totalSupply !== null && decimals !== null ? formatUnits(totalSupply, decimals) : null,
    owner,
    ownershipRenounced: ownerLc === null ? null : ownerLc === ZERO || ownerLc === DEAD,
    paused,
    proxy: {
      isProxy: implementation !== null || minimalProxy,
      kind: eip1967Impl ? "eip1967" : implementation ? "zeppelinos-legacy" : minimalProxy ? "eip1167-minimal" : null,
      implementation: implementation ?? (minimalProxy ? `0x${hex.slice(20, 60)}` : null),
      admin: slotAddress(adminWord) ?? slotAddress(legacyAdminWord),
    },
    bytecodeSize: hex.length / 2,
    // For proxies the logic lives in the implementation, so these reflect the proxy shell only.
    capabilities,
    notes: [
      "capabilities are bytecode selector heuristics; a proxy's flags describe the proxy, not its implementation",
      "owner is null when the contract has no owner() function",
    ],
    blockNumber: Number(blockNumber),
  };
}
