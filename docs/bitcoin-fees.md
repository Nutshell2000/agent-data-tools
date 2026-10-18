# Check Bitcoin fee rates | SpellzCode

$0.002 native USDC on Base per successful call. No API account or subscription. Bring an existing funded x402 wallet.

## Quote and buy Bitcoin fee data without writing a client

Download https://agent-data-tools.revmesh2074.workers.dev/clients/reader/1.7.6/reader-client.mjs and https://agent-data-tools.revmesh2074.workers.dev/clients/reader/1.7.6/reader-client.mjs.sha256 into the same folder. Requires Node 20.19+ after verification. No npm installation.

Verify this one executable before running it. Stop on any failure. Linux:

```sh
sha256sum -c reader-client.mjs.sha256
```

macOS:

```sh
shasum -a 256 -c reader-client.mjs.sha256
```

PowerShell:

```powershell
$line = (Get-Content -LiteralPath 'reader-client.mjs.sha256' -Raw).Trim()
$match = [regex]::Match($line, '^([a-f0-9]{64})  reader-client\.mjs$')
if (-not $match.Success) { throw 'Invalid checksum file' }
$actual = (Get-FileHash -LiteralPath 'reader-client.mjs' -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actual -ne $match.Groups[1].Value) { throw 'Checksum mismatch; do not run the download' }
Write-Output 'reader-client.mjs: OK'
```

The complete SHA256SUMS list remains at https://agent-data-tools.revmesh2074.workers.dev/clients/reader/1.7.6/SHA256SUMS for people downloading all artifacts. Do not check that whole list after downloading only one file. SHA-256 checks detect changed bytes against the published checksum; the checksum is served through the same website and is not an independent signature. Public source: https://github.com/Nutshell2000/agent-data-tools/tree/main/clients .

Inspect the unpaid price quote (no URL, key, signing or Bitcoin-data fetch):

```sh
node reader-client.mjs quote-btc-fees
```

Only for an authorized purchase, configure an existing funded Base wallet's X402_PRIVATE_KEY privately in the local process environment and invoke once:

```sh
node reader-client.mjs buy-btc-fees --max-usdc 0.002
```

This buys a JSON data result for at most $0.002 native USDC on Base; it does not buy Bitcoin, select a transaction fee for you, or send a Bitcoin transaction. No Bitcoin key is needed. The same client pins our service, recipient, Base/native USDC and exact scheme, permits one authorization and never retries an uncertain payment.

The client validates the expected network/unit/source, numeric fields and the illustrative 141-vB arithmetic. This is structural consistency checking, not independent confirmation of upstream data. Inspect checkedAt, source and limitations; the three upstream reads are not atomic, transaction size varies and fee estimates do not guarantee confirmation time. Bitcoin fee results do not carry the reader's contentHash.

Using an existing MCP host? https://agent-data-tools.revmesh2074.workers.dev/guides/local-mcp provides btc_fees_quote (no arguments) and, only after paid-mode opt-in, btc_fees_buy with maxUsdc. The reader, sitemap and Bitcoin-data tools share one process reservation budget and uncertainty lock. No purchase happens on startup, discovery or quote.

On an unknown signed outcome or a settled but invalid result, stop, preserve request ID and available receipt, and reconcile before buying again. A paid result receipt is server-reported evidence, not an independent chain audit. Offline fixtures and this dated example are not customer purchases; funded CLI/local-adapter fee delivery remains unverified until separately evidenced.



## What it does

Current recommended sat/vB fee estimates and mempool context from public Bitcoin data sources. Network conditions change; estimates do not guarantee confirmation time. This tool does not send transactions. The dated result below is illustrative, not a current fee quote.


## Inspect the quote without paying

Open https://agent-data-tools.revmesh2074.workers.dev/btc-fees?format=json with an ordinary HTTP client, or run:

```sh
curl -i 'https://agent-data-tools.revmesh2074.workers.dev/btc-fees?format=json'
```

Expect HTTP 402 and a base64-encoded PAYMENT-REQUIRED header. This does not run the tool or sign a payment. Check exact scheme, eip155:8453, recipient 0x2074c40346ae2a90e0e4a391bcee6f16bf5277f5, native USDC 0x833589fcd6edb6e08f4c7c32d4f71b54bda02913 and amount 2000 atomic units ($0.002). HEAD is also an unpaid probe.

## Example result (illustrative, not a paid receipt or live quote)

```json
{
  "network": "bitcoin",
  "unit": "sat/vB",
  "fees": {
    "nextBlock": 4,
    "halfHour": 3,
    "hour": 1,
    "economy": 1,
    "minimum": 1
  },
  "typicalPaymentSats": {
    "nextBlock": 564,
    "hour": 141
  },
  "typicalPaymentVbytes": 141,
  "source": "https://mempool.space/api",
  "limitations": [
    "Estimates do not guarantee confirmation time",
    "141 vB is an illustrative one-input/two-output SegWit size; actual transaction size varies",
    "Source endpoints are fetched concurrently, not as an atomic snapshot"
  ],
  "mempool": {
    "transactions": 83832,
    "vsize": 42066150,
    "totalFeesBtc": 0.1093664
  },
  "blockHeight": 970000,
  "checkedAt": "2026-10-01T00:00:00.000Z"
}
```

## Buy one result over HTTP

Install npm install @x402/fetch@2.28.0 @x402/evm@2.28.0 viem@2.57.4 and npm install --save-dev typescript tsx @types/node.
Save as client.ts. Configure X402_PRIVATE_KEY privately in your own process environment, then run npx tsx client.ts only when you intend to pay. Never share or commit the key. It stays on your device. Each invocation can pay once; this is a per-payment cap, not a monthly budget. Do not run in an unbounded retry loop.

