import { z } from "zod";
import * as z4mini from "zod/v4-mini";
import type { Endpoint } from "./endpoints";
import { CAPACITY_LIMITED } from "./lib/capacity";
import { FREE_CALLS_PER_CALLER } from "./lib/free-calls";

/** One snake_case name per tool: "/eth/gas" becomes "eth_gas" and "/base-gas" becomes "base_gas". */
export const mcpName = (path: string) => path.slice(1).replace(/[/-]/g, "_");
export const toolName = (endpoint: Endpoint) => mcpName(endpoint.path);
// Every tool reads or computes and changes nothing in the user's environment, so it is read-only in the MCP
// sense; the per-call charge is billing, stated in the description. Not idempotent: a repeat is charged again.
// (Before 1.35.1 readOnlyHint was false, which the Claude directory and Glama flagged as a mismatch.)
export const toolAnnotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true };

/** A short "Example: name=value" from the documented parameter examples (directories score descriptions with examples). */
const exampleText = (endpoint: Endpoint) => {
  const parts = Object.entries(endpoint.params).filter(([, p]) => p.example !== undefined).map(([name, p]) => `${name}=${String(p.example)}`);
  const text = parts.join(", ");
  return parts.length && text.length <= 90 ? ` Example: ${text}.` : "";
};

export const toolDescription = (endpoint: Endpoint) =>
  `${endpoint.description}${exampleText(endpoint)} Price ${endpoint.price}/call via x402 USDC or a card key (/credits)${CAPACITY_LIMITED.has(endpoint.path) ? "" : `, first ${FREE_CALLS_PER_CALLER} free`}; failed calls free. Reads or computes only and changes nothing; each call is charged, so repeats are not free.`;

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
    // Directories (Claude, ChatGPT) require a human-readable title on every tool and in its annotations.
    name: toolName(endpoint), title: endpoint.summary, description: toolDescription(endpoint), annotations: { title: endpoint.summary, ...toolAnnotations },
    inputSchema: z4mini.toJSONSchema(z.object(toolInputShape(endpoint, z)), {target:"draft-7",io:"input"}) as {type:"object";[key:string]:unknown},
    ...(endpoint.outputSchema ? {outputSchema: endpoint.outputSchema as {type:"object";[key:string]:unknown}} : {}),
    execution: {taskSupport:"forbidden" as const},
  };
}
