// x402 version 1 alongside version 2. Older buyer clients (x402-fetch, x402-axios, v1 Python and Go
// clients, early agent kits) read the price from the 402 body in the v1 shape and pay with an X-PAYMENT
// header, which the v2 server library does not read. Official v2 clients read the PAYMENT-REQUIRED header
// first and use the body only when that header is absent, so a v1 body serves both generations.
// Verification and settlement go through the same Coinbase facilitator, with the v1 request format.
import type { Context, Next } from "hono";
import { decodePaymentSignatureHeader, encodePaymentResponseHeader } from "@x402/core/http";
import type { Endpoint } from "../endpoints";
import type { Env } from "./env";
import { buildFacilitator } from "./facilitator";
import { paymentOptions, USDC_BY_NETWORK } from "./networks";
import { usdMicros } from "./revenue";
import { markStage, activeTrace } from "./funnel";
import type { SettlementRecord } from "./settlement-ledger";

type C = Context<{ Bindings: Env }>;

/** v1 used network names, not CAIP-2 ids. Only networks that existed in v1 and that we accept. */
export const V1_NETWORK: Record<string, string> = { "eip155:8453": "base", "eip155:137": "polygon", "eip155:84532": "base-sepolia" };
const CAIP_OF_V1 = Object.fromEntries(Object.entries(V1_NETWORK).map(([caip, v1]) => [v1, caip]));

export interface RequirementsV1 {
  scheme: "exact"; network: string; maxAmountRequired: string; resource: string; description: string; mimeType: string;
  outputSchema: Record<string, unknown>; payTo: string; maxTimeoutSeconds: number; asset: string; extra: Record<string, unknown>;
}

/** The v1 payment terms for one tool call, one entry per v1 network we accept. */
export function v1Requirements(env: Env, endpoint: Endpoint, resourceUrl: string): RequirementsV1[] {
  const atomic = usdMicros(endpoint.price);
  if (atomic === null) return [];
  return paymentOptions(env).filter(({ network }) => V1_NETWORK[network]).map(({ network, payTo }) => ({
    scheme: "exact",
    network: V1_NETWORK[network],
    maxAmountRequired: String(atomic), // USDC has 6 decimals, so micro-dollars are atomic units
    resource: resourceUrl,
    description: endpoint.description,
    mimeType: "application/json",
    // The v1 Bazaar lists a tool from this block at its first settlement, inputs included.
    outputSchema: {
      input: {
        type: "http", method: "GET", discoverable: true,
        queryParams: Object.fromEntries(Object.entries(endpoint.params).map(([name, p]) => [name, {
          type: p.type, required: Boolean(p.required), description: p.description, ...(p.enum ? { enum: [...p.enum] } : {}),
        }])),
      },
      output: endpoint.outputExample,
    },
    payTo,
    maxTimeoutSeconds: 300,
    asset: USDC_BY_NETWORK[network as keyof typeof USDC_BY_NETWORK],
    // EIP-712 domain of the USDC contract: "USD Coin" on Base and Polygon mainnet, "USDC" on Base Sepolia.
    extra: { name: network === "eip155:84532" ? "USDC" : "USD Coin", version: "2" },
  }));
}

export const v1Body = (accepts: RequirementsV1[], error: string, hint?: string) => ({ x402Version: 1 as const, error, accepts, ...(hint ? { hint } : {}) });

let facilitator: ReturnType<typeof buildFacilitator> | undefined;

interface PayloadV1 { x402Version: 1; scheme: string; network: string; payload: { signature?: string; authorization?: { from?: string; to?: string; value?: string; nonce?: string } } }

/**
 * Handles a request that carries an x402 v1 X-PAYMENT header: verify, run the tool, settle only on
 * success, answer with X-PAYMENT-RESPONSE and record the receipt. Failures answer 402 in v1 shape.
 */
