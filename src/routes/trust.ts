/**
 * The trust and evidence layer for open agent payments (11 Nov 2026, owner: "Yes, start it", after the agentic-commerce
 * research in reports/Agentic payments market for SpellzCode.md). Stablecoin payments have no chargebacks, so trust moves
 * to before the payment (is the payee still the seller's own wallet?) and to after it (what proves the purchase?). The
 * payee and seller screens already exist (/check/payee, /check/x402-seller); these three add what they do not answer:
 *
 * - /x402/payout-check: has the seller's payout wallet changed? Compares the wallet a live quote names with the wallet the
 *   seller's Coinbase Bazaar listing last settled to, and with the seller's own declaration (/.well-known/paycheck.json,
 *   the file Lumiere PayCheck reads). An undeclared change is how a hijacked endpoint looks, and it is what the checkers
 *   flagged on us after 7 Nov 2026 (memory note payout-wallet-change-trust-flags).
 * - /x402/seller-record: who has paid a payout wallet in USDC, from public Transfer logs: payments, distinct and repeat
 *   payers, amounts, first and last payment. The evidence a buyer has that a seller delivers is that others came back.
 * - /x402/receipt: a bookkeeping receipt for a settled payment from its transaction hash, with a stable id and a SHA-256
 *   over a canonical text, so an agent's purchase can be filed (agents "do not forward receipts").
 *
 * None of these holds, moves or signs funds, and none scores a person: they describe sellers' wallets and public
 * transactions. Licence reading in the report: software that never holds customer funds sits outside PSD2 and MiCA.
 */
import { formatUnits, getAddress, isHash, type PublicClient } from "viem";
import { entry, getJson, num, opt, pick, type Entry } from "../family";
import { HttpError, isAddress, type Env } from "../lib/env";
import { isSelfHost } from "../lib/self-fetch";
import { capBytes, fetchPublic, parseTarget } from "../lib/fetch";
import { blockAtTime, recentBlockSeconds } from "../lib/block-time";
import { CHAINS, USDC, client, historyRead, logsClient, rpc } from "./chain-reads";
import { analyze } from "./x402-check";

const SEARCH = "https://api.cdp.coinbase.com/platform/v2/x402/discovery/search";
const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef" as const;
/** keccak256("AuthorizationUsed(address,bytes32)"): USDC emits it for an EIP-3009 transferWithAuthorization, the x402 exact scheme. */
const AUTHORIZATION_USED = "0x98de503528ee59b575ef0c0a2576a82497bfc029a5685b209e9ec333479b10a5" as const;
const CAIP: Record<string, string> = { base: "eip155:8453", eth: "eip155:1", arb: "eip155:42161", op: "eip155:10", polygon: "eip155:137" };
const SLUG_OF_CAIP: Record<string, string> = Object.fromEntries(Object.entries(CAIP).map(([slug, caip]) => [caip, slug]));
const EXPLORER: Record<string, string> = { base: "https://basescan.org/tx/", eth: "https://etherscan.io/tx/", arb: "https://arbiscan.io/tx/", op: "https://optimistic.etherscan.io/tx/", polygon: "https://polygonscan.com/tx/" };
const CHAIN_SLUGS = ["base", "eth", "arb", "op", "polygon"] as [string, ...string[]];
/** A wallet as compared: EVM addresses lower-cased, anything else (Solana) as written. */
const walletKey = (w: string) => (isAddress(w) ? w.toLowerCase() : w.trim());
const chainOf = (slug: string) => CHAINS.find((c) => c.slug === slug)!;

/** The endpoint's 402 answer, through the SELF binding for our own host (a Worker cannot fetch its own workers.dev URL). */
async function fetchFrom(env: Env, target: URL, accept: string, allow: number[]) {
  return isSelfHost(env, target.hostname) && env.SELF
    ? env.SELF.fetch(target.href, { headers: { accept } })
    : fetchPublic(target, accept, allow);
}

