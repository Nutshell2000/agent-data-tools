// The wallets this service is paid at, declared where trust checkers read them (11 Nov 2026).
//
// PAY_TO moved on 7 Nov 2026 (1.104.0). To a checker that watches sellers for hijacks, an undeclared change of payout
// wallet looks the same as a takeover: Lumière PayCheck capped every tool of ours at grade C, "pay only small amounts",
// with "1 payout-wallet change nobody could confirm yet" (the points alone gave 93); Keptvow and Hagglyai flagged a
// wallet mismatch, because 620 of our 672 Coinbase Bazaar listings still showed the old wallet (a listing keeps the terms
// of its last settlement). Lumière reads `https://<host>/.well-known/paycheck.json` every six hours: wallets listed
// there may be switched between without a flag, and a wallet that is NOT listed is blocked at once.
//
// So this list must hold every wallet a live quote can name: the current EVM wallet, the Tempo one, the Solana one, and
// every earlier wallet that a catalogue may still show. When PAY_TO changes again, add the old address to
// PREVIOUS_PAY_TO in the same release; never remove one while a listing can still carry it.
import { getAddress, isAddress } from "viem";
import type { Env } from "./env";

/** Earlier payout wallets that are still the owner's. 0x2074…77f5: her Coinbase Wallet, PAY_TO until 7 Nov 2026. */
export const PREVIOUS_PAY_TO: readonly string[] = ["0x2074c40346ae2a90e0e4a391bcee6f16bf5277f5"];

/** Every payout wallet, current first, EVM addresses checksummed, without repeats. */
export function payoutWallets(env: Pick<Env, "PAY_TO" | "SOLANA_PAY_TO" | "TEMPO_PAY_TO">): string[] {
  const evm = [env.PAY_TO, env.TEMPO_PAY_TO, ...PREVIOUS_PAY_TO].filter((a): a is string => typeof a === "string" && isAddress(a)).map((a) => getAddress(a));
  const solana = typeof env.SOLANA_PAY_TO === "string" && env.SOLANA_PAY_TO.trim() ? [env.SOLANA_PAY_TO.trim()] : [];
  return [...new Set([...evm, ...solana])];
}

/**
 * The declaration file. `tests` are known-answer checks a checker may run with its own paid call: only tools whose
 * answer never changes belong here (a hash of a fixed text), so a pass means the tool computed the value.
 * After a release that changes this file, have it read at once (it is otherwise re-read every six hours):
 * `curl -X POST https://lumierepaycheck.org/v1/declaration -H "content-type: application/json" -d '{"url":"<origin>/time"}'`.
 */
export function paycheckDeclaration(env: Pick<Env, "PAY_TO" | "SOLANA_PAY_TO" | "TEMPO_PAY_TO">) {
  return { payTo: payoutWallets(env), tests: KNOWN_ANSWER_TESTS };
}

type KnownAnswerTest = { name: string; query: Record<string, string>; expect: { path: string; equals: string | number | boolean }[] };
/**
 * 1.114.0: ten more, all pure computation (`LOCAL_PATHS`), each on the tool's published example. Lumière's list of top
 * endpoints is the ones with a passed paid test AND "values checked"; with one test we could reach that on one tool.
 * tests/empty-defaults-1114.test.cjs runs every entry against the tool itself, so a wrong answer cannot be published.
 * Not here on purpose: anything read from an outside source (a sanctions list, a web page, a price), because a test
 * that fails for a reason outside the tool lowers the grade.
 */
export const KNOWN_ANSWER_TESTS: Readonly<Record<string, readonly KnownAnswerTest[]>> = {
  "/keccak": [{ name: "selector of transfer(address,uint256)", query: { text: "transfer(address,uint256)" }, expect: [{ path: "$.selector", equals: "0xa9059cbb" }] }],
  "/hash": [{ name: "SHA-256 of hello", query: { text: "hello" }, expect: [{ path: "$.hex", equals: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824" }] }],
  "/hmac": [{ name: "HMAC-SHA256 of hello with the key secret", query: { message: "hello", key: "secret" }, expect: [{ path: "$.hex", equals: "88aab3ede8d3adf94d26ab90d3bafd4a2083070c3bcce9c014ee04a443847c0b" }] }],
  "/base64/encode": [{ name: "base64 of hello world", query: { text: "hello world" }, expect: [{ path: "$.base64", equals: "aGVsbG8gd29ybGQ=" }] }],
  "/base64/decode": [{ name: "aGVsbG8gd29ybGQ= decoded", query: { text: "aGVsbG8gd29ybGQ=" }, expect: [{ path: "$.text", equals: "hello world" }] }],
  "/number/roman": [{ name: "2026 in Roman numerals", query: { number: "2026" }, expect: [{ path: "$.roman", equals: "MMXXVI" }] }],
  "/date/diff": [{ name: "days from 2026-01-01 to 2026-10-18", query: { from: "2026-01-01", to: "2026-10-18" }, expect: [{ path: "$.days", equals: 290 }] }],
  "/evm/checksum": [{ name: "EIP-55 checksum of a lower-case address", query: { address: "0xd8da6bf26964af9d7eed9e03e53415d37aa96045" }, expect: [{ path: "$.checksummed", equals: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045" }] }],
  "/validate/iban": [{ name: "a valid Swedish IBAN", query: { iban: "SE45 5000 0000 0583 9825 7466" }, expect: [{ path: "$.valid", equals: true }, { path: "$.country", equals: "SE" }] }],
  "/math/evaluate": [{ name: "(1500 * 0.045 / 12) + sqrt(144) - 2^3", query: { expression: "(1500 * 0.045 / 12) + sqrt(144) - 2^3" }, expect: [{ path: "$.value", equals: 9.625 }] }],
  "/ip/cidr": [{ name: "192.168.1.0/24", query: { cidr: "192.168.1.0/24" }, expect: [{ path: "$.usableHosts", equals: 254 }, { path: "$.broadcast", equals: "192.168.1.255" }] }],
};
