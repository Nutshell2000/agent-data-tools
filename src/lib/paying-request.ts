/**
 * Does a request to one of the API-shaped fronts (/v1/chat/completions, /v1/messages, /v1/search, …) carry a payment or
 * one of our own keys? The fronts refuse bad input with 400 only for a paying request; an unpaid one gets the tool's 402.
 *
 * 21 Nov 2026: the fronts treated ANY Authorization or x-api-key header as a payment. The OpenAI SDK always sends
 * `Authorization: Bearer <its key>`, and the Anthropic, Exa, Cohere and ElevenLabs SDKs always send `x-api-key` or
 * `xi-api-key`, so an SDK's first probe (an empty body, or HEAD) got 400 instead of the payment terms: a failed health
 * sample for routers and a dead end for the buyer. Now only real payment credentials and our own keys count:
 * x402 (PAYMENT-SIGNATURE, X-PAYMENT), MPP (`Authorization: Payment …`) and keys that start with `adt_` (credit, voice
 * test and trial keys all do; lib/credits.ts `apiKeyFrom` reads the same headers).
 */
export function carriesPayment(header: (name: string) => string | undefined): boolean {
  if (header("payment-signature") || header("x-payment")) return true;
  const auth = (header("authorization") ?? "").trim();
  if (/(^|,)\s*Payment\s/i.test(auth) || /^(?:Bearer\s+)?adt_/i.test(auth)) return true;
  return ["x-api-key", "xi-api-key"].some((name) => /^adt_/.test((header(name) ?? "").trim()));
}

/**
 * The headers a front forwards to its tool. A HEAD request is a probe: it must never authorize a payment, spend a key's
 * credits or run a tool (the tool paths already follow this in lib/payment-probe.ts). 21 Nov 2026: the API-shaped fronts
 * forwarded every header for HEAD too (Hono answers HEAD with the GET route), so a HEAD with query inputs and a payment
 * or key could settle a call whose answer the runtime then threw away. For HEAD only `accept` is forwarded.
 */
export function forwardedHeaders(request: Request): Headers {
  return request.method === "HEAD" ? new Headers({ accept: "application/json" }) : new Headers(request.headers);
}
