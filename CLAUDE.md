@AGENTS.md

## Where things stand (2026-10-18)

- Production runs 1.23.0 (167 tools, commit 413ae01), deployed 2026-10-18 ~19:00 UTC by the local
  Claude Code session through the guard. check:live 167/167, AgentCash discovery 1.7.5 all checks true,
  x402scan lists 167/167, tag v1.23.0 published to the MCP Registry. Baseline: docs/sales-baseline.md.
- Deploys need Cloudflare access, which only Peter's PC has: prepare PRs and a runbook here, and the
  local session deploys with `npm run deploy:production -- --expected-version <live uuid>`.
- Sales plan: flagship tools /check/counterparty and /extract/rendered, free ?sample=1 previews,
  readable 402 bodies, MCP bundles at /mcp/<section>. Directory copy: docs/listings.md.
- OFAC mirror release `ofac-latest` is published by .github/workflows/ofac-mirror.yml.
- Ownership proof is live (PR #84, deployed 2026-10-18): Coinbase Wallet ERC-1271 signature in
  OWNERSHIP_PROOFS, verified on Base by `npm run check:ownership` in CI. AgentCash discovery reports
  trustTier ownership_verified; x402scan re-registered 167/167.
- Pending on Peter: directory submissions, revoking the Cloudflare token pasted in chat.
- After a tool change: bump server.json and MCP_SERVER_VERSION, run `npm run update:mcp-contract`
  last (after any description edit), then `npm test` and `npm run check:mcp-contract`.

## Sales and payments work of 2026-10-19 (PRs #114–#125)

Deploy these together after they merge, then follow "After deploying" below.

- Measurement:
  - `/metrics/callers` → `{ http, mcpConnections }`: requests by calling software (User-Agent family)
    and outcome, plus MCP connections by client app and mode (open, key or account). Only software
    names are stored.
  - `/revenue` adds `cardCredits` (purchases, topUps, buyers, USD bought and spent) only with
    `Authorization: Bearer <REVENUE_TOKEN>`.
  - Weekly table: docs/sales-baseline.md.
- Card credits:
  - Top-up links (`client_reference_id=topup_<sha256 of key>`) add credits to an existing key. They
    appear in out-of-credits responses, `/credits/balance` and the new-key page.
  - MPP top-up: send the existing key in `X-API-Key`.
  - One-time low-balance warning below 200 credits.
  - `POST /credits/rotate` replaces a leaked key.
  - `/credits` offers no pack while `STRIPE_READ_KEY` is unset.
- Free calls:
  - A keyless `/mcp/account` sign-in no longer refills them.
  - Open `/mcp` tells cloud-app users (shared addresses) to use `/mcp/account` for their own.
- Secrets (Peter sets them with `npx wrangler secret put <NAME>`; never in chat or Git):

  | Secret | Status | What it controls |
  |---|---|---|
  | `STRIPE_READ_KEY` | Required | Card claims; without it no pack is offered |
  | `REVENUE_TOKEN` | Optional | Private card-sales figures on `/revenue` |
  | `STRIPE_MPP_KEY` | Optional | Agents buy packs themselves over MPP |
- After deploying:
  1. `check:live` and `node scripts/check-agent-discovery.mjs <discovery dist>`.
  2. `curl <origin>/credits` shows `cardReady: true` and 3 packs.
  3. `curl <origin>/metrics/callers` returns both keys.
  4. Fill in the first scorecard row in docs/sales-baseline.md.
- Waiting on Peter: should the 26 tools still at $0.002 (`/extract`, AI text, fx, weather…) move to
  $0.003? Keep `/extract` at $0.002 as the entry price if so.

## Payment visibility and the staging proof (1.35.0, 2026-10-19)

Audit result of 19 Oct: the paywall, facilitator round-trip, card credits and MCP all work, but no buyer
client has called since 14 Oct; the traffic is directory crawlers. The only paying bots read the Coinbase
Bazaar, which lists a tool only after its first settled payment (2 of 175 are listed). What changed:

- Every refused or failed payment is logged (`wrangler tail`) with its reason and marked in the funnel:
  `refused_amount`, `refused_network`, `refused_format`, `facilitator_unavailable`, plus the existing
  `verification_failed` / `settlement_failed`. `/metrics/callers` counts refused v2 attempts as `v2_payment`
  (v1 as `v1_payment`). Read these on Monday before judging conversion: an attempt that dies in `refused_*`
  is our bug or a stale directory price, not a buyer who changed their mind. The v1 path accepts the
  variations real clients send (version as a string, network as a CAIP-2 id, value as a number at or above
  the quote). On 19 Oct a real, unidentified browser-based v1 buyer failed four times on `/eth/gas` before
  any of this was deployed (Peter confirmed it was not him); watch `wrangler tail` for the next one.
- The published client example (homepage, llms.txt, OpenAPI x-guidance) caps payments at `ORDINARY_PRICE`
  ($0.003, `src/discovery.ts`), so an agent that copies it can pay for every ordinary tool. Keep that
  constant equal to the catalog's common price.
- Paused `/buy/*` paths answer 503 before the paywall and the counters.
- **Staging on Base Sepolia**: `wrangler.staging.jsonc` deploys `agent-data-tools-staging` with the keyless
  testnet facilitator and faucet USDC (`.test-wallet.json`, git-ignored; address from
  `node scripts/pay-test.mjs address`; refill at https://faucet.circle.com). After every release, deploy it
  and prove all three payment paths; none of this touches mainnet or counts as income:

  ```sh
  npx wrangler deploy -c wrangler.staging.jsonc
  node scripts/pay-test.mjs https://agent-data-tools-staging.revmesh2074.workers.dev/btc-fees
  node scripts/pay-test.mjs https://agent-data-tools-staging.revmesh2074.workers.dev/btc-fees --v1
  node scripts/pay-test.mjs https://agent-data-tools-staging.revmesh2074.workers.dev --mcp btc_fees
  ```

  Each prints `settle:` with `success: true` and a transaction; `curl <staging>/revenue` then shows the
  settlements. The script refuses any mainnet network.
- **After any price change** (and after adding tools): run `node scripts/update-402index-prices.mjs --dry`
  then without `--dry` (token in `.402index-token`, git-ignored; copy it from `C:\MoneyWallet\x402-api`),
  `node scripts/register-402index.mjs` for new paths (10 per hour), and re-register the server on x402scan
  so its cached copy and prices match. Directories that still show an old price cause `refused_amount`
  attempts from v1 clients. Prices are frozen at the current catalog until 8 Nov 2026 (the x402 stop-rule
  check) unless Peter decides otherwise.
- Decisions that stay with Peter (not code): Bazaar seeding (one self-settled call per tool through the CDP
  facilitator; the ledger marks self-payments, Peter's rule currently forbids it), app-directory submissions
  (`docs/app-directory-submission.md`), and whether the 19 Oct browser payment attempts on `/eth/gas` were
  his own tests.

## Per-call MPP on the tools (1.36.0): evm on Base ON, Tempo off

- `src/lib/mpp-evm.ts` (on by default, `MPP_EVM` in `wrangler.jsonc`): each tool's 402 also offers `WWW-Authenticate: Payment`
  evm/charge, an EIP-3009 USDC authorization on our x402 network to PAY_TO, verified and settled through the same facilitator
  as x402 (settle only after the tool succeeded, Bazaar extension sent with the settlement, receipt in the ledger). It exists
  so MPPScan lists the 175 tools without a first settled payment, at no cost. Staging proof after every release:
  `node scripts/pay-test.mjs <staging>/time?zone=UTC --mpp-evm`. After deploying, re-register the origin at mppscan.com/register.
- `src/lib/mpp-tempo.ts`: a second challenge, tempo/charge (USDC.e on Tempo, pull mode), broadcast only after the tool
  succeeded. It stays off while `TEMPO_PAY_TO` in `wrangler.jsonc` is empty.
- Peter decides the receiving address (reuse PAY_TO after a wallet check, or a new Tempo address):
  `docs/mpp-per-call.md`. Do not set `TEMPO_PAY_TO` without his answer in chat.
- Credit packs `/credits/buy/*` answer GET only, and their Stripe challenge names a recipient (the MPPScan warnings).

## Discovery files (1.36.1)

- `/discovery/resources` (src/lib/discovery-index.ts) is our own Bazaar-shaped index of every tool with exact USDC terms per network, paged (`limit` up to 500, `offset`); `/.well-known/x402.json` aliases `/.well-known/x402`. Directories that crawl sellers directly read these; the Coinbase Bazaar still needs a first settled payment per tool.
- Directory PRs opened 2026-10-20: tempoxyz/mpp#1095 (mpp.dev services, 38 routes, evm/charge) and Pazificateur69/gold-402#1. Circle Agent Marketplace form (forms.gle/7YFzvdmMcn1JH5tF6) is Peter's to send (indemnification clause).
