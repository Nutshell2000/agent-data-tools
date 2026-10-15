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
const maxUsdcAtomic = 2000n; // $0.002 USDC, the current /extract price

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
  const result = await paid.callTool("extract", {"url":"https://example.com","maxChars":20000});
  if (result.isError) throw new Error(JSON.stringify(result.content));
  console.log(JSON.stringify(result, null, 2));
} finally { await mcp.close(); }