async function liveTerms(env: Env, target: URL) {
  const res = await fetchFrom(env, target, "application/json", [402]);
  const body = res.body ? await new Response(capBytes(res.body, 262_144, () => {})).text() : "";
  return analyze(target.href, res.status, res.headers.get("payment-required"), body);
}

/** Wallets a seller declares at /.well-known/paycheck.json: `payTo` (Lumiere's format), or `wallets`/`payouts`, as strings or {address}. */
export function declaredWallets(doc: unknown): string[] | null {
  if (!doc || typeof doc !== "object") return null;
  const d = doc as Record<string, unknown>;
  const list = [d.payTo, d.wallets, d.payouts].find(Array.isArray) as unknown[] | undefined;
  if (!list) return null;
  const out = list.map((w) => (typeof w === "string" ? w : w && typeof w === "object" ? String((w as Record<string, unknown>).address ?? "") : "")).map((w) => w.trim()).filter(Boolean);
  return [...new Set(out)].slice(0, 50);
}

async function declaration(env: Env, origin: string) {
  const url = `${origin}/.well-known/paycheck.json`;
  try {
    const res = await fetchFrom(env, new URL(url), "application/json", [404, 410]);
    if (!res.ok) { await res.body?.cancel().catch(() => {}); return { url, found: false, payTo: [] as string[] }; }
    const text = res.body ? await new Response(capBytes(res.body, 65_536, () => {})).text() : "";
    const wallets = declaredWallets(JSON.parse(text));
    return { url, found: wallets !== null, payTo: wallets ?? [] };
  } catch {
    return { url, found: false, payTo: [] as string[] };
  }
}

