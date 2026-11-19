// x402 v2 carries the challenge in the PAYMENT-REQUIRED header and leaves the body as {}.
// Agents that fetch a tool with plain HTTP only see the body, so repeat the decoded
// challenge there with a short hint. Official clients read the header first, so this is additive.
import { decodePaymentRequiredHeader } from "@x402/core/http";
import { FREE_HTTP_CALLS_PER_CALLER } from "./free-calls";
import { v1Body, type RequirementsV1 } from "./x402-v1";
import { browserToolPage } from "./browser-402";
import { exampleParams, type Endpoint } from "../endpoints";
import { relatedList } from "./related";
import { WEB_PACKS, callsAt, usdcPrepayLine } from "./credits";
import { keyPriceLine } from "./key-prices";

/**
 * The card route for callers without a wallet. While card payments can issue keys it is the first Stripe checkout as one
 * link (22 Oct: nobody reached /credits, and a page in between is one step too many for a person an agent is helping).
 */
function cardHint(origin: string, cardReady: boolean, price = "$0.01") {
  const [starter] = WEB_PACKS;
  const card = cardReady
    ? `No wallet? Pay $${starter.usdCents / 100} by card in one step at ${starter.url} (${starter.credits.toLocaleString("en-US")} credits, about ${callsAt(starter.credits, price)} calls at ${price}; the key is shown right after payment; other packs at ${origin}/credits), then send the key as Authorization: Bearer adt_… or, if your client can only fetch a URL, add &api_key=adt_… to this URL.`
    : `No wallet? Pay by card: buy credits at ${origin}/credits and send the key as Authorization: Bearer adt_… or, if your client can only fetch a URL, add &api_key=adt_… to this URL.`;
  // 19 Nov 2026: the MCP payment hint already tells wallet clients about the checkout-free credit pack; put the same
  // route in the HTTP 402 body, which is what an agent sees when it calls a tool directly.
  return `${card} An agent with an MPP client can buy a credit pack without a checkout page: GET ${origin}/credits/buy/1 answers 402 with payment terms and returns a key on settlement.`;
}

/** The keyless route, as data: the request that was just refused (or the tool's published example when it carried no input) with trial=1. */
function freeTrialOffer(page: { endpoint: Endpoint; url: string }) {
  const url = new URL(page.url);
  for (const control of ["x402", "sample"]) url.searchParams.delete(control);
  if (![...url.searchParams.keys()].length) for (const [k, p] of exampleParams(page.endpoint)) url.searchParams.set(k, String(p.example));
  url.searchParams.set("trial", "1");
  return { what: `No key, no wallet: ${FREE_HTTP_CALLS_PER_CALLER} free successful calls per caller on this and most other tools. Failed calls do not count.`, url: url.href };
}

/** The card route, as data: where credits are sold and the smallest pack (named only while card payments can issue keys). */
function payByCard(origin: string, cardReady: boolean) {
  const [starter] = WEB_PACKS;
  return {
    credits: `${origin}/credits`,
    ...(cardReady && starter ? { smallestPack: { price: `$${starter.usdCents / 100}`, credits: starter.credits, buy: starter.url } } : {}),
    use: "Send the key as Authorization: Bearer adt_…, or add api_key=adt_… to the URL, then re-send this exact URL.",
  };
}

/** v1 terms in the 402 body only when the caller asks (x402=1) or the switch QUOTE_BODY=v1 is set; see readable402. */
export const wantsV1Body = (param: string | undefined, env: { QUOTE_BODY?: string }) => param?.trim() === "1" || env.QUOTE_BODY === "v1";

