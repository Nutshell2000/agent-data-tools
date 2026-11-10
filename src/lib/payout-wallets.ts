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
 */
export function paycheckDeclaration(env: Pick<Env, "PAY_TO" | "SOLANA_PAY_TO" | "TEMPO_PAY_TO">) {
  return {
    payTo: payoutWallets(env),
    tests: {
      "/keccak": [{ name: "selector of transfer(address,uint256)", query: { text: "transfer(address,uint256)" }, expect: [{ path: "$.selector", equals: "0xa9059cbb" }] }],
    },
  };
}
