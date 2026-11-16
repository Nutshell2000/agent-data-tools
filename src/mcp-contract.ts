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

/** The compact server's address segment: /mcp/compact (mcp.ts registerCompactTools). */
export const COMPACT_BUNDLE = "compact";
/** The names of the compact server's own tools; no catalog tool may take one (tests/mcp-compact.test.cjs). */
export const COMPACT_TOOLS = ["find_tool", "tool_details", "call_tool"] as const;
/**
 * The small surface that /mcp lists (16 Nov 2026): the three finder tools, with `describe_tool` as the listed name for
 * what the compact server calls `tool_details` (same handler), plus MCP_PINNED_PATHS as ordinary definitions. tools/call
 * on /mcp still takes every name it took before; only the list is small. The full list is at /mcp/all.
 */
export const SURFACE_TOOLS = ["find_tool", "describe_tool", "call_tool"] as const;
/** The full list, every tool as its own definition (entry paths left out): /mcp/all and /mcp/k/<key>/all. */
export const ALL_BUNDLE = "all";
/**
 * The tools /mcp lists as ordinary definitions beside the finder trio. Chosen from the repository's own evidence, not
 * taste: each is in SALES_FIRST (lib/discovery-index.ts) or is a job the release notes record buyers paying for:
 *   /search, /news          Brave-backed search and news; /news is what Mercator's gateway bought most (7-11 Nov 2026)
 *   /extract                page to Markdown, the entry-price tool and the largest web-scraping intent
 *   /weather                the tool new wallets buy first (vAPI quest wallets, 10-15 Nov 2026)
 *   /price/token            token price: the busiest short query on Zero and the Bazaar
 *   /sanctions/check, /check/payee   the payee and sanctions checks that lead SALES_FIRST
 *   /transcribe             speech to text, the voice line's profit centre
 *   /pdf/text               the most-used document tool
 *   /company/search, /vat/validate   company and VAT checks, the lead product for business buyers (14 Nov 2026)
 *   /ai/chat                first in SALES_FIRST
 * Canonical tools only: no entry path (ENTRY_OF) and no tool that writes (tests/mcp-surface.test.cjs checks both, and
 * that the whole list stays under 20 definitions).
 */
export const MCP_PINNED_PATHS: readonly string[] = [
  "/search", "/extract", "/news", "/weather", "/price/token", "/sanctions/check", "/check/payee",
  "/transcribe", "/pdf/text", "/company/search", "/vat/validate", "/ai/chat",
];
/**
 * The capped twin, /mcp/compact-capped: the same three tools, but a tool priced above the ceiling does not exist there
 * and call_tool takes no max_price. For hosts that count spend from a declared cost per tool name (the Hermes package):
 * the top of the declared range is then a figure the server enforces.
 */
export const COMPACT_CAPPED_BUNDLE = "compact-capped";
/**
 * The dearest call call_tool makes on its own, as a public price (owner, 11 Nov 2026: "do what is best for the whole
 * operation", on whether dearer tools should be reachable). A client knows call_tool by one name, and a model picks the
 * tool, so one call must not be able to empty a $1 key by accident. On /mcp/compact a dearer tool is found and
 * described like any other and runs only when the call names its price in `max_price`; on the capped twin it is absent.
 * tests/hermes-plugin.test.cjs keeps the Hermes package's declared top cost equal to this.
 */
export const COMPACT_PRICE_CEILING = "$0.10";
const usd = (price: string) => Number(price.slice(1));
/** True when a call at this price needs the caller to name the price first. */
export const aboveCompactCeiling = (price: string) => usd(price) > usd(COMPACT_PRICE_CEILING);
/** A price a caller named: "$1.00", "1", 1 or "1 USD", in dollars; NaN when it is not a price. */
const namedUsd = (value: unknown) => typeof value === "number" ? value : typeof value === "string" && /^\s*\$?\s*\d+(\.\d+)?\s*(usdc?)?\s*$/i.test(value) ? Number(value.replace(/[^\d.]/g, "")) : Number.NaN;
/** May call_tool run a call at this price, given the max_price the caller named (or none)? */
export const compactPricePermits = (price: string, named: unknown) => !aboveCompactCeiling(price) || namedUsd(named) >= usd(price);
/** The tools the compact server reaches: every tool that only reads; on the capped twin, only up to the price ceiling. */
export const compactReach = (e: Endpoint, capped = false) => annotationsFor(e.path).readOnlyHint === true && !(capped && aboveCompactCeiling(e.price));

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

