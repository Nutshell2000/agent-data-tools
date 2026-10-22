// Seeds the Coinbase Bazaar: pays each selected tool once through production, because Coinbase indexes a
// resource only after its first settled payment through the CDP facilitator. Owner-approved on 2026-10-19
// (docs/bazaar-seeding.md). The money goes from the owner's buyer wallet to the owner's PAY_TO; the ledger
// marks the buyer wallet as owned, so these settlements never count as revenue or demand.
//
//   node scripts/seed-bazaar.mjs wallet                       create the buyer wallet if needed, print its address
//   node scripts/seed-bazaar.mjs                              dry run: every eligible tool in demand order
//   node scripts/seed-bazaar.mjs --budget 0.25                 dry run: the demand order, cut at 0.25 USD
//   node scripts/seed-bazaar.mjs --set prices,compliance,chain dry run for named MCP sections
//   node scripts/seed-bazaar.mjs --only /btc-address,/ens     dry run for named paths
//   node scripts/seed-bazaar.mjs --pay --ledger-excluded      pay (needs BUYER_KEY in the environment)
//   --budget 0.25      seed in demand order until this many USD is planned (the "earned -> seed" trigger:
//                      Peter moves what the service earned into the buyer wallet and seeds that much)
//   --max-total 1.00   refuse to spend more than this many USD in one run (default 1.00)
//   --force            include tools that are already listed in the Bazaar
//
// The buyer wallet: `wallet` creates .seed-bazaar-wallet.json (git-ignored, Base mainnet, holds about 1 USDC that the
// owner sends to it) and prints the address; --pay reads the key from that file, or from BUYER_KEY in the
// environment when set. The key is never printed. The facilitator pays the gas.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { wrapFetchWithPayment, x402Client, decodePaymentResponseHeader } from "@x402/fetch";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

// Named to match the .gitignore pattern for seeding files, so the key can never be committed.
const WALLET_FILE = new URL("../.seed-bazaar-wallet.json", import.meta.url);
if (process.argv[2] === "wallet") {
  if (!existsSync(WALLET_FILE)) writeFileSync(WALLET_FILE, JSON.stringify({ note: "Bazaar seeding buyer wallet (Base mainnet). Fund with about 1 USDC; never commit.", key: generatePrivateKey() }));
  console.log(privateKeyToAccount(JSON.parse(readFileSync(WALLET_FILE, "utf8")).key).address);
  process.exit(0);
}

// SEED_ORIGIN / SEED_NETWORK / SEED_USDC exist only to rehearse this script against the Base Sepolia staging
// Worker (wrangler.staging.jsonc) with the faucet test wallet; production needs none of them.
const ORIGIN = process.env.SEED_ORIGIN ?? "https://agent-data-tools.revmesh2074.workers.dev";
const NETWORK = process.env.SEED_NETWORK ?? "eip155:8453";
const BASE_USDC = (process.env.SEED_USDC ?? "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913").toLowerCase();
if (ORIGIN.includes("staging") !== (NETWORK !== "eip155:8453")) throw new Error("staging origin needs SEED_NETWORK=eip155:84532 and SEED_USDC; production takes no overrides");
const DISCOVERY = "https://api.cdp.coinbase.com/platform/v2/x402/discovery/resources";
const UA = "agent-data-tools-seed/1.0";

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const option = (name, fallback) => { const i = argv.indexOf(name); return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : fallback; };
const pay = flag("--pay");
const sets = option("--set", "").split(",").map((s) => s.trim()).filter(Boolean);
const budgetUsd = option("--budget", "") === "" ? undefined : Number(option("--budget", ""));
if (budgetUsd !== undefined && (!Number.isFinite(budgetUsd) || budgetUsd <= 0)) throw new Error("--budget must be a positive number of USD");
const only = option("--only", "").split(",").map((s) => s.trim()).filter(Boolean);
const maxTotalUsd = Number(option("--max-total", "1.00"));
if (!Number.isFinite(maxTotalUsd) || maxTotalUsd <= 0 || maxTotalUsd > 5) throw new Error("--max-total must be between 0 and 5 USD");

const micros = (price) => { const m = /^\$(\d+)(?:\.(\d{1,6}))?$/.exec(price); if (!m) throw new Error(`bad price ${price}`); return BigInt(m[1]) * 1_000_000n + BigInt((m[2] ?? "").padEnd(6, "0") || "0"); };
const usd = (atomic) => (Number(atomic) / 1e6).toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
const toolName = (path) => path.slice(1).replace(/[/-]/g, "_");
const get = (url, headers = {}) => fetch(url, { headers: { "user-agent": UA, ...headers }, signal: AbortSignal.timeout(30_000) });

// 1. The catalog: every tool's price and a working example URL.
const card = await (await get(ORIGIN, { accept: "application/json" })).json();
const payTo = String(card.payment.payTo).toLowerCase();
const byName = new Map(card.endpoints.map((e) => [toolName(new URL(e.url).pathname), e]));

