# Reader client

Run `npm ci` and `npm run build:reader` in the source checkout. The generated standalone executable and checksum are under `public/clients/reader/1.6.0/`; cached samples are generated from owned source in `examples/reader-samples.mjs`. Wrangler builds these artifacts automatically before deployment.

Buyers download `reader-client.mjs` and `reader-client.mjs.sha256` from the website, verify that one file, and run the file with Node 20.19 or later. No npm install, TypeScript editing or new wallet is needed on the buyer's device.

The [1.5.1 repository release](https://github.com/Nutshell2000/agent-data-tools/releases/tag/reader-1.5.1) provides the same six published files as a fallback download. Choose the CLI executable and its one-file checksum, or the MCP adapter and its one-file checksum. Keep their filenames unchanged and verify before running; the release notes link to shell-specific verification and setup instructions. The release is pinned to source commit `651be3de54798b3fda285dad5a24457bd0778bfa`. No wallet or payment is needed to download or inspect it.

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

Reader 1.3.1 preserves source image alt text in primary text/Markdown and table cells. It never fetches or interprets image bytes; output warnings disclose missing descriptions and uninterpreted SVG/canvas. All six published 1.3.0 artifacts, including both single-file checksums, remain immutable.

Version 1.4.0 adds quote-btc-fees (no arguments) and buy-btc-fees --max-usdc 0.002. These buy JSON fee/mempool data using the same Base-USDC pins, not Bitcoin transactions. Fee results receive structural/unit/source/arithmetic checks, not reader content hashes or independent upstream verification. The local adapter adds btc_fees_quote/btc_fees_buy under the existing shared session budget/lock. All six published 1.3.1 artifacts remain byte-exact. See docs/bitcoin-fees.md.

Version 1.4.1 preserves spaces between table-cell line breaks, paragraphs and list items, preventing concatenated API terms. Inline word markup stays contiguous. Published 1.4.0 downloads remain byte-exact; payment behavior and prices are unchanged.

Version 1.5.0 also accepts source Markdown through the existing quote/buy commands. text/markdown and .md/.markdown served as text/plain retain source syntax and whitespace; sourceFormat and warnings identify this mode. Structured metadata is not parsed, relative links remain source-relative, and sections require HTML. No Markdown code, links or embedded HTML are executed. All six 1.4.1 downloads remain immutable.

Version 1.5.1 resolves HTML links/canonical against the first supported declared document base and reports linkBaseUrl with applied/ignored warnings. No links are fetched automatically. Markdown source syntax stays unchanged; linkBaseUrl supplies its final-URL base. Static interpretation does not evaluate scripts or CSP. Exact 1.5.0 download bytes remain preserved in the pinned archive.

Version 1.6.0 adds sourceMetadata: bounded unverified author and date declarations with provenance, page identity selection and local author-reference resolution. No external contexts or profiles are fetched; dates are not normalized or independently verified. Metadata limits do not erase readable body content. Prior 1.5.1 website and repository downloads stay unchanged.
