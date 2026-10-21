// One-call counterparty check on Base, Ethereum, Arbitrum or Optimism: OFAC SDN address match,
// wallet or contract heuristics (Base only) and USD holdings, with a single verdict. Composes existing tools, so no new data source.
// All parts must answer: a partial check would read as a clean one, so any failure fails
// the call (uncharged) rather than returning a verdict with a gap.
import { getAddress } from "viem";
import { entry, pick, type Entry } from "../family";
import { HttpError, isAddress } from "../lib/env";
import { CHAINS, client, rpc } from "./chain-reads";
import { contractRisk } from "./contract-risk";
import { PRICES } from "./prices";
import { screen, sdnIndex } from "./sanctions";
import { walletAudit } from "./wallet-audit";

interface Risk { riskLevel: string; riskFlags: string[] }

/** block on any SDN match; review on high or critical heuristics; otherwise pass. */
export function verdict(matches: Record<string, unknown>[], account: Risk, contract: Risk | null) {
  const reasons: string[] = [];
  if (matches.length) reasons.push(`address is on the OFAC SDN list (${[...new Set(matches.map((m) => m.name))].join(", ")})`);
  if (account.riskLevel === "high") reasons.push(`wallet heuristics: ${account.riskFlags.join(", ")}`);
  if (contract && (contract.riskLevel === "high" || contract.riskLevel === "critical")) reasons.push(`contract heuristics: ${contract.riskFlags.join(", ")}`);
  return { verdict: matches.length ? "block" : reasons.length ? "review" : "pass", reasons };
}

const CHAIN_SLUGS = ["base", "eth", "arb", "op"] as [string, ...string[]];
const portfolio = PRICES.find((e) => e.endpoint.path === "/wallet/portfolio")!;

export const COUNTERPARTY: Entry[] = [
  entry("/check/counterparty", "Screen a payee before paying: EVM address risk check (OFAC and on-chain signals)",
    "Screen a payee before paying, trading or onboarding: one call vets an address on Base, Ethereum, Arbitrum or Optimism with an OFAC SDN address match, account type and activity, USD holdings and, on Base, wallet risk heuristics (or contract bytecode and proxy checks), combined into a block, review or pass verdict with reasons. Screening aid, not legal advice or a security audit. Use before paying, trading with or onboarding an address.",
    ["payee-screening", "compliance", "sanctions", "ofac", "wallet", "risk", "base", "ethereum"], {
      address: { type: "string", description: "0x address to check", required: true, example: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045" },
      chain: { type: "string", description: "Network: base (default), eth, arb or op", enum: CHAIN_SLUGS, example: "base" },
    },
    {
      address: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045", chain: "base", verdict: "pass", reasons: [],
      sanctions: { listed: false, matches: [], listDate: "2026-10-17T20:15:00.000Z" },
      account: { type: "eoa", riskLevel: "low", riskFlags: [], accountNonce: 1234 },
      contract: null,
      holdings: { totalUsd: 1234.56, tokensChecked: 9 },
      limitations: [],
      note: "Screening aid only: confirm any sanctions match against the official OFAC record; heuristics are not a security audit.",
    },
    async (env, q) => {
      const address = q("address")?.trim() ?? "";
      if (!isAddress(address)) throw new HttpError(400, "address must be a 0x-prefixed 20-byte hex address, e.g. 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045");
      const slug = pick(q, "chain", CHAIN_SLUGS, "base");
      const holdingsOf = () => portfolio.run(env, (name) => (name === "address" ? address : name === "chain" ? slug : undefined)) as Promise<{ totalUsd: number; tokensChecked: number }>;
      const note = "Screening aid only: confirm any sanctions match against the official OFAC record; heuristics are not a security audit.";
      if (slug !== "base") {
        // Wallet and contract heuristics exist for Base only; elsewhere report type and activity.
        const cl = client(env, CHAINS.find((c) => c.slug === slug)!);
        const owner = getAddress(address);
        const [index, value, code, nonce] = await Promise.all([
          sdnIndex(), holdingsOf(), rpc(() => cl.getCode({ address: owner })), rpc(() => cl.getTransactionCount({ address: owner })),
        ]);
        const matches = screen(index, address, undefined);
        const type = !code || code === "0x" ? "eoa" : code.startsWith("0xef0100") ? "eoa-delegated" : "contract";
        return {
          address: getAddress(address), chain: slug,
          ...verdict(matches, { riskLevel: "not-assessed", riskFlags: [] }, null),
          sanctions: { listed: matches.length > 0, matches, listDate: index.listDate },
          account: { type, riskLevel: null, riskFlags: [], accountNonce: nonce },
          contract: null,
          holdings: { totalUsd: value.totalUsd, tokensChecked: value.tokensChecked },
          limitations: ["wallet and contract risk heuristics run on Base only; this chain gets sanctions, account type, nonce and holdings"],
          note,
        };
      }
      const [index, audit, value] = await Promise.all([sdnIndex(), walletAudit(env, address), holdingsOf()]);
      const contract = audit.type === "contract" ? await contractRisk(env, address) : null;
      const matches = screen(index, address, undefined);
      return {
        address: audit.address, chain: "base",
        ...verdict(matches, audit, contract),
        sanctions: { listed: matches.length > 0, matches, listDate: index.listDate },
        account: { type: audit.type, riskLevel: audit.riskLevel, riskFlags: audit.riskFlags, accountNonce: audit.accountNonce },
        contract: contract && { riskLevel: contract.riskLevel, riskFlags: contract.riskFlags },
        holdings: { totalUsd: value.totalUsd, tokensChecked: value.tokensChecked },
        limitations: [],
        note,
      };
    }, "$0.03"),
];
