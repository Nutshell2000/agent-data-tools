// End-to-end payment test on the Base Sepolia TESTNET. Test tokens only; no real money.
//
//   node scripts/pay-test.mjs address          create the test wallet if needed and print its address
//   node scripts/pay-test.mjs <url>            call <url>, pay the 402 with testnet USDC, print the result
//
// The test wallet's key lives in .test-wallet.json (git-ignored) and is never printed.
// It must only ever hold faucet tokens.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { wrapFetchWithPayment, x402Client, decodePaymentResponseHeader } from "@x402/fetch";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const KEY_FILE = new URL("../.test-wallet.json", import.meta.url);
if (!existsSync(KEY_FILE)) writeFileSync(KEY_FILE, JSON.stringify({ note: "Base Sepolia test wallet. Faucet tokens only.", key: generatePrivateKey() }));
const account = privateKeyToAccount(JSON.parse(readFileSync(KEY_FILE, "utf8")).key);

const target = process.argv[2];
if (!target || target === "address") {
  console.log(account.address);
  process.exit(0);
}

const client = new x402Client();
registerExactEvmScheme(client, { signer: account });
// The stock client refuses any single payment over $1. Real agents keep that default,
// so this switch exists only to test routes priced above it.
if (process.argv.includes("--no-cap")) client.spendControls = false;
const paidFetch = wrapFetchWithPayment(fetch, client);

const plain = await fetch(target);
console.log(`unpaid: HTTP ${plain.status}`);
if (plain.status === 402) {
  const challenge = JSON.parse(Buffer.from(plain.headers.get("payment-required"), "base64").toString());
  const a = challenge.accepts[0];
  console.log(`asks:   ${a.amount} units of ${a.asset} on ${a.network}, payTo ${a.payTo}`);
  if (a.network !== "eip155:84532") {
    console.log("REFUSING: this endpoint is not on the Base Sepolia testnet.");
    process.exit(1);
  }
}

const res = await paidFetch(target);
const body = await res.text();
console.log(`paid:   HTTP ${res.status}`);
const receipt = res.headers.get("payment-response");
console.log(`settle: ${receipt ? JSON.stringify(decodePaymentResponseHeader(receipt)) : "no PAYMENT-RESPONSE header"}`);
console.log(`body:   ${body.slice(0, 300)}`);
