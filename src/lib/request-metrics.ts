import type { MiddlewareHandler } from "hono";
import type { Env } from "./env";
import { queueMetricBump, settledApiRevenueMicros } from "./revenue";
import type { Outcome } from "../metrics";
import { callerFamily } from "./caller";
import { FAILURE_PREFIX, failureReason } from "./failure-reason";
import { TARGET_UNAVAILABLE } from "./fetch";

export function requestMetricsMiddleware(
  paidPaths: ReadonlySet<string>,
  isMarketplace: (env: Env, rapid: string | undefined, fluxa: string | undefined) => boolean | string,
): MiddlewareHandler<{ Bindings: Env }> {
  return async (c, next) => {
    await next();
    if (!paidPaths.has(c.req.path) || !c.env.METRICS || c.req.method !== "GET") return;
    let outcome: Outcome;
    let revenueUsdMicros: number | undefined;
    const market = isMarketplace(c.env, c.req.header("x-rapidapi-proxy-secret"), c.req.header("x-fluxa-proxy-secret"));
    // A payment attempt answered 402 is a refused payment, not a quote: counted apart by protocol version
    // (v2 clients send PAYMENT-SIGNATURE, v1 clients X-PAYMENT, MPP clients Authorization: Payment) so refusals
    // are visible among the quotes.
    const json = c.res.status >= 400 && (c.res.headers.get("content-type") ?? "").includes("json");
    const body = json ? await c.res.clone().json().then((b) => b as { error?: unknown; code?: unknown } | null).catch(() => null) : null;
    if (c.res.status === 402 && c.req.header("payment-signature")) outcome = "v2_payment";
    else if (c.res.status === 402 && c.req.header("x-payment")) outcome = "v1_payment";
    else if (c.res.status === 402 && /(^|,)\s*Payment\s/i.test(c.req.header("authorization") ?? "")) outcome = "mpp_payment";
    else if (c.res.status === 402) outcome = "challenged";
    // A target URL the caller named that was down, slow or broken (lib/fetch.ts TARGET_UNAVAILABLE) is the caller's input,
    // like a 404 target: counted as failed, not as our server error.
    else if (c.res.status >= 500 && body?.code === TARGET_UNAVAILABLE) outcome = "failed";
    else if (c.res.status >= 500) outcome = "errored";
    else if (c.res.status >= 400) outcome = "failed";
    else if (c.res.headers.get("X-Sample") === "1") outcome = "sample";
    else if (c.res.headers.has("X-Free-Trial-Remaining")) outcome = "trial";
    else if (c.res.headers.has("X-Credits-Charged")) outcome = "credits";
    else if (market) outcome = "marketplace";
    else {
      revenueUsdMicros = settledApiRevenueMicros(c.req.path, "paid", c.res.headers);
      outcome = revenueUsdMicros === undefined ? "unsettled" : "paid";
    }
    const metrics = c.env.METRICS.get(c.env.METRICS.idFromName("global"));
    const caller = callerFamily(c.req.header("user-agent"), outcome === "marketplace" ? market : false);
    queueMetricBump(metrics, (promise) => c.executionCtx.waitUntil(promise), c.req.path, outcome, revenueUsdMicros, caller);
    // Why it failed, so /status can show it (the 21-23 Oct /pdf/text failures could not be diagnosed without logs).
    if ((outcome === "failed" || outcome === "errored") && json) {
      queueMetricBump(metrics, (promise) => c.executionCtx.waitUntil(promise), `${FAILURE_PREFIX}${c.req.path} ${failureReason(c.res.status, body?.error)}`, outcome);
    }
  };
}
