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
