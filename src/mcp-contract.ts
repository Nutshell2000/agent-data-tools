import { z } from "zod";
import * as z4mini from "zod/v4-mini";
import { exampleParams, type Endpoint } from "./endpoints";
import { CAPACITY_LIMITED } from "./lib/capacity";
import { FREE_CALLS_PER_CALLER } from "./lib/free-calls";

/** One snake_case name per tool: "/eth/gas" becomes "eth_gas" and "/base-gas" becomes "base_gas". */
export const mcpName = (path: string) => path.slice(1).replace(/[/-]/g, "_");
export const toolName = (endpoint: Endpoint) => mcpName(endpoint.path);
// Every tool reads or computes and changes nothing in the user's environment, so it is read-only in the MCP
// sense; the per-call charge is billing, stated in the description. Not idempotent: a repeat is charged again.
// (Before 1.35.1 readOnlyHint was false, which the Claude directory and Glama flagged as a mismatch.)
export const toolAnnotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true };
// The agent memory tools (1.75.0) are the exception: saving and deleting change what the caller has stored with us, so
// they are not read-only, delete is destructive, both are idempotent (same key, same result) and closed-world.
const WRITE_TOOLS: Readonly<Record<string, { destructive: boolean }>> = { "/memory/set": { destructive: false }, "/memory/delete": { destructive: true } };
export const annotationsFor = (path: string) => Object.hasOwn(WRITE_TOOLS, path)
  ? { readOnlyHint: false, destructiveHint: WRITE_TOOLS[path].destructive, idempotentHint: true, openWorldHint: false }
  : toolAnnotations;

/**
 * A short "Example: name=value" from the published example call (directories score descriptions with examples). It is
 * exactly the call the Bazaar lists, so it never pairs alternatives that override each other (city with lat/lon,
 * symbol with address) and never shows the empty `only` filter.
 */
const exampleText = (endpoint: Endpoint) => {
  const parts = exampleParams(endpoint).filter(([, p]) => p.example !== undefined && p.example !== "").map(([name, p]) => `${name}=${String(p.example)}`);
  const text = parts.join(", ");
  return parts.length && text.length <= 90 ? ` Example: ${text}.` : "";
};

/**
 * The ChatGPT directory server (/mcp/chatgpt) shows no prices or payment methods: ChatGPT's plugin rules forbid pricing
 * and checkout prompts inside the app. Credits are bought on our own site, outside ChatGPT.
 */
export const directoryToolDescription = (endpoint: Endpoint) =>
  `${endpoint.description}${exampleText(endpoint)} Uses one of this account's free calls or credits per successful call; failed calls never count. ${Object.hasOwn(WRITE_TOOLS, endpoint.path) ? "Changes only what you saved in your own memory namespace." : "Reads or computes only and changes nothing."}`;

export const toolDescription = (endpoint: Endpoint) =>
  `${endpoint.description}${exampleText(endpoint)} Price ${endpoint.price}/call via x402 USDC or a card key (/credits)${CAPACITY_LIMITED.has(endpoint.path) ? "" : `, first ${FREE_CALLS_PER_CALLER} free`}; failed calls free. ${Object.hasOwn(WRITE_TOOLS, endpoint.path) ? "Changes only what you saved in your own memory namespace" : "Reads or computes only and changes nothing"}; each call is charged, so repeats are not free.`;

export const toolInputShape = (endpoint: Endpoint, z: typeof import("zod").z) =>
  Object.fromEntries(
    Object.entries(endpoint.params).map(([name, param]) => {
      const schema = param.enum
        ? z.enum(param.enum)
        : param.type === "integer"
          ? z.number().int()
          : param.type === "number"
            ? z.number()
            // String inputs whose example is a flag or a number (fullPage=true, plus=1) also take the JSON type an
            // agent naturally sends; the handler reads every argument as a string either way.
            : typeof param.example === "string" && /^(true|false|-?\d+(\.\d+)?)$/.test(param.example)
              ? z.union([z.string(), z.number(), z.boolean()])
              : z.string();
      const field = schema.describe(param.description);
      return [name, param.required ? field : field.optional()];
    }),
  );

/** Exact public output schema, shared with OpenAPI. Payment errors are MCP isError results. */
export function protocolTool(endpoint: Endpoint, directory = false) {
  return {
    // Directories (Claude, ChatGPT) require a human-readable title on every tool and in its annotations.
    name: toolName(endpoint), title: endpoint.summary, description: directory ? directoryToolDescription(endpoint) : toolDescription(endpoint), annotations: { title: endpoint.summary, ...annotationsFor(endpoint.path) },
    inputSchema: z4mini.toJSONSchema(z.object(toolInputShape(endpoint, z)), {target:"draft-7",io:"input"}) as {type:"object";[key:string]:unknown},
    ...(endpoint.outputSchema ? {outputSchema: endpoint.outputSchema as {type:"object";[key:string]:unknown}} : {}),
    execution: {taskSupport:"forbidden" as const},
  };
}
