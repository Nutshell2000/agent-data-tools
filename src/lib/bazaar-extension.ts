import { declareDiscoveryExtension } from "@x402/extensions/bazaar";
import type { Endpoint } from "../endpoints";
import { exampleParams } from "../endpoints";
import { schemaFromExample } from "./output-schema";

/**
 * The Coinbase Bazaar discovery metadata for one tool: what the facilitator indexes after the first settled
 * payment. Shared by the x402 paywall (every 402 carries it) and the MPP evm settlement (lib/mpp-evm.ts), which
 * sends it with the payment payload so an MPP settlement can index the tool too.
 */
export function bazaarExtensionFor(e: Endpoint) {
  return declareDiscoveryExtension({
    input: Object.fromEntries(exampleParams(e).map(([k, p]) => [k, p.example])),
    inputSchema: {
      properties: Object.fromEntries(
        Object.entries(e.params).map(([k, p]) => [k, { type: p.type, description: p.description, ...(p.enum ? { enum: p.enum } : {}) }]),
      ),
      required: Object.entries(e.params)
        .filter(([, p]) => p.required)
        .map(([k]) => k),
    },
    output: { example: e.outputExample, schema: schemaFromExample(e.outputExample) },
  });
}
