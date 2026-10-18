// Signs the ownership proof x402scan and AgentCash use to mark this origin ownership_verified:
// an EIP-191 personal_sign of the bare origin by the PAY_TO wallet. Run it on the machine that
// holds the payout key; the key is read from the environment and never printed or stored.
//   PowerShell: $env:PAYOUT_KEY="0x…"; node scripts/sign-ownership-proof.mjs; Remove-Item Env:PAYOUT_KEY
//   bash:       PAYOUT_KEY=0x… node scripts/sign-ownership-proof.mjs
// Paste the printed signature into OWNERSHIP_PROOFS in src/discovery.ts (it is public, like any signature).
import { readFile } from "node:fs/promises";
import { privateKeyToAccount } from "viem/accounts";
import { recoverMessageAddress } from "viem";

const ORIGIN = process.argv[2] ?? "https://agent-data-tools.revmesh2074.workers.dev";
if (!/^https:\/\/[^/]+$/.test(ORIGIN)) throw new Error("origin must be https://host with no path or trailing slash");
const config = await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8");
const payTo = config.match(/"PAY_TO":\s*"(0x[0-9a-fA-F]{40})"/)?.[1];
if (!payTo) throw new Error("PAY_TO not found in wrangler.jsonc");
const key = process.env.PAYOUT_KEY?.trim();
if (!key) throw new Error("Set PAYOUT_KEY to the PAY_TO wallet's private key for this one command.");
const account = privateKeyToAccount(key.startsWith("0x") ? key : `0x${key}`);
if (account.address.toLowerCase() !== payTo.toLowerCase()) throw new Error(`This key controls ${account.address}, not PAY_TO ${payTo}. Nothing was signed.`);
const signature = await account.signMessage({ message: ORIGIN });
const recovered = await recoverMessageAddress({ message: ORIGIN, signature });
if (recovered.toLowerCase() !== payTo.toLowerCase()) throw new Error("Signature check failed");
console.log(`Origin:    ${ORIGIN}\nSigner:    ${recovered}\nSignature: ${signature}`);
