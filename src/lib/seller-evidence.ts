/**
 * Signed seller evidence (19 Nov 2026). A machine-readable, verifiable snapshot of facts we already
 * publish at /revenue and /status, signed with the Ed25519 key whose public half is at
 * /.well-known/agent-payee-keys.json. It exists because buyer-side trust/quality gates (agents-trust,
 * Mercator, Bazaar ranking) want paid-delivery evidence; routers still compute quality from their own
 * observed settlements, so this is an entry ticket, not a claim of demand. No new claim is made here.
 */
import type { Env } from "./env";
import { signPayload } from "../routes/payee";

type EndpointTotal = { settlements: number; grossAtomic: string };
type Revenue = {
  sinceUtc: string; settlements: number; grossAtomic: string; selfPayments: number;
  asset: string; decimals: number; byEndpoint: Record<string, EndpointTotal>;
  payerActivity: unknown; evidence?: string;
};
type Reliability = {
  windowDays: number; served: number; serverErrors: number; successRate: number | null;
  recent: { days: number; served: number; serverErrors: number; successRate: number | null };
  medianDailySuccessRate: number | null; daysAt99: number;
};

/** Fixed-point decimal from an atomic integer string; never a float. */
export function usdcAmount(atomic: string, decimals = 6): string {
  const digits = (String(atomic).match(/^\d+$/) ? String(atomic) : "0").replace(/^0+/, "") || "0";
  const padded = digits.padStart(decimals + 1, "0");
  return `${padded.slice(0, -decimals)}.${padded.slice(-decimals)}`;
}

const SAMPLE_TX = "0x778c8c1b1fd1b320bf045eae0af7274e74a9e2e1f83c34ec96d9f825aea3b933";

export async function sellerEvidence(env: Pick<Env, "PAYEE_SIGNING_KEY">, issuer: string, revenue: Revenue, reliability: Reliability) {
  const decimals = Number.isInteger(revenue.decimals) && revenue.decimals >= 0 && revenue.decimals <= 18 ? revenue.decimals : 6;
  const topPaidTools = Object.entries(revenue.byEndpoint)
    .map(([path, v]) => ({ path, paidCalls: v.settlements, grossUsdc: usdcAmount(v.grossAtomic, decimals) }))
    .sort((a, b) => b.paidCalls - a.paidCalls || (a.path < b.path ? -1 : 1))
    .slice(0, 10);
  const payload = {
    v: 1,
    type: "agent-data-tools.seller-evidence.v1",
    iss: issuer,
    iat: new Date().toISOString(),
    seller: { name: "SpellzCode", country: "SE", service: "Agent Data Tools", site: issuer },
    delivery: {
      window: { sinceUtc: revenue.sinceUtc, days: 30 },
      paidCalls: revenue.settlements,
      grossUsdc: usdcAmount(revenue.grossAtomic, decimals),
      asset: revenue.asset,
      decimals,
      selfPaymentsExcluded: revenue.selfPayments,
      payers: revenue.payerActivity,
      topPaidTools,
      evidence: revenue.evidence ?? null,
    },
    reliability: {
      windowDays: reliability.windowDays,
      served: reliability.served,
      serverErrors: reliability.serverErrors,
      successRate: reliability.successRate,
      recent: reliability.recent,
      medianDailySuccessRate: reliability.medianDailySuccessRate,
      daysAt99: reliability.daysAt99,
    },
    verify: {
      method: "Ed25519 over the UTF-8 bytes of payload.canonical (sorted-key JSON); verify with the JWKS key named by kid",
      receiptTool: `${issuer}/x402/receipt`,
      receiptExample: { chain: "base", transaction: SAMPLE_TX, explorer: `https://basescan.org/tx/${SAMPLE_TX}` },
      rawRevenue: `${issuer}/revenue`,
      rawStatus: `${issuer}/status`,
    },
    limitations: [
      "Self-published from our own settlement ledger and call metrics; not independently audited.",
      "External wallet addresses are not verified customers; self-payments are excluded from the totals above.",
      "A receipt proves USDC moved on chain, not that a specific deliverable was accepted. Verify it by transaction hash.",
      "Discovery services usually compute quality from their own observed settlements. This file is evidence, not a guarantee of demand or availability.",
    ],
  };
  return { payload, ...await signPayload(payload, env, issuer) };
}
