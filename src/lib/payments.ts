import { x402ResourceServer } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { bazaarResourceServerExtension } from "@x402/extensions/bazaar";
import type { Env } from "./env";
import { buildFacilitator } from "./facilitator";

let server: x402ResourceServer | undefined;

/**
 * One payment server per isolate, shared by the HTTP paywall and the MCP tools.
 * Built on first use: Workers expose env bindings per request, not at module load.
 */
export function resourceServer(env: Env): x402ResourceServer {
  return (server ??= new x402ResourceServer(buildFacilitator(env))
    .register(env.NETWORK, new ExactEvmScheme())
    .registerExtension(bazaarResourceServerExtension));
}
