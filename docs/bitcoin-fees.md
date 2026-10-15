# Check Bitcoin fee rates | SpellzCode

$0.002 native USDC on Base per successful call. No API account or subscription. Bring an existing funded x402 wallet.



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
  "mempool": {
    "transactions": 83832,
    "vsize": 42066150,
    "totalFeesBtc": 0.1093664
  },
  "blockHeight": 970000
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
