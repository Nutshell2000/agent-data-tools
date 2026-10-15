import { HttpError, type Env } from "../lib/env";
import { baseClient } from "../lib/rpc";
import type { Product } from "./catalog";
import { findPayment } from "./chain";

const PAY_WINDOW_MS = 3 * 60 * 60 * 1000;
const KEEP_SECONDS = 30 * 24 * 60 * 60;

export interface Order {
  id: string;
  slug: string;
  /** USDC in 6-decimal units. The last four digits are unique to this order. */
  amount: string;
  createdAt: number;
  createdBlock: string;
  paidAt?: number;
  paidTx?: string;
  via?: "transfer" | "x402" | "test";
}

export type OrderState = "waiting" | "paid" | "expired";

const kv = (env: Env) => {
  if (!env.TRIALS) throw new HttpError(503, "the store is not available in this environment");
  return env.TRIALS;
};

const checkout = (env: Env) => {
  if (!env.METRICS) throw new HttpError(503, "payment matching is temporarily unavailable");
  return env.METRICS.get(env.METRICS.idFromName("global"));
};
const paymentScope = (env: Env) => `${env.NETWORK}:${env.PAY_TO.toLowerCase()}`;

const randomHex = (bytes: number) =>
  [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");

export const formatUsdc = (amount: string) => `${amount.slice(0, -6) || "0"}.${amount.slice(-6).padStart(6, "0")}`;

export const orderState = (o: Order): OrderState =>
  o.paidAt ? "paid" : Date.now() - o.createdAt > PAY_WINDOW_MS ? "expired" : "waiting";

export async function getOrder(env: Env, id: string): Promise<Order | null> {
  if (!/^[0-9a-f]{32}$/.test(id)) return null;
  return kv(env).get<Order>(`order:${id}`, "json");
}

/**
 * The price plus a random 1-9999 micro-dollars identifies the order on chain,
 * so a buyer can pay from any wallet or exchange without attaching a memo.
 */
export async function createOrder(env: Env, product: Product, paidVia?: "x402" | "test"): Promise<Order> {
  const baseAmount = product.priceUsd * 1_000_000;
  if (!Number.isSafeInteger(baseAmount) || baseAmount <= 0) throw new HttpError(503, "product price is unavailable");
  const order: Order = {
    id: randomHex(16),
    slug: product.slug,
    amount: String(baseAmount),
    createdAt: Date.now(),
    createdBlock: paidVia ? "0" : String(await baseClient(env).getBlockNumber()),
    ...(paidVia && { paidAt: Date.now(), via: paidVia }),
  };
  if (!paidVia) {
    const coordinator = checkout(env);
    let reserved = false;
    for (let attempt = 0; attempt < 16; attempt++) {
      order.amount = String(baseAmount + 1 + (crypto.getRandomValues(new Uint16Array(1))[0] % 9999));
      if (await coordinator.reserveCheckoutAmount({ scope: paymentScope(env), amount: order.amount,
        orderId: order.id, expiresAt: order.createdAt + PAY_WINDOW_MS })) { reserved = true; break; }
    }
    if (!reserved) throw new HttpError(503, "checkout is busy; please try again later");
  }
  await kv(env).put(`order:${order.id}`, JSON.stringify(order), { expirationTtl: KEEP_SECONDS });
  return order;
}

async function markPaid(env: Env, order: Order, via: Order["via"], tx?: string, from?: string): Promise<Order> {
  const paid: Order = { ...order, paidAt: Date.now(), via, ...(tx && { paidTx: tx }) };
  await Promise.all([
    kv(env).put(`order:${order.id}`, JSON.stringify(paid), { expirationTtl: KEEP_SECONDS }),
    // Doubles as the sales log and as the guard that stops one transfer unlocking two orders.
    tx && kv(env).put(`paid:${tx}`, JSON.stringify({ orderId: order.id, slug: order.slug, usdc: formatUsdc(order.amount), from, at: new Date().toISOString() })),
  ]);
  return paid;
}

/** Looks on chain for the order's payment. Writes nothing unless the payment is found. */
export async function refreshOrder(env: Env, order: Order): Promise<Order> {
  if (orderState(order) !== "waiting") return order;
  // A failed lookup must not break the order page; the next poll simply tries again.
  const payment = await findPayment(env, env.PAY_TO, BigInt(order.amount), BigInt(order.createdBlock)).catch((e) => {
    console.error(`payment lookup failed for order ${order.id}: ${e}`);
    return null;
  });
  if (!payment) return order;
  const claimed = await kv(env).get<{ orderId: string }>(`paid:${payment.tx}`, "json");
  if (claimed && claimed.orderId !== order.id) return order;
  // Durable Object transaction arbitrates concurrent claimants. A KV write failure
  // can safely retry the same order; another order can never consume this event.
  if (!await checkout(env).claimCheckoutPayment({ scope: paymentScope(env), amount: order.amount,
    orderId: order.id, transaction: payment.tx.toLowerCase(), logIndex: payment.logIndex })) return order;
  return markPaid(env, order, "transfer", payment.tx, payment.from);
}

export const markTestPaid = (env: Env, order: Order) => markPaid(env, order, "test");
