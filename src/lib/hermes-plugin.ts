// The files of the Hermes Agent plugin package in integrations/hermes (written by scripts/build-hermes-plugin.mjs; never
// served by the Worker). Hermes loads a "portable Agent Plugins v1" package: plugin.json, mcp.json and skills/.
//
// It points at the compact server's capped twin, /mcp/compact-capped: three tools (find_tool, tool_details, call_tool)
// that reach every read-only tool up to the price ceiling. /mcp lists 452 tools (about 570 KB of tool definitions),
// more than an agent should carry in its context.
//
// Why no Authorization header in mcp.json: Hermes refuses to start a remote server whose header still holds an unset
// ${VAR} (tools/mcp_tool_config.py, read 11 Nov 2026), so a header would make a key mandatory before the first call.
// Without it the server answers with the 25 free calls, and a user who buys a key adds a same-name entry with the
// header to their own config.yaml: Hermes lets that entry replace the package's and keeps the costs declared here.
import { COMPACT_CAPPED_BUNDLE, COMPACT_PRICE_CEILING } from "../mcp-contract";
import { LOCAL_KEY_PRICE } from "./key-prices";

export const HERMES_PLUGIN_NAME = "agent-data-tools";
/** Bump when plugin.json, mcp.json, the skill or the README of the package changes; the catalog entry carries the same number. */
export const HERMES_PLUGIN_VERSION = "1.0.0";
/**
 * The MCP address segment the package connects: the compact server's capped twin. Hermes counts spend from the cost
 * declared per tool name, so the package must connect an address where no call can cost more than the declared top;
 * on /mcp/compact a call that names max_price can.
 */
export const HERMES_BUNDLE = COMPACT_CAPPED_BUNDLE;
export const HERMES_ORIGIN = "https://agent-data-tools.revmesh2074.workers.dev";
/**
 * What Hermes lets one chat book before it asks, in credits (1 credit = $0.001): the smallest key, $1. Hermes books the
 * top of a declared range for every call (tools/mcp_tool_costs.py, read 11 Nov 2026), so this is ten call_tool calls
 * whatever they really cost.
 */
export const HERMES_SPEND_LIMIT = 1_000;

const credits = (price: string) => Math.round(Number(price.slice(1)) * 1000);

/**
 * The cheapest and the dearest call a prepaid key can make through call_tool, in credits. Both are constants of the
 * service, not read from today's prices, so a price change inside the range leaves the pinned package true: the
 * cheapest key price there is, and the compact server's price ceiling, which it enforces.
 */
export const hermesCallRange = (): [number, number] => [credits(LOCAL_KEY_PRICE), credits(COMPACT_PRICE_CEILING)];

/** MCP tool name -> what a prepaid key is charged for one successful call, in credits. Finding and reading details are free. */
export function hermesToolCosts(): Record<string, unknown> {
  return {
    find_tool: 0,
    tool_details: 0,
    call_tool: { credits: hermesCallRange(), note: "the called tool's own price, most often 10; find_tool shows it" },
  };
}

export function hermesPluginFiles(): Record<string, unknown> {
  return {
    "plugin.json": {
      $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
      name: HERMES_PLUGIN_NAME,
      version: HERMES_PLUGIN_VERSION,
      description: "Live data and AI tools for your agent through three MCP tools: find the tool for a job, read its inputs and price, call it. Web search and news, web page and PDF text, screenshots, weather, FX, stock and token prices, wallet and chain reads, sanctions and company checks, LLM chat, speech and more, from Agent Data Tools' hosted server. 25 free calls with no key or sign-up; after that a prepaid key from $1 pays per successful call.",
      author: { name: "SpellzCode", url: HERMES_ORIGIN },
      homepage: `${HERMES_ORIGIN}/tools`,
      repository: "https://github.com/Nutshell2000/agent-data-tools",
      license: "ISC",
      keywords: ["mcp", "web-search", "web-scraping", "pdf", "market-data", "blockchain", "compliance", "pay-per-call", "agent-tools"],
      extensions: {
        "com.nousresearch.hermes": {
          servers: {
            [HERMES_PLUGIN_NAME]: {
              // The three tools are annotated read-only (the compact server cannot reach the tools that write), so the
              // spend limit below is what makes Hermes stop and ask.
              trust: "untrusted",
              // What a prepaid key pays per successful call. Free calls and failed calls cost nothing.
              costs: hermesToolCosts(),
              spend_limit: HERMES_SPEND_LIMIT,
              cost_unit: "credits",
            },
          },
        },
      },
    },
    "mcp.json": {
      $schema: "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
      mcpServers: { [HERMES_PLUGIN_NAME]: { type: "streamable-http", url: `${HERMES_ORIGIN}/mcp/${HERMES_BUNDLE}` } },
    },
  };
}
