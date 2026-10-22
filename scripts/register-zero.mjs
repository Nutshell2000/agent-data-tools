// Registers (or re-crawls) our origin on Zero.xyz, at most once a day (the daily request budget: Zero re-crawls every
// route after each registration). Signs the request with the staging test wallet (.test-wallet.json, git-ignored):
// Zero accepts any wallet we control as the registrant. Never pays anything.
//   node scripts/register-zero.mjs [origin]            register / re-crawl
//   node scripts/register-zero.mjs status <uid>        read a registration job
import { readFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { privateKeyToAccount } from "viem/accounts";

const KEY_FILE = new URL("../.test-wallet.json", import.meta.url);
const account = privateKeyToAccount(JSON.parse(readFileSync(KEY_FILE, "utf8")).key);
const BASE = "https://api.zero.xyz";
const [, , a, b] = process.argv;
const origin = a && a !== "status" ? a : "https://agent-data-tools.revmesh2074.workers.dev";

async function signed(method, path, bodyObj) {
  const body = bodyObj === undefined ? undefined : JSON.stringify(bodyObj);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = randomUUID();
  const bodyHash = createHash("sha256").update(body ?? "").digest("hex");
  const signature = await account.signMessage({ message: `${method}:${path}:${bodyHash}:${timestamp}:${nonce}` });
  const headers = { "x-zero-address": account.address, "x-zero-timestamp": timestamp, "x-zero-nonce": nonce, "x-zero-signature": signature, "x-zero-sdk-version": "1.36.0", "user-agent": "agent-data-tools-release/1.0", accept: "application/json" };
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(BASE + path, { method, headers, body, signal: AbortSignal.timeout(60_000) });
  const text = await res.text();
  console.log(`${method} ${path} -> ${res.status} ${text.slice(0, 400)}`);
  if (!res.ok) process.exitCode = 1;
  try { return JSON.parse(text); } catch { return null; }
}

if (a === "status") await signed("GET", `/v1/register/${b}`);
else await signed("POST", "/v1/register/", { url: origin, protocol: "x402", openapiUrl: `${origin}/openapi.json` });
