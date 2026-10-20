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

Token prices, OFAC sanctions checks, chain reads, web/PDF reading and LLM calls for AI agents. 25 free calls, then x402, MPP or card credits per call.

## Long description (under 500 characters)

Agent Data Tools sells single tool calls to AI agents over MCP or HTTP. Try 25 calls free, then pay per call with x402 (USDC on Base, Polygon, Arbitrum, Monad, World Chain) or MPP (USDC on Base, USDC.e on Tempo), or by card with prepaid credits; failed calls are never charged. OpenAI-compatible /v1 chat, Responses and embeddings endpoints run on the same tools. Main jobs: value tokens and wallets, vet a counterparty in one call (OFAC SDN, wallet or contract risk, holdings, verdict), and read the web (pages, JavaScript apps, PDFs, RSS). Plus chain reads on five EVM chains and everyday utilities. Most calls cost $0.003.

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
- OpenAI-compatible: https://agent-data-tools.revmesh2074.workers.dev/v1 (chat/completions, responses, embeddings, models)
- Discovery index: https://agent-data-tools.revmesh2074.workers.dev/discovery/resources
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
| Claude directory | `/mcp/account` | claude.ai/directory/manage (paid Claude plan); needs privacy, terms, support, tool titles and annotations (all live) | submitted 2026-10-19, in review |
| ChatGPT apps | `/mcp/account` | OpenAI platform, after business or individual verification; credits are bought on our site, never inside ChatGPT | not submitted |
| Official MCP Registry | `/mcp` and each `/mcp/<section>` | Automatic on each `v*` tag (`.github/workflows/publish-mcp.yml`) | published |
| Glama | `/mcp` | Claim at glama.ai with the Nutshell2000 GitHub account; claim file at `/.well-known/glama.json` | check |
| Smithery | `/mcp/account` (or `/mcp`) | Publishing closed since the Arcade acquisition (403) | closed |
| PulseMCP | `/mcp` | Submissions paused; imports from the official MCP Registry when reopened | waiting on PulseMCP |
| mcp.so | `/mcp` | Paid listing only ($39) | skipped (no spending) |
| Cursor directory | `/mcp` | Needs a cursor.directory sign-in | skipped |
| Agentic.Market, Pay.sh, Ampersend, x402-list.com | origin | Agentic.Market is fed by the Bazaar (first settled payment per tool); Pay.sh needs Solana mainnet; Ampersend lists only its hosted proxies; x402-list.com charges $1 | not usable |
| x402scan | origin | x402scan.com/resources/register or `npx agentcash register <origin>` | 179 resources listed 2026-10-20 |
| MPPScan | origin | mppscan.com/register or the same CLI | 183 of 183 listed 2026-10-20 |
| 402 Index | each tool URL | `scripts/register-402index.mjs` (token file, 10 per hour) | all tools listed |
| mpp.dev services | PR to tempoxyz/mpp (schemas/services.ts) | curated; evm/charge entry with 38 routes | PR 1095 open |
| gold-402 | PR to Pazificateur69/gold-402 (directory/apis.md) | one line, live 402 probe | PR 1 open |
| awesome-remote-mcp-servers | PR to punkpeye/awesome-remote-mcp-servers | needs the Glama connector badge and a starred repo | PR 2339 open, CI green |
| mcpservers.org | `/mcp` | Free form at mcpservers.org/submit | submitted 2026-10-20, 2-week review |
| Circle Agent Marketplace | origin | Google Form (forms.gle/7YFzvdmMcn1JH5tF6), manual review, payout wallet screened | submitted 2026-10-20 |
| Stripe MPP directory | `/credits/buy/*` | machine-payments@stripe.com thread; card packs under MPP-team review; stablecoin access needs an incorporated company | in review 2026-10-20 |
| AgentCash search | origin | Fed by x402scan and MPPScan; semantic index | registered, not indexed (question drafted) |
| MCP Market | `/mcp` | Remote listing is paid only ($69) | skipped (no spending) |
| awesome-x402 (xpaysh) | origin | PR from fork branch `add-agent-data-tools` (compare link in docs/release-1.23.0.md) | not opened |
| RapidAPI | marketplace OpenAPI | Listing exists (Everyday Data API); refresh copy and prices from this file | live |
