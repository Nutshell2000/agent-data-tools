import type { MiddlewareHandler } from "hono";
import type { Env } from "./env";
import { queueMetricBump, settledApiRevenueMicros } from "./revenue";
import type { Outcome } from "../metrics";
import { callerFamily } from "./caller";

export function requestMetricsMiddleware(
  paidPaths: ReadonlySet<string>,
  isMarketplace: (env: Env, sent: string | undefined) => boolean,
): MiddlewareHandler<{ Bindings: Env }> {
  return async (c, next) => {
    await next();
    if (!paidPaths.has(c.req.path) || !c.env.METRICS || c.req.method !== "GET") return;
    let outcome: Outcome;
    let revenueUsdMicros: number | undefined;
    // An x402 v1 client pays with X-PAYMENT, which this v2 server does not read: it gets 402 again.
    // Counted apart so refused payment attempts are visible rather than lost among quotes.
    if (c.res.status === 402 && c.req.header("x-payment") && !c.req.header("payment-signature")) outcome = "v1_payment";
    else if (c.res.status === 402) outcome = "challenged";
    else if (c.res.status >= 500) outcome = "errored";
    else if (c.res.status >= 400) outcome = "failed";
    else if (c.res.headers.get("X-Sample") === "1") outcome = "sample";
    else if (c.res.headers.has("X-Free-Trial-Remaining")) outcome = "trial";
    else if (c.res.headers.has("X-Credits-Charged")) outcome = "credits";
    else if (isMarketplace(c.env, c.req.header("x-rapidapi-proxy-secret"))) outcome = "marketplace";
    else {
      revenueUsdMicros = settledApiRevenueMicros(c.req.path, "paid", c.res.headers);
      outcome = revenueUsdMicros === undefined ? "unsettled" : "paid";
    }
    const metrics = c.env.METRICS.get(c.env.METRICS.idFromName("global"));
    const caller = callerFamily(c.req.header("user-agent"), outcome === "marketplace");
    queueMetricBump(metrics, (promise) => c.executionCtx.waitUntil(promise), c.req.path, outcome, revenueUsdMicros, caller);
  };
}
