// EVM developer utilities computed locally with viem (1.56.0). Bazaar search on 24 Oct 2026, summed 30-day payers over the
// top 20 results, no listing of ours: "decode calldata" 38, "signature verify" 35, "address checksum" 23.
import { decodeFunctionData, getAddress, isAddress, parseAbiItem, recoverMessageAddress, toFunctionSelector, type AbiFunction, type Hex } from "viem";
import { entry, flag, need, opt, type Entry } from "../family";
import { HttpError } from "../lib/env";

const U = ["utility", "dev"];

/** Common functions tried when no signature is given (ERC-20, ERC-721, ERC-1155, WETH, multicall, Permit2-style approve). */
export const COMMON_SIGNATURES = [
  "transfer(address,uint256)", "transferFrom(address,address,uint256)", "approve(address,uint256)",
  "safeTransferFrom(address,address,uint256)", "safeTransferFrom(address,address,uint256,bytes)", "setApprovalForAll(address,bool)",
  "safeTransferFrom(address,address,uint256,uint256,bytes)", "safeBatchTransferFrom(address,address,uint256[],uint256[],bytes)",
  "deposit()", "withdraw(uint256)", "mint(address,uint256)", "burn(uint256)", "multicall(bytes[])", "multicall(uint256,bytes[])",
  "permit(address,address,uint256,uint256,uint8,bytes32,bytes32)", "increaseAllowance(address,uint256)", "decreaseAllowance(address,uint256)",
  // EIP-3009, used by x402 settlements and USDC gasless transfers (v,r,s and packed-signature forms).
  "transferWithAuthorization(address,address,uint256,uint256,uint256,bytes32,uint8,bytes32,bytes32)", "receiveWithAuthorization(address,address,uint256,uint256,uint256,bytes32,uint8,bytes32,bytes32)",
  "transferWithAuthorization(address,address,uint256,uint256,uint256,bytes32,bytes)",
];
const fnItem = (sig: string): AbiFunction => {
  const s = sig.trim().replace(/^function\s+/, "");
  if (!/^[A-Za-z_$][\w$]*\(.*\)$/.test(s) || s.length > 500) throw new HttpError(400, "signature must look like transfer(address,uint256)");
  try { return parseAbiItem(`function ${s}`) as AbiFunction; } catch { throw new HttpError(400, "signature is not a valid Solidity function signature"); }
};
const plain = (v: unknown): unknown => (typeof v === "bigint" ? v.toString() : Array.isArray(v) ? v.map(plain) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, plain(x)])) : v);

export function decodeCalldata(data: Hex, signature?: string) {
  const selector = data.slice(0, 10).toLowerCase();
  const candidates = signature ? [fnItem(signature)] : COMMON_SIGNATURES.map(fnItem).filter((f) => toFunctionSelector(f) === selector);
  if (!candidates.length) return { selector, decoded: false, reason: "unknown selector: pass the function signature (for example transfer(address,uint256))" };
  for (const item of candidates) {
    if (toFunctionSelector(item) !== selector) throw new HttpError(422, `the calldata selector ${selector} is not ${toFunctionSelector(item)} (${item.name})`);
    try {
      const d = decodeFunctionData({ abi: [item], data });
      const sig = `${item.name}(${item.inputs.map((i) => i.type).join(",")})`;
      return { selector, decoded: true, function: sig, args: item.inputs.map((input, i) => ({ type: input.type, value: plain(d.args?.[i]) })) };
    } catch { /* try the next candidate with this selector */ }
  }
  throw new HttpError(422, "the calldata does not decode with that signature (wrong argument types or truncated data)");
}

