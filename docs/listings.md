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

Agent Data Tools sells single tool calls to AI agents over MCP or HTTP. Try 25 calls free, then pay per call with x402 (USDC on Base, Polygon, Arbitrum, Monad, World Chain) or MPP (USDC on Base, USDC.e on Tempo), or by card with prepaid credits; failed calls are never charged. OpenAI-compatible /v1 chat, Responses and embeddings endpoints run on the same tools. Main jobs: value tokens and wallets, screen a payee before paying or vet a counterparty in one call (OFAC SDN, wallet or contract risk, holdings, verdict), and read the web (pages, JavaScript apps, PDFs, RSS). Plus chain reads on five EVM chains and everyday utilities. Most calls cost $0.003.

## Categories / tags

finance, crypto, blockchain, compliance, web-scraping, data, x402, payments, mcp

## Links

- Website: https://agent-data-tools.revmesh2074.workers.dev/
- MCP server with sign-in (OAuth; for app directories such as Claude and ChatGPT): https://agent-data-tools.revmesh2074.workers.dev/mcp/account
- MCP server, open (streamable HTTP, no sign-in; free calls, then a credit key header or x402): https://agent-data-tools.revmesh2074.workers.dev/mcp
- Buy credits by card: https://agent-data-tools.revmesh2074.workers.dev/credits
- Privacy, terms, support: https://agent-data-tools.revmesh2074.workers.dev/privacy, /terms, /support
- Smaller MCP servers, one per section:
  - https://agent-data-tools.revmesh2074.workers.dev/mcp/prices (prices and DeFi, 19 tools)
  - https://agent-data-tools.revmesh2074.workers.dev/mcp/web (web, documents and search, 17 tools)
  - https://agent-data-tools.revmesh2074.workers.dev/mcp/compliance (company, compliance and checks, 18 tools)
  - https://agent-data-tools.revmesh2074.workers.dev/mcp/chain (chain data, 111 tools)
  - https://agent-data-tools.revmesh2074.workers.dev/mcp/ai (AI text, 15 tools)
  - https://agent-data-tools.revmesh2074.workers.dev/mcp/everyday (everyday data, 15 tools)
  - https://agent-data-tools.revmesh2074.workers.dev/mcp/utilities (utilities, 74 tools)
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
| x402scan | origin | x402scan.com/resources/register or `npx agentcash register <origin>` | 182 of 186 registered 2026-10-20 12:25 UTC via `npx agentcash register` (3 skipped, 0 failed) |
| MPPScan | origin | mppscan.com/register or the same CLI | 186 of 186 registered 2026-10-20 12:25 UTC |
| 402 Index | each tool URL | `scripts/register-402index.mjs` (token file, 10 per hour) | all tools listed |
| mpp.dev services | PR to tempoxyz/mpp (schemas/services.ts) | curated; tools entry (tempo + evm, 41 routes incl. /v1/chat/completions, /v1/responses, /v1/embeddings) plus `agent-data-tools-credits` (stripe card packs at serviceUrl /credits); `pnpm check:services` 44/44 and 7/7; feeds the Stripe Directory's machine-payments index | PR 1095 open, updated 2026-10-20 12:30. Their bot asks for the service PR template (`.github/PULL_REQUEST_TEMPLATE/service.md`) in the PR description before review, and `stale-service-prs.yml` closes service PRs 14 days after opening (#1095: about 2 Nov). Filled template sent to Peter 2026-10-20; this session cannot edit tempoxyz PRs. |
| gold-402 | PR to Pazificateur69/gold-402 (directory/apis.md) | one line, live 402 probe | PR 1 open |
| awesome-remote-mcp-servers | PR to punkpeye/awesome-remote-mcp-servers | needs the Glama connector badge and a starred repo | PR 2339 open, CI green |
| mcpservers.org | `/mcp` | Free form at mcpservers.org/submit | submitted 2026-10-20, 2-week review |
| Circle Agent Marketplace | origin | Google Form (forms.gle/7YFzvdmMcn1JH5tF6), manual review, payout wallet screened | submitted 2026-10-20 |
| Stripe MPP directory | `/credits/buy/*` | machine-payments@stripe.com thread; card packs under MPP-team review; stablecoin access needs an incorporated company | in review 2026-10-20 |
| AgentCash search | origin | Fed by x402scan and MPPScan; semantic index | registered again 2026-10-20 13:55 UTC (x402scan 182/186, MPPScan 186/186, origin id 1db0e01d…) but absent from the first 100 `agentcash search --broad --limit 50` results, even by exact name, while zero-sale origins appear; asked mason@merit.systems by email 2026-10-20 13:58 UTC (from the support address), awaiting reply |
| MCP Market | `/mcp` | Remote listing is paid only ($69) | skipped (no spending) |
| awesome-x402 (xpaysh) | origin | PR from fork branch `add-agent-data-tools` | PR 1829 open (2026-10-20) |
| RapidAPI | marketplace OpenAPI | Listing exists (Everyday Data API); refresh copy and prices from this file | live |
| Agent402 (agent402.tools) | origin | Open cross-seller index plus a router that buys from indexed sellers (unproven sellers last, at most $0.01 a call on Base). `POST /api/index/register {"origin"}` (5 an hour per IP) and `POST /api/mpp-index/register {"origin","path"}`; crawls `/.well-known/x402` every 30 minutes; row at `/api/index?seller=<host>` | x402 index 185 tools, routable, health 1 (re-registered 2026-10-20 12:40). Its Smart Order Router (`/api/route/execute`) buys from indexed sellers: we are `settlement_required` (below the settlement floor) but in the **Base unproven lane** (`executeViaCallableNow`, up to $0.01), tried after proven sellers. Ranking is lexical (slug 30, name 6, text 3): we rank #1 for "ethereum gas price", #2 for OFAC sanctions and wallet portfolio, absent for "web page to markdown" and "base gas". Index still reads `mpp: false` from a stale 10-day-old probe of the paused `/buy/x402-seller-kit`; corrections: mike@agent402.tools |
| Zero.xyz | origin | Search engine and payment layer (ZeroBot reads the Bazaar and OpenAPI). Seller API: `POST https://api.zero.xyz/v1/register {"url","protocol","openapiUrl"}` with EIP-191 headers `x-zero-address/-timestamp/-nonce/-signature` over `METHOD:path:sha256(body):timestamp:nonce` (any wallet we own; our staging test wallet); poll `GET /v1/register/<uid>`. Host record at zero.xyz/host/<host>/llms.txt, demand at `/v1/intents/` and `/v1/commerce/overview` | re-registered 2026-10-20: 183 routes at current prices, 0 activations |
| Ultravioleta DAO Bazaar | each tool URL | Keyless `POST facilitator.ultravioletadao.xyz/discovery/register` (about 5/min, 100 per host); crawled by Dexter | 100 tools registered 2026-10-20 (all 201) |
| Dexter / OpenDexter / x402gle | each tool URL | `npx @dexterai/opendexter audition <tool url> --json` registers the route; the audit then pays a test call from Dexter's wallet (lists on the CDP Bazaar; never revenue). Origin-wide audition answers 500 ("could not persist 3 resource writes") | 11 routes registered 2026-10-20 (gas on 5 chains, /base-gas, /btc-fees, /btc-price, eth/base/arb block). Every test payment was "incomplete: could not settle a test payment on a chain this route accepts" on their side (Dexter pays mostly on Solana, which we do not take). Retry later; query-string URLs are skipped |
| PayAPI Market | origin + one paid route | `POST payapi.market/api/submit-listing`; human review, then PayAPI pays one test call (up to $0.10) | submitted 2026-10-20 with /check/counterparty ($0.03) as the paid route, provider email the support address; status pending (the first attempt timed out client-side, so a duplicate pending entry may exist). Result by email |
| PayAI Bazaar | each tool URL | Listed after a `/verify` of a signed payment (no funds move) | Peter: not now (2026-10-20) |