export async function payV1(c: C, endpoint: Endpoint, header: string, next: Next) {
  markStage("attempt");
  const url = new URL(c.req.url);
  const accepts = v1Requirements(c.env, endpoint, url.href);
  // Every refusal is logged (reason only: no signature, payload or caller address) and marked in the funnel,
  // so /revenue shows why payment attempts die instead of only that they did.
  const refuse = (stage: "refused_format" | "refused_network" | "refused_amount", error: string) => {
    markStage(stage);
    console.warn(`x402 v1 ${stage} ${endpoint.path}: ${error.slice(0, 160)}`);
    return c.json(v1Body(accepts, error), 402);
  };
  let payment: PayloadV1;
  try { payment = decodePaymentSignatureHeader(header) as unknown as PayloadV1; } catch { return refuse("refused_format", "X-PAYMENT is not valid base64 JSON"); }
  // v1 clients vary: the version may arrive as a string, the network as a CAIP-2 id, the value as a number.
  // Normalize what the facilitator is strict about instead of refusing a buyer over a representation.
  if (Number(payment?.x402Version) !== 1 || payment?.scheme !== "exact") return refuse("refused_format", `only x402 version 1 'exact' payments are accepted in X-PAYMENT (got version ${String(payment?.x402Version)}, scheme ${String(payment?.scheme)}); version 2 clients use PAYMENT-SIGNATURE`);
  const network = v1NetworkName(payment.network);
  const requirements = accepts.find((r) => r.network === network);
  if (!requirements) return refuse("refused_network", `network ${String(payment.network)} is not accepted; use one of: ${accepts.map((r) => r.network).join(", ")}`);
  const auth = payment.payload?.authorization;
  const value = atomicValue(auth?.value);
  // Like the reference facilitator, at least the quoted amount; the authorization's own value is what settles.
  if (!auth || auth.to?.toLowerCase() !== requirements.payTo.toLowerCase() || value === null || value < BigInt(requirements.maxAmountRequired)) {
    return refuse("refused_amount", `the authorization must pay at least ${requirements.maxAmountRequired} atomic USDC to ${requirements.payTo} (got ${String(auth?.value)} to ${String(auth?.to)})`);
  }
  payment = { ...payment, x402Version: 1, network, payload: { ...payment.payload, authorization: { ...auth, value: value.toString() } } };
  facilitator ??= buildFacilitator(c.env);
  const fac = facilitator as unknown as {
    verify(p: unknown, r: unknown): Promise<{ isValid: boolean; invalidReason?: string; payer?: string }>;
    settle(p: unknown, r: unknown): Promise<{ success: boolean; transaction?: string; network?: string; payer?: string; errorReason?: string }>;
  };
  let verified;
  try {
    verified = await fac.verify(payment, requirements);
  } catch (e) {
    // The client library throws VerifyError when the facilitator rejects the payment itself (bad
    // signature, insufficient funds, expired authorization): that is an answer, not an outage.
    const message = String((e as Error)?.message ?? e);
    if ((e as Error)?.name === "VerifyError" || /^invalid_|insufficient_funds/.test(message)) {
      markStage("verification_failed");
      console.warn(`x402 v1 verification_failed ${endpoint.path} on ${payment.network}: ${message.slice(0, 160)}`);
      return c.json(v1Body(accepts, `payment invalid: ${message.slice(0, 200)}`), 402);
    }
    markStage("facilitator_unavailable");
    console.error(`x402 v1 facilitator_unavailable ${endpoint.path}: ${message.slice(0, 160)}`);
    return c.json(v1Body(accepts, "payment verification is temporarily unavailable; you were not charged"), 402);
  }
  if (!verified.isValid) {
    markStage("verification_failed");
    console.warn(`x402 v1 verification_failed ${endpoint.path} on ${payment.network}: ${verified.invalidReason ?? "rejected by the facilitator"}`);
    return c.json(v1Body(accepts, `payment invalid: ${verified.invalidReason ?? "rejected by the facilitator"}`), 402);
  }
  markStage("verified");
  await next();
  if (c.res.status >= 400) return; // failed calls are never settled, so never charged
  let settled;
  try { settled = await fac.settle(payment, requirements); } catch (e) { console.error("x402 v1 settle failed", e); settled = { success: false, errorReason: String((e as Error)?.message ?? "settlement unavailable").slice(0, 200) }; }
  if (!settled.success || !settled.transaction) {
    markStage("settlement_failed");
    console.warn(`x402 v1 settlement_failed ${endpoint.path} on ${payment.network}: ${settled.errorReason ?? "unknown"}`);
    c.res = c.json(v1Body(accepts, `settlement failed: ${settled.errorReason ?? "unknown"}; you were not charged`), 402);
    return;
  }
  markStage("settled");
  const response = { success: true, transaction: settled.transaction, network, payer: settled.payer ?? auth.from ?? "" };
  c.res.headers.set("X-PAYMENT-RESPONSE", encodePaymentResponseHeader(response as never));
  c.res.headers.set("Access-Control-Expose-Headers", "X-PAYMENT-RESPONSE, X-Request-ID");
  c.executionCtx.waitUntil(recordV1(c.env, endpoint.path, CAIP_OF_V1[network], requirements, settled.transaction, (settled.payer ?? auth.from ?? "").toLowerCase(), auth.nonce ?? "", value.toString()));
}

/** The v1 network name for what a client sent: "base", or its CAIP-2 id "eip155:8453"; unknown names pass through. */
function v1NetworkName(sent: unknown): string {
  const name = String(sent ?? "").trim().toLowerCase();
  return CAIP_OF_V1[name] ? name : V1_NETWORK[name] ?? name;
}

/** An authorization value as sent (decimal string or number) in atomic units, or null when it is not a whole number. */
function atomicValue(sent: unknown): bigint | null {
  if (typeof sent === "number") return Number.isSafeInteger(sent) && sent >= 0 ? BigInt(sent) : null;
  if (typeof sent === "string" && /^\d+$/.test(sent.trim())) return BigInt(sent.trim());
  return null;
}

async function recordV1(env: Env, path: string, network: string, req: RequirementsV1, transaction: string, payer: string, nonce: string, amountAtomic: string) {
  if (!env.METRICS) return;
  try {
    const bytes = new TextEncoder().encode(`${network}:${req.asset}:${payer}:${nonce}`);
    const id = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");
    const record: SettlementRecord = {
      id, requestId: activeTrace()?.requestId, transaction, network, asset: req.asset, recipient: req.payTo.toLowerCase(), payer,
      authorizationNonce: nonce, amountAtomic, amountEvidence: "accepted-requirements",
      path, transport: "http", recordedAt: new Date().toISOString(), selfPayment: false, reconciliation: "pending",
    };
    await env.METRICS.get(env.METRICS.idFromName("global")).recordSettlement(record);
  } catch {
    console.error("settlement-ledger: v1 receipt write failed; operator reconciliation required");
  }
}
