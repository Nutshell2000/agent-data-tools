# agent-data-tools

Data tools for AI agents, one HTTP call each: PDF to text, web page to Markdown, web search, news, token prices, OFAC sanctions checks, chain reads on 18 networks, IP geolocation, hosted pages and about 550 more. No dependencies. 25 free calls with no signup, then card credits or USDC per call; failed calls are not charged.

## Use it in your AI client

One command per client. Each connects the client to the compact MCP server at `https://agent-data-tools.revmesh2074.workers.dev/mcp/compact`: three tools (`find_tool`, `tool_details`, `call_tool`) that find, describe and run any tool in the catalog, so the assistant does not carry several hundred tool definitions. Add `--full` to `setup` or `mcp` for the server that lists every tool as its own definition (`https://agent-data-tools.revmesh2074.workers.dev/mcp`).

```sh
npx agent-data-tools setup claude-code      # prints the `claude mcp add --transport http ...` command to run
npx agent-data-tools setup claude-desktop   # adds the server to claude_desktop_config.json
npx agent-data-tools setup cursor           # adds the server to ~/.cursor/mcp.json
npx agent-data-tools setup vscode           # adds the server to .vscode/mcp.json in the current folder
```

`--print` shows the change without writing anything. When a file is changed, other servers in it are kept and the previous version stays next to it as `.bak`; a file that is not plain JSON is left alone and the lines to add are printed.

Without a key the server gives 25 free calls. With a prepaid key:

```sh
npx agent-data-tools credits            # where to get a key (card or USDC)
npx agent-data-tools key adt_...        # saves it to ~/.agent-data-tools/config.json
npx agent-data-tools key                # shows the last 4 characters and the balance
npx agent-data-tools setup cursor --key adt_...
```

`setup --key` puts the key into the client's own user-level configuration (a header for Claude Code and Cursor, the server's environment for Claude Desktop). It is never written to `.vscode/mcp.json`, which is a project file: there the entry is the local command below, which reads the saved key.

`npx agent-data-tools mcp` is a stdio MCP server that forwards to the remote one, for clients that only start local commands. It reads the key from `--key`, then `AGENT_DATA_TOOLS_KEY`, then `~/.agent-data-tools/config.json`. The package holds no payment or wallet code.

## From the command line and from code

```sh
npx agent-data-tools list pdf
npx agent-data-tools pdf_text url=https://arxiv.org/pdf/1706.03762 pages=2
```

```js
import { AgentDataTools } from "agent-data-tools";

const adt = new AgentDataTools();
const weather = await adt.call("/weather", { city: "London" });
const matches = await adt.tools({ search: "sanctions" });
```

## Give the tools to a model

`openAiTools()` returns OpenAI function-calling definitions; [examples/openai-agent.mjs](examples/openai-agent.mjs) is a complete loop in 30 lines.

```js
const tools = await adt.openAiTools(["extract", "pdf_text", "search"]);
// When the model calls one:
const answer = await adt.call(call.function.name, JSON.parse(call.function.arguments));
```

## Paying

| How | Setup |
|---|---|
| Free calls | None. 25 successful calls per caller; AI media, rendering and search tools are paid only. |
| Card credits | Buy a key at [/credits](https://agent-data-tools.revmesh2074.workers.dev/credits), then `npx agent-data-tools key adt_...`, `new AgentDataTools({ apiKey })` or the `ADT_API_KEY` environment variable. |
| USDC per call from your wallet, in your AI client | Start the MCP server with `AGENT_DATA_TOOLS_WALLET_KEY` set to the private key of a wallet that holds USDC on Base: `npx agent-data-tools mcp`. No account and no key to buy. After the free calls each call is paid at its listed price; failed calls are not charged. Limits: $0.10 a call and $1 a day, changed with `AGENT_DATA_TOOLS_MAX_USD` and `AGENT_DATA_TOOLS_DAILY_USD`. Use a wallet that holds only what you are willing to spend. |
| USDC per call (x402), from code | Pass a fetch that pays HTTP 402, such as `@x402/fetch` around your own wallet: `new AgentDataTools({ fetch: paying })`. Set your spending limits in that wrapper. |

When payment is needed and none is set up, `call()` throws `PaymentRequired` with `priceUsd` and `buyUrl`. Other failures throw `ToolError` with `status` and `body`. The package reads a wallet key only from `AGENT_DATA_TOOLS_WALLET_KEY`, only in `mcp`, and only to sign USDC payments on Base for the exact amount the service quoted; it never writes, prints or sends the key. Your API key goes only to the service origin.

## Also

Full catalog and prices: [`/tools`](https://agent-data-tools.revmesh2074.workers.dev/tools), [`/openapi.json`](https://agent-data-tools.revmesh2074.workers.dev/openapi.json). MCP servers: `https://agent-data-tools.revmesh2074.workers.dev/mcp/compact` (three tools for the whole catalog) and `https://agent-data-tools.revmesh2074.workers.dev/mcp` (every tool). Terms: [`/terms`](https://agent-data-tools.revmesh2074.workers.dev/terms).
