# Capped Base chain client 1.0.0

[Buying guide and workflows](../../docs/chain-checks.md) · [Versioned release](https://github.com/Nutshell2000/agent-data-tools/releases/tag/chain-client-1.0.0)

This standalone Node executable buys results from four existing tools: `/base-tx`, `/wallet`, `/base-gas` and `/base-allowance`. No tool handler, response contract, price or reader client is changed. Quotes never read a key or sign. Each explicit buy has its own cap and authorizes/submits at most once. Stop after an uncertain signed outcome; there is no automatic recovery purchase or paid polling.

## Reproduce the executable

From the repository root at the release's pinned source commit:

```sh
npm ci
node clients/chain/build.mjs
node --test --test-concurrency=1 tests/chain-client.test.cjs
```

The build uses the existing root lockfile and dependencies without updating them. It writes `chain-client.mjs` and `chain-client.mjs.sha256` under the ignored `.release-build/chain-client/1.0.0/` folder. It does not rebuild or replace reader downloads or change Worker assets. The client has its own 1.0.0 version; this client release does not change the Worker version.

`core.mjs` fixes the HTTPS origin, recipient, Base network, native USDC, exact scheme and operation-specific ceilings. `chain-client.mjs` exposes no origin overrides. Dependency injection is available to offline tests only. Results are validated against documented identities/required fields and projected to documented fields; unknown service/error fields and signatures are not printed. Server receipts are not independent chain verification.

Public distribution contains just the executable and its single-file checksum. Keep the existing reader release marked latest: publish this tag with `--latest=false`. No Cloudflare deployment or MCP registry publication is part of this client release. Never seed purchases to verify it.
