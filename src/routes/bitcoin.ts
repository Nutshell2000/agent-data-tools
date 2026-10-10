import { decode } from "light-bolt11-decoder";
import { HttpError } from "../lib/env";

const API = "https://mempool.space/api";
const SATS = 100_000_000;
const ADDRESS = /^(bc1[a-z0-9]{11,87}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})$/;

async function mempool<T>(path: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(API + path, { signal: AbortSignal.timeout(8_000), headers: { "user-agent": "AgentDataTools/1.0" } });
  } catch {
    throw new HttpError(502, "the Bitcoin data source did not respond");
  }
  if (res.status === 400 || res.status === 404) throw new HttpError(404, "not found on the Bitcoin network");
  if (!res.ok) throw new HttpError(502, `the Bitcoin data source returned HTTP ${res.status}`);
  return res.json();
}

interface Fees {
  fastestFee: number;
  halfHourFee: number;
  hourFee: number;
  economyFee: number;
  minimumFee: number;
}

export async function bitcoinFees() {
  const [fees, pool, height] = await Promise.all([
    mempool<Fees>("/v1/fees/recommended"),
    mempool<{ count: number; vsize: number; total_fee: number }>("/mempool"),
    mempool<number>("/blocks/tip/height"),
  ]);
  return {
    network: "bitcoin",
    unit: "sat/vB",
    fees: {
      nextBlock: fees.fastestFee,
      halfHour: fees.halfHourFee,
      hour: fees.hourFee,
      economy: fees.economyFee,
      minimum: fees.minimumFee,
    },
    // A plain one-input, two-output SegWit payment is about 141 vB.
    typicalPaymentSats: { nextBlock: fees.fastestFee * 141, hour: fees.hourFee * 141 },
    mempool: { transactions: pool.count, vsize: pool.vsize, totalFeesBtc: pool.total_fee / SATS },
    blockHeight: height,
    checkedAt: new Date().toISOString(),
  };
}

interface Stats {
  funded_txo_sum: number;
  spent_txo_sum: number;
  tx_count: number;
}

export async function bitcoinAddress(input: string) {
  const address = input.trim();
  if (!ADDRESS.test(address)) throw new HttpError(400, "address must be a Bitcoin mainnet address (1..., 3... or bc1...)");
  const a = await mempool<{ chain_stats: Stats; mempool_stats: Stats }>(`/address/${address}`);
  const confirmed = a.chain_stats.funded_txo_sum - a.chain_stats.spent_txo_sum;
  const pending = a.mempool_stats.funded_txo_sum - a.mempool_stats.spent_txo_sum;
  return {
    network: "bitcoin",
    address,
    balanceSats: confirmed,
    balanceBtc: confirmed / SATS,
    pendingSats: pending,
    totalReceivedBtc: a.chain_stats.funded_txo_sum / SATS,
    totalSentBtc: a.chain_stats.spent_txo_sum / SATS,
    transactions: a.chain_stats.tx_count,
    pendingTransactions: a.mempool_stats.tx_count,
    checkedAt: new Date().toISOString(),
  };
}

/** Decodes a BOLT11 Lightning invoice locally; nothing is sent anywhere. */
export function lightningInvoice(input: string) {
  const invoice = input.trim().replace(/^lightning:/i, "");
  if (!/^ln[a-z0-9]{20,}$/i.test(invoice)) throw new HttpError(400, "invoice must be a BOLT11 Lightning invoice starting with ln");
  let sections: { name: string; value?: unknown }[];
  try {
    sections = decode(invoice).sections as { name: string; value?: unknown }[];
  } catch {
    throw new HttpError(422, "the invoice could not be decoded");
  }
  const get = (name: string) => sections.find((s) => s.name === name)?.value;
  const msat = get("amount") === undefined ? null : Number(get("amount"));
  const timestamp = Number(get("timestamp"));
  const expiry = get("expiry") === undefined ? 3600 : Number(get("expiry"));
  const expiresAt = new Date((timestamp + expiry) * 1000);
  const prefix = String(get("coin_network") && (get("coin_network") as { bech32?: string }).bech32);
  return {
    network: { bc: "bitcoin", tb: "testnet", tbs: "signet", bcrt: "regtest" }[prefix] ?? prefix,
    amountSats: msat === null ? null : msat / 1000,
    amountBtc: msat === null ? null : msat / 1000 / SATS,
    description: (get("description") as string | undefined) ?? null,
    paymentHash: (get("payment_hash") as string | undefined) ?? null,
    createdAt: new Date(timestamp * 1000).toISOString(),
    expiresAt: expiresAt.toISOString(),
    expired: expiresAt.getTime() < Date.now(),
    expirySeconds: expiry,
  };
}
