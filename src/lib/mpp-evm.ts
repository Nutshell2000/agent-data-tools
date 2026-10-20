// Per-call MPP (Machine Payments Protocol) on the tools with USDC on the service's own x402 network: method "evm",
// intent "charge", recipient PAY_TO, settled through the same facilitator as x402. The buyer signs an EIP-3009
// transfer authorization (the x402 "exact" primitive) and sends it as `Authorization: Payment …`; the tool runs
// first, and the authorization is settled only when it succeeded, so a failed call is never charged.
//
// Why: MPP directories (MPPScan) list a tool only if it answers an MPP challenge, and they list without a first
// settled payment, unlike the Coinbase Bazaar. This method needs no new address, no deposit and no secret beyond
// what production already has, so it is on by default; MPP_EVM=off switches it off. The Tempo method
// (lib/mpp-tempo.ts) can be offered next to it once Peter chooses a Tempo address.
import type { Context, Next } from "hono";
import { Mppx, evm } from "mppx/server";
import { Challenge, Credential, Errors, Receipt } from "mppx";
import { ENDPOINTS, type Endpoint } from "../endpoints";
import { isAddress, type Env } from "./env";
import { buildFacilitator } from "./facilitator";
import { bazaarExtensionFor } from "./bazaar-extension";
import { USDC_BY_NETWORK } from "./networks";
import { usdMicros } from "./revenue";
import { activeTrace, markStage } from "./funnel";
import type { SettlementRecord } from "./settlement-ledger";

type C = Context<{ Bindings: Env }>;
type Address = `0x${string}`;

/** EIP-712 domain of the USDC contract per network the facilitator settles (must match the token exactly). */
const USDC_DOMAIN: Readonly<Record<string, { name: string; version: string }>> = Object.freeze({
  "eip155:8453": { name: "USD Coin", version: "2" },
  "eip155:84532": { name: "USDC", version: "2" },
});
const MAX_TIMEOUT_SECONDS = 300;

/** Network, chain id, USDC address and EIP-712 domain for the service's primary x402 network. */
export function evmTerms(env: Pick<Env, "NETWORK">) {
  const network = env.NETWORK;
  const currency = USDC_BY_NETWORK[network] as Address | undefined;
  return { network, chainId: Number(network.split(":")[1]), currency, domain: USDC_DOMAIN[network] };
}

const payTo = (env: Pick<Env, "PAY_TO">): Address | undefined => {
  const address = env.PAY_TO?.trim();
  return address && isAddress(address) ? (address.toLowerCase() as Address) : undefined;
};

/** On by default; needs a recipient, a network whose USDC domain is known, and a secret to sign challenges. */
export function evmEnabled(env: Env): boolean {
  if (env.MPP_EVM === "off") return false;
  const { currency, domain } = evmTerms(env);
  return Boolean(payTo(env) && currency && domain && (env.MPP_SECRET_KEY || env.CDP_API_KEY_SECRET));
}

/** The x-payment-info protocol entry MPP directories read, next to { x402: {} }. */
export const evmProtocol = (env: Env) => ({ mpp: { method: "evm", intent: "charge", currency: evmTerms(env).currency! } });

/** HMAC key for challenge binding, derived one-way from MPP_SECRET_KEY (else the CDP secret): always 32 bytes. */
async function challengeSecret(env: Env) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.MPP_SECRET_KEY || env.CDP_API_KEY_SECRET!), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode("mpp-evm-challenge-signing")));
  return [...mac].map((b) => b.toString(16).padStart(2, "0")).join("");
}

interface Authorization { from: Address; to: Address; value: string; validAfter: string; validBefore: string; nonce: Address; signature: Address }

/** x402 v2 requirements and payload for the facilitator, exactly as the x402 paywall would send them. */
function facilitatorPayment(env: Env, authorization: Authorization, amountAtomic: string) {
  const { network, currency, domain } = evmTerms(env);
  const requirements = { scheme: "exact", network, amount: amountAtomic, asset: currency!, payTo: payTo(env)!, maxTimeoutSeconds: MAX_TIMEOUT_SECONDS, extra: { name: domain!.name, version: domain!.version } };
  const { signature, ...auth } = authorization;
  const payload = { x402Version: 2, accepted: requirements, payload: { signature, authorization: auth } };
  return { requirements, payload };
}

/** The endpoint this request pays for, from the request trace. */
const currentEndpoint = (): Endpoint | undefined => ENDPOINTS.find((e) => e.path === activeTrace()?.path);

