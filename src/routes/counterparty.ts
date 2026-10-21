// One-call counterparty check on Base, Ethereum, Arbitrum or Optimism: OFAC SDN address match,
// wallet or contract heuristics (Base only) and USD holdings, with a single verdict. Composes existing tools, so no new data source.
// All parts must answer: a partial check would read as a clean one, so any failure fails
// the call (uncharged) rather than returning a verdict with a gap.
import { getAddress } from "viem";
import { entry, pick, type Entry } from "../family";
import { HttpError, isAddress } from "../lib/env";
import { CHAINS, client, rpc } from "./chain-reads";
import { contractRisk } from "./contract-risk";
import { domainReport } from "./domain-report";
import { PRICES } from "./prices";
import { screen, sdnIndex } from "./sanctions";
import { walletAudit } from "./wallet-audit";

interface Risk { riskLevel: string; riskFlags: string[] }
interface DomainFlag { level: string; code: string; message: string }

/** block on any SDN match; review on high or critical heuristics or a high-severity domain flag; otherwise pass. */
export function verdict(matches: Record<string, unknown>[], account: Risk, contract: Risk | null, domainFlags: DomainFlag[] = []) {
  const reasons: string[] = [];
  if (matches.length) reasons.push(`address is on the OFAC SDN list (${[...new Set(matches.map((m) => m.name))].join(", ")})`);
  // The heuristics run on Base only; naming it keeps "zero-account-nonce" from reading as "never transacted".
  if (account.riskLevel === "high") reasons.push(`wallet heuristics on Base: ${account.riskFlags.join(", ")}`);
  if (contract && (contract.riskLevel === "high" || contract.riskLevel === "critical")) reasons.push(`contract heuristics on Base: ${contract.riskFlags.join(", ")}`);
  const domainHigh = domainFlags.filter((f) => f.level === "high");
  if (domainHigh.length) reasons.push(`payee domain: ${domainHigh.map((f) => f.message).join(" ")}`);
  return { verdict: matches.length ? "block" : reasons.length ? "review" : "pass", reasons };
}

const CHAIN_SLUGS = ["base", "eth", "arb", "op"] as [string, ...string[]];
/** Every chain we read, since a payee check needs no Base-only heuristics. */
const PAYEE_CHAINS = ["base", "eth", "arb", "op", "polygon"] as [string, ...string[]];

/** eoa, eoa-delegated (EIP-7702) or contract, from the address's code. */
const accountType = (code: string | undefined) => (!code || code === "0x" ? "eoa" : code.startsWith("0xef0100") ? "eoa-delegated" : "contract");

