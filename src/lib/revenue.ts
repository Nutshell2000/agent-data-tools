import { decodePaymentResponseHeader } from "@x402/core/http";
import { MCP_PAYMENT_RESPONSE_META_KEY } from "@x402/mcp";
import { ENDPOINTS } from "../endpoints";
import { PRODUCTS } from "../store/catalog";
import type { Outcome } from "../metrics";

type RevenueMetrics = {
  bump(path: string, outcome: Outcome, revenueUsdMicros?: number, caller?: string): Promise<void>;
};

/** Converts a catalog USD price to exact integer micro-dollars without floating point. */
export function usdMicros(price: string): number | null {
  const match = /^\$(\d+)(?:\.(\d{1,6}))?$/.exec(price);
  if (!match) return null;
  const micros = BigInt(match[1]) * 1_000_000n + BigInt((match[2] ?? "").padEnd(6, "0") || "0");
  return micros <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(micros) : null;
}

/** Product catalog prices are numbers rather than decimal strings. */
export function productUsdMicros(priceUsd: number): number | null {
  const micros = priceUsd * 1_000_000;
  return Number.isFinite(priceUsd) && Number.isSafeInteger(micros) ? micros : null;
}

/** Revenue is recorded only when a paid catalog path returned a successful x402 settlement. */
export function settledApiRevenueMicros(path: string, outcome: Outcome, headers: Headers): number | undefined {
  if (outcome !== "paid") return undefined;
  const endpoint = ENDPOINTS.find((item) => item.path === path);
  const product = endpoint ? undefined : PRODUCTS.find((item) => path === `/buy/${item.slug}`);
  const priceMicros = endpoint ? usdMicros(endpoint.price) : product ? productUsdMicros(product.priceUsd) : null;
  if (priceMicros === null) return undefined;
  const paymentResponse = headers.get("PAYMENT-RESPONSE") ?? headers.get("X-PAYMENT-RESPONSE");
  if (!paymentResponse) return undefined;
  try {
    if (decodePaymentResponseHeader(paymentResponse).success !== true) return undefined;
  } catch {
    return undefined;
  }
  return priceMicros;
}

/** Queue a non-blocking metric update without letting telemetry affect the paid response. */
export function queueMetricBump(
  metrics: RevenueMetrics | undefined,
  waitUntil: (promise: Promise<unknown>) => void,
  path: string,
  outcome: Outcome,
  revenueUsdMicros?: number,
  caller?: string,
): void {
  if (!metrics) return;
  waitUntil(metrics.bump(path, outcome, revenueUsdMicros, caller).catch(() => {}));
}

/** Wraps a paid MCP callback and records only its successful structured settlement. */
export function withMcpRevenue<TArgs extends unknown[], TResult extends { isError?: boolean; _meta?: Record<string, unknown> }>(
  path: string,
  callback: (...args: TArgs) => Promise<TResult>,
  getMetrics: () => RevenueMetrics | undefined,
  waitUntil: (promise: Promise<unknown>) => void,
): (...args: TArgs) => Promise<TResult> {
  return async (...args) => {
    const result = await callback(...args);
    const revenueUsdMicros = settledMcpRevenueMicros(path, result);
    if (revenueUsdMicros !== undefined) {
      queueMetricBump(getMetrics(), waitUntil, path, "paid", revenueUsdMicros);
    }
    return result;
  };
}

/** MCP payment wrappers attach the actual settlement result to tool-result metadata. */
export function settledMcpRevenueMicros(
  path: string,
  result: { isError?: boolean; _meta?: Record<string, unknown> },
): number | undefined {
  if (result.isError) return undefined;
  const endpoint = ENDPOINTS.find((item) => item.path === path);
  if (!endpoint) return undefined;
  const settlement = result._meta?.[MCP_PAYMENT_RESPONSE_META_KEY];
  if (!settlement || typeof settlement !== "object" || !("success" in settlement) || settlement.success !== true) {
    return undefined;
  }
  return usdMicros(endpoint.price) ?? undefined;
}
