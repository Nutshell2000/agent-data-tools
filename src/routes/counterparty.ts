// One-call counterparty check on Base: OFAC SDN address match, wallet or contract heuristics
// and USD holdings, with a single verdict. Composes existing tools, so no new data source.
// All parts must answer: a partial check would read as a clean one, so any failure fails
// the call (uncharged) rather than returning a verdict with a gap.
import { entry, type Entry } from "../family";
import { HttpError, isAddress } from "../lib/env";
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

const portfolio = PRICES.find((e) => e.endpoint.path === "/wallet/portfolio")!;

export const COUNTERPARTY: Entry[] = [
  entry("/check/counterparty", "Counterparty check before paying a Base address",
    "One call to vet a Base address before paying, trading or onboarding: OFAC SDN address match, wallet risk heuristics (or contract bytecode and proxy checks if it is a contract) and USD holdings, combined into a verdict of block, review or pass with the reasons. Cheaper than buying the parts. Screening aid, not legal advice or a security audit. Use before paying, trading with or onboarding an address.",
    ["compliance", "sanctions", "ofac", "wallet", "risk", "base"], {
      address: { type: "string", description: "0x address on Base to check", required: true, example: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045" },
    },
    {
      address: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045", chain: "base", verdict: "pass", reasons: [],
      sanctions: { listed: false, matches: [], listDate: "2026-10-17T20:15:00.000Z" },
      account: { type: "eoa", riskLevel: "low", riskFlags: [], accountNonce: 1234 },
      contract: null,
      holdings: { totalUsd: 1234.56, tokensChecked: 9 },
      note: "Screening aid only: confirm any sanctions match against the official OFAC record; heuristics are not a security audit.",
    },
    async (env, q) => {
      const address = q("address")?.trim() ?? "";
      if (!isAddress(address)) throw new HttpError(400, "address must be a 0x-prefixed 20-byte hex address, e.g. 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045");
      const [index, audit, value] = await Promise.all([
        sdnIndex(),
        walletAudit(env, address),
        portfolio.run(env, (name) => (name === "address" ? address : name === "chain" ? "base" : undefined)) as Promise<{ totalUsd: number; tokensChecked: number }>,
      ]);
      const contract = audit.type === "contract" ? await contractRisk(env, address) : null;
      const matches = screen(index, address, undefined);
      return {
        address: audit.address, chain: "base",
        ...verdict(matches, audit, contract),
        sanctions: { listed: matches.length > 0, matches, listDate: index.listDate },
        account: { type: audit.type, riskLevel: audit.riskLevel, riskFlags: audit.riskFlags, accountNonce: audit.accountNonce },
        contract: contract && { riskLevel: contract.riskLevel, riskFlags: contract.riskFlags },
        holdings: { totalUsd: value.totalUsd, tokensChecked: value.tokensChecked },
        note: "Screening aid only: confirm any sanctions match against the official OFAC record; heuristics are not a security audit.",
      };
    }, "$0.03"),
];
