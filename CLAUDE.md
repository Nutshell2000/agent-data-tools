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
