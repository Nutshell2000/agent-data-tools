import { z } from "zod";
import * as z4mini from "zod/v4-mini";
import type { Endpoint } from "./endpoints";

export const toolName = (endpoint: Endpoint) => endpoint.path.slice(1);
// Every invocation can spend money, even when the underlying data is read-only.
export const toolAnnotations = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true };

export const toolDescription = (endpoint: Endpoint) =>
  `${endpoint.description} Costs ${endpoint.price} in USDC on Base per successful call, paid with x402.`;

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
