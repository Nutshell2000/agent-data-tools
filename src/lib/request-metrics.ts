import type { MiddlewareHandler } from "hono";
import type { Env } from "./env";
import { queueMetricBump, settledApiRevenueMicros } from "./revenue";
import type { Outcome } from "../metrics";

export function requestMetricsMiddleware(
  paidPaths: ReadonlySet<string>,
  isMarketplace: (env: Env, sent: string | undefined) => boolean,
): MiddlewareHandler<{ Bindings: Env }> {
  return async (c, next) => {
    await next();
    if (!paidPaths.has(c.req.path) || !c.env.METRICS || c.req.method !== "GET") return;
    let outcome: Outcome;
    let revenueUsdMicros: number | undefined;
    if (c.res.status === 402) outcome = "challenged";
    else if (c.res.status >= 500) outcome = "errored";
    else if (c.res.status >= 400) outcome = "failed";
    else if (c.res.headers.has("X-Free-Trial-Remaining")) outcome = "trial";
    else if (isMarketplace(c.env, c.req.header("x-rapidapi-proxy-secret"))) outcome = "marketplace";
    else {
      revenueUsdMicros = settledApiRevenueMicros(c.req.path, "paid", c.res.headers);
      outcome = revenueUsdMicros === undefined ? "unsettled" : "paid";
    }
    const metrics = c.env.METRICS.get(c.env.METRICS.idFromName("global"));
    queueMetricBump(metrics, (promise) => c.executionCtx.waitUntil(promise), c.req.path, outcome, revenueUsdMicros);
  };
}
