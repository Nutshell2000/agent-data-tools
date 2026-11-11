# Agent Data Tools for Hermes Agent

A [Portable Agent Plugins v1](https://agent-plugins.org) package for [Hermes Agent](https://github.com/NousResearch/hermes-agent).
It gives a Hermes agent the catalog of [Agent Data Tools](https://agent-data-tools.revmesh2074.workers.dev/tools), over
600 hosted tools, through three MCP tools, so the agent's context holds three tool definitions and not hundreds:

| Tool | What it does | Cost |
|---|---|---|
| `find_tool` | says which tools do a job described in plain words, with each one's price and inputs | free |
| `tool_details` | every input, the price and an example call of one tool | free |
| `call_tool` | runs a tool by name with its arguments | that tool's own price |

What the catalog covers: web search, the text of a web page or PDF, screenshots, weather, FX, stock, commodity
and token prices, wallet and chain reads on EVM networks, sanctions, company and VAT checks, DNS and domain lookups,
LLM chat, embeddings, speech to text and text to speech, and about a hundred converters, hashes and calculators.

The package holds one MCP server entry and one skill, and nothing else: no Python, no executables, no local command.

| Part | What it is |
|---|---|
| `agent-data-tools` | the hosted MCP server `https://agent-data-tools.revmesh2074.workers.dev/mcp/compact-capped` (Streamable HTTP, 3 tools) |
| `skills/agent-data-tools` | how to find and call a tool, how to treat what comes back, and what calls cost |

## Install

```bash
hermes plugins install agent-data-tools
hermes plugins enable agent-data-tools
```

Portable packages install disabled, so the second command is needed. The tools arrive as
`mcp__agent-data-tools__find_tool`, `mcp__agent-data-tools__tool_details` and `mcp__agent-data-tools__call_tool`.

## What it costs

- **Free to try.** `find_tool` and `tool_details` are always free. The first 25 successful `call_tool` calls need no
  key and no sign-up, and failed calls are never counted. The free calls cover the tools `find_tool` marks
  `inFreeCalls`: reading pages and PDFs, prices, weather, chain reads, checks, lookups and the converters. Search,
  rendered pages, screenshots, speech, image and large-model tools cost us money per call and need a key from the first
  call.
- **Then pay per successful call.** A prepaid key costs from $1 (1,000 credits; 1 credit = $0.001) at
  [/credits](https://agent-data-tools.revmesh2074.workers.dev/credits), by card through Stripe, with no account. Most
  tools cost 10 credits a call, reading a page or a PDF 2, and a converter, hash or calculator 1. No tool this server
  reaches costs more than 100. Failed calls are refunded to the key at once. Credits bought as a pack do not expire.
- **What Hermes counts.** Hermes knows `call_tool` by one name, so the package declares its cost as a range of 1 to 100
  credits, and Hermes books the top of a range for every call. With the package's limit of 1,000 credits ($1.00) per
  chat, Hermes therefore asks after ten `call_tool` calls in one chat, although they usually spent far less. Your key is
  only ever charged each tool's real price. Change the limit with `spend_limit` in your own `config.yaml` entry.

### Use a key

The package itself carries no key (Hermes will not start a server whose header names a variable that is not set, and
the free calls should work without one). When you have a key, put it in your profile `.env` as
`AGENT_DATA_TOOLS_KEY=adt_...` and add this to `~/.hermes/config.yaml`, then run `/reload-mcp`:

```yaml
mcp_servers:
  agent-data-tools:
    url: "https://agent-data-tools.revmesh2074.workers.dev/mcp/compact-capped"
    headers:
      Authorization: "Bearer ${AGENT_DATA_TOOLS_KEY}"
```

An entry of the same name in `config.yaml` replaces the package's server entry and keeps the costs it declares. The
same file is in this folder as `config.yaml`.

## Disclosure

- **Network.** Every tool call goes to `agent-data-tools.revmesh2074.workers.dev` with its arguments: the words given
  to `find_tool`, and for `call_tool` the tool's inputs (search words, URLs, addresses, text to process). The service
  fetches the pages and files you name from the public web on your behalf and sends each request to the public data
  source or model behind the tool that was called. Nothing else on your machine is read or sent.
- **Money.** Without a key no call can spend anything: after the free calls a tool answers with a payment request and
  stops. With your key in `config.yaml`, each successful `call_tool` call spends that key's prepaid credits at the
  called tool's price, never more than 100 credits ($0.10) a call. The plugin cannot buy credits and holds no card.
- **Approvals.** The package marks the server `untrusted`. All three tools are annotated read-only: this server cannot
  reach the service's four tools that write (saved agent memory and page publishing), so nothing it runs changes
  anything on your machine or in your accounts. Hermes stops and asks when a chat reaches the spend limit.
- **Credentials.** The package declares none. A key you add lives in your own profile `.env` and is sent as a bearer
  header by Hermes's own MCP client.
- **What the service keeps.** Counts of calls per tool and per day (no inputs or outputs in them), a one-way hash of
  the caller's IP address for the free-call allowance, and for a key a one-way hash of it with its balance and
  purchase history. Its host, Cloudflare, keeps ordinary request logs (IP address, user agent, URL, timing) for days.
  [Privacy](https://agent-data-tools.revmesh2074.workers.dev/privacy) ·
  [Terms](https://agent-data-tools.revmesh2074.workers.dev/terms).
- **No telemetry, no background process, no self-update.** The tool set is served by the remote server at runtime and
  is not covered by the pinned commit.

## Tools above $0.10 a call

This package connects the capped address on purpose: there, a tool priced above $0.10 a call does not exist, so the
100 credits Hermes books per call is a real upper limit. The same three tools without the cap are at `/mcp/compact`,
where `call_tool` runs a dearer tool when the call names its price in `max_price`. If you connect that address
yourself under this server's name, Hermes still books 100 credits for such a call, so its count can then be too low.

## One section instead

The same service serves each section of the catalog as an ordinary MCP server with one definition per tool, priced
the same way: `/mcp/web`, `/mcp/ai`, `/mcp/everyday`, `/mcp/prices`, `/mcp/chain`, `/mcp/compliance` and
`/mcp/utilities`. Add one under another name in `config.yaml` if you would rather have its tools listed by name; this
package declares no costs for those, so Hermes will not count their spend.

Source of this package: <https://github.com/Nutshell2000/agent-data-tools/tree/main/integrations/hermes>. Support:
<https://agent-data-tools.revmesh2074.workers.dev/support>.
