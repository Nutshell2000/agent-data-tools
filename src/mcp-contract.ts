import { z } from "zod";
import * as z4mini from "zod/v4-mini";
import { exampleParams, type Endpoint } from "./endpoints";
import { CAPACITY_LIMITED } from "./lib/capacity";
import { LOCAL_PATHS } from "./families";
import { FREE_CALLS_PER_CALLER } from "./lib/free-calls";
import { chatgptText } from "./lib/chatgpt-tools";

/** One snake_case name per tool: "/eth/gas" becomes "eth_gas" and "/base-gas" becomes "base_gas". */
export const mcpName = (path: string) => path.slice(1).replace(/[/-]/g, "_");
export const toolName = (endpoint: Endpoint) => mcpName(endpoint.path);
// Every tool reads or computes and changes nothing in the user's environment, so it is read-only in the MCP
// sense; the per-call charge is billing, stated in the description. Not idempotent: a repeat is charged again.
// (Before 1.35.1 readOnlyHint was false, which the Claude directory and Glama flagged as a mismatch.)
export const toolAnnotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true };
// The agent memory tools (1.75.0) are the exception: saving and deleting change what the caller has stored with us, so
// they are not read-only, delete is destructive, both are idempotent (same key, same result) and closed-world.
// 10 Nov 2026, after OpenAI's review of 5 Nov ("annotations do not appear to match the tool's behavior"), read against
// its published meanings: a write that can overwrite, delete or send something that cannot be taken back is destructive;
// openWorld is the public internet or open-ended entities, not "has a network connection".
//   /memory/set overwrites a saved key, so it is destructive too; both memory tools stay closed-world and idempotent.
//   /page/publish and its entry path /page/host put a page on the public web that the caller cannot withdraw: not
//   read-only, destructive, open-world, and each call makes a new page (not idempotent). They were marked read-only.
const WRITE_TOOLS: Readonly<Record<string, { destructive: boolean; openWorld: boolean; idempotent: boolean }>> = {
  "/memory/set": { destructive: true, openWorld: false, idempotent: true },
  "/memory/delete": { destructive: true, openWorld: false, idempotent: true },
  "/page/publish": { destructive: true, openWorld: true, idempotent: false },
  "/page/host": { destructive: true, openWorld: true, idempotent: false },
};
/** True for the tools that change something: what the caller saved with us, or a page on the public web. */
export const isWriteTool = (path: string) => Object.hasOwn(WRITE_TOOLS, path);
// A tool that only computes from its own inputs (hashes, converters, calculators, validators; LOCAL_PATHS) touches
// nothing outside the request, and the memory reads see only what the caller saved here: closed-world. Everything else reads the public internet or open-ended public records.
export const annotationsFor = (path: string) => Object.hasOwn(WRITE_TOOLS, path)
  ? { readOnlyHint: false, destructiveHint: WRITE_TOOLS[path].destructive, idempotentHint: WRITE_TOOLS[path].idempotent, openWorldHint: WRITE_TOOLS[path].openWorld }
  : LOCAL_PATHS.has(path) || path.startsWith("/memory/") || path === "/time" ? { ...toolAnnotations, openWorldHint: false } : toolAnnotations;

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
 * The ChatGPT plugin server (/mcp/chatgpt) is free inside ChatGPT and says nothing about prices, plans, free calls or
 * credits: its rules allow no sale of digital services and no upsell (lib/chatgpt-tools.ts).
 */
/** What a tool changes, for its description: side effects must be stated where a model and a reviewer read them. */
const writeNote = (path: string) => !Object.hasOwn(WRITE_TOOLS, path) ? "Reads or computes only and changes nothing."
  : path.startsWith("/memory/") ? "Changes only what you saved in your own memory namespace."
  : "Publishes a page on the public web that stays up until it expires and cannot be withdrawn.";

export const directoryToolDescription = (endpoint: Endpoint) =>
  `${chatgptText(endpoint.path, `${endpoint.description}${exampleText(endpoint)}`)} ${writeNote(endpoint.path)}`;

export const toolDescription = (endpoint: Endpoint) =>
  `${endpoint.description}${exampleText(endpoint)} Price ${endpoint.price}/call via x402 USDC or a card key (/credits)${CAPACITY_LIMITED.has(endpoint.path) ? "" : `, first ${FREE_CALLS_PER_CALLER} free`}; failed calls free. ${writeNote(endpoint.path).replace(/\.$/, "")}; each call is charged, so repeats are not free.`;

export const toolInputShape = (endpoint: Endpoint, z: typeof import("zod").z, wording: (text: string) => string = (text) => text) =>
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
      const field = schema.describe(wording(param.description));
      return [name, param.required ? field : field.optional()];
    }),
  );

/** Exact public output schema, shared with OpenAPI. Payment errors are MCP isError results. */
export function protocolTool(endpoint: Endpoint, directory = false) {
  return {
    // Directories (Claude, ChatGPT) require a human-readable title on every tool and in its annotations.
    name: toolName(endpoint), title: endpoint.summary, description: directory ? directoryToolDescription(endpoint) : toolDescription(endpoint), annotations: { title: endpoint.summary, ...annotationsFor(endpoint.path) },
    inputSchema: z4mini.toJSONSchema(z.object(toolInputShape(endpoint, z, directory ? (text) => chatgptText(endpoint.path, text) : undefined)), {target:"draft-7",io:"input"}) as {type:"object";[key:string]:unknown},
    ...(endpoint.outputSchema ? {outputSchema: endpoint.outputSchema as {type:"object";[key:string]:unknown}} : {}),
    execution: {taskSupport:"forbidden" as const},
  };
}
