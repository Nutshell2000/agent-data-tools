@AGENTS.md

## Where things stand (2026-10-18)

- main carries catalog 1.23.0 (167 tools); production still runs c6d231cb (161 tools). Deploy and
  checks: follow docs/release-1.23.0.md step by step.
- Sales plan: flagship tools /check/counterparty and /extract/rendered, free ?sample=1 previews,
  readable 402 bodies, MCP bundles at /mcp/<section>. Directory copy: docs/listings.md.
- OFAC mirror release `ofac-latest` is published by .github/workflows/ofac-mirror.yml.
- Pending on Peter: ownership proof signature (scripts/sign-ownership-proof.mjs; share only the
  signature, then add it to OWNERSHIP_PROOFS in src/discovery.ts), directory submissions, revoking
  the Cloudflare token pasted in chat.
- After a tool change: bump server.json and MCP_SERVER_VERSION, run `npm run update:mcp-contract`
  last (after any description edit), then `npm test` and `npm run check:mcp-contract`.