```typescript
// Save as client.ts; set X402_PRIVATE_KEY in your environment, never in source.
import { ExactEvmScheme } from "@x402/evm";
import { wrapFetchWithPayment, x402Client } from "@x402/fetch";
import { privateKeyToAccount } from "viem/accounts";

const rawPrivateKey = process.env.X402_PRIVATE_KEY;
if (!rawPrivateKey || !/^0x[0-9a-fA-F]{64}$/.test(rawPrivateKey)) {
  throw new Error("Set X402_PRIVATE_KEY in a secret manager or process environment.");
}
const account = privateKeyToAccount(rawPrivateKey as `0x${string}`);
const serviceOrigin = "https://agent-data-tools.revmesh2074.workers.dev";
const expectedPayTo = "0x2074c40346ae2a90e0e4a391bcee6f16bf5277f5";
const baseUsdc = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const maxUsdcAtomic = 2000n; // $0.002 USDC, the current /btc-fees price

const client = new x402Client()
  .register("eip155:8453", new ExactEvmScheme(account))
  .setSpendControls({ maxAmountPerPayment: "$0.002" })
  .registerPolicy((_version, requirements) =>
    requirements.filter((requirement) => {
      if (requirement.network !== "eip155:8453" || requirement.scheme !== "exact") return false;
      if (requirement.payTo.toLowerCase() !== expectedPayTo) return false;
      if (requirement.asset.toLowerCase() !== baseUsdc.toLowerCase()) return false;
      return /^\d+$/.test(requirement.amount) && BigInt(requirement.amount) <= maxUsdcAtomic;
    }),
  );

const fetchWithPayment = wrapFetchWithPayment(fetch, client);
const response = await fetchWithPayment(new URL("/btc-fees?format=json", serviceOrigin));
if (!response.ok) throw new Error(`API returned HTTP ${response.status}`);
console.log("Request ID:", response.headers.get("X-Request-ID"));
console.log("Settlement:", response.headers.get("PAYMENT-RESPONSE"));
console.log(await response.json());
```

## Buy one result over MCP

An ordinary MCP connection can list tools and receive quotes, but cannot pay automatically. Use an x402-capable client with a funded signer and the same explicit spending policy. Install npm install @x402/mcp@2.28.0 @x402/evm@2.28.0 @modelcontextprotocol/sdk@1.32.1 viem@2.57.4, plus the development tools above. Save as mcp-client.ts and run npx tsx mcp-client.ts only when you intend to pay. Each invocation can incur a charge.

```typescript
// Save as client.ts; set X402_PRIVATE_KEY in your environment, never in source.
import { ExactEvmScheme } from "@x402/evm";
import { x402Client, wrapMCPClientWithPayment } from "@x402/mcp";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { privateKeyToAccount } from "viem/accounts";

const rawPrivateKey = process.env.X402_PRIVATE_KEY;
if (!rawPrivateKey || !/^0x[0-9a-fA-F]{64}$/.test(rawPrivateKey)) {
  throw new Error("Set X402_PRIVATE_KEY in a secret manager or process environment.");
}
const account = privateKeyToAccount(rawPrivateKey as `0x${string}`);
const serviceOrigin = "https://agent-data-tools.revmesh2074.workers.dev";
const expectedPayTo = "0x2074c40346ae2a90e0e4a391bcee6f16bf5277f5";
const baseUsdc = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const maxUsdcAtomic = 2000n; // $0.002 USDC, the current /btc-fees price

const client = new x402Client()
  .register("eip155:8453", new ExactEvmScheme(account))
  .setSpendControls({ maxAmountPerPayment: "$0.002" })
  .registerPolicy((_version, requirements) =>
    requirements.filter((requirement) => {
      if (requirement.network !== "eip155:8453" || requirement.scheme !== "exact") return false;
      if (requirement.payTo.toLowerCase() !== expectedPayTo) return false;
      if (requirement.asset.toLowerCase() !== baseUsdc.toLowerCase()) return false;
      return /^\d+$/.test(requirement.amount) && BigInt(requirement.amount) <= maxUsdcAtomic;
    }),
  );

const mcp = new Client({ name: "spellzcode-buyer-example", version: "1.0.0" });
try {
  await mcp.connect(new StreamableHTTPClientTransport(new URL("/mcp", serviceOrigin)));
  const paid = wrapMCPClientWithPayment(mcp, client, { autoPayment: true });
  const result = await paid.callTool("btc-fees", {});
  if (result.isError) throw new Error(JSON.stringify(result.content));
  console.log(JSON.stringify(result, null, 2));
} finally { await mcp.close(); }
```

Both examples reject the wrong recipient, network, asset, scheme or a quote above $0.002. Funded production HTTP and MCP delivery are tracked separately; publication of these examples is not evidence that a customer has paid through either transport.

## Failure and support

Tool execution errors do not settle a charge. A settlement failure returns an error instead of a paid result. If the connection drops after settlement, stop before retrying: a fresh invocation can pay again. Preserve the transaction hash, X-Request-ID (or MCP _meta requestId), tool name and time; report these at https://github.com/Nutshell2000/agent-data-tools/issues. Never post signatures, keys, private URLs or page content. Storage telemetry failures do not ask for a second payment. A returned result indicates server-side completion, not proof that the buyer received it. Refunds require review and are recorded separately.

All prices: https://agent-data-tools.revmesh2074.workers.dev/openapi.json
Payment evidence: https://agent-data-tools.revmesh2074.workers.dev/revenue