/** One server per isolate, realm and terms; challenges are stateless (HMAC), so no store is needed. */
const servers = new Map<string, ReturnType<typeof createServer>>();
async function createServer(env: Env, realm: string) {
  const { chainId, currency, domain } = evmTerms(env);
  const recipient = payTo(env)!;
  return Mppx.create({
    methods: [evm.charge({
      currency: currency!,
      chainId,
      decimals: 6,
      authorization: domain!,
      recipient,
      // Settlement through our facilitator (CDP in production, the keyless testnet one on staging). mppx calls
      // this from broadcastCredential(), which payEvm() runs only after the tool succeeded.
      settle: async ({ payload }) => {
        const authorization = payload as unknown as Authorization;
        const { requirements, payload: paymentPayload } = facilitatorPayment(env, authorization, authorization.value);
        // The Bazaar indexes a resource from its first settlement, given the resource and its discovery extension.
        const endpoint = currentEndpoint();
        const trace = activeTrace();
        const enriched = endpoint && trace ? { ...paymentPayload, resource: { url: new URL(`https://${realm}${endpoint.path}`).href }, extensions: bazaarExtensionFor(endpoint) } : paymentPayload;
        const settled = await buildFacilitator(env).settle(enriched as never, requirements as never);
        if (!settled.success || !settled.transaction) throw new Errors.VerificationFailedError({ reason: settled.errorMessage ?? settled.errorReason ?? "settlement failed" });
        return { reference: settled.transaction };
      },
    })],
    secretKey: await challengeSecret(env),
    realm,
  });
}
function server(env: Env, url: string) {
  const realm = new URL(url).host;
  const key = `${realm}|${payTo(env)}|${evmTerms(env).network}`;
  const cached = servers.get(key);
  if (cached) return cached;
  const pending = createServer(env, realm);
  pending.catch(() => servers.delete(key));
  servers.set(key, pending);
  return pending;
}

/** Route input bound into the challenge; the same amount is required again when the credential comes back. */
function routeRequest(endpoint: Endpoint) {
  const micros = usdMicros(endpoint.price);
  if (micros === null) throw new Error(`price ${endpoint.price} is not a fixed USD amount`);
  return { amount: (micros / 1_000_000).toFixed(6).replace(/0+$/, "").replace(/\.$/, "") }; // USDC has 6 decimals
}

/** The WWW-Authenticate value offering this call over MPP (evm/charge), scoped to the tool's path. */
export async function evmChallenge(c: C, endpoint: Endpoint): Promise<string> {
  const mppx = await server(c.env, c.req.url);
  return Challenge.serialize(await mppx.challenge.evm.charge({ ...routeRequest(endpoint), description: endpoint.summary, scope: endpoint.path }));
}

/** A 402 that offers a fresh challenge and says why the credential was not accepted. Never charged. */
async function refusal(c: C, endpoint: Endpoint, error: string) {
  const challenge = await evmChallenge(c, endpoint).catch(() => undefined);
  return c.json({ error, method: "evm", intent: "charge", hint: "Pay with a fresh evm charge credential (mppx: charge({ account, currencies: [assets.base.USDC], networks: [8453] }) from mppx/evm/client, an EIP-3009 USDC authorization), or with x402 (PAYMENT-REQUIRED header)." }, 402,
    challenge ? { "WWW-Authenticate": challenge, "Cache-Control": "no-store" } : { "Cache-Control": "no-store" });
}