export async function readable402(res: Response, origin: string, freeCalls = false, v1Accepts: RequirementsV1[] = [], page?: { endpoint: Endpoint; url: string }, cardReady = false, freeExhausted = false, mppReady = false): Promise<Response> {
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
  // 19 Nov 2026: a caller that just used its free calls is the highest-intent quote we get (about 28,600 such calls in
  // 30 days). It used to receive the same generic paragraph as a first-time crawler. Give it one explicit next step:
  // buy the smallest pack, then repeat the SAME URL with the key. No new URL — reuse the card pack already offered.
  const [starter] = WEB_PACKS;
  const resume = freeExhausted && starter
    ? `You've used your ${FREE_HTTP_CALLS_PER_CALLER} free calls here. To continue: GET ${starter.url} ($${starter.usdCents / 100} for ${starter.credits.toLocaleString("en-US")} credits), then repeat this exact URL with &api_key=adt_… — the same key works on every tool. `
    : "";
  // MPP is offered in the body for buying a pack (cardHint); say how to settle THIS call too. Docs already teach it.
  // The WWW-Authenticate header is appended by the MPP middleware AFTER this function, so read it from the flag
  // the caller computed from tempoEnabled/evmEnabled rather than from the response (19 Nov: header check never fired).
  const mppCall = mppReady
    ? "MPP clients: this 402 also carries WWW-Authenticate: Payment; answer it in Authorization: Payment to settle this call, then repeat the request. "
    : "";
  const hint = `${resume}${freeCalls ? `Try it free: add trial=1 to this request (${FREE_HTTP_CALLS_PER_CALLER} free successful calls per caller). ` : ""}Paid x402 tool. x402 v2 clients: terms in the PAYMENT-REQUIRED header, pay with PAYMENT-SIGNATURE (for example @x402/fetch or AgentCash). ${v1Accepts.length ? "x402 v1 clients: terms in this body, pay with X-PAYMENT." : "The same terms are in this body. x402 v1 clients: add x402=1 to this request for v1 terms, then pay with X-PAYMENT."}${mppCall} ${cardHint(origin, cardReady, page?.endpoint.price)} Free example output: add sample=1. Free docs: ${origin}/llms.txt`;
  // The body mirrors the v2 header (1.117.0, 10 Nov 2026). Until then it was a v1 PaymentRequired on every tool, and
  // vAPI Call's listing check read that as "header and body declare different x402 versions" and found no input
  // description, because the Bazaar extension only exists in v2 terms; seven of nine sellers its monitor calls healthy
  // serve v2 in both places. A v1 client still gets v1 terms by adding x402=1 (the caller passes v1Accepts only then),
  // and a request that carries X-PAYMENT is answered by lib/x402-v1.ts as before.
  // Three related tools, so an agent that cannot use this one (price, inputs, chain) sees the next thing to try.
  const related = page ? relatedList(origin, page.endpoint.path) : undefined;
  // A wallet that will call more than once can prepay and stop paying per call (lib/usdc-credits.ts).
  const prepay = page ? usdcPrepayLine(origin) : undefined;
  // Where a prepaid key pays less than the public price, the refusal says so (lib/key-prices.ts).
  const withKey = page ? keyPriceLine(page.endpoint.path, page.endpoint.price, origin) : undefined;
  // What a newcomer can do right now comes first (16 Nov 2026): a model reads a JSON body top down, and the payment terms
  // are long. Key order only; the x402 fields below keep their names and values, and the header is untouched.
  const first = {
    hint,
    ...(freeExhausted && starter ? { resume: { usedFreeCalls: FREE_HTTP_CALLS_PER_CALLER, buy: starter.url, key: "api_key=adt_…", retry: page?.url ?? null } } : {}),
    freeTrial: freeCalls && page ? freeTrialOffer(page) : undefined,
    payByCard: payByCard(origin, cardReady),
    prepay,
  };
  const body = v1Accepts.length ? { ...first, ...v1Body(v1Accepts, challenge.error ?? "Payment required"), resource: challenge.resource, related, withKey } : { ...first, ...challenge, related, withKey };
  const headers = new Headers(res.headers);
  headers.delete("content-length");
  return new Response(JSON.stringify(body), { status: 402, headers });
}
