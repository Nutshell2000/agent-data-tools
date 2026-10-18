# Release 1.23.0 runbook

For the person or agent deploying from a PC with Cloudflare access. Deploys nothing by itself.
Follow AGENTS.md; nothing here relaxes the deploy guard, the price floor or the no-seeding rule.

## What ships (live is c6d231cb, built from 25e4682)

- 167 tools (was 161 live). New: `/check/counterparty` ($0.03, base/eth/arb/op), `/extract/rendered` ($0.01),
  `/price/tokens`, `/wallet/portfolio`, `/feed`, `/url/meta`, `/sanctions/check` via the GitHub OFAC mirror.
- Readable 402 bodies, free `?sample=1` previews, `/og.png`, `/status`, MCP bundles at `/mcp/<section>`.
- Cold-start fixes (ajv stub, cached MCP wrappers, pre-built OFAC index).

The OFAC mirror release `ofac-latest` is already published (SDN.CSV, ALT.CSV, ofac-index.json).

## Steps

1. `git pull` on main; confirm CI passed on the exact commit (the deploy script checks this).
2. `npm ci && npm test` (all pass except the PowerShell test where pwsh is missing).
3. `npm run smoke:families` — every family tool on its example input against live sources.
   Then `node scripts/smoke-families.mjs counterparty`. Report any FAIL lines.
4. `npx wrangler deployments list` — confirm the live version is still `c6d231cb-5de2-4aef-b646-18c806c16986`.
5. `npm run deploy:production -- --expected-version c6d231cb-5de2-4aef-b646-18c806c16986`
6. After deploy, read-only checks (none of them pay):
   - `npm run check:live` → expect `167/167 ready`.
   - `node scripts/check-agent-discovery.mjs <@agentcash/discovery>/dist/index.js` → every check `true`.
   - `curl -s "$ORIGIN/check/counterparty?sample=1"` → 200 with `"sample":true`.
   - `curl -si "$ORIGIN/check/counterparty?address=0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045&chain=eth"` → 402 with a JSON body carrying `x402Version: 2`.
   - `curl -s "$ORIGIN/status"` and `curl -sI "$ORIGIN/og.png"` → 200.
   - One paid `/extract/rendered` call through an x402 client is the only check that needs the browser binding;
     it costs $0.01 and is a test purchase, not listing seeding. Skip it if unsure.
7. Tag `v1.23.0` and push the tag (publishes server.json to the MCP Registry).
8. Only when step 6 shows 167/167: re-register the origin on x402scan (a failing probe deprecates that resource).
9. Record the baseline in `docs/sales-baseline.md`: `/revenue`, `/metrics`, `/status` and the funnel counts, dated.

`ORIGIN=https://agent-data-tools.revmesh2074.workers.dev`

## Waiting on Peter

- Ownership proof: run `scripts/sign-ownership-proof.mjs` locally and share only the printed signature.
- Directory submissions from `docs/listings.md` (Glama claim, Smithery, PulseMCP, mcp.so, x402 directories,
  awesome-x402 PR from the `add-agent-data-tools` fork branch).
- Revoke the Cloudflare token pasted into chat on 2026-10-18.