export const EVM_TOOLS: Entry[] = [
  entry("/evm/decode-calldata", "Decode calldata: function and arguments of an EVM call",
    "Decode EVM transaction calldata into the function and its arguments with viem: give the function signature (transfer(address,uint256)), or leave it out to try common ERC-20, ERC-721, ERC-1155, WETH, permit and multicall functions by selector. Numbers come back as decimal strings. Use to read what a pending or past transaction does before signing; get calldata from eth_tx. A selector that does not match is 422, uncharged.",
    ["decode-calldata", "calldata", "abi", "ethereum", "evm", ...U], {
      data: { type: "string", description: "0x calldata (selector plus ABI-encoded arguments), up to 8 KB", required: true, example: "0xa9059cbb000000000000000000000000d8da6bf26964af9d7eed9e03e53415d37aa960450000000000000000000000000000000000000000000000000000000000989680" },
      signature: { type: "string", description: "Optional function signature such as transfer(address,uint256)", example: "transfer(address,uint256)" },
    },
    { selector: "0xa9059cbb", decoded: true, function: "transfer(address,uint256)", args: [{ type: "address", value: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045" }, { type: "uint256", value: "10000000" }] },
    (_e, q) => {
      const data = need(q, "data", 16_400).trim().toLowerCase();
      if (!/^0x[0-9a-f]{8}([0-9a-f]{2})*$/.test(data)) throw new HttpError(400, "data must be 0x hex with at least a 4-byte selector and whole bytes");
      return decodeCalldata(data as Hex, opt(q, "signature", 500));
    }),

  entry("/evm/verify-signature", "Signature verify, EIP-191: recover the signer of an Ethereum message",
    "Verify an Ethereum personal_sign (EIP-191) signature: recover the address that signed a message and, given an expected address, say whether it matches. Works for ordinary wallets (EOAs); smart-contract wallets sign by ERC-1271, which this offline check does not cover. Use for sign-in-with-wallet, proving wallet ownership or checking a signed order. A malformed signature is 400, uncharged.",
    ["signature-verify", "verify-signature", "ethereum", "eip-191", "wallet", ...U], {
      message: { type: "string", description: "The exact message that was signed (or 0x hex with raw=true)", required: true, example: "hello" }, // example signed with the public Hardhat test key #0
      signature: { type: "string", description: "0x signature, 65 bytes (130 hex characters)", required: true, example: "0xf16ea9a3478698f695fd1401bfe27e9e4a7e8e3da94aa72b021125e31fa899cc573c48ea3fe1d4ab61a9db10c19032026e3ed2dbccba5a178235ac27f94504311c" },
      address: { type: "string", description: "Optional expected signer address to compare", example: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" },
      raw: { type: "string", description: "true to treat a 0x message as raw bytes instead of text", example: "false" },
    },
    { recovered: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266", expected: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266", valid: true, standard: "EIP-191 personal_sign" },
    async (_e, q) => {
      const message = need(q, "message", 10_000);
      const signature = need(q, "signature", 200).trim();
      if (!/^0x[0-9a-fA-F]{130}$/.test(signature)) throw new HttpError(400, "signature must be 0x followed by 130 hex characters (65 bytes)");
      const raw = flag(q, "raw");
      if (raw && !/^0x([0-9a-fA-F]{2})*$/.test(message)) throw new HttpError(400, "with raw=true the message must be 0x hex bytes");
      let recovered: string;
      try { recovered = await recoverMessageAddress({ message: raw ? { raw: message as Hex } : message, signature: signature as Hex }); }
      catch { throw new HttpError(400, "the signature is not a valid secp256k1 signature"); }
      const want = opt(q, "address", 64)?.trim();
      if (want && !isAddress(want, { strict: false })) throw new HttpError(400, "address must be a 0x address (40 hex characters)");
      return { recovered, expected: want ? getAddress(want.toLowerCase()) : null, valid: want ? recovered.toLowerCase() === want.toLowerCase() : null, standard: "EIP-191 personal_sign" };
    }),

  entry("/evm/checksum", "Address checksum (EIP-55): validate and format an EVM address",
    "Validate an EVM address and return its EIP-55 checksummed form, saying whether the input was all lower case, all upper case, correctly checksummed or mixed case with a wrong checksum (a likely typo). Works for every EVM chain. Use before sending funds or storing an address; for whether it is a contract use <chain>_is_contract.",
    ["address-checksum", "eip-55", "address", "evm", "validation", ...U], { address: { type: "string", description: "0x address (40 hex characters)", required: true, example: "0xd8da6bf26964af9d7eed9e03e53415d37aa96045" } },
    { input: "0xd8da6bf26964af9d7eed9e03e53415d37aa96045", valid: true, checksummed: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045", inputCase: "lower", checksumMatches: null },
    (_e, q) => {
      // Read the raw value: the shared input normaliser lowercases inputs named "address", which would hide the input's case.
      const input = need(q, "address", 64).trim();
      if (!/^0x[0-9a-fA-F]{40}$/.test(input)) return { input, valid: false, checksummed: null, inputCase: null, checksumMatches: null, reason: "not 0x followed by 40 hex characters" };
      const body = input.slice(2);
      const checksummed = getAddress(input.toLowerCase());
      const inputCase = body === body.toLowerCase() ? "lower" : body === body.toUpperCase() ? "upper" : "mixed";
      const matches = inputCase === "mixed" ? input === checksummed : null;
      return { input, valid: matches !== false, checksummed, inputCase, checksumMatches: matches, ...(matches === false ? { reason: "mixed case that does not match the EIP-55 checksum: probably a typo" } : {}) };
    }),
];
