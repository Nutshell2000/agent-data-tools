// End-to-end payment test against the staging Worker on the Base Sepolia TESTNET. Faucet tokens only; no real money.
// It proves that a signed payment verifies, the tool runs, settlement happens and a receipt comes back, over
// each of the three ways an agent can pay. It refuses every mainnet network, so it can never pay production.
//
//   node scripts/pay-test.mjs address                       create the test wallet if needed and print its address
//   node scripts/pay-test.mjs <url>                         HTTP, x402 v2: pay the 402 with PAYMENT-SIGNATURE
//   node scripts/pay-test.mjs <url> --post-json '{...}'  HTTP, x402 v2 with a POST body (the OpenAI-style /v1/chat/completions)
//   node scripts/pay-test.mjs <url> --v1                    HTTP, x402 v1: pay from the 402 body with X-PAYMENT
//   node scripts/pay-test.mjs <origin> --mcp <tool> [--args '{"url":"https://example.com"}']
//                                                           MCP: the @x402/mcp client wrapper pays the tool call
//   node scripts/pay-test.mjs <url> --mpp-evm               HTTP, MPP evm/charge: the mppx client answers the WWW-Authenticate
//                                                           challenge with a USDC authorization (Authorization: Payment)
//   node scripts/pay-test.mjs <url> --tempo                 HTTP, MPP tempo/charge on the Moderato TESTNET: the mppx client signs a
//                                                           pathUSD transfer (pull mode) that staging broadcasts after the tool ran
//
// The test wallet's key lives in .test-wallet.json (git-ignored) and is never printed. Fund it with Base Sepolia
// USDC from https://faucet.circle.com (and a little Sepolia ETH is not needed: the facilitator pays gas).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { wrapFetchWithPayment, x402Client, decodePaymentResponseHeader } from "@x402/fetch";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const TESTNET = "eip155:84532";
const TESTNET_V1 = "base-sepolia";

const KEY_FILE = new URL("../.test-wallet.json", import.meta.url);
if (!existsSync(KEY_FILE)) writeFileSync(KEY_FILE, JSON.stringify({ note: "Base Sepolia test wallet. Faucet tokens only.", key: generatePrivateKey() }));
const account = privateKeyToAccount(JSON.parse(readFileSync(KEY_FILE, "utf8")).key);

const argv = process.argv.slice(2);
const target = argv[0];
const flag = (name) => argv.includes(name);
const option = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
if (!target || target === "address") {
  console.log(account.address);
  process.exit(0);
}

/** An x402 v2 client that signs only for the Base Sepolia testnet, whatever a server offers. */
function testnetClient() {
  const client = new x402Client();
  registerExactEvmScheme(client, { signer: account });
  client.registerPolicy((_version, requirements) => requirements.filter((r) => r.network === TESTNET && r.scheme === "exact"));
  // The stock client refuses any single payment over $1. Real agents keep that default,
  // so this switch exists only to test routes priced above it.
  if (flag("--no-cap")) client.setSpendControls(false);
  return client;
}

const describe = (receipt) => (receipt ? JSON.stringify(receipt) : "none");

if (flag("--mcp")) await mcp(target, option("--mcp"), JSON.parse(option("--args") ?? "{}"));
else if (flag("--mpp-evm")) await mppEvm(target);
else if (flag("--tempo")) await mppTempo(target);
else if (flag("--v1")) await httpV1(target);
else await httpV2(target);

async function httpV2(url) {
  const plain = await fetch(url, option("--post-json") ? { method: "POST", headers: { "content-type": "application/json" }, body: option("--post-json") } : undefined);
  console.log(`unpaid: HTTP ${plain.status}`);
  if (plain.status !== 402) { console.log(await plain.text()); process.exit(1); }
  const challenge = JSON.parse(Buffer.from(plain.headers.get("payment-required"), "base64").toString());
  const terms = challenge.accepts.find((a) => a.network === TESTNET);
  if (!terms) {
    console.log(`REFUSING: this endpoint offers ${challenge.accepts.map((a) => a.network).join(", ")}, not the Base Sepolia testnet.`);
    process.exit(1);
  }
  console.log(`asks:   ${terms.amount} units of ${terms.asset} on ${terms.network}, payTo ${terms.payTo}`);
  const paidFetch = wrapFetchWithPayment(fetch, testnetClient());
  const postJson = option("--post-json");
  const res = await paidFetch(url, postJson ? { method: "POST", headers: { "content-type": "application/json" }, body: postJson } : undefined);
  const body = await res.text();
  console.log(`paid:   HTTP ${res.status}`);
  const receipt = res.headers.get("payment-response");
  console.log(`settle: ${receipt ? JSON.stringify(decodePaymentResponseHeader(receipt)) : "no PAYMENT-RESPONSE header"}`);
  console.log(`body:   ${body.slice(0, 300)}`);
  process.exitCode = res.ok && receipt ? 0 : 1;
}

