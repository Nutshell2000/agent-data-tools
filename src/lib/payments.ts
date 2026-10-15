import { x402ResourceServer } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { bazaarResourceServerExtension } from "@x402/extensions/bazaar";
import type { Env } from "./env";
import { buildFacilitator } from "./facilitator";
import { settlementRecord } from "./settlement-ledger";

let server: x402ResourceServer | undefined;

/**
 * One payment server per isolate, shared by the HTTP paywall and the MCP tools.
 * Built on first use: Workers expose env bindings per request, not at module load.
 */
export function resourceServer(env: Env): x402ResourceServer {
  if (server) return server;
  server = new x402ResourceServer(buildFacilitator(env))
    .register(env.NETWORK, new ExactEvmScheme())
    .registerExtension(bazaarResourceServerExtension);
  server.onAfterSettle(async context => {
    if (context.phase !== "after-handler" || context.result.success !== true) return;
    try {
      const record = await settlementRecord(context, env.PAY_TO);
      if (!record || !env.METRICS) { console.error("settlement-ledger: unsupported or unavailable receipt storage"); return; }
      await env.METRICS.get(env.METRICS.idFromName("global")).recordSettlement(record);
    } catch {
      // A telemetry/storage failure must never turn an already-settled response into another payment request.
      console.error("settlement-ledger: receipt write failed; operator reconciliation required");
    }
  });
  return server;
}
