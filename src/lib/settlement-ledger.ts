import type { SettleResultContext } from "@x402/core/server";
import { ENDPOINTS } from "../endpoints";
import { PRODUCTS } from "../store/catalog";
import { activeTrace } from "./funnel";
import { SOLANA_NETWORK, SOLANA_USDC, USDC_BY_NETWORK } from "./networks";

const ADDRESS = /^0x[0-9a-f]{40}$/;
const HASH = /^0x[0-9a-f]{64}$/;
// Native USDC per accepted network (lib/networks.ts); a receipt must match its own network's token.
// Owner wallets: their payments are recorded but never counted as revenue or demand. The Bazaar seeding
// buyer wallet (docs/bazaar-seeding.md) is added here, deployed, and only then used.
const OWNED_WALLETS = new Set([
  "0x60c51dd9c16fdad84165474279c70cc91eb7b15f", // Existing Taskmarket agent.
  "0x279bdcc64cee279dcd2ca0e4cc45ec2d8950ae66", // Existing test-wallet public address.
]);
const PATHS = new Set([...ENDPOINTS.map(e => e.path), ...PRODUCTS.map(p => `/buy/${p.slug}`)]);
const object = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" ? value as Record<string, unknown> : null;

export interface SettlementRecord {
  requestId?: string;
  id: string;
  transaction: string;
  network: string;
  asset: string;
  recipient: string;
  payer: string;
  authorizationNonce: string;
  amountAtomic: string;
  amountEvidence: "facilitator-result" | "accepted-requirements";
  path: string;
  transport: "http" | "mcp";
  recordedAt: string;
  selfPayment: boolean;
  reconciliation: "pending";
}

/** Solana receipts: base58 accounts and transaction signatures, case-sensitive. */
const SOLANA_ACCOUNT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const SOLANA_SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{64,90}$/;

/** Identity fields of one receipt, validated per network family. */
function receiptParties(context: SettleResultContext, recipient: string, solanaRecipient?: string) {
  const result = context.result, requirements = context.requirements;
  if (requirements.network !== result.network) return null;
  if (result.network === SOLANA_NETWORK) {
    // The facilitator broadcasts the buyer's signed SPL transfer; its signature identifies the payment.
    const transaction = String(result.transaction ?? ""), payer = String(result.payer ?? ""), to = String(requirements.payTo ?? "");
    if (!solanaRecipient || to !== solanaRecipient || String(requirements.asset) !== SOLANA_USDC ||
        !SOLANA_ACCOUNT.test(to) || !SOLANA_ACCOUNT.test(payer) || !SOLANA_SIGNATURE.test(transaction)) return null;
    return { usdc: SOLANA_USDC, transaction, payer, to, nonce: transaction };
  }
  const transaction = String(result.transaction ?? "").toLowerCase();
  const payer = String(result.payer ?? "").toLowerCase();
  const to = String(requirements.payTo ?? "").toLowerCase();
  const usdc = USDC_BY_NETWORK[String(result.network)];
  if (!usdc || String(requirements.asset).toLowerCase() !== usdc || to !== recipient.toLowerCase() ||
      !ADDRESS.test(to) || !ADDRESS.test(payer) || !HASH.test(transaction)) return null;
  const authorization = object(context.paymentPayload.payload.authorization);
  const nonce = String(authorization?.nonce ?? "").toLowerCase();
  // EVM networks use native USDC with EIP-3009. Unsupported schemes are not guessed.
  if (!HASH.test(nonce) || String(authorization?.from).toLowerCase() !== payer ||
      String(authorization?.to).toLowerCase() !== to || authorization?.value !== requirements.amount) return null;
  return { usdc, transaction, payer, to, nonce };
}

/** Receipts originate in the trusted settle hook, never in an incoming request header. */
export async function settlementRecord(context: SettleResultContext, recipient: string, solanaRecipient?: string): Promise<SettlementRecord | null> {
  if (context.phase !== "after-handler" || context.result.success !== true) return null;
  const result = context.result, requirements = context.requirements;
  const parties = receiptParties(context, recipient, solanaRecipient);
  if (!parties) return null;
  const { usdc, transaction, payer, to, nonce } = parties;
  const amount = result.amount ?? requirements.amount;
  if (typeof amount !== "string" || !/^[1-9]\d{0,29}$/.test(amount)) return null;
  const request = object(object(context.transportContext)?.request);
  const resource = String(context.paymentPayload.resource?.url ?? "");
  let path = typeof request?.path === "string" ? request.path : "";
  const transport = resource.startsWith("mcp://") ? "mcp" : "http";
  if (!path && transport === "mcp") {
    try { path = new URL(resource).pathname; } catch { return null; }
  }
  if (!PATHS.has(path)) return null;
  const bytes = new TextEncoder().encode(`${result.network}:${usdc}:${payer}:${nonce}`);
  const id = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(b => b.toString(16).padStart(2, "0")).join("");
  return { id, requestId: activeTrace()?.requestId, transaction, network: String(result.network), asset: usdc, recipient: to, payer,
    authorizationNonce: nonce, amountAtomic: amount,
    amountEvidence: result.amount === undefined ? "accepted-requirements" : "facilitator-result",
    path, transport, recordedAt: new Date().toISOString(),
    selfPayment: payer === to || OWNED_WALLETS.has(payer), reconciliation: "pending" };
}

