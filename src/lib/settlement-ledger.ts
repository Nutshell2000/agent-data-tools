import type { SettleResultContext } from "@x402/core/server";
import { ENDPOINTS } from "../endpoints";
import { PRODUCTS } from "../store/catalog";

const ADDRESS = /^0x[0-9a-f]{40}$/;
const HASH = /^0x[0-9a-f]{64}$/;
const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const OWNED_WALLETS = new Set([
  "0x60c51dd9c16fdad84165474279c70cc91eb7b15f", // Existing Taskmarket agent.
  "0x279bdcc64cee279dcd2ca0e4cc45ec2d8950ae66", // Existing test-wallet public address.
]);
const PATHS = new Set([...ENDPOINTS.map(e => e.path), ...PRODUCTS.map(p => `/buy/${p.slug}`)]);
const object = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" ? value as Record<string, unknown> : null;

export interface SettlementRecord {
  id: string;
  transaction: string;
  network: "eip155:8453";
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

/** Receipts originate in the trusted settle hook, never in an incoming request header. */
export async function settlementRecord(context: SettleResultContext, recipient: string): Promise<SettlementRecord | null> {
  if (context.phase !== "after-handler" || context.result.success !== true) return null;
  const result = context.result, requirements = context.requirements;
  const transaction = String(result.transaction ?? "").toLowerCase();
  const payer = String(result.payer ?? "").toLowerCase();
  const to = String(requirements.payTo ?? "").toLowerCase();
  if (result.network !== "eip155:8453" || requirements.network !== result.network ||
      String(requirements.asset).toLowerCase() !== USDC || to !== recipient.toLowerCase() ||
      !ADDRESS.test(to) || !ADDRESS.test(payer) || !HASH.test(transaction)) return null;
  const authorization = object(context.paymentPayload.payload.authorization);
  const nonce = String(authorization?.nonce ?? "").toLowerCase();
  // This deployment uses native Base USDC with EIP-3009. Unsupported schemes are not guessed.
  if (!HASH.test(nonce) || String(authorization?.from).toLowerCase() !== payer ||
      String(authorization?.to).toLowerCase() !== to || authorization?.value !== requirements.amount) return null;
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
  const bytes = new TextEncoder().encode(`${result.network}:${USDC}:${payer}:${nonce}`);
  const id = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(b => b.toString(16).padStart(2, "0")).join("");
  return { id, transaction, network: "eip155:8453", asset: USDC, recipient: to, payer,
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
  if (!/^[0-9a-f]{64}$/.test(record.id) || !HASH.test(record.transaction) || !ADDRESS.test(record.payer) ||
      !ADDRESS.test(record.recipient) || !HASH.test(record.authorizationNonce) || record.asset !== USDC ||
      record.network !== "eip155:8453" || !PATHS.has(record.path) ||
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
  return { sinceUtc: from, ...total, asset: "USDC", decimals: 6,
    evidence: "facilitator-reported; independent chain reconciliation pending",
    fees: "unmeasured", netIncome: null,
    note: "Historical paid counters are not backfilled using current prices. Self-payments are excluded from grossAtomic." };
}