/** x402 v1: terms come from the 402 body; the payment is an EIP-3009 authorization in the X-PAYMENT header. */
async function httpV1(url) {
  const plain = await fetch(url);
  console.log(`unpaid: HTTP ${plain.status}`);
  const body = await plain.json().catch(() => null);
  if (plain.status !== 402 || body?.x402Version !== 1) { console.log(`REFUSING: no x402 v1 terms in the body (${JSON.stringify(body).slice(0, 200)})`); process.exit(1); }
  const terms = body.accepts.find((a) => a.network === TESTNET_V1);
  if (!terms) { console.log(`REFUSING: v1 terms offer ${body.accepts.map((a) => a.network).join(", ")}, not ${TESTNET_V1}.`); process.exit(1); }
  console.log(`asks:   ${terms.maxAmountRequired} units of ${terms.asset} on ${terms.network}, payTo ${terms.payTo} (domain ${terms.extra.name} v${terms.extra.version})`);
  const now = Math.floor(Date.now() / 1000);
  const authorization = {
    from: account.address, to: terms.payTo, value: terms.maxAmountRequired,
    validAfter: String(now - 60), validBefore: String(now + terms.maxTimeoutSeconds),
    nonce: "0x" + Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex"),
  };
  const signature = await account.signTypedData({
    domain: { name: terms.extra.name, version: terms.extra.version, chainId: 84532, verifyingContract: terms.asset },
    types: { TransferWithAuthorization: [
      { name: "from", type: "address" }, { name: "to", type: "address" }, { name: "value", type: "uint256" },
      { name: "validAfter", type: "uint256" }, { name: "validBefore", type: "uint256" }, { name: "nonce", type: "bytes32" },
    ] },
    primaryType: "TransferWithAuthorization",
    message: { ...authorization, value: BigInt(authorization.value), validAfter: BigInt(authorization.validAfter), validBefore: BigInt(authorization.validBefore) },
  });
  const header = Buffer.from(JSON.stringify({ x402Version: 1, scheme: "exact", network: TESTNET_V1, payload: { signature, authorization } })).toString("base64");
  const res = await fetch(url, { headers: { "X-PAYMENT": header } });
  const text = await res.text();
  console.log(`paid:   HTTP ${res.status}`);
  const receipt = res.headers.get("x-payment-response");
  console.log(`settle: ${receipt ? Buffer.from(receipt, "base64").toString() : "no X-PAYMENT-RESPONSE header"}`);
  console.log(`body:   ${text.slice(0, 300)}`);
  process.exitCode = res.ok && receipt ? 0 : 1;
}

/** MCP: the official client wrapper reads the tool's payment requirement, signs, and retries with _meta["x402/payment"]. */
async function mcp(origin, tool, args) {
  if (!tool) { console.log("--mcp needs a tool name, for example --mcp btc_fees"); process.exit(1); }
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { StreamableHTTPClientTransport } = await import("@modelcontextprotocol/sdk/client/streamableHttp.js");
  const { wrapMCPClientWithPayment } = await import("@x402/mcp");
  const base = new Client({ name: "pay-test", version: "1.0.0" });
  const client = wrapMCPClientWithPayment(base, testnetClient(), { autoPayment: true });
  const url = new URL("/mcp", origin);
  await client.connect(new StreamableHTTPClientTransport(url));
  try {
    const listed = (await client.listTools()).tools;
    if (!listed.some((t) => t.name === tool)) { console.log(`no such tool ${tool}; ${listed.length} tools listed`); process.exitCode = 1; return; }
    // Staging runs with TRIALS_ENABLED off, so this call is quoted and the wrapper pays; with free calls on it would run free.
    const result = await client.callTool(tool, args);
    // The wrapper lifts the server's _meta["x402/payment-response"] into paymentResponse.
    const receipt = result?.paymentResponse ?? result?._meta?.["x402/payment-response"];
    console.log(`paid:   isError=${Boolean(result.isError)} paymentMade=${Boolean(result.paymentMade)}`);
    console.log(`settle: ${describe(receipt)}`);
    console.log(`body:   ${JSON.stringify(result.structuredContent ?? result.content).slice(0, 300)}`);
    process.exitCode = !result.isError && receipt?.success ? 0 : 1;
  } finally {
    await client.close();
  }
}