interface LedgerDay {
  settlements: number;
  grossAtomic: string;
  selfPayments: number;
  byEndpoint: Record<string, { settlements: number; grossAtomic: string }>;
}
const emptyDay = (): LedgerDay => ({ settlements: 0, grossAtomic: "0", selfPayments: 0, byEndpoint: {} });

/** Atomic deduplication survives retries, concurrent hooks, and isolate restarts. */
export async function saveSettlement(storage: DurableObjectStorage, record: SettlementRecord): Promise<boolean> {
  const solana = record.network === SOLANA_NETWORK;
  const partiesValid = solana
    ? SOLANA_SIGNATURE.test(record.transaction) && SOLANA_ACCOUNT.test(record.payer) && SOLANA_ACCOUNT.test(record.recipient) &&
      record.authorizationNonce === record.transaction && record.asset === SOLANA_USDC
    : HASH.test(record.transaction) && ADDRESS.test(record.payer) && ADDRESS.test(record.recipient) &&
      HASH.test(record.authorizationNonce) && record.network in USDC_BY_NETWORK && record.asset === USDC_BY_NETWORK[record.network];
  if (!/^[0-9a-f]{64}$/.test(record.id) || !partiesValid || !PATHS.has(record.path) ||
      !/^[1-9]\d{0,29}$/.test(record.amountAtomic) || record.reconciliation !== "pending" ||
      !Number.isFinite(Date.parse(record.recordedAt))) throw new Error("invalid settlement record");
  record = { ...record, selfPayment: record.payer === record.recipient || OWNED_WALLETS.has(record.payer) };
  return storage.transaction(async txn => {
    const key = `settlement:receipt:${record.id}`;
    const previous = await txn.get<SettlementRecord>(key);
    if (previous) {
      if (previous.transaction !== record.transaction || previous.amountAtomic !== record.amountAtomic ||
          previous.path !== record.path) throw new Error("settlement identity conflict requires reconciliation");
      return false;
    }
    const dayKey = `settlement:day:${record.recordedAt.slice(0, 10)}`;
    const day = await txn.get<LedgerDay>(dayKey) ?? emptyDay();
    if (record.selfPayment) day.selfPayments++;
    else {
      day.settlements++;
      day.grossAtomic = (BigInt(day.grossAtomic) + BigInt(record.amountAtomic)).toString();
      const endpoint = day.byEndpoint[record.path] ??= { settlements: 0, grossAtomic: "0" };
      endpoint.settlements++;
      endpoint.grossAtomic = (BigInt(endpoint.grossAtomic) + BigInt(record.amountAtomic)).toString();
    }
    await txn.put(key, record);
    await txn.put(dayKey, day);
    if (!record.selfPayment) await txn.put(`settlement:activity:${record.recordedAt.slice(0, 10)}:${record.payer}:${record.path}`, {
      day: record.recordedAt.slice(0, 10), payer: record.payer, path: record.path,
    });
    return true;
  });
}

/** Public aggregate only. Payers, nonces and transaction identifiers remain private. */
export async function ledgerSummary(storage: DurableObjectStorage) {
  const from = new Date(Date.now() - 29 * 86400_000).toISOString().slice(0, 10);
  const days = await storage.list<LedgerDay>({ prefix: "settlement:day:", start: `settlement:day:${from}` });
  const total = emptyDay();
  for (const day of days.values()) {
    total.settlements += day.settlements;
    total.selfPayments += day.selfPayments;
    total.grossAtomic = (BigInt(total.grossAtomic) + BigInt(day.grossAtomic)).toString();
    for (const [path, value] of Object.entries(day.byEndpoint)) {
      const row = total.byEndpoint[path] ??= { settlements: 0, grossAtomic: "0" };
      row.settlements += value.settlements;
      row.grossAtomic = (BigInt(row.grossAtomic) + BigInt(value.grossAtomic)).toString();
    }
  }
  // Bound the small-buyer experiment's read cost. Report coverage instead of
  // presenting a truncated activity scan as an exact count at larger scale.
  const activity = await storage.list<{ day: string; payer: string; path: string }>({ prefix: "settlement:activity:", start: `settlement:activity:${from}`, limit: 10_000 });
  const payers = new Map<string, Set<string>>(), pairs = new Map<string, Set<string>>();
  for (const row of activity.values()) {
    if (!payers.has(row.payer)) payers.set(row.payer, new Set());
    payers.get(row.payer)!.add(row.day);
    const pair = `${row.payer}:${row.path}`;
    if (!pairs.has(pair)) pairs.set(pair, new Set());
    pairs.get(pair)!.add(row.day);
  }
  return { sinceUtc: from, ...total, asset: "USDC", decimals: 6,
    payerActivity: { distinctExternalWallets: payers.size, returningOnAnotherUtcDay: [...payers.values()].filter(days => days.size > 1).length,
      repeatPayerToolPairs: [...pairs.values()].filter(days => days.size > 1).length,
      coverage: activity.size < 10_000 ? "complete since activity tracking began" : "bounded scan; counts are lower bounds",
      demandEvidence: "External wallet identities are not verified customers. Sweeps, tests and buyer task confirmation require operator review." },
    evidence: "facilitator-reported; independent chain reconciliation pending",
    fees: "unmeasured", netIncome: null,
    note: "Historical paid counters are not backfilled using current prices. Self-payments are excluded from grossAtomic." };
}