// 2. The selection: the tools of the named MCP sections (what buyers of that kind look for), or named paths.
const selected = new Map();
// Demand order (Tanod's Bazaar snapshot of 9 Oct 2026 and our buyer-bot measurement of 15-19 Oct): chain reads are
// the most-paid category, then the crypto-risk checks bot A buys at $0.01-0.05, then prices, compliance and web
// reading, then everything else up to $0.005. Never the $0.20 package audit or the capacity-limited AI and media tools.
// Repeat-buyer categories first (Bazaar snapshot of 20 Oct, docs/bazaar-market-2026-10-20.md): LLM chat, web
// reading and token data are the only ones where payers call again and again. 0.011 USD for all four.
const REPEAT = ["/extract", "/ai/chat", "/price/token", "/wallet/portfolio"];
// First of all (Base buyer-bot analysis of 15-22 Oct, business/agentic/reports/base-bots-2026-10-22.md): explorers buy
// weather/geo listings at about 2x the base rate, real buyers pay most for chain data, prices, search and scraping, and
// the payee checks match the $0.005-0.01 jobs our one organic buyer pays others for.
const PRIORITY = ["/weather", "/check/payee", "/check/x402-seller", "/price/token", "/eth/balance", "/sanctions/check", "/geocode", "/airport/status", "/hyperliquid/market", "/sec/filings", "/email", "/company", "/domain"];
const RISK = ["/contract-risk", "/token-report", "/wallet-audit", "/liquidity-pool-audit", "/check/counterparty", "/token", "/trade-insight", "/mev-simulator"];
const NEVER = new Set(["/package-audit", "/screenshot", "/image", "/transcribe", "/describe", "/summarize", "/extract/rendered"]);
const isChain = (path) => /^\/((base|eth|arb|op|polygon|wallet)(\/|$)|base-|btc-|ens$)/.test(path);
async function sectionPaths(set) {
  const res = await fetch(`${ORIGIN}/mcp/${set}`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "user-agent": UA },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }), signal: AbortSignal.timeout(30_000) });
  const text = await res.text();
  const line = text.split("\n").find((l) => l.startsWith("data:")) ?? text;
  const tools = JSON.parse(line.replace(/^data:\s*/, "")).result?.tools ?? [];
  if (!tools.length) throw new Error(`no tools in section ${set}`);
  return tools.map((t) => byName.get(t.name)).filter(Boolean).map((e) => new URL(e.url).pathname);
}
if (only.length) {
  for (const path of only) { const e = byName.get(toolName(path)); if (!e) throw new Error(`unknown tool ${path}`); selected.set(path, e); }
} else if (!sets.length) {
  const all = card.endpoints.map((e) => [new URL(e.url).pathname, e]).filter(([path, e]) => !NEVER.has(path) && (!path.startsWith("/ai/") || REPEAT.includes(path)) && !path.startsWith("/buy/") && e.price);
  const byPath = new Map(all);
  const add = (path) => { if (byPath.has(path) && !selected.has(path)) selected.set(path, byPath.get(path)); };
  for (const path of PRIORITY) add(path);
  for (const path of REPEAT) add(path);
  for (const [path] of all) if (isChain(path)) add(path);
  for (const path of RISK) add(path);
  for (const set of ["prices", "compliance", "web"]) for (const path of await sectionPaths(set)) add(path);
  for (const [path, e] of all) if (micros(e.price) <= 5000n) add(path);
} else {
  for (const set of sets) for (const path of await sectionPaths(set)) selected.set(path, byName.get(toolName(path)));
}

// 3. What the Bazaar already lists for our payout address, so each tool is seeded at most once.
const listed = new Set();
for (let offset = 0, total = Infinity; offset < total; offset += 500) {
  const res = await get(`${DISCOVERY}?limit=500&offset=${offset}`);
  if (!res.ok) { console.warn(`Bazaar listing read failed (HTTP ${res.status}); continuing without the skip list`); break; }
  const body = await res.json();
  total = body.pagination?.total ?? 0;
  for (const it of body.items ?? []) if (String(it.accepts?.[0]?.payTo ?? "").toLowerCase() === payTo) { try { listed.add(new URL(it.resource).pathname); } catch { /* ignore */ } }
  if (!body.items?.length) break;
}

