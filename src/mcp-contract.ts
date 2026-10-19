import { z } from "zod";
import * as z4mini from "zod/v4-mini";
import type { Endpoint } from "./endpoints";
import { CAPACITY_LIMITED } from "./lib/capacity";
import { FREE_CALLS_PER_CALLER } from "./lib/free-calls";

/** One snake_case name per tool: "/eth/gas" becomes "eth_gas" and "/base-gas" becomes "base_gas". */
export const mcpName = (path: string) => path.slice(1).replace(/[/-]/g, "_");
export const toolName = (endpoint: Endpoint) => mcpName(endpoint.path);
// Every invocation can spend money, even when the underlying data is read-only.
export const toolAnnotations = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true };

export const toolDescription = (endpoint: Endpoint) =>
  `${endpoint.description} Side effects: none on any outside system (it only reads or computes), but each successful call costs ${endpoint.price} in USDC on Base or another supported network, paid with x402, or the same amount in prepaid card credits when the request carries an API key from /credits. That payment is why the tool is not marked read-only or idempotent: repeating a call charges again. Failed calls are never charged.${CAPACITY_LIMITED.has(endpoint.path) ? "" : ` Each caller gets ${FREE_CALLS_PER_CALLER} free successful calls first (over MCP they are used automatically).`}`;

export const toolInputShape = (endpoint: Endpoint, z: typeof import("zod").z) =>
  Object.fromEntries(
    Object.entries(endpoint.params).map(([name, param]) => {
      const schema = param.enum
        ? z.enum(param.enum)
        : param.type === "integer"
          ? z.number().int()
          : param.type === "number"
            ? z.number()
            : z.string();
      const field = schema.describe(param.description);
      return [name, param.required ? field : field.optional()];
    }),
  );

/** Exact public output schema, shared with OpenAPI. Payment errors are MCP isError results. */
export function protocolTool(endpoint: Endpoint) {
  return {
    name: toolName(endpoint), description: toolDescription(endpoint), annotations: toolAnnotations,
    inputSchema: z4mini.toJSONSchema(z.object(toolInputShape(endpoint, z)), {target:"draft-7",io:"input"}) as {type:"object";[key:string]:unknown},
    ...(endpoint.outputSchema ? {outputSchema: endpoint.outputSchema as {type:"object";[key:string]:unknown}} : {}),
    execution: {taskSupport:"forbidden" as const},
  };
}
