# Reader client

Run `npm ci` and `npm run build:reader` in the source checkout. The generated standalone executable and checksum are under `public/clients/reader/1.1.2/`; cached samples are generated from owned source in `examples/reader-samples.mjs`. Wrangler builds these artifacts automatically before deployment.

Buyers download `reader-client.mjs` and `SHA256SUMS` from the website, verify the checksum, and run the file with Node 20.19 or later. No npm install, TypeScript editing or new wallet is needed on the buyer's device.

```sh
node reader-client.mjs quote https://example.com --format both
node reader-client.mjs buy https://example.com --max-usdc 0.002 --format both
```

`quote` never reads a key or signs. `buy` needs an existing funded wallet's `X402_PRIVATE_KEY` in the process environment and an explicit cap no greater than $0.002. Keys never become CLI arguments, URLs or logs. Each invocation can authorize and submit once. Redirects and unexpected origin, recipient, chain, asset, payment scheme or excessive prices are rejected. There are no automatic recovery purchases.

Output is JSON; unsuccessful outcomes exit nonzero. A cap covers one invocation, not repeated runs or a monthly budget. An uncertain response after signing can still correspond to a settled payment: stop and reconcile the request ID and receipt before manually retrying. A returned settlement receipt is server-reported evidence, not an independent chain audit. The client verifies the returned primary content hash. Existing MCP examples remain available in the buying guide; this release does not add an MCP bridge.

Tests inject an offline facilitator/network response. The actual SDK signing test uses a fixed public test key and performs no network payment, chain transaction or customer purchase.

The published 1.1.1 client is preserved byte-for-byte under clients/releases/1.1.1 and copied into release assets. The command-builder bundle is local-only browser code: no network, wallet or signing APIs.
