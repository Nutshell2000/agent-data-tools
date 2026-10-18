# Directory listing copy

One block to paste into MCP and x402 directory forms (PulseMCP, mcp.so, MCP Market, Smithery,
Glama, x402.org ecosystem). Keep it in step with `SERVICE_SUMMARY` in `src/endpoints.ts` and the
bundle list in `MCP_BUNDLES` (`src/discovery.ts`). Never claim usage, customers or uptime we
cannot show; `/status` is the public reliability source.

## Name

Agent Data Tools

## Tagline (under 80 characters)

Pay-per-call data tools for AI agents: prices, sanctions, web and PDF reading

## Short description (under 160 characters)

Token prices, wallet portfolios, OFAC sanctions checks, chain reads and web/PDF reading for AI agents. Pay per call in USDC on Base via x402. No API key.

## Long description (under 500 characters)

Agent Data Tools sells single tool calls to AI agents over HTTP or MCP, paid per call in USDC on Base via x402: no account, no API key, and failed calls are never charged. Main jobs: value tokens and wallets (Uniswap v3 prices, portfolios), screen counterparties (OFAC SDN, contract and token checks), and read the web (pages, PDFs and RSS as clean text, link previews). Plus chain reads on five EVM chains and everyday utilities. Most calls cost $0.001.

## Categories / tags

finance, crypto, blockchain, compliance, web-scraping, data, x402, payments, mcp

## Links

- Website: https://agent-data-tools.revmesh2074.workers.dev/
- MCP server (streamable HTTP, no auth; tools ask for x402 payment): https://agent-data-tools.revmesh2074.workers.dev/mcp
- Smaller MCP servers, one per section:
  - https://agent-data-tools.revmesh2074.workers.dev/mcp/prices (prices and DeFi, 12 tools)
  - https://agent-data-tools.revmesh2074.workers.dev/mcp/web (web, documents and search, 10 tools)
  - https://agent-data-tools.revmesh2074.workers.dev/mcp/compliance (company, compliance and checks, 9 tools)
  - https://agent-data-tools.revmesh2074.workers.dev/mcp/chain (chain data, 60 tools)
  - https://agent-data-tools.revmesh2074.workers.dev/mcp/ai (AI text, 13 tools)
  - https://agent-data-tools.revmesh2074.workers.dev/mcp/everyday (everyday data, 10 tools)
  - https://agent-data-tools.revmesh2074.workers.dev/mcp/utilities (utilities, 52 tools)
- OpenAPI: https://agent-data-tools.revmesh2074.workers.dev/openapi.json
- llms.txt: https://agent-data-tools.revmesh2074.workers.dev/llms.txt
- Reliability: https://agent-data-tools.revmesh2074.workers.dev/status
- Logo / preview image (1200x630 PNG): https://agent-data-tools.revmesh2074.workers.dev/og.png
- Icon: https://agent-data-tools.revmesh2074.workers.dev/favicon.ico
- Source: https://github.com/Nutshell2000/agent-data-tools

## Where to submit

| Directory | How | Notes |
|---|---|---|
| Official MCP Registry | Automatic: `.github/workflows/publish-mcp.yml` on each `v*` tag | Many directories mirror it |
| Glama | Claim the server at glama.ai with the Nutshell2000 GitHub account | `glama.json` in the repo root names the maintainer |
| Smithery | "Add server" at smithery.ai with the remote URL `https://agent-data-tools.revmesh2074.workers.dev/mcp` | Remote streamable HTTP, no auth |
| PulseMCP | Submit form at pulsemcp.com | Paste the long description |
| mcp.so | Submit form | Paste the long description |
| x402.org ecosystem | Pull request to the site's ecosystem list | Logo: /og.png |
| awesome-x402 (xpaysh) | Pull request from the fork branch `add-agent-data-tools` | Already prepared |
