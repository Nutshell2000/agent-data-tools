import { x402ResourceServer } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { bazaarResourceServerExtension } from "@x402/extensions/bazaar";
import type { Env } from "./env";
import { buildFacilitator } from "./facilitator";
import { ExactSvmScheme } from "@x402/svm/exact/server";
import { paymentOptions, SOLANA_NETWORK } from "./networks";
import { settlementRecord } from "./settlement-ledger";
import { markStage } from "./funnel";

/**
 * Cold initialization belongs to one request. HTTP and MCP cache their own
 * fully initialized state; they must not share a server while its maps are loading.
 */
export function resourceServer(env: Env): x402ResourceServer {
  const server = new x402ResourceServer(buildFacilitator(env));
  for (const { network } of paymentOptions(env)) server.register(network, network === SOLANA_NETWORK ? new ExactSvmScheme() : new ExactEvmScheme());
  server.registerExtension(bazaarResourceServerExtension);
  // Each failure is logged with its reason (never the signature, payload or payer) so refused buyers show up in
  // `wrangler tail` and the funnel, not only as a count of 402s.
  const where = (requirements: { network?: string } | undefined, payload: { resource?: { url?: string } } | undefined) =>
    `${payload?.resource?.url ?? "unknown resource"} on ${requirements?.network ?? "unknown network"}`;
  server.onAfterVerify(async context => {
    markStage(context.result.isValid ? "verified" : "verification_failed");
    if (!context.result.isValid) console.warn(`x402 v2 verification_failed ${where(context.requirements, context.paymentPayload)}: ${context.result.invalidReason ?? "rejected by the facilitator"}`);
  });
  server.onVerifyFailure(async context => {
    const message = String(context.error?.message ?? context.error).slice(0, 160);
    // The client library throws for a facilitator rejection too; an edge block or timeout is an outage instead.
    const outage = !(context.error?.name === "VerifyError" || /^invalid_|insufficient_funds/.test(message));
    markStage(outage ? "facilitator_unavailable" : "verification_failed");
    console.warn(`x402 v2 ${outage ? "facilitator_unavailable" : "verification_failed"} ${where(context.requirements, context.paymentPayload)}: ${message}`);
  });
  server.onSettleFailure(async context => {
    markStage("settlement_failed");
    console.warn(`x402 v2 settlement_failed ${where(context.requirements, context.paymentPayload)}: ${String(context.error?.message ?? context.error).slice(0, 160)}`);
  });
  server.onAfterSettle(async context => {
    if (context.phase !== "after-handler" || context.result.success !== true) return;
    markStage("settled");
    try {
      const record = await settlementRecord(context, env.PAY_TO, env.SOLANA_PAY_TO);
      if (!record || !env.METRICS) { console.error("settlement-ledger: unsupported or unavailable receipt storage"); return; }
      await env.METRICS.get(env.METRICS.idFromName("global")).recordSettlement(record);
    } catch {
      // A telemetry/storage failure must never turn an already-settled response into another payment request.
      console.error("settlement-ledger: receipt write failed; operator reconciliation required");
    }
  });
  return server;
}
