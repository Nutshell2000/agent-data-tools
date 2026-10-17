# Agent Data Tools

Operated by **SpellzCode**. Start with [static documentation reading](docs/web-reading.md): clean text, Markdown, code and tables for **$0.002 USDC on Base**, using an existing funded x402 wallet. No account or subscription. Static HTML, Markdown and plain text only; no JavaScript rendering, authenticated pages or paywall access.

- [Browse all 32 tools and prices](https://agent-data-tools.revmesh2074.workers.dev/#tools)
- [View a real result → Inspect a free quote → Buy one page](https://agent-data-tools.revmesh2074.workers.dev/guides/web-reading)
- [Use the local MCP adapter without writing a client](docs/local-mcp.md)
- [Inspect the portable buyer skill](skills/spellzcode-x402-reader/SKILL.md) and [installation context](https://agent-data-tools.revmesh2074.workers.dev/skills/index.json)
- [Research a technical question from three pages: maximum $0.006](docs/three-page-research.md)
- [Discover documentation URLs from a sitemap: $0.002](docs/sitemap.md)
- [Real cached examples and owned source HTML](https://agent-data-tools.revmesh2074.workers.dev/examples/extract/)
- [Extraction benchmark and limitations](docs/extraction-quality.md)
- Secondary: [Bitcoin fee data with capped CLI and local MCP commands](docs/bitcoin-fees.md)

The downloadable client requires Node 20.19+ and no npm installation or TypeScript. An unsigned quote needs no key and never pays. An explicit authorized purchase needs an existing funded Base wallet and a per-call cap of at most $0.002. The local MCP adapter starts in quotes-only mode; deliberately enabled buying shares a process budget across reader, sitemap and Bitcoin-data calls. Keys stay on the buyer's device.

Repository fallback downloads for **1.7.4**: [CLI executable](https://github.com/Nutshell2000/agent-data-tools/releases/download/reader-1.7.4/reader-client.mjs) and [its checksum](https://github.com/Nutshell2000/agent-data-tools/releases/download/reader-1.7.4/reader-client.mjs.sha256), or [local MCP adapter](https://github.com/Nutshell2000/agent-data-tools/releases/download/reader-1.7.4/reader-mcp.mjs) and [its checksum](https://github.com/Nutshell2000/agent-data-tools/releases/download/reader-1.7.4/reader-mcp.mjs.sha256). Save the executable and matching checksum in one folder, then follow the [verification instructions](docs/web-reading.md) before running it. [Release notes and all six files](https://github.com/Nutshell2000/agent-data-tools/releases/tag/reader-1.7.4). These match the website's published bytes; checksums are not independent security signatures. Older [1.7.0 downloads](https://github.com/Nutshell2000/agent-data-tools/releases/tag/reader-1.7.0) and [1.5.1 downloads](https://github.com/Nutshell2000/agent-data-tools/releases/tag/reader-1.5.1) remain available unchanged.

Need help with an existing attempt? [Report a purchase problem](https://github.com/Nutshell2000/agent-data-tools/issues/new?template=purchase-problem.yml) using the request ID, approximate UTC time and reported payment status. Stop after an uncertain signed outcome; do not make a new purchase to reproduce it. For missing text, code or tables, [report an output problem](https://github.com/Nutshell2000/agent-data-tools/issues/new?template=reader-output.yml) with a short public or authored example. Reports are public: never include keys, signatures, raw payment headers or private content.

The reader also supports an exact HTML section ID and retains labelled source image descriptions; it does not interpret image pixels. Source-declared authors and publication/update dates now include provenance and unverified/ambiguity warnings when available. Check scope, output limits and warnings before claiming coverage. [Full buying instructions](docs/web-reading.md).

Cached examples are actual build-time results on owned HTML and are labelled separately from illustrative snippets. Local tests do not establish funded production delivery or customer demand.

A Cloudflare Worker that sells 32 tools to AI agents. Each call is paid in USDC on Base through the x402 protocol, and the money goes straight to the address in `PAY_TO`.

| Endpoint | Returns | Price |
|---|---|---|
| `GET /sitemap?url=&contains=&maxUrls=&offset=` | XML sitemap URLs, source-reported dates and pagination (bounded, no crawling) | $0.002 |
| `GET /extract?url=` | Web page as clean text, headings and links | $0.002 |
| `GET /domain?name=` | DNS, registration age, SPF/DMARC | $0.005 |
| `GET /domain-report?name=` | Domain trust verdict and email-auth flags | $0.01 |
| `GET /token?address=` | Base ERC-20 facts and risk flags | $0.01 |
| `GET /token-report?address=` | Base token risks and live DEX market data | $0.02 |
| `GET /wallet?address=` | Base wallet balances and account nonce | $0.005 |
| `GET /summarize?url=` | Short summary and key points of a page | $0.01 |
| `GET /screenshot?url=` | JPEG of the rendered page (base64) | $0.02 |
| `GET /image?prompt=` | Generated 1024x1024 image (base64) | $0.02 |
| `GET /transcribe?url=` | Text of an audio file (max 5 MB) | $0.02 |
| `GET /describe?url=` | Description of an image, or an answer about it | $0.01 |
| `GET /btc-fees` | Bitcoin fee rates and mempool status | $0.002 |
| `GET /btc-address?address=` | Bitcoin address balance and activity | $0.003 |
| `GET /ln-invoice?invoice=` | Decoded Lightning invoice | $0.002 |
| `GET /package-audit?packages=` | Audit up to 10 dependencies; supports exact-version advisories and fixes | $0.20 |
| `GET /wallet-audit?address=` | Base token holdings and nonce-based heuristic risk indicators | $0.02 |
| `GET /contract-risk?address=` | Limited bytecode, EIP-1967 slot and zero-supply heuristics | $0.02 |
| `GET /trade-insight?token=&wallet=` | Separate token and wallet risk indicators; no trade recommendation | $0.05 |
| `GET /liquidity-pool-audit?address=` | Verified Base DEX pair details and reported market data | $0.03 |
| `GET /mev-simulator` | Base gas-cost estimates using fixed typical gas units; not a quote | $0.04 |
| `GET /package?ecosystem=&name=&version=` | Latest or pinned package metadata and bounded dependency-risk signals (not a safety guarantee) | $0.002 |
| `GET /email?address=` | Email validation without sending mail | $0.002 |
| `GET /papers?query=` | Academic paper search | $0.003 |
| `GET /fx?from=&to=` | Currency exchange rates and conversion | $0.002 |
| `GET /btc-price` | Bitcoin price in major currencies | $0.002 |
| `GET /base-gas` | Base network gas price and fee estimate | $0.002 |
| `GET /base-tx?hash=` | Base transaction status and details | $0.003 |
| `GET /base-allowance?token=&owner=&spender=` | ERC-20 approval check on Base | $0.002 |
| `GET /ens?name=` | ENS name/address resolution | $0.002 |
| `GET /weather?lat=&lon=` | Current weather and hourly forecast | $0.002 |
| `GET /time?zone=` | Current time and time zone conversion | $0.002 |

The catalog lists 32 paid tools. Free trials are disabled by default. A request with `trial=1` gets the normal 402 challenge unless the Worker variable `TRIALS_ENABLED` is set to exactly `on`; this opt-in is reversible. When enabled, the trial limits are 10 calls per caller per day and 1,000 calls total per day.

The homepage and `llms.txt` include a copy-pastable Node.js/TypeScript x402 client using `@x402/fetch`, `@x402/evm` and viem. It reads the private key from `X402_PRIVATE_KEY` (never hard-code or commit it), pins Base, the service's published `PAY_TO` recipient and Base USDC, and caps each payment at the `/extract` catalog price of $0.002. It does not add `trial=1`. `/package-audit` remains $0.20 per call and is intentionally refused by this lower-spend example. The OpenAPI `x-guidance` carries the same client, price and trial notes.

`/package` keeps its latest-version behavior when `version` is omitted. Pass `ecosystem`, `name` and an optional exact `version` as separate inputs (for example, `ecosystem=npm&name=lodash&version=4.17.20`) to return pinned-version metadata and deps.dev advisories. Version ranges and tags are rejected. For exact-version OSV affected ranges and dated FIRST EPSS CVE estimates, use `/package-audit`.

`/package-audit` accepts up to 10 comma-separated `ecosystem:name` items, optionally with an exact version, such as `npm:lodash@4.17.20` or `npm:@types/node@22.0.0`. Unversioned items retain latest-version checks. To bound outbound fetches, it does not query npm weekly downloads; `weeklyDownloadsStatus` is `not-fetched-subrequest-budget`. Unversioned items fetch at most one deps.dev advisory detail and report `advisoryDetailsOmitted`; failed detail fetches are counted in `advisoryDetailsUnavailable` and make `advisoryDetailsStatus` partial. Pinned items skip duplicate deps.dev details but retain all advisory IDs/counts. Exact versions use OSV batch IDs and up to 15 detailed records per request; per-advisory `detailStatus`, `detailsNotFetched` and `omittedAdvisories` identify incomplete coverage. Returned CVE aliases are enriched with dated FIRST EPSS estimates in one deduplicated request (up to 50 CVEs); `epssLookup` reports source status, retrieval time, omitted CVEs and uninspected OSV details. EPSS estimates 30-day exploitation probability, not package safety; missing scores are unknown, not zero. Neither `ok` nor an empty advisory result means a package is safe.

`/airdrop-scanner`, `/liquidity-return-analyzer`, `/token-holder-analysis`, `/pair-analyzer` and `/wallet-history` are deferred because this service has no verified live data sources for their advertised analyses. They are not listed as paid tools and return HTTP 503 without a payment challenge or charge.

The AI endpoints use Workers AI and `/screenshot` uses Browser Rendering. Account allowances and actual operating costs must be checked separately; they are not established by the API price. Upstream capacity or rate-limit failures return errors without settling a charge.

Free routes include the owned `/examples/extract/` results, versioned `/clients/reader/` downloads, `/sitemap.xml`, `/` (a web page for browsers, JSON for programs), `/openapi.json`, `/llms.txt`, `/robots.txt`, `/health`, `/.well-known/x402`, `/.well-known/mcp/server-card.json`, `/.well-known/api-catalog`.

`/metrics` reports daily request counts by path. `unsettled` counts successful HTTP 2xx responses on paid paths without a verified successful `PAYMENT-RESPONSE`; only calls with a valid settlement response increment `paid`. `revenueUsdMicros` is gross USD in millionths of a dollar, and `trackedPaidCalls` counts settled x402 HTTP API, MCP tool and `/buy/<slug>` calls included in that total. MCP totals are recorded only when the payment wrapper returns a successful structured settlement result; x402 product purchases use the exact product catalog price. Revenue fields are prospective and have no historical backfill. `paid` counts from before settlement validation are not proof of payment and must not be used as revenue. Challenges, trials, marketplace requests, unsettled responses, and direct storefront-transfer amounts are excluded.

## Store

New digital-product sales are paused at `/store` and `/buy/*` (HTTP 503, no payment challenge). Existing orders and downloads are preserved. The retained implementation works as follows: A buyer gets an exact USDC amount and the address in `PAY_TO`; the order page watches the chain and unlocks the download when a matching transfer arrives. Agents can buy the same products at `GET /buy/<slug>` through the normal paywall.

- Products are listed in `src/store/catalog.ts`.
- Orders and the sales log live in the `TRIALS` key-value store (`order:` and `paid:` keys). List sales with `npx wrangler kv key list --binding TRIALS --prefix paid: --remote`.
- The DeFi Trader Intelligence Bundle is delisted because the service has no API-key authentication, 250-call quota or `/account` endpoint. Legacy order receipts remain supported, but actual download fulfillment is unverified. Product assets under the gitignored `public/_files/` directory are intentionally absent from Git and must be privately provisioned before deploying a fresh checkout; missing assets make paid downloads return 502. The existing production worktree retains these assets. Never publish them in source control.

## MCP

The same 32 catalog tools are available as an MCP server at `/mcp` (streamable HTTP, stateless). Listing tools is free. Calling a tool without payment returns an x402 payment requirement; an MCP client with x402 support pays and retries. A tool call that fails is not charged.

Each tool is defined once in `src/endpoints.ts` (name, price, parameters) and implemented once in `src/tools.ts`; the HTTP route, MCP tool, OpenAPI document and web page are generated from that catalog.

## Where it is listed

- Official MCP Registry: listed as `io.github.Nutshell2000/agent-data-tools`. To publish a new version, raise `version` in `server.json` and push a matching `v*` tag; the workflow in `.github/workflows/publish-mcp.yml` does the rest on GitHub's servers.
- 402 Index (https://402index.io): existing reader entries and catalog metadata were refreshed on 15 October 2026. Third-party caches can remain stale; the live catalog and quotes take precedence.
- x402scan: existing listings cover the catalog. Reconcile current prices after each release; no new duplicate registration is needed.
- Coinbase Bazaar: Bitcoin fees and package metadata have indexed entries. Other routes require a genuine settled payment; a readiness pass alone does not index them.

An unpaid request gets HTTP 402 with a `PAYMENT-REQUIRED` header. Calls that fail (4xx/5xx) are not charged.

## Current revenue operations

The active catalog has 32 paid tools. New seller-kit sales are paused; existing paid orders keep download access. Free trials remain disabled.
`/metrics` reports request counters; `/revenue` reports deduplicated, facilitator-reported
settlements observed since the ledger was deployed. Its amounts are integer native
Base USDC atomic units (6 decimals), and known self-payments are excluded from gross.
Receipts preserve transaction, payer, authorization nonce, endpoint and amount evidence
privately in the existing Durable Object. Signatures and request content are not stored.
Public responses expose aggregate totals only. A storage error is logged without turning
an already-settled customer response into another payment request.

These totals remain pending independent chain reconciliation. Fees, expenses and net
income are not inferred. Historical paid counters cannot be backfilled using today's prices. The two indexed
historical receipts were 2,000 atomic units each and remain separate from the current
settlement ledger. Tests and self-payments are never customer income.

The live catalog is authoritative for current tools, prices and trial availability.


## Configuration

All settings are in `wrangler.jsonc`:

- `PAY_TO`: the address that receives payments.
- `NETWORK`: `eip155:8453` for Base mainnet.
- `FACILITATOR_URL`: the service that verifies and broadcasts payments.
- `PAYWALL`: set to `off` only for local testing.
- `TRIALS_ENABLED`: trials are disabled unless set exactly to `on`; set to `off` (or unset it) to disable them.

## Commands

```bash
npx wrangler dev
```

```bash
npx wrangler deploy
```

```bash
npx wrangler tail
```

`wrangler tail` streams live requests, which is the quickest way to see whether anyone is calling the service.

On Windows, `wrangler dev` can fail with `SQLITE_CANTOPEN` when the project path is long. Add `--persist-to` with a short folder path to fix it.

To try `/screenshot` without the paywall, use `npx wrangler dev --remote --var PAYWALL:off`. It runs on Cloudflare, so no browser is downloaded to this PC.

## Listing in the Coinbase Bazaar

This deployment already uses the authenticated Coinbase CDP facilitator. For a separate installation, configure your own account:

1. Create a free API key at https://portal.cdp.coinbase.com.
2. Store it as Worker secrets (you'll be prompted for each value):

   ```bash
   npx wrangler secret put CDP_API_KEY_ID
   ```

   ```bash
   npx wrangler secret put CDP_API_KEY_SECRET
   ```

3. In `wrangler.jsonc`, set `FACILITATOR_URL` to `https://api.cdp.coinbase.com/platform/v2/x402` and deploy.

The Bazaar indexes an endpoint after a successful settled payment with discovery metadata. Never manufacture self-purchases to seed it. `npm run check:live` runs the free, read-only Coinbase validator against every documented tool example. It does not sign, settle or create an index entry. The historical `scripts/index-listings.mjs --pay` route is disabled. HTTP and MCP funded production delivery remain separate evidence requirements.

## Checking that it works

Live URL: https://agent-data-tools.revmesh2074.workers.dev

Coinbase runs a free validator. A pass shows `"valid":true` and `"simulation":{"outcome":"accepted"}`:

```bash
curl -X POST https://api.cdp.coinbase.com/platform/v2/x402/validate -H "Content-Type: application/json" -d "{\"resource\":\"https://agent-data-tools.revmesh2074.workers.dev/domain?name=cloudflare.com\",\"method\":\"GET\"}"
```

Incoming payments show up as USDC transfers to `PAY_TO` on https://basescan.org.

## Limits

- `/extract` reads at most 2 MB of a page and waits at most 8 seconds for it.
- `/token` and `/wallet` use the public Base RPC, which is rate limited. Set `BASE_RPC_URL` to a private endpoint if volume grows.
- Token capability flags are bytecode heuristics, and for a proxy they describe the proxy, not its implementation.

### Agent-client compatibility evidence

On 15 October 2026, `@agentcash/discovery` 1.7.5 discovered all 31 live routes from our OpenAPI, recognized `/extract` as paid x402 at `0.002 USD`, retrieved the standalone-client guidance and read the full reader schema. This was a wallet-free metadata check, not funded delivery or a customer purchase. AgentCash CLI 0.17.1's `check` command loads an existing wallet; its discovery library can inspect schemas without one. Our standalone `quote` needs no wallet or key.

Reproduce the read-only check with an independently installed discovery library:

```sh
node scripts/check-agent-discovery.mjs /path/to/@agentcash/discovery/dist/index.js /private/path/evidence.json
```

The script does not install packages, initialize wallets, sign payments or execute paid extraction. It checks the current production catalog, price, guidance and structured output schema; funded HTTP, CLI and MCP delivery require separate evidence.

### Use a local MCP agent without writing a client

The [bundled local MCP adapter](https://agent-data-tools.revmesh2074.workers.dev/guides/local-mcp) runs with Node 20.19+ and no npm installation. Quotes-only by default. Explicit paid mode enables one-call purchases capped at $0.002 each and a process session allowance; unknown signed outcomes lock further buys. [Source and setup](docs/local-mcp.md). Preserve host tool approvals. The remote MCP connection alone does not pay automatically.

### Read the relevant section of a long document

Optional `section` selects an exact visible heading/container ID within primary HTML. Use `--section` with the CLI or `section` with MCP. Missing/ambiguous selections fail uncharged; returned scope is explicit. [Actual cached late-section example](https://agent-data-tools.revmesh2074.workers.dev/examples/extract/section-result.json) and [scope instructions](docs/web-reading.md). Price remains $0.002. URL fragments alone do not change scope.

### Portable buyer skill

The [single-file reader skill](skills/spellzcode-x402-reader/SKILL.md) gives a compatible agent the quote, authorized purchase, section-reading and failure-reconciliation workflow. [Owned download](https://agent-data-tools.revmesh2074.workers.dev/skills/spellzcode-x402-reader/SKILL.md) and [installation context](https://agent-data-tools.revmesh2074.workers.dev/skills/index.json). Place it in a folder named spellzcode-x402-reader in your host's configured skills location using that host's procedure. Inspect before installing; no automatic installation, wallet creation or spending authorization is supplied. Host activation and funded delivery are not established by publication.

### Secondary entry: Bitcoin fee data

The same downloaded client now supports `node reader-client.mjs quote-btc-fees` and one authorized `node reader-client.mjs buy-btc-fees --max-usdc 0.002`. No URL, npm setup or Bitcoin key. Local MCP exposes btc_fees_quote/btc_fees_buy under the shared session allowance. This buys data for Base USDC and never sends Bitcoin. [Setup and limitations](docs/bitcoin-fees.md). The static reader remains the primary workflow.


### Earlier reader releases

Version 1.2.0 adds the bounded `/sitemap` tool and capped `quote-sitemap`/`buy-sitemap` commands. Version 1.1.2 adds a local command builder with POSIX/PowerShell quoting and a three-page research recipe, while preserving immutable 1.1.1 downloads. Reader 1.1.1 separates metadata limits from primary table text, preserves literal code whitespace and nested lists, and closes clipped code fences within the output limit. The bundled Node client supports an unsigned `quote` and one explicitly capped `buy`. Build it and the cached samples with `npm run build:reader`. Downloaded clients need Node 20.19+ and no project dependencies. Checksums and public source accompany the download; keys stay in the buyer's process environment.

Remote MCP advertises successful-result JSON schemas for `extract`, `sitemap` and `btc-fees`, matching OpenAPI. Results are checked before settlement. Quotes and failures return `isError: true` with JSON in `content[0].text`; only successful results have `structuredContent`. This keeps free quotes usable by schema-validating clients.