/**
 * The range a LISTED integer input states (16 Nov 2026). zod writes a bare integer as -9007199254740991..9007199254740991,
 * which a directory reads as "no bounds given". The rule, in order:
 *   1. the range the input's own description states ("1-20", "100 to 10000", "-25 to 25"), widened by a later "up to N"
 *      (token_buyers: ten times the blocks on Base). That is the range the handler enforces or holds the value to.
 *   2. otherwise the range the handlers enforce for that kind of input, by name (INTEGER_KINDS): at least as wide as
 *      every tool that takes an input of that name without stating a range accepts today.
 *   3. otherwise -1e12..1e12, the widest range any handler takes (random_number).
 * This is what tools/list publishes, never what a call is checked against: mcp.ts validates a call against the shape
 * without bounds, exactly as before, so a value a tool accepts today (limit=500, held to 50 by the handler) still runs.
 */
const INTEGER_KINDS: Readonly<Record<string, readonly [number, number]>> = {
  // date_add takes -100000..100000 for each unit; date_business_days (add) and calc_loan (months) take less.
  years: [-100_000, 100_000], months: [-100_000, 100_000], weeks: [-100_000, 100_000], days: [-100_000, 100_000],
  hours: [-100_000, 100_000], minutes: [-100_000, 100_000], businessDays: [-100_000, 100_000], add: [-100_000, 100_000],
  // Calendar years: vin takes 1950-2100, papers 1800-2100 and 0 for "no filter".
  year: [0, 9_999], fromYear: [0, 9_999],
  code: [100, 599],
  firstPage: [1, 100_000],
  minContext: [0, 100_000_000], inputTokens: [0, 100_000_000], outputTokens: [0, 100_000_000],
  seed: [1, 2_147_483_648],
  min: [-1_000_000_000_000, 1_000_000_000_000], max: [-1_000_000_000_000, 1_000_000_000_000],
  // How many of the caller's own items (random_pick, random_teams): bounded by the 20,000-character list they are read from.
  count: [1, 20_000], teams: [1, 20_000], limit: [1, 20_000],
  offset: [0, 1_000_000],
};
const INTEGER_FALLBACK: readonly [number, number] = [-1_000_000_000_000, 1_000_000_000_000];
const plainNumber = (text: string) => Number(text.replace(/,/g, ""));
export function integerRange(name: string, param: { description: string }): readonly [number, number] {
  const stated = /(?:^|[\s(,])(-?\d[\d,]*)\s*(?:-|–|to)\s*(-?\d[\d,]*)(?=[\s,;:.)]|$)/.exec(param.description);
  if (stated && plainNumber(stated[1]) <= plainNumber(stated[2])) {
    let top = plainNumber(stated[2]);
    for (const more of param.description.matchAll(/up to (\d[\d,]*)/g)) top = Math.max(top, plainNumber(more[1]));
    return [plainNumber(stated[1]), top];
  }
  return Object.hasOwn(INTEGER_KINDS, name) ? INTEGER_KINDS[name] : INTEGER_FALLBACK;
}

/** `listed`: the shape tools/list publishes (integers carry their range). Calls are checked against the shape without it. */
export const toolInputShape = (endpoint: Endpoint, z: typeof import("zod").z, wording: (text: string) => string = (text) => text, listed = false) =>
  Object.fromEntries(
    Object.entries(endpoint.params).map(([name, param]) => {
      const schema = param.enum
        ? z.enum(param.enum)
        : param.type === "integer"
          ? (listed ? z.number().int().min(integerRange(name, param)[0]).max(integerRange(name, param)[1]) : z.number().int())
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
    inputSchema: z4mini.toJSONSchema(z.object(toolInputShape(endpoint, z, directory ? (text) => chatgptText(endpoint.path, text) : undefined, true)), {target:"draft-7",io:"input"}) as {type:"object";[key:string]:unknown},
    ...(endpoint.outputSchema ? {outputSchema: endpoint.outputSchema as {type:"object";[key:string]:unknown}} : {}),
    execution: {taskSupport:"forbidden" as const},
  };
}