interface BazaarItem { resource?: string; lastUpdated?: string; accepts?: { payTo?: string; network?: string }[]; quality?: { l30DaysUniquePayers?: number; l30DaysTotalCalls?: number; lastCalledAt?: string } }
const bare = (u: string) => u.replace(/[?#].*$/, "").replace(/\/+$/, "").toLowerCase();

/** The Bazaar listing of exactly this resource: the discovery search returns it first when asked for its URL (checked 11 Nov 2026). */
async function bazaarListing(resource: string) {
  const data = await getJson<{ resources?: BazaarItem[]; items?: BazaarItem[] }>(`${SEARCH}?${new URLSearchParams({ query: resource, limit: "20" })}`, { timeoutMs: 8_000 });
  const hit = (data.resources ?? data.items ?? []).find((it) => it.resource && bare(it.resource) === bare(resource));
  if (!hit) return null;
  return {
    payTo: [...new Set((hit.accepts ?? []).map((a) => a.payTo).filter((w): w is string => Boolean(w)))],
    lastSettledAt: hit.lastUpdated ?? null,
    payers30d: hit.quality?.l30DaysUniquePayers ?? null,
    calls30d: hit.quality?.l30DaysTotalCalls ?? null,
  };
}

type Listing = Awaited<ReturnType<typeof bazaarListing>>;

/**
 * unchanged: every live wallet is one the listing last settled to. declared-rotation: a live wallet differs from the
 * listing, but the seller's own file declares both. undeclared-change: a live wallet differs and the seller does not
 * declare it (how a hijacked endpoint looks). not-listed: no Bazaar listing to compare with.
 */
export function payoutVerdict(live: string[], listing: Listing, declared: { found: boolean; payTo: string[] }) {
  const reasons: string[] = [];
  const declaredSet = new Set(declared.payTo.map(walletKey));
  const liveKeys = live.map(walletKey);
  if (!liveKeys.length) return { verdict: "review", status: "no-terms", reasons: ["the endpoint did not answer 402 with x402 payment terms, so there is no wallet to check"] };
  if (declared.found) {
    const missing = live.filter((w) => !declaredSet.has(walletKey(w)));
    if (missing.length) reasons.push(`the live quote pays ${missing.join(", ")}, which the seller's own paycheck.json does not declare`);
  }
  if (!listing) return { verdict: reasons.length ? "review" : "pass", status: "not-listed", reasons };
  const listed = new Set(listing.payTo.map(walletKey));
  const changed = live.filter((w) => !listed.has(walletKey(w)));
  if (!changed.length) return { verdict: reasons.length ? "review" : "pass", status: "unchanged", reasons };
  const declaredBoth = declared.found && changed.every((w) => declaredSet.has(walletKey(w))) && listing.payTo.every((w) => declaredSet.has(walletKey(w)));
  if (declaredBoth) return { verdict: reasons.length ? "review" : "pass", status: "declared-rotation", reasons };
  reasons.push(`the live quote pays ${changed.join(", ")}, but the Bazaar listing last settled to ${listing.payTo.join(", ") || "no wallet"} and the seller has not declared the change`);
  return { verdict: "review", status: "undeclared-change", reasons };
}

/** The payout wallet a seller-record call reads: the address given, or the first EVM payTo of the endpoint on a network we read. */
async function payeeOf(env: Env, q: (n: string) => string | undefined, chainInput: string | undefined) {
  const address = q("address")?.trim();
  if (address) {
    if (!isAddress(address)) throw new HttpError(400, "address must be a 0x payout wallet (40 hex characters)");
    return { payTo: getAddress(address), slug: chainInput ?? "base", url: null as string | null };
  }
  const url = opt(q, "url", 2_000);
  if (!url) throw new HttpError(400, "send address (the payout wallet) or url (a paid x402 endpoint)");
  const terms = await liveTerms(env, parseTarget(url));
  const options = terms.accepts.filter((a) => a.payTo && isAddress(a.payTo) && SLUG_OF_CAIP[a.network ?? ""]);
  const chosen = options.find((a) => SLUG_OF_CAIP[a.network!] === (chainInput ?? "base")) ?? options[0];
  if (!chosen) throw new HttpError(422, "the endpoint's 402 terms name no EVM payout wallet on Base, Ethereum, Arbitrum, Optimism or Polygon");
  return { payTo: getAddress(chosen.payTo!), slug: SLUG_OF_CAIP[chosen.network!], url: terms.url };
}

/**
 * Blocks per eth_getLogs call: publicnode refuses more than 50,000 for one address and topic ("exceed maximum block
 * range: 50000", probed 11 Nov 2026). Base's 0.2 s blocks make seven days about 61 windows, so they run four at a time.
 */
const SCAN_WINDOW = 50_000n;
const SCAN_PARALLEL = 4;
type RawLog = { blockNumber: string; transactionHash: string; topics: string[]; data: string };
type ReadLogs = (from: bigint, to: bigint) => Promise<RawLog[]>;

/**
 * USDC inflows from `floor` to `latest`, newest first. A refused window is retried once in quarters; the scan stops at
 * the first window that still fails and keeps only the unbroken newest part, so `reached` (the oldest block read) and
 * the counts always describe the same stretch of chain. Nothing read at all is the node's error (an uncharged 502).
 */
/**
 * A buyer's agent and a router wait about 30 s. When the public log nodes rate-limit Cloudflare (12 Nov 2026: a one-day
 * record took over 120 s), the scan starts no new batch after this budget and answers what it has read, marked partial.
 */
const SCAN_BUDGET_MS = 25_000;

async function scanInflows(read: ReadLogs, latest: bigint, floor: bigint, budgetMs = SCAN_BUDGET_MS, now = () => Date.now()) {
  const started = now();
  const windows: [bigint, bigint][] = [];
  for (let to = latest; to >= floor; to -= SCAN_WINDOW) windows.push([to - SCAN_WINDOW + 1n > floor ? to - SCAN_WINDOW + 1n : floor, to]);
  const once = async ([from, to]: [bigint, bigint]): Promise<RawLog[] | null> => {
    try { return await read(from, to); } catch { /* retried in quarters below */ }
    const q = (to - from + 1n) / 4n || 1n;
    const parts: RawLog[] = [];
    for (let t = to; t >= from; t -= q) {
      try { parts.push(...(await read(t - q + 1n > from ? t - q + 1n : from, t))); } catch { return null; }
    }
    return parts;
  };
  let logs: RawLog[] = [];
  let reached = latest + 1n;
  for (let i = 0; i < windows.length; i += SCAN_PARALLEL) {
    if (i > 0 && now() - started > budgetMs) return { logs, complete: false, reached, outOfTime: true };
    const batch = windows.slice(i, i + SCAN_PARALLEL);
    const got = await Promise.all(batch.map(once));
    for (let j = 0; j < batch.length; j++) {
      const chunk = got[j];
      if (!chunk) {
        if (reached > latest) throw new HttpError(502, "the network's public log nodes did not answer; nothing was charged");
        return { logs, complete: false, reached };
      }
      logs = logs.concat(chunk);
      reached = batch[j][0];
    }
  }
  return { logs, complete: true, reached };
}

function inflows(cl: PublicClient, token: `0x${string}`, payTo: string, latest: bigint, floor: bigint) {
  const topic = `0x${"0".repeat(24)}${payTo.slice(2).toLowerCase()}` as `0x${string}`;
  return scanInflows((from, to) => rpc(() => cl.request({ method: "eth_getLogs", params: [{ address: token, topics: [TRANSFER, null, topic], fromBlock: `0x${from.toString(16)}`, toBlock: `0x${to.toString(16)}` }] })) as Promise<RawLog[]>, latest, floor);
}

const median = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const iso = (seconds: bigint | number) => new Date(Number(seconds) * 1000).toISOString();

async function blockTime(env: Env, slug: string, block: bigint) {
  try { return iso((await rpc(() => client(env, chainOf(slug)).getBlock({ blockNumber: block }))).timestamp); } catch { return null; }
}

/** Sorted-key JSON, so the same receipt always gives the same text and hash. */
export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson((v as Record<string, unknown>)[k])}`).join(",")}}`;
  return JSON.stringify(v ?? null);
}
async function sha256Hex(text: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
const topicAddress = (t: string | undefined) => (t ? getAddress(`0x${t.slice(-40)}`) : null);

const EX_ENDPOINT = "https://agent-data-tools.revmesh2074.workers.dev/weather";
const EX_PAY_TO = "0x6293ded2684F1A76E26bEcef87c137D691Fbf800";
/** A settled x402 payment to us on Base (11 Nov 2026, Mercator's gateway 0x72c5 paying $0.01, block 56,118,430): the receipt example. */
const EX_TX = "0x778c8c1b1fd1b320bf045eae0af7274e74a9e2e1f83c34ec96d9f825aea3b933";

export const TRUST: Entry[] = [
  entry("/x402/payout-check", "Payout wallet check: has an x402 seller's payout wallet changed?",
    "Check whether an x402 seller's payout wallet changed before you pay it: compares the wallet its live 402 quote names with the wallet its Coinbase Bazaar listing last settled to and with the seller's own /.well-known/paycheck.json. An undeclared change is how a hijacked endpoint looks; a declared rotation passes. Pass or review with reasons, plus the listing's 30-day payers. Never pays or signs. Use before paying a seller you bought from before.",
    ["payout-wallet", "x402", "payee-screening", "seller-trust", "hijack-check"], {
      url: { type: "string", description: "Absolute public https URL of the paid x402 endpoint", required: true, example: EX_ENDPOINT },
    },
    {
      url: EX_ENDPOINT, verdict: "pass", status: "unchanged", reasons: [],
      live: { payTo: [EX_PAY_TO, "82wfSCZhCmZA7zwqqt6Q3FG8nqYBwUvbThP6M97fa9Q6"] },
      listing: { payTo: [EX_PAY_TO, "82wfSCZhCmZA7zwqqt6Q3FG8nqYBwUvbThP6M97fa9Q6"], lastSettledAt: "2026-11-11T16:07:39.921Z", payers30d: 8, calls30d: 19 },
      declaration: { url: "https://agent-data-tools.revmesh2074.workers.dev/.well-known/paycheck.json", found: true, payTo: [EX_PAY_TO, "0x2074c40346aE2A90e0e4a391BcEe6f16bF5277f5", "82wfSCZhCmZA7zwqqt6Q3FG8nqYBwUvbThP6M97fa9Q6"] },
      limitations: [],
      note: "A pass means the wallet is the one buyers have been paying or one the seller declares; it is not a guarantee the seller delivers.",
    },
    async (env, q) => {
      const target = parseTarget(q("url"));
      const limitations: string[] = [];
      const [terms, listing, declared] = await Promise.all([
        liveTerms(env, target),
        bazaarListing(target.href).catch(() => { limitations.push("the Coinbase Bazaar search did not answer, so the listing was not compared"); return null; }),
        declaration(env, target.origin),
      ]);
      const live = [...new Set(terms.accepts.map((a) => a.payTo).filter((w): w is string => Boolean(w)))];
      return {
        url: target.href,
        ...payoutVerdict(live, listing, declared),
        live: { payTo: live },
        listing,
        declaration: declared,
        limitations,
        note: "A pass means the wallet is the one buyers have been paying or one the seller declares; it is not a guarantee the seller delivers.",
      };
    }),

  entry("/x402/seller-record", "Seller payment record: who has paid an x402 seller in USDC",
    "See whether other buyers pay an x402 seller before you do: every USDC transfer into its payout wallet over the last 1-7 days from public logs on Base, Ethereum, Arbitrum, Optimism or Polygon, with payments, distinct and repeat payers, total and median amount, first and last payment and top payers. Give the payout wallet or the paid endpoint's URL. Counts all USDC received, x402 or not. Use before the first payment to an unfamiliar seller.",
    ["seller-trust", "x402", "payment-history", "usdc", "repeat-buyers"], {
      address: { type: "string", description: "The seller's payout wallet (0x). Or send url instead", example: EX_PAY_TO },
      url: { type: "string", description: "Or: the paid x402 endpoint; its quote's payout wallet is read", example: EX_ENDPOINT },
      chain: { type: "string", description: "Network: base (default), eth, arb, op or polygon", enum: CHAIN_SLUGS, example: "base" },
      days: { type: "integer", description: "Days back to read, 1-7 (default 1)", example: 1 },
    },
    {
      // A real answer (11 Nov 2026, 17:30 UTC): our own payout wallet's last day on Base.
      payTo: EX_PAY_TO, chain: "base", url: null, days: 1, fromBlock: 56105625, toBlock: 56148824, complete: true, hoursCovered: 24,
      payments: 6, distinctPayers: 2, repeatPayers: 2, totalUsdc: "0.02", medianUsdc: "0.002", largestUsdc: "0.01",
      firstPaymentAt: "2026-11-11T15:55:37.000Z", lastPaymentAt: "2026-11-11T16:21:01.000Z",
      topPayers: [{ payer: "0x72c573fd7dE6a3DEc3035D48DB938ebF733D159b", payments: 4, usdc: "0.016" }, { payer: "0x82cef1CdC34D65Cf690235dc24e823a6585A6f86", payments: 2, usdc: "0.004" }],
      note: "Counts every USDC transfer into the wallet, x402 or not; a seller's own test wallets look like any payer.",
    },
    async (env, q) => {
      const chainInput = q("chain")?.trim() ? pick(q, "chain", CHAIN_SLUGS) : undefined;
      const days = num(q, "days", { min: 1, max: 7, fallback: 1, integer: true });
      const { payTo, slug, url } = await payeeOf(env, q, chainInput);
      const cl = slug === "base" || slug === "polygon" ? logsClient(env, chainOf(slug)) : client(env, chainOf(slug));
      const latest = await rpc(() => cl.getBlockNumber());
      // The window starts at the block of that moment, read from real headers (Base's block time changed on ~5 Nov 2026).
      const head = { block: latest, ts: Number((await rpc(() => cl.getBlock({ blockNumber: latest }))).timestamp) };
      const secs = await recentBlockSeconds(cl, slug, latest);
      const start = await rpc(() => blockAtTime(cl, head, head.ts - days * 86_400, { secs, tolerance: 600 }));
      const floor = start.block;
      const scan = await inflows(cl, USDC[slug], payTo, latest, floor);
      const { logs, complete, reached } = scan;
      const reachedTs = reached === floor ? start.ts : Number((await rpc(() => cl.getBlock({ blockNumber: reached }))).timestamp);
      const hoursCovered = Math.round(((head.ts - reachedTs) / 3600) * 10) / 10;
      const byPayer = new Map<string, { payments: number; atomic: bigint }>();
      const amounts: number[] = [];
      let total = 0n;
      for (const l of logs) {
        const payer = topicAddress(l.topics[1])!;
        const value = BigInt(l.data === "0x" ? 0 : l.data);
        total += value;
        amounts.push(Number(value) / 1e6);
        const row = byPayer.get(payer) ?? { payments: 0, atomic: 0n };
        row.payments++; row.atomic += value;
        byPayer.set(payer, row);
      }
      const blocks = logs.map((l) => BigInt(l.blockNumber)).sort((a, b) => (a < b ? -1 : 1));
      const [firstAt, lastAt] = blocks.length ? await Promise.all([blockTime(env, slug, blocks[0]), blockTime(env, slug, blocks[blocks.length - 1])]) : [null, null];
      const fmt = (n: number | null) => (n === null ? null : String(Math.round(n * 1e6) / 1e6));
      return {
        payTo, chain: slug, url, days, fromBlock: Number(reached), toBlock: Number(latest), complete, hoursCovered,
        ...(complete ? {} : { requestedFromBlock: Number(floor), coverageNote: "outOfTime" in scan ? `The public log nodes were slow, so the read stopped after the newest ${hoursCovered} hours of the ${days * 24} asked to answer in time: every count covers that part only. Ask for fewer days for a full read.` : `The public log nodes stopped answering after the newest ${hoursCovered} hours of the ${days * 24} asked: every count covers that part only.` }),
        payments: logs.length, distinctPayers: byPayer.size, repeatPayers: [...byPayer.values()].filter((r) => r.payments > 1).length,
        totalUsdc: formatUnits(total, 6), medianUsdc: fmt(median(amounts)), largestUsdc: fmt(amounts.length ? Math.max(...amounts) : null),
        firstPaymentAt: firstAt, lastPaymentAt: lastAt,
        topPayers: [...byPayer.entries()].sort((a, b) => b[1].payments - a[1].payments || (b[1].atomic > a[1].atomic ? 1 : -1)).slice(0, 10).map(([payer, r]) => ({ payer, payments: r.payments, usdc: formatUnits(r.atomic, 6) })),
        note: "Counts every USDC transfer into the wallet, x402 or not; a seller's own test wallets look like any payer.",
      };
    }),

  entry("/x402/receipt", "Payment receipt for an x402 or USDC payment from its transaction hash",
    "Turn a settled x402 or USDC payment into a receipt to file: from the transaction hash, the payer, payee, amount, time, block, status and whether it was an EIP-3009 authorization (the x402 exact scheme), on Base, Ethereum, Arbitrum, Optimism or Polygon, with a stable receipt id and a SHA-256 of a canonical text for bookkeeping. Optionally name what was bought. Never signs. Use to keep proof of a purchase after an agent pays.",
    ["payment-receipt", "x402", "usdc", "bookkeeping", "proof-of-payment"], {
      hash: { type: "string", description: "Transaction hash of the payment (0x, 64 hex characters)", required: true, example: EX_TX },
      chain: { type: "string", description: "Network: base (default), eth, arb, op or polygon", enum: CHAIN_SLUGS, example: "base" },
      payTo: { type: "string", description: "Optional: the payee, when the transaction holds several USDC transfers", example: EX_PAY_TO },
      resource: { type: "string", description: "Optional: the URL or item the payment bought, written into the receipt", example: "https://agent-data-tools.revmesh2074.workers.dev/news" },
    },
    {
      // The tool's real answer for the example payment.
      receiptId: "rcpt_fbcd04404acc94e2", chain: "base", chainId: 8453, transactionHash: EX_TX, logIndex: 135, block: 56118430, paidAt: "2026-11-11T16:21:01.000Z",
      status: "confirmed", payer: "0x72c573fd7dE6a3DEc3035D48DB938ebF733D159b", payee: EX_PAY_TO, amount: "0.01", amountAtomic: "10000",
      asset: "USDC", assetAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", method: "eip3009-authorization", submittedBy: "0xB87E1A2cc2B4643F2892768e80e41167F17C5860",
      resource: null, confirmations: 30399, explorerUrl: `https://basescan.org/tx/${EX_TX}`,
      sha256: "ebaf858615585e1ea5960d85d7002afb8c515edd1a2619555608dcb7c922499b", canonical: "{\"amount\":\"0.01\",\"amountAtomic\":\"10000\",\"asset\":\"USDC\",…}",
      note: "Proof that USDC moved on chain; it says nothing about what was delivered. Keep the canonical text and its hash together.",
    },
    async (env, q) => {
      const hash = q("hash")?.trim() ?? "";
      if (!isHash(hash)) throw new HttpError(400, "hash must be a 0x transaction hash (64 hex characters)");
      const slug = pick(q, "chain", CHAIN_SLUGS, "base");
      const wantPayee = q("payTo")?.trim();
      if (wantPayee && !isAddress(wantPayee)) throw new HttpError(400, "payTo must be a 0x address");
      const resource = opt(q, "resource", 500) ?? null;
      const c = chainOf(slug);
      const token = USDC[slug].toLowerCase();
      const receipt = await historyRead(env, c, (cl) => cl.getTransactionReceipt({ hash: hash as `0x${string}` }));
      const transfers = receipt.logs.filter((l) => l.address.toLowerCase() === token && l.topics[0] === TRANSFER && l.topics.length === 3);
      const chosen = wantPayee ? transfers.find((l) => topicAddress(l.topics[2])!.toLowerCase() === wantPayee.toLowerCase()) : transfers[0];
      if (!chosen) throw new HttpError(404, wantPayee ? "this transaction holds no USDC transfer to that payTo (nothing was charged)" : "this transaction holds no USDC transfer on this network (nothing was charged)");
      const viaAuthorization = receipt.logs.some((l) => l.address.toLowerCase() === token && l.topics[0] === AUTHORIZATION_USED);
      const [block, latest] = await Promise.all([rpc(() => client(env, c).getBlock({ blockNumber: receipt.blockNumber })), rpc(() => client(env, c).getBlockNumber())]);
      const value = BigInt(chosen.data === "0x" ? 0 : chosen.data);
      const core = {
        chain: slug, chainId: c.chain.id, transactionHash: receipt.transactionHash, logIndex: chosen.logIndex ?? null, block: Number(receipt.blockNumber), paidAt: iso(block.timestamp),
        status: receipt.status === "success" ? "confirmed" : "failed", payer: topicAddress(chosen.topics[1]), payee: topicAddress(chosen.topics[2]),
        amount: formatUnits(value, 6), amountAtomic: value.toString(), asset: "USDC", assetAddress: getAddress(USDC[slug]),
        method: viaAuthorization ? "eip3009-authorization" : "transfer", submittedBy: getAddress(receipt.from), resource,
      };
      const canonical = canonicalJson(core);
      const sha256 = await sha256Hex(canonical);
      return {
        receiptId: `rcpt_${(await sha256Hex(`${slug}|${receipt.transactionHash.toLowerCase()}|${chosen.logIndex}`)).slice(0, 16)}`,
        ...core,
        confirmations: Number(latest - receipt.blockNumber),
        explorerUrl: `${EXPLORER[slug]}${receipt.transactionHash}`,
        sha256, canonical,
        note: "Proof that USDC moved on chain; it says nothing about what was delivered. Keep the canonical text and its hash together.",
      };
    }),
];

export const __test = { payoutVerdict, declaredWallets, canonicalJson, scanInflows, SCAN_WINDOW };
