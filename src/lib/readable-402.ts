// x402 v2 carries the challenge in the PAYMENT-REQUIRED header and leaves the body as {}.
// Agents that fetch a tool with plain HTTP only see the body, so repeat the decoded
// challenge there with a short hint. Official clients read the header first, so this is additive.
import { decodePaymentRequiredHeader } from "@x402/core/http";
import { FREE_CALLS_PER_CALLER } from "./free-calls";
import { v1Body, type RequirementsV1 } from "./x402-v1";
import { browserToolPage } from "./browser-402";
import type { Endpoint } from "../endpoints";
import { relatedList } from "./related";
import { CREDIT_PACKS } from "./credits";

/**
 * The card route for callers without a wallet. While card payments can issue keys it is the $5 Stripe checkout as one
 * link (22 Oct: nobody reached /credits, and a page in between is one step too many for a person an agent is helping).
 */
function cardHint(origin: string, cardReady: boolean) {
  const [starter] = CREDIT_PACKS;
  return cardReady
    ? `No wallet? Pay $${starter.usdCents / 100} by card in one step at ${starter.url} (${starter.credits.toLocaleString("en-US")} credits, about ${Math.floor(starter.credits / 10).toLocaleString("en-US")} calls at $0.01; the key is shown right after payment; other packs at ${origin}/credits), then send the key as Authorization: Bearer adt_….`
    : `No wallet? Pay by card: buy credits at ${origin}/credits and send the key as Authorization: Bearer adt_….`;
}

export async function readable402(res: Response, origin: string, freeCalls = false, v1Accepts: RequirementsV1[] = [], page?: { endpoint: Endpoint; url: string }, cardReady = false): Promise<Response> {
  const header = res.headers.get("payment-required");
  // A person in a browser gets the library's developer page; show them the tool and the ways to use it instead.
  if (res.status === 402 && header && page && (res.headers.get("content-type") ?? "").includes("text/html")) {
    const headers = new Headers(res.headers);
    headers.delete("content-length");
    headers.set("content-type", "text/html; charset=utf-8");
    return new Response(browserToolPage(page.endpoint, page.url, freeCalls), { status: 402, headers });
  }
  if (res.status !== 402 || !header || !(res.headers.get("content-type") ?? "").includes("application/json")) return res;
  const text = await res.clone().text();
  if (text.trim() !== "{}") return res;
  let challenge: ReturnType<typeof decodePaymentRequiredHeader>;
  try {
    challenge = decodePaymentRequiredHeader(header);
  } catch {
    return res;
  }
  const hint = `${freeCalls ? `Try it free: add trial=1 to this request (${FREE_CALLS_PER_CALLER} free successful calls per caller). ` : ""}Paid x402 tool. x402 v2 clients: terms in the PAYMENT-REQUIRED header, pay with PAYMENT-SIGNATURE (for example @x402/fetch or AgentCash). x402 v1 clients: terms in this body, pay with X-PAYMENT. ${cardHint(origin, cardReady)} Free example output: add sample=1. Free docs: ${origin}/llms.txt`;
  // With v1 terms the body is a v1 PaymentRequired (official v2 clients read the header first and use the
  // body only when it is absent); otherwise the body mirrors the v2 header.
  // Three related tools, so an agent that cannot use this one (price, inputs, chain) sees the next thing to try.
  const related = page ? relatedList(origin, page.endpoint.path) : undefined;
  const body = v1Accepts.length ? { ...v1Body(v1Accepts, challenge.error ?? "Payment required", hint), resource: challenge.resource, related } : { ...challenge, hint, related };
  const headers = new Headers(res.headers);
  headers.delete("content-length");
  return new Response(JSON.stringify(body), { status: 402, headers });
}
