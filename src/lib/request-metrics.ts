import type { MiddlewareHandler } from "hono";
import { decodePaymentRequiredHeader } from "@x402/core/http";
import type { Env } from "./env";
import { queueMetricBump, settledApiRevenueMicros } from "./revenue";
import type { Outcome } from "../metrics";
import { callerFamily } from "./caller";
import { FAILURE_PREFIX, failureReason, refusalReason } from "./failure-reason";
import { TARGET_UNAVAILABLE } from "./fetch";
import { orthogonalSecret } from "./marketplace";

export function requestMetricsMiddleware(
  paidPaths: ReadonlySet<string>,
  isMarketplace: (env: Env, rapid: string | undefined, fluxa: string | undefined, orthogonal?: string) => boolean | string,
): MiddlewareHandler<{ Bindings: Env }> {
  return async (c, next) => {
    await next();
    if (!paidPaths.has(c.req.path) || !c.env.METRICS || c.req.method !== "GET") return;
    let outcome: Outcome;
    let revenueUsdMicros: number | undefined;
    const market = isMarketplace(c.env, c.req.header("x-rapidapi-proxy-secret"), c.req.header("x-fluxa-proxy-secret"), orthogonalSecret((n) => c.req.header(n)));
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
    // A review key's call (lib/review-keys.ts) carries X-Credits-Charged: 0 too, but nothing was bought or spent:
    // counted apart, so "credits" on /metrics/callers means calls that spent bought credits (12 Nov 2026: 85 review
    // calls read as card-credit sales).
    else if (c.res.headers.has("X-Review-Calls-Left")) outcome = "review";
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
      // A paying caller refused for its inputs (a 400 on a request that carried a payment): also keep the NAMES of the
      // inputs it sent, never their values, so the next alias we lack is visible on /status (10 Nov 2026: /weather and
      // /llm/chat refused paid calls and nothing showed what the buyers had sent instead of city and prompt).
      const paying = c.req.header("payment-signature") || c.req.header("x-payment") || /(^|,)\s*Payment\s/i.test(c.req.header("authorization") ?? "");
      const sent = c.res.status === 400 && paying ? sentInputNames(new URL(c.req.url).searchParams) : "";
      queueMetricBump(metrics, (promise) => c.executionCtx.waitUntil(promise), `${FAILURE_PREFIX}${c.req.path} ${failureReason(c.res.status, body?.error)}${sent}`, outcome);
    }
    // Why a buyer's payment was refused: until 1.84.2 this reached only wrangler tail, so lost buyers could not be explained.
    if (outcome === "v2_payment" || outcome === "v1_payment" || outcome === "mpp_payment") {
      const reason = outcome === "v2_payment" ? decodedChallengeError(c.res.headers.get("payment-required")) : body?.error;
      queueMetricBump(metrics, (promise) => c.executionCtx.waitUntil(promise), `${FAILURE_PREFIX}${c.req.path} ${refusalReason(reason)}`, outcome);
    }
  };
}

/** " [sent a,b]": up to six input names of a request, lower-case identifiers only (letters and underscores, 24 at most). */
export function sentInputNames(params: URLSearchParams): string {
  const names = [...new Set([...params.keys()].filter((k) => /^[A-Za-z_]{1,24}$/.test(k)).map((k) => k.toLowerCase()))].sort().slice(0, 6);
  return names.length ? ` [sent ${names.join(",")}]` : " [sent nothing]";
}

/** The refusal message a v2 402 carries in its PAYMENT-REQUIRED header. */
export function decodedChallengeError(header: string | null): string {
  if (!header) return "no PAYMENT-REQUIRED header";
  try { return String(decodePaymentRequiredHeader(header).error ?? "payment refused").slice(0, 160); } catch { return "unreadable PAYMENT-REQUIRED header"; }
}
