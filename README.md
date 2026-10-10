# Agent Data Tools

A Cloudflare Worker that sells fifteen tools to AI agents. Each call is paid in USDC on Base through the x402 protocol, and the money goes straight to the address in `PAY_TO`.

| Endpoint | Returns | Price |
|---|---|---|
| `GET /extract?url=` | Web page as clean text, headings and links | $0.002 |
| `GET /summarize?url=` | Short summary and key points of a page | $0.01 |
| `GET /screenshot?url=` | JPEG of the rendered page (base64) | $0.02 |
| `GET /image?prompt=` | Generated 1024x1024 image (base64) | $0.02 |
| `GET /transcribe?url=` | Text of an audio file (max 5 MB) | $0.02 |
| `GET /describe?url=` | Description of an image, or an answer about it | $0.01 |
| `GET /domain?name=` | DNS, registration age, SPF/DMARC | $0.005 |
| `GET /token?address=` | Base ERC-20 facts and risk flags | $0.01 |
| `GET /wallet?address=` | Base wallet balances | $0.005 |
| `GET /btc-fees` | Bitcoin fee rates and mempool status | $0.002 |
| `GET /btc-address?address=` | Bitcoin address balance and activity | $0.003 |
| `GET /ln-invoice?invoice=` | Decoded Lightning invoice | $0.001 |
| `GET /package?ecosystem=&name=` | Whether a package exists and is safe to install | $0.002 |
| `GET /email?address=` | Email validation without sending mail | $0.001 |
| `GET /papers?query=` | Academic paper search | $0.003 |

Add `trial=1` to any GET request for a free call: up to 3 per caller per day, 300 a day in total. Without it, unpaid requests get the 402 challenge.

The AI endpoints run on Workers AI and `/screenshot` on Browser Rendering, both within Cloudflare's free daily allowance (10,000 AI "neurons" and 10 browser-minutes). When either runs out, or the browser is rate limited, the endpoint answers 503 and the caller is not charged.

Free routes: `/` (a web page for browsers, JSON for programs), `/openapi.json`, `/llms.txt`, `/robots.txt`, `/health`, `/.well-known/x402`, `/.well-known/mcp/server-card.json`, `/.well-known/api-catalog`.

## Store

The service also sells digital products to people at `/store`. A buyer gets an exact USDC amount and the address in `PAY_TO`; the order page watches the chain and unlocks the download when a matching transfer arrives. Agents can buy the same products at `GET /buy/<slug>` through the normal paywall.

- Products are listed in `src/store/catalog.ts`.
- Orders and the sales log live in the `TRIALS` key-value store (`order:` and `paid:` keys). List sales with `npx wrangler kv key list --binding TRIALS --prefix paid: --remote`.
- Product files are not in this repository.

## MCP

The same nine tools are available as an MCP server at `/mcp` (streamable HTTP, stateless). Listing tools is free. Calling a tool without payment returns an x402 payment requirement; an MCP client with x402 support pays and retries. A tool call that fails is not charged.

Each tool is defined once in `src/discovery.ts` (name, price, parameters) and implemented once in `src/tools.ts`; the HTTP route, the MCP tool, the OpenAPI document and the web page are all generated from those.

## Where it is listed

- Official MCP Registry: listed as `io.github.Nutshell2000/agent-data-tools`. To publish a new version, raise `version` in `server.json` and push a matching `v*` tag; the workflow in `.github/workflows/publish-mcp.yml` does the rest on GitHub's servers.
- 402 Index (https://402index.io): all nine endpoints registered on 8 October 2026, pending their review.
- x402scan: not yet. Needs a wallet sign-in at https://www.x402scan.com/resources/register.
- Coinbase Bazaar: not yet. See below.

An unpaid request gets HTTP 402 with a `PAYMENT-REQUIRED` header. Calls that fail (4xx/5xx) are not charged.

## Configuration

All settings are in `wrangler.jsonc`:

- `PAY_TO`: the address that receives payments.
- `NETWORK`: `eip155:8453` for Base mainnet.
- `FACILITATOR_URL`: the service that verifies and broadcasts payments.
- `PAYWALL`: set to `off` only for local testing.

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

The default facilitator needs no account. To appear in Coinbase's x402 Bazaar, payments must go through the Coinbase CDP facilitator:

1. Create a free API key at https://portal.cdp.coinbase.com.
2. Store it as Worker secrets (you'll be prompted for each value):

   ```bash
   npx wrangler secret put CDP_API_KEY_ID
   ```

   ```bash
   npx wrangler secret put CDP_API_KEY_SECRET
   ```

3. In `wrangler.jsonc`, set `FACILITATOR_URL` to `https://api.cdp.coinbase.com/platform/v2/x402` and deploy.

The Bazaar indexes an endpoint after its first settled payment. The CDP path has not been tested end to end, because that needs a real key.

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