/** The payee's domain from a bare name or a URL ("https://shop.example.com/pay" -> "shop.example.com"). */
export function payeeDomain(raw: string | undefined): string | undefined {
  const text = raw?.trim();
  if (!text) return undefined;
  try { return new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`).hostname.replace(/^www\./, "") || undefined; } catch { throw new HttpError(400, "domain must be a domain or URL such as example.com"); }
}

/** The domain part of the result: age and trust from /domain-report, or null when no domain was given. */
async function domainPart(env: Parameters<typeof domainReport>[0], name: string | undefined) {
  if (!name) return null;
  const r = await domainReport(env, name);
  return { name: r.domain, trust: r.trust, ageDays: r.facts.ageDays, registeredAt: r.facts.registeredAt, flags: r.flags };
}
const portfolio = PRICES.find((e) => e.endpoint.path === "/wallet/portfolio")!;

export const COUNTERPARTY: Entry[] = [
  entry("/check/counterparty", "Screen a payee before paying: EVM address risk check (OFAC and on-chain signals)",
    "Screen a payee before paying, trading or onboarding: one call vets an address on Base, Ethereum, Arbitrum or Optimism with an OFAC SDN match, account type and activity, USD holdings and, on Base, wallet or contract risk checks; add the payee's domain for its age and trust flags. One block, review or pass verdict with reasons. Screening aid, not legal advice or a security audit. Use before paying, trading with or onboarding an address.",
    ["payee-screening", "compliance", "sanctions", "ofac", "wallet", "risk", "base", "ethereum"], {
      address: { type: "string", description: "0x address to check", required: true, example: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045" },
      chain: { type: "string", description: "Network: base (default), eth, arb or op", enum: CHAIN_SLUGS, example: "base" },
      domain: { type: "string", description: "Optional: the payee's domain or website URL, e.g. ethereum.org; adds domain age and trust flags", example: "ethereum.org" },
    },
    {
      address: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045", chain: "base", verdict: "pass", reasons: [],
      sanctions: { listed: false, matches: [], listDate: "2026-10-17T20:15:00.000Z" },
      account: { type: "eoa", riskLevel: "low", riskFlags: [], accountNonce: 1234 },
      contract: null,
      domain: { name: "ethereum.org", trust: "high", ageDays: 4100, registeredAt: "2015-03-21T00:00:00Z", flags: [] },
      holdings: { totalUsd: 1234.56, tokensChecked: 9 },
      limitations: [],
      note: "Screening aid only: confirm any sanctions match against the official OFAC record; heuristics are not a security audit.",
    },
    async (env, q) => {
      const address = q("address")?.trim() ?? "";
      if (!isAddress(address)) throw new HttpError(400, "address must be a 0x-prefixed 20-byte hex address, e.g. 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045");
      const slug = pick(q, "chain", CHAIN_SLUGS, "base");
      const domainName = payeeDomain(q("domain"));
      const holdingsOf = () => portfolio.run(env, (name) => (name === "address" ? address : name === "chain" ? slug : undefined)) as Promise<{ totalUsd: number; tokensChecked: number }>;
      const note = "Screening aid only: confirm any sanctions match against the official OFAC record; heuristics are not a security audit.";
      if (slug !== "base") {
        // Wallet and contract heuristics exist for Base only; elsewhere report type and activity.
        const cl = client(env, CHAINS.find((c) => c.slug === slug)!);
        const owner = getAddress(address);
        const [index, value, code, nonce, domain] = await Promise.all([
          sdnIndex(), holdingsOf(), rpc(() => cl.getCode({ address: owner })), rpc(() => cl.getTransactionCount({ address: owner })), domainPart(env, domainName),
        ]);
        const matches = screen(index, address, undefined);
        const type = accountType(code);
        return {
          address: getAddress(address), chain: slug,
          ...verdict(matches, { riskLevel: "not-assessed", riskFlags: [] }, null, domain?.flags),
          sanctions: { listed: matches.length > 0, matches, listDate: index.listDate },
          account: { type, riskLevel: null, riskFlags: [], accountNonce: nonce },
          contract: null,
          domain,
          holdings: { totalUsd: value.totalUsd, tokensChecked: value.tokensChecked },
          limitations: ["wallet and contract risk heuristics run on Base only; this chain gets sanctions, account type, nonce and holdings"],
          note,
        };
      }
      const [index, audit, value, domain] = await Promise.all([sdnIndex(), walletAudit(env, address), holdingsOf(), domainPart(env, domainName)]);
      const contract = audit.type === "contract" ? await contractRisk(env, address) : null;
      const matches = screen(index, address, undefined);
      return {
        address: audit.address, chain: "base",
        ...verdict(matches, audit, contract, domain?.flags),
        sanctions: { listed: matches.length > 0, matches, listDate: index.listDate },
        account: { type: audit.type, riskLevel: audit.riskLevel, riskFlags: audit.riskFlags, accountNonce: audit.accountNonce },
        contract: contract && { riskLevel: contract.riskLevel, riskFlags: contract.riskFlags },
        domain,
        holdings: { totalUsd: value.totalUsd, tokensChecked: value.tokensChecked },
        // A wallet busy elsewhere can be new on Base (21 Oct: the Lazarus Group's Ethereum wallet read as
        // zero-nonce here); say so instead of letting the Base heuristics stand for its whole history.
        limitations: audit.type === "eoa" && audit.accountNonce === 0
          ? ["no outgoing transactions on Base, so the wallet heuristics treat it as new here; if the payee uses another network, check it with chain=eth, arb or op"]
          : [],
        note,
      };
    }, "$0.03"),
  // The one-cent job paying agents buy most at other sellers (21 Oct: "screen a payee before paying", sanctions plus
  // domain age): one SDN lookup and two RPC reads on one chain, no holdings or audits, so it answers in about a second.
  entry("/check/payee", "Payee preflight check: OFAC screen an address before paying, plus account type and domain age",
    "Fast check of a payee before an agent pays it: OFAC SDN match on the address, account type (wallet, delegated wallet or contract) and nonce on Base, Ethereum, Arbitrum, Optimism or Polygon, and optionally the payee domain's age and trust flags. One block, review or pass verdict with reasons. Screening aid, not legal advice. Use before an x402 or USDC payment to an unfamiliar address; holdings and wallet heuristics: check_counterparty.",
    ["payee-screening", "sanctions", "ofac", "payments", "x402", "compliance", "wallet", "base"], {
      address: { type: "string", description: "0x address you are about to pay", required: true, example: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045" },
      chain: { type: "string", description: "Network of the payment: base (default), eth, arb, op or polygon", enum: PAYEE_CHAINS, example: "base" },
      domain: { type: "string", description: "Optional: the payee's domain or website URL, e.g. ethereum.org; adds domain age and trust flags", example: "ethereum.org" },
    },
    {
      address: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045", chain: "base", verdict: "pass", reasons: [],
      sanctions: { listed: false, matches: [], listDate: "2026-10-17T20:15:00.000Z" },
      account: { type: "eoa", accountNonce: 1234 },
      domain: { name: "ethereum.org", trust: "high", ageDays: 4100, registeredAt: "2015-03-21T00:00:00Z", flags: [] },
      limitations: [],
      note: "Screening aid only: confirm any sanctions match against the official OFAC record.",
    },
    async (env, q) => {
      const address = q("address")?.trim() ?? "";
      if (!isAddress(address)) throw new HttpError(400, "address must be a 0x-prefixed 20-byte hex address, e.g. 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045");
      const slug = pick(q, "chain", PAYEE_CHAINS, "base");
      const domainName = payeeDomain(q("domain"));
      const cl = client(env, CHAINS.find((c) => c.slug === slug)!);
      const owner = getAddress(address);
      const [index, code, nonce, domain] = await Promise.all([
        sdnIndex(), rpc(() => cl.getCode({ address: owner })), rpc(() => cl.getTransactionCount({ address: owner })), domainPart(env, domainName),
      ]);
      const matches = screen(index, address, undefined);
      const type = accountType(code);
      return {
        address: owner, chain: slug,
        ...verdict(matches, { riskLevel: "not-assessed", riskFlags: [] }, null, domain?.flags),
        sanctions: { listed: matches.length > 0, matches, listDate: index.listDate },
        account: { type, accountNonce: nonce },
        domain,
        // A fresh receiving address is normal for a payee, so it is reported, not counted against the verdict.
        limitations: type === "eoa" && nonce === 0 ? [`no outgoing transactions on ${slug}: a new receiving address is common, but confirm it with the payee if it should be an established one`] : [],
        note: "Screening aid only: confirm any sanctions match against the official OFAC record.",
      };
    }, "$0.01"),
];