/** The method named in a Payment credential, or undefined when it cannot be read. */
export function credentialMethod(header: string): string | undefined {
  try {
    const credential = Credential.extractPaymentScheme(header);
    return credential ? String(Credential.deserialize(credential).challenge?.method ?? "") : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Handles a tool call that carries an evm/charge Payment credential: check the challenge and the signed
 * authorization (HMAC, route, amount, recipient), ask the facilitator to verify it, refuse replays before the tool
 * runs, run the tool, settle only on success, answer with Payment-Receipt and record the receipt in the ledger.
 */
export async function payEvm(c: C, endpoint: Endpoint, header: string, next: Next) {
  markStage("attempt");
  const credential = Credential.extractPaymentScheme(header);
  const refuse = async (stage: "refused_format" | "refused_amount", error: string) => {
    markStage(stage);
    console.warn(`mpp evm ${stage} ${endpoint.path}: ${error.slice(0, 160)}`);
    return refusal(c, endpoint, error);
  };
  if (!credential) return refuse("refused_format", "Authorization carries no Payment credential");
  const options = { request: routeRequest(endpoint), scope: endpoint.path };
  let mppx;
  try {
    mppx = await server(c.env, c.req.url);
    await mppx.validateCredential(credential, options);
  } catch (e) {
    const message = String((e as Error)?.message ?? e).split("\n")[0].slice(0, 200);
    if (/challenge|scope|expired|malformed|payload|not supported|source|signature|signer/i.test(message)) return refuse("refused_format", `payment invalid: ${message}`);
    if (/amount|recipient|currency|no matching payment|chain/i.test(message)) return refuse("refused_amount", `payment invalid: ${message}`);
    markStage("verification_failed");
    console.warn(`mpp evm verification_failed ${endpoint.path}: ${message.slice(0, 160)}`);
    return refusal(c, endpoint, `payment invalid: ${message}`);
  }
  const authorization = Credential.deserialize(credential).payload as Authorization;
  const { network, currency } = evmTerms(c.env);
  const amountAtomic = String(usdMicros(endpoint.price));
  if (BigInt(authorization.value) < BigInt(amountAtomic)) return refuse("refused_amount", `the authorization must pay at least ${amountAtomic} atomic USDC`);
  // One authorization pays once, whichever path presents it: the claim is atomic across isolates, and the ledger
  // records x402 and MPP settlements under the same nonce-based identity.
  const expires = Math.min(Number(authorization.validBefore) * 1000, Date.now() + 2 * MAX_TIMEOUT_SECONDS * 1000);
  // If the claim cannot be recorded (storage limits), nothing has been charged yet: answer an uncharged 503.
  const claimed = c.env.METRICS
    ? await c.env.METRICS.get(c.env.METRICS.idFromName("global")).mppClaim(`evm:${network}:${authorization.nonce.toLowerCase()}`, expires)
      .catch((e: unknown) => { console.error("mpp evm claim failed", e); return null; })
    : true;
  if (claimed === null) {
    markStage("facilitator_unavailable");
    return c.json({ error: "the payment could not be recorded right now; nothing was charged, try again later" }, 503, { "Retry-After": "60" });
  }
  if (!claimed) {
    markStage("verification_failed");
    return refusal(c, endpoint, "payment invalid: this authorization was already used; request a new challenge");
  }
  // The facilitator checks the signature against the token domain and the payer's balance before any work is done.
  const { requirements, payload } = facilitatorPayment(c.env, authorization, authorization.value);
  try {
    const verified = await buildFacilitator(c.env).verify(payload as never, requirements as never);
    if (!verified.isValid) {
      markStage("verification_failed");
      console.warn(`mpp evm verification_failed ${endpoint.path}: ${verified.invalidReason ?? "rejected by the facilitator"}`);
      return refusal(c, endpoint, `payment invalid: ${verified.invalidReason ?? "rejected by the facilitator"}`);
    }
  } catch (e) {
    const message = String((e as Error)?.message ?? e);
    if ((e as Error)?.name === "VerifyError" || /^invalid_|insufficient_funds/.test(message)) {
      markStage("verification_failed");
      console.warn(`mpp evm verification_failed ${endpoint.path}: ${message.slice(0, 160)}`);
      return refusal(c, endpoint, `payment invalid: ${message.slice(0, 200)}`);
    }
    markStage("facilitator_unavailable");
    console.error(`mpp evm facilitator_unavailable ${endpoint.path}: ${message.slice(0, 160)}`);
    return refusal(c, endpoint, "payment verification is temporarily unavailable; you were not charged");
  }
  markStage("verified");
  await next();
  if (c.res.status >= 400) return; // failed calls are never settled, so never charged
  let receipt;
  try {
    receipt = await mppx.broadcastCredential(credential, options);
  } catch (e) {
    markStage("settlement_failed");
    const message = String((e as Error)?.message ?? "settlement failed").slice(0, 200);
    console.warn(`mpp evm settlement_failed ${endpoint.path}: ${message.slice(0, 160)}`);
    c.res = await refusal(c, endpoint, `settlement failed: ${message}; you were not charged`);
    return;
  }
  markStage("settled");
  c.res.headers.set("Payment-Receipt", Receipt.serialize(receipt));
  c.res.headers.set("Cache-Control", "no-store");
  c.executionCtx.waitUntil(recordEvm(c.env, endpoint.path, network, currency!, payTo(c.env)!, authorization.from.toLowerCase(), receipt.reference, authorization.nonce.toLowerCase(), authorization.value));
}

async function recordEvm(env: Env, path: string, network: string, asset: string, recipient: string, payer: string, transaction: string, nonce: string, amountAtomic: string) {
  if (!env.METRICS) return;
  try {
    // Same identity as an x402 receipt for this authorization, so the two paths can never double-record it.
    const bytes = new TextEncoder().encode(`${network}:${asset}:${payer}:${nonce}`);
    const id = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");
    const record: SettlementRecord = {
      id, requestId: activeTrace()?.requestId, transaction: transaction.toLowerCase(), network, asset, recipient, payer,
      authorizationNonce: nonce, amountAtomic, amountEvidence: "accepted-requirements",
      path, transport: "http", recordedAt: new Date().toISOString(), selfPayment: false, reconciliation: "pending",
    };
    await env.METRICS.get(env.METRICS.idFromName("global")).recordSettlement(record);
  } catch {
    console.error("settlement-ledger: mpp evm receipt write failed; operator reconciliation required");
  }
}
