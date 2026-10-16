# Reader client

Run `npm ci` and `npm run build:reader` in the source checkout. The generated standalone executable and checksum are under `public/clients/reader/1.3.0/`; cached samples are generated from owned source in `examples/reader-samples.mjs`. Wrangler builds these artifacts automatically before deployment.

Buyers download `reader-client.mjs` and `reader-client.mjs.sha256` from the website, verify that one file, and run the file with Node 20.19 or later. No npm install, TypeScript editing or new wallet is needed on the buyer's device.

```sh
node reader-client.mjs quote https://example.com --format both
node reader-client.mjs buy https://example.com --max-usdc 0.002 --format both
```

`quote` never reads a key or signs. `buy` needs an existing funded wallet's `X402_PRIVATE_KEY` in the process environment and an explicit cap no greater than $0.002. Keys never become CLI arguments, URLs or logs. Each invocation can authorize and submit once. Redirects and unexpected origin, recipient, chain, asset, payment scheme or excessive prices are rejected. There are no automatic recovery purchases.

Output is JSON; unsuccessful outcomes exit nonzero. A cap covers one invocation, not repeated runs or a monthly budget. An uncertain response after signing can still correspond to a settled payment: stop and reconcile the request ID and receipt before manually retrying. A returned settlement receipt is server-reported evidence, not an independent chain audit. The client verifies the returned primary content hash. Existing MCP examples remain available in the buying guide; the separately downloadable local adapter is described in docs/local-mcp.md.

Tests inject an offline facilitator/network response. The actual SDK signing test uses a fixed public test key and performs no network payment, chain transaction or customer purchase.

The published 1.1.1 client is preserved byte-for-byte under clients/releases/1.1.1 and copied into release assets. The command-builder bundle is local-only browser code: no network, wallet or signing APIs.

Version 1.2.1 also supports quote-sitemap and buy-sitemap with --contains, --max-urls and --offset. Both tools share the explicit maximum $0.002 cap and identical fixed payment pins. Published 1.1.1 and 1.1.2 artifacts remain immutable.

The 1.2.1 reader-mcp.mjs bundle is a local MCP stdio server. Default mode exposes only reader_session, reader_quote and sitemap_quote. Explicit --enable-buy --session-max-usdc 0.006 enables reader_buy/sitemap_buy with required per-call maxUsdc, a shared reservation cap, concurrent-buy rejection and a lock after unknown signed outcomes. This in-memory cap resets on restart and is not a wallet-wide or monthly budget. Keep host approvals enabled. See [setup and failure rules](../docs/local-mcp.md).

Reader 1.3.0 adds optional --section <exact-html-id> to quote/buy. HTTP and MCP accept section. The client rejects a successful paid result whose section.id differs from the requested ID. IDs are exact and case-sensitive; URL fragments alone retain full-page behavior. See docs/web-reading.md for scope boundaries and no-charge errors. Published 1.2.1 CLI, browser and MCP artifacts remain immutable.

Each executable has a matching .sha256 file. Verify only the downloaded executable: sha256sum -c reader-client.mjs.sha256 (Linux), shasum -a 256 -c reader-client.mjs.sha256 (macOS), or use the tested PowerShell instructions in docs/web-reading.md. MCP uses reader-mcp.mjs.sha256. The unchanged complete SHA256SUMS file also lists the other artifacts, so a whole-list check requires those downloads too. No executable or original checksum is changed by this setup repair.
