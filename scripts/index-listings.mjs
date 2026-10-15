// Gets every endpoint into the Coinbase Bazaar directory. The Bazaar lists an endpoint only
// after one real payment for it has settled, so this buys each endpoint once.
// REAL MONEY on Base mainnet: about $0.18 in USDC in total, and it is paid to our own wallet.
//
//   node scripts/index-listings.mjs          show what would be bought and the total; pays nothing
//   node scripts/index-listings.mjs --pay    buy each endpoint once
//
// For --pay, set BUYER_KEY in your own terminal to the private key of a wallet YOU control that
// holds a little USDC on Base. No ETH is needed. The key is read from the environment only and
// is never printed or saved. Use a small spare wallet, not one holding savings.
import { wrapFetchWithPayment, x402Client, decodePaymentResponseHeader } from "@x402/fetch";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";

const ORIGIN = "https://agent-data-tools.revmesh2074.workers.dev";
const PAY_TO = "0x2074c40346ae2a90e0e4a391bcee6f16bf5277f5";
// Already listed; paying again would add nothing. Pass --all to include them anyway.
const LISTED = new Set(["/btc-fees", "/package"]);
// Hard stops, so a changed price or a wrong address can never cost more than cents.
const MAX_EACH_USD = 0.02;
const MAX_TOTAL_USD = 0.2;

// Lets open connections close first; exiting abruptly after a fetch crashes Node on Windows.
const quit = async (code) => {
  process.exitCode = code;
  await new Promise((r) => setTimeout(r, 300));
  process.exit();
};

const pay = process.argv.includes("--pay");
const card = await (await fetch(ORIGIN, { headers: { accept: "application/json" } })).json();
const plan = card.endpoints
  .map((e) => ({ path: new URL(e.url).pathname, url: e.example, usd: Number(e.price.replace("$", "")) }))
  .filter((e) => process.argv.includes("--all") || !LISTED.has(e.path));
const total = plan.reduce((sum, e) => sum + e.usd, 0);

for (const e of plan) console.log(`${e.path.padEnd(14)} $${e.usd}`);
console.log(`${plan.length} endpoints, total $${total.toFixed(3)} in USDC on Base, paid to ${PAY_TO}`);
if (plan.some((e) => e.usd > MAX_EACH_USD) || total > MAX_TOTAL_USD) {
  console.log("REFUSING: a price is higher than this script allows.");
  await quit(1);
}
if (!pay) {
  console.log("Nothing was paid. Run again with --pay to buy each endpoint once.");
  await quit(0);
}
if (!/^0x[0-9a-fA-F]{64}$/.test(process.env.BUYER_KEY ?? "")) {
  console.log("BUYER_KEY is not set to a real private key (0x followed by 64 letters and digits). Nothing was paid.");
  await quit(1);
}

const account = privateKeyToAccount(process.env.BUYER_KEY);
const client = new x402Client();
registerExactEvmScheme(client, { signer: account });
const paidFetch = wrapFetchWithPayment(fetch, client);
console.log(`paying from ${account.address}`);

let spent = 0;
for (const e of plan) {
  // Check the challenge before signing anything: right network, right receiver, right amount.
  const probe = await fetch(e.url);
  const header = probe.headers.get("payment-required");
  const ask = header && JSON.parse(Buffer.from(header, "base64").toString()).accepts[0];
  if (probe.status !== 402 || !ask || ask.network !== "eip155:8453" || ask.payTo.toLowerCase() !== PAY_TO || Number(ask.amount) !== Math.round(e.usd * 1e6)) {
    console.log(`${e.path.padEnd(14)} SKIPPED: unexpected payment request (HTTP ${probe.status})`);
    continue;
  }
  const res = await paidFetch(e.url);
  const receipt = res.headers.get("payment-response");
  const tx = receipt ? decodePaymentResponseHeader(receipt).transaction : null;
  if (res.ok && tx) spent += e.usd;
  // A failed call is not charged, so it is safe to run the script again for the ones that failed.
  console.log(`${e.path.padEnd(14)} HTTP ${res.status} ${tx ? `paid, tx ${tx}` : "NOT paid"}`);
}
console.log(`done: $${spent.toFixed(3)} paid. Listings appear in the Bazaar within about an hour.`);