// 4. Verify each tool's live terms before anything is signed: our address, Base USDC, the catalog price.
const plan = [];
for (const [path, e] of selected) {
  if (listed.has(path) && !flag("--force")) { plan.push({ path, skip: "already in the Bazaar" }); continue; }
  const quote = await get(e.example, { accept: "application/json" });
  await quote.arrayBuffer();
  const header = quote.headers.get("payment-required");
  if (quote.status !== 402 || !header) { plan.push({ path, skip: `expected 402 with PAYMENT-REQUIRED, got HTTP ${quote.status}` }); continue; }
  let challenge;
  try { challenge = JSON.parse(Buffer.from(header, "base64").toString()); } catch { plan.push({ path, skip: "unreadable PAYMENT-REQUIRED" }); continue; }
  const terms = (challenge.accepts ?? []).find((a) => a.network === NETWORK && a.scheme === "exact");
  const expected = micros(e.price);
  if (!terms) { plan.push({ path, skip: "no Base terms" }); continue; }
  if (String(terms.payTo).toLowerCase() !== payTo) { plan.push({ path, skip: `payTo ${terms.payTo} is not ours` }); continue; }
  if (String(terms.asset).toLowerCase() !== BASE_USDC) { plan.push({ path, skip: `asset ${terms.asset} is not Base USDC` }); continue; }
  if (BigInt(terms.amount) !== expected) { plan.push({ path, skip: `quote ${terms.amount} differs from catalog ${expected}` }); continue; }
  plan.push({ path, example: e.example, amount: terms.amount, price: e.price });
}
// --budget cuts the demand order: tools past the budget are planned for a later run, not skipped for good.
let planned = 0n;
for (const p of plan) {
  if (p.skip || budgetUsd === undefined) continue;
  if (planned + BigInt(p.amount) > BigInt(Math.round(budgetUsd * 1e6))) p.skip = `beyond --budget ${budgetUsd}`;
  else planned += BigInt(p.amount);
}
const todo = plan.filter((p) => !p.skip);
const totalAtomic = todo.reduce((s, p) => s + BigInt(p.amount), 0n);

console.log(`${selected.size} tools selected (${only.length ? "named paths" : sets.length ? `sections ${sets.join(", ")}` : "demand order"}); ${listed.size} of our resources already in the Bazaar.`);
for (const p of plan) console.log(p.skip ? `  skip ${p.path}: ${p.skip}` : `  pay  ${p.path}  ${p.price}`);
console.log(`${todo.length} payments, ${usd(totalAtomic)} USDC in total (cap ${maxTotalUsd} USD).`);
if (totalAtomic > BigInt(Math.round(maxTotalUsd * 1e6))) throw new Error("total exceeds --max-total; narrow the selection or raise the cap deliberately");

if (!pay) { console.log("Dry run: nothing was signed or paid. Add --pay --ledger-excluded to seed."); process.exit(0); }
if (!flag("--ledger-excluded")) throw new Error("--pay needs --ledger-excluded: confirm the buyer wallet is in OWNED_WALLETS (src/lib/settlement-ledger.ts) on the live Worker, so these settlements are never counted as revenue");
const rawKey = process.env.BUYER_KEY ?? (existsSync(WALLET_FILE) ? JSON.parse(readFileSync(WALLET_FILE, "utf8")).key : undefined);
if (!rawKey || !/^0x[0-9a-fA-F]{64}$/.test(rawKey)) throw new Error("no buyer wallet: run `node scripts/seed-bazaar.mjs wallet` first, or set BUYER_KEY (0x + 64 hex) for this run");
const account = privateKeyToAccount(rawKey);
console.log(`Buyer wallet ${account.address} (must be listed in OWNED_WALLETS). Paying ${todo.length} tools on ${NETWORK}...`);

const results = [];
let spent = 0n;
for (const p of todo) {
  const client = new x402Client();
  registerExactEvmScheme(client, { signer: account });
  client.setSpendControls({ maxAmountPerPayment: p.price });
  client.registerPolicy((_version, requirements) => requirements.filter((r) =>
    r.network === NETWORK && r.scheme === "exact" && String(r.payTo).toLowerCase() === payTo && String(r.asset).toLowerCase() === BASE_USDC && r.amount === p.amount));
  const paidFetch = wrapFetchWithPayment(fetch, client);
  const record = { path: p.path, amount: p.amount, at: new Date().toISOString() };
  try {
    const res = await paidFetch(p.example, { headers: { "user-agent": UA, "x402-source": "seed" } });
    await res.arrayBuffer();
    record.status = res.status;
    record.requestId = res.headers.get("x-request-id");
    const receipt = res.headers.get("payment-response");
    record.settlement = receipt ? decodePaymentResponseHeader(receipt) : null;
    const ext = res.headers.get("extension-responses");
    if (ext) { try { record.bazaar = JSON.parse(Buffer.from(ext, "base64").toString()); } catch { record.bazaar = ext.slice(0, 200); } }
    if (res.ok && record.settlement?.success) { spent += BigInt(p.amount); console.log(`  paid ${p.path}  tx ${record.settlement.transaction}  ${record.bazaar ? JSON.stringify(record.bazaar).slice(0, 120) : ""}`); }
    else console.log(`  FAILED ${p.path}: HTTP ${res.status}, settlement ${JSON.stringify(record.settlement)}`);
  } catch (error) {
    record.error = String(error?.message ?? error).slice(0, 200);
    console.log(`  FAILED ${p.path}: ${record.error}`);
  }
  results.push(record);
  await new Promise((r) => setTimeout(r, 1500));
}
const log = `.seed-bazaar-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
writeFileSync(log, JSON.stringify({ origin: ORIGIN, buyer: account.address, spentAtomic: spent.toString(), results }, null, 2) + "\n");
console.log(`Done: ${results.filter((r) => r.settlement?.success).length} of ${todo.length} settled, ${usd(spent)} USDC moved to ${payTo}. Private log: ${log} (git-ignored). Re-run in a few minutes with the same selection: listed tools are skipped and failures retried.`);