/** MPP evm/charge: the mppx client reads the WWW-Authenticate challenge, signs a USDC authorization for the testnet only and retries. */
async function mppEvm(url) {
  const plain = await fetch(url);
  console.log(`unpaid: HTTP ${plain.status}`);
  await plain.arrayBuffer();
  const { Challenge } = await import("mppx");
  const { Mppx, evm } = await import("mppx/client");
  const challenge = plain.status === 402 ? Challenge.fromResponseList(plain).find((ch) => ch.method === "evm") : undefined;
  if (!challenge) { console.log("REFUSING: no evm/charge challenge in WWW-Authenticate"); process.exit(1); }
  if (challenge.request.methodDetails.chainId !== 84532) { console.log(`REFUSING: the challenge is for chain ${challenge.request.methodDetails.chainId}, not the Base Sepolia testnet.`); process.exit(1); }
  console.log(`asks:   ${challenge.request.amount} units of ${challenge.request.currency} on eip155:${challenge.request.methodDetails.chainId}, recipient ${challenge.request.recipient}`);
  const client = Mppx.create({ polyfill: false, methods: [evm.charge({ account, currencies: [evm.assets.baseSepolia.USDC], networks: [84532] })] });
  const res = await client.fetch(url);
  const body = await res.text();
  console.log(`paid:   HTTP ${res.status}`);
  const receipt = res.headers.get("payment-receipt");
  console.log(`settle: ${receipt ? receipt : "no Payment-Receipt header"}`);
  console.log(`body:   ${body.slice(0, 300)}`);
  process.exitCode = res.ok && receipt ? 0 : 1;
}
/** MPP tempo/charge on Moderato (chain 42431): faucet pathUSD only (tempo_fundAddress on rpc.moderato.tempo.xyz). Refuses Tempo mainnet. */
async function mppTempo(url) {
  const plain = await fetch(url);
  console.log(`unpaid: HTTP ${plain.status}`);
  await plain.arrayBuffer();
  const { Challenge } = await import("mppx");
  const { Mppx, tempo } = await import("mppx/client");
  const { createClient, http } = await import("viem");
  const { tempoModerato } = await import("viem/tempo/chains");
  const challenge = plain.status === 402 ? Challenge.fromResponseList(plain).find((ch) => ch.method === "tempo") : undefined;
  if (!challenge) { console.log("REFUSING: no tempo/charge challenge in WWW-Authenticate (is TEMPO_PAY_TO set on staging?)"); process.exit(1); }
  if (challenge.request.methodDetails.chainId !== tempoModerato.id) { console.log(`REFUSING: the challenge is for Tempo chain ${challenge.request.methodDetails.chainId}, not Moderato (${tempoModerato.id}).`); process.exit(1); }
  console.log(`asks:   ${challenge.request.amount} units of ${challenge.request.currency} on eip155:${challenge.request.methodDetails.chainId}, recipient ${challenge.request.recipient}, modes ${(challenge.request.methodDetails.supportedModes ?? []).join("/")}`);
  const client = Mppx.create({ polyfill: false, methods: [tempo.charge({ account, mode: "pull", getClient: () => createClient({ chain: tempoModerato, transport: http() }) })] });
  const res = await client.fetch(url);
  const body = await res.text();
  console.log(`paid:   HTTP ${res.status}`);
  const receipt = res.headers.get("payment-receipt");
  console.log(`settle: ${receipt ? Buffer.from(receipt, "base64url").toString() : "no Payment-Receipt header"}`);
  console.log(`body:   ${body.slice(0, 300)}`);
  process.exitCode = res.ok && receipt ? 0 : 1;
}
