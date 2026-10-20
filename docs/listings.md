# Directory listing copy

One block to paste into MCP and x402 directory forms (PulseMCP, mcp.so, MCP Market, Smithery,
Glama, and the x402 service directories named in the x402 README). Keep it in step with `SERVICE_SUMMARY` in `src/endpoints.ts` and the
bundle list in `MCP_BUNDLES` (`src/discovery.ts`). Never claim usage, customers or uptime we
cannot show; `/status` is the public reliability source.

## Name

Agent Data Tools

## Tagline (under 80 characters)

Pay-per-call data tools for AI agents: prices, sanctions, web and PDF reading

## Short description (under 160 characters)

Token prices, OFAC sanctions checks, chain reads and web/PDF reading for AI agents. 25 free calls, then card credits or x402 per call.

## Long description (under 500 characters)

Agent Data Tools sells single tool calls to AI agents over MCP or HTTP. Try 25 calls free, then pay by card with prepaid credits or per call with x402 (USDC); failed calls are never charged. Main jobs: value tokens and wallets, vet a counterparty in one call (OFAC SDN, wallet or contract risk, holdings, verdict), and read the web (pages, JavaScript apps, PDFs, RSS). Plus chain reads on five EVM chains and everyday utilities. Most calls cost $0.003.

## Categories / tags

finance, crypto, blockchain, compliance, web-scraping, data, x402, payments, mcp

## Links

- Website: https://agent-data-tools.revmesh2074.workers.dev/
- MCP server with sign-in (OAuth; for app directories such as Claude and ChatGPT): https://agent-data-tools.revmesh2074.workers.dev/mcp/account
- MCP server, open (streamable HTTP, no sign-in; free calls, then a credit key header or x402): https://agent-data-tools.revmesh2074.workers.dev/mcp
- Buy credits by card: https://agent-data-tools.revmesh2074.workers.dev/credits
- Privacy, terms, support: https://agent-data-tools.revmesh2074.workers.dev/privacy, /terms, /support
- Smaller MCP servers, one per section:
  - https://agent-data-tools.revmesh2074.workers.dev/mcp/prices (prices and DeFi, 12 tools)
  - https://agent-data-tools.revmesh2074.workers.dev/mcp/web (web, documents and search, 11 tools)
  - https://agent-data-tools.revmesh2074.workers.dev/mcp/compliance (company, compliance and checks, 12 tools)
  - https://agent-data-tools.revmesh2074.workers.dev/mcp/chain (chain data, 64 tools)
  - https://agent-data-tools.revmesh2074.workers.dev/mcp/ai (AI text, 15 tools)
  - https://agent-data-tools.revmesh2074.workers.dev/mcp/everyday (everyday data, 10 tools)
  - https://agent-data-tools.revmesh2074.workers.dev/mcp/utilities (utilities, 52 tools)
- OpenAPI: https://agent-data-tools.revmesh2074.workers.dev/openapi.json
- llms.txt: https://agent-data-tools.revmesh2074.workers.dev/llms.txt
- Reliability: https://agent-data-tools.revmesh2074.workers.dev/status
- Logo / preview image (1200x630 PNG): https://agent-data-tools.revmesh2074.workers.dev/og.png
- Icon: https://agent-data-tools.revmesh2074.workers.dev/favicon.ico
- Source: https://github.com/Nutshell2000/agent-data-tools

## Where to submit

Status is updated by whoever submits (date, result). Peter submits; nothing here is automated except the
MCP Registry.

| Directory | URL to submit | How | Status |
|---|---|---|---|
| Claude directory | `/mcp/account` | claude.ai/directory/manage (paid Claude plan); needs privacy, terms, support, tool titles and annotations (all live) | not submitted |
| ChatGPT apps | `/mcp/account` | OpenAI platform, after business or individual verification; credits are bought on our site, never inside ChatGPT | not submitted |
| Official MCP Registry | `/mcp` and each `/mcp/<section>` | Automatic on each `v*` tag (`.github/workflows/publish-mcp.yml`) | published |
| Glama | `/mcp` | Claim at glama.ai with the Nutshell2000 GitHub account; claim file at `/.well-known/glama.json` | check |
| Smithery | `/mcp/account` (or `/mcp`) | "Add server" at smithery.ai, remote streamable HTTP | not submitted |
| PulseMCP | `/mcp` | Submit form at pulsemcp.com; paste the long description | not submitted |
| mcp.so | `/mcp` | Submit form; paste the long description | not submitted |
| Cursor directory | `/mcp` | cursor.directory submission | not submitted |
| Agentic.Market, Pay.sh, ampersend discover, x402-list.com | origin | The x402 README's service directories; some index only after real paid calls | not submitted |
| awesome-x402 (xpaysh) | origin | PR from fork branch `add-agent-data-tools` (compare link in docs/release-1.23.0.md) | not opened |
| RapidAPI | marketplace OpenAPI | Listing exists (Everyday Data API); refresh copy and prices from this file | live |
