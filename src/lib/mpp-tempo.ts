// Per-call MPP (Machine Payments Protocol) on the tools, next to x402: method "tempo", intent "charge", USDC.e on
// Tempo. Agents that hold a Tempo wallet (mppx clients, the Tempo CLI, MPP credits) pay one call without x402,
// and MPP directories such as MPPScan list the tools because each answers an MPP challenge.
// Off until TEMPO_PAY_TO is set: no challenge, no OpenAPI entry, and Payment credentials are refused unread.
//
// The buyer signs a Tempo transaction (pull mode) that we broadcast only after the tool succeeded, like the x402
// paths: a failed call is never charged. Push mode (the buyer broadcasts and sends the hash) is not offered
// because it pays before the tool runs. The buyer's transaction pays its own network fee in a stablecoin, so this
// server holds no key and spends nothing. Research and the receiving-address decision: docs/mpp-per-call.md.
import type { Context, Next } from "hono";
import { BaseError, HttpRequestError, LimitExceededRpcError, TimeoutError, createClient, fallback, http, keccak256, type Transport } from "viem";
import { tempo as tempoMainnet, tempoModerato } from "viem/tempo/chains";
import { Mppx, tempo } from "mppx/server";
import { Challenge, Credential, Errors, Receipt } from "mppx";
import type { Endpoint } from "../endpoints";
import { isAddress, type Env } from "./env";
import { TEMPO_STABLECOIN } from "./networks";
import { usdMicros } from "./revenue";
import { activeTrace, markStage } from "./funnel";
import { replayStore } from "./mpp-store";
import type { SettlementRecord } from "./settlement-ledger";

type C = Context<{ Bindings: Env }>;

/** Chain, CAIP-2 id and stablecoin for the configured Tempo network (mainnet unless TEMPO_NETWORK=testnet). */
export function tempoTerms(env: Pick<Env, "TEMPO_NETWORK">) {
  const chain = env.TEMPO_NETWORK === "testnet" ? tempoModerato : tempoMainnet;
  const network = `eip155:${chain.id}`;
  return { chain, network, currency: TEMPO_STABLECOIN[network] as `0x${string}` };
}

/** The receiving address, or undefined while per-call MPP is off. */
const payTo = (env: Pick<Env, "TEMPO_PAY_TO">) => {
  const address = env.TEMPO_PAY_TO?.trim();
  return address && isAddress(address) && !/^0x0{40}$/.test(address) ? address.toLowerCase() as `0x${string}` : undefined;
};

/** On only with a valid TEMPO_PAY_TO and a secret to sign challenges with. */
export const tempoEnabled = (env: Env) => Boolean(payTo(env) && (env.MPP_SECRET_KEY || env.CDP_API_KEY_SECRET));

/** The x-payment-info protocol entry MPP directories read, next to { x402: {} }. */
export const tempoProtocol = (env: Env) => ({ mpp: { method: "tempo", intent: "charge", currency: tempoTerms(env).currency } });

/** HMAC key for challenge binding, derived one-way from MPP_SECRET_KEY (else the CDP secret): always 32 bytes. */
async function challengeSecret(env: Env) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.MPP_SECRET_KEY || env.CDP_API_KEY_SECRET!), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode("mpp-tempo-challenge-signing")));
  return [...mac].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Keyless public RPCs tried after the default one, by chain id. `send` lists only those that implement Tempo's
 * eth_sendRawTransactionSync. Measured from the Worker on 22 Oct 2026: rpc.tempo.xyz answered every read and send;
 * Moderato's RPC refused most reads and every send ("rate limited"); dRPC answers reads but has no sync send;
 * 1rpc.io refuses Cloudflare traffic ("usage limit"), so it is not listed.
 */
const TEMPO_FALLBACK_RPCS: Record<number, { read: string[]; send: string[] }> = {
  [tempoMainnet.id]: { read: ["https://tempo-mainnet.drpc.org"], send: [] },
  [tempoModerato.id]: { read: ["https://rpc.testnet.tempo.xyz", "https://tempo-moderato-testnet.drpc.org"], send: ["https://rpc.testnet.tempo.xyz"] },
};
const SEND_METHODS = new Set(["eth_sendRawTransaction", "eth_sendRawTransactionSync"]);

/**
 * Tempo's public RPC rate-limits Cloudflare's shared egress ("rate limited, try again in 11ms" on every verification
 * from the Worker, 22 Oct), so reads move on to the next public RPC, and the broadcast (a signed transaction, so a
 * repeat cannot pay twice) retries quickly on the RPCs that can send it.
 */
export function tempoTransport(primary: string, chainId: number): Transport {
  const more = TEMPO_FALLBACK_RPCS[chainId] ?? { read: [], send: [] };
  const reads = fallback([primary, ...more.read].map((url) => http(url, { retryCount: 1, retryDelay: 40 })));
  const sends = fallback([primary, ...more.send].map((url) => http(url, { retryCount: 8, retryDelay: 15 })));
  return ((params: Parameters<Transport>[0]) => {
    const read = reads(params);
    const send = sends(params);
    return { ...read, request: ((args: { method: string }, options?: unknown) => (SEND_METHODS.has(args.method) ? send : read).request(args as never, options as never)) as typeof read.request };
  }) as Transport;
}

/** One server per isolate and realm; challenges are stateless (HMAC), replay state lives in the Durable Object. */
const servers = new Map<string, ReturnType<typeof createServer>>();
async function createServer(env: Env, realm: string) {
  const { chain, currency } = tempoTerms(env);
  const rpcUrl = env.TEMPO_RPC_URL || chain.rpcUrls.default.http[0];
  return Mppx.create({
    methods: [tempo.charge({
      currency,
      decimals: 6,
      recipient: payTo(env)!,
      chainId: chain.id,
      supportedModes: ["pull"],
      store: replayStore(env),
      getClient: () => createClient({ chain, transport: tempoTransport(rpcUrl, chain.id) }),
    })],
    secretKey: await challengeSecret(env),
    realm,
  });
}
function server(env: Env, url: string) {
  const realm = new URL(url).host;
  const key = `${realm}|${payTo(env)}|${tempoTerms(env).network}|${env.TEMPO_RPC_URL ?? ""}`;
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
  // USDC.e and pathUSD have 6 decimals, so micro-dollars are atomic units; mppx takes the decimal amount.
  return { amount: (micros / 1_000_000).toFixed(6).replace(/0+$/, "").replace(/\.$/, "") };
}

/** The WWW-Authenticate value offering this call over MPP (tempo/charge), scoped to the tool's path. */
export async function tempoChallenge(c: C, endpoint: Endpoint): Promise<string> {
  const mppx = await server(c.env, c.req.url);
  return Challenge.serialize(await mppx.challenge.tempo.charge({ ...routeRequest(endpoint), description: endpoint.summary, scope: endpoint.path }));
}

/** A 402 that offers a fresh challenge and says why the credential was not accepted. Never charged. */
async function refusal(c: C, endpoint: Endpoint, error: string) {
  const challenge = await tempoChallenge(c, endpoint).catch(() => undefined);
  return c.json({ error, method: "tempo", intent: "charge", hint: "Pay with a fresh Tempo charge credential (mppx client, pull mode), or with x402 (PAYMENT-REQUIRED header)." }, 402,
    challenge ? { "WWW-Authenticate": challenge, "Cache-Control": "no-store" } : { "Cache-Control": "no-store" });
}

/**
 * Handles a tool call that carries `Authorization: Payment …` (reached only while tempoEnabled): validate the signed
 * Tempo transfer (challenge HMAC, route, amount, recipient, memo, simulation), run the tool, broadcast only on
 * success, answer with Payment-Receipt and record the receipt in the settlement ledger.
 */
export async function payTempo(c: C, endpoint: Endpoint, header: string, next: Next) {
  markStage("attempt");
  const credential = Credential.extractPaymentScheme(header);
  const refuse = async (stage: "refused_format" | "refused_amount", error: string) => {
    markStage(stage);
    console.warn(`mpp tempo ${stage} ${endpoint.path}: ${error.slice(0, 160)}`);
    return refusal(c, endpoint, error);
  };
  if (!credential) return refuse("refused_format", "Authorization carries no Payment credential");
  const options = { request: routeRequest(endpoint), scope: endpoint.path };
  let mppx, validation;
  try {
    mppx = await server(c.env, c.req.url);
    validation = await mppx.validateCredential(credential, options);
  } catch (e) {
    const message = String((e as Error)?.message ?? e).split("\n")[0].slice(0, 200);
    if (!isPaymentAnswer(e)) {
      markStage("facilitator_unavailable"); // the Tempo RPC, our facilitator for this method
      console.error(`mpp tempo rpc_unavailable ${endpoint.path}: ${errorChain(e).slice(0, 600)}`);
      return refusal(c, endpoint, "payment verification is temporarily unavailable; you were not charged");
    }
    if (/challenge|scope|expired|malformed|payload|mode|not supported|source/i.test(message)) return refuse("refused_format", `payment invalid: ${message}`);
    if (/amount|recipient|currency|no matching payment|memo/i.test(message)) return refuse("refused_amount", `payment invalid: ${message}`);
    markStage("verification_failed");
    console.warn(`mpp tempo verification_failed ${endpoint.path}: ${errorChain(e).slice(0, 600)}`);
    return refusal(c, endpoint, `payment invalid: ${message}`);
  }
  // A credential already settled once is refused before the tool runs (broadcast would refuse it after). If the
  // replay store cannot answer (Durable Object quota), broadcast could not claim the payment either: stop here,
  // before any work is done, uncharged.
  const settled = await alreadySettled(c.env, credential);
  if (settled === null) {
    markStage("facilitator_unavailable");
    return c.json({ error: "the payment could not be recorded right now; nothing was charged, try again later" }, 503, { "Retry-After": "60" });
  }
  if (settled) {
    markStage("verification_failed");
    return refusal(c, endpoint, "payment invalid: this payment credential was already used; request a new challenge");
  }
  markStage("verified");
  await next();
  if (c.res.status >= 400) return; // failed calls are never broadcast, so never charged
  let receipt;
  try {
    receipt = await mppx.broadcastCredential(credential, options);
  } catch (e) {
    markStage("settlement_failed");
    const message = String((e as Error)?.message ?? "broadcast failed").slice(0, 200);
    console.warn(`mpp tempo settlement_failed ${endpoint.path}: ${message.slice(0, 160)}`);
    c.res = await refusal(c, endpoint, `settlement failed: ${message}; you were not charged`);
    return;
  }
  markStage("settled");
  c.res.headers.set("Payment-Receipt", Receipt.serialize(receipt));
  c.res.headers.set("Cache-Control", "no-store");
  const { network, currency } = tempoTerms(c.env);
  const payer = String(validation.payer ?? "").toLowerCase();
  c.executionCtx.waitUntil(recordTempo(c.env, endpoint.path, network, currency, payTo(c.env)!, payer, receipt.reference, String(BigInt(usdMicros(endpoint.price)!))));
}

/** True when mppx's replay marker for this signed transaction (keyed by its hash) is still live; null when the store is down. */
export async function alreadySettled(env: Env, credential: string): Promise<boolean | null> {
  let signed: `0x${string}` | undefined;
  try {
    signed = (Credential.deserialize(credential).payload as { signature?: `0x${string}` }).signature;
  } catch {
    return false; // unreadable here; broadcastCredential still enforces replay protection
  }
  if (!signed || !env.METRICS) return false;
  try {
    const marker = await env.METRICS.get(env.METRICS.idFromName("global")).mppGet(`mppx:charge:${keccak256(signed).toLowerCase()}`) as { expires?: number } | null;
    return Boolean(marker && (marker.expires ?? Infinity) > Date.now());
  } catch (e) {
    console.error("mpp tempo: replay store unavailable", e);
    return null;
  }
}

/**
 * True when the error is an answer about the credential (mppx PaymentErrors, a reverted simulation such as an
 * empty balance); false when the Tempo RPC could not be reached, so the buyer is told to retry.
 */
function isPaymentAnswer(e: unknown): boolean {
  if (rpcRefused(e)) return false;
  if (e instanceof Errors.PaymentError) return !(e instanceof Errors.InternalPaymentError) || isPaymentAnswer((e as Error).cause);
  if (e instanceof BaseError) return !e.walk((inner) => inner instanceof HttpRequestError || inner instanceof TimeoutError);
  return false;
}

/**
 * The RPC refused our request rather than judging the payment: a rate or size limit (-32005, -32029, HTTP 429).
 * On 22 Oct Tempo's public testnet RPC answered every verification from the Worker with "Request exceeds defined
 * limit" while the same check passed from a PC, and buyers were told their payment was invalid.
 */
export function rpcRefused(e: unknown): boolean {
  for (let inner = e as { cause?: unknown; code?: unknown; status?: unknown; message?: unknown } | undefined, depth = 0; inner && depth < 8; inner = inner.cause as typeof inner, depth++) {
    if (inner instanceof LimitExceededRpcError || inner.code === -32005 || inner.code === -32029 || inner.status === 429) return true;
    if (typeof inner.message === "string" && /exceeds defined limit|rate limit|too many requests/i.test(inner.message)) return true;
  }
  return false;
}

/** The error and its causes on one line (name, RPC code, message), for wrangler tail. */
function errorChain(e: unknown): string {
  const parts: string[] = [];
  for (let inner = e as { cause?: unknown; name?: unknown; code?: unknown; shortMessage?: unknown; message?: unknown } | undefined, depth = 0; inner && depth < 6; inner = inner.cause as typeof inner, depth++) {
    parts.push(`${String(inner.name ?? "Error")}${inner.code !== undefined ? `(${String(inner.code)})` : ""}: ${String(inner.shortMessage ?? inner.message ?? inner).split("\n")[0].slice(0, 120)}`);
  }
  return parts.join(" <- ");
}

async function recordTempo(env: Env, path: string, network: string, asset: string, recipient: string, payer: string, transaction: string, amountAtomic: string) {
  if (!env.METRICS) return;
  try {
    // A Tempo transaction is mined at most once, so its hash identifies the payment (as a Solana signature does).
    const tx = transaction.toLowerCase();
    const bytes = new TextEncoder().encode(`${network}:${asset}:${payer}:${tx}`);
    const id = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");
    const record: SettlementRecord = {
      id, requestId: activeTrace()?.requestId, transaction: tx, network, asset, recipient, payer,
      authorizationNonce: tx, amountAtomic, amountEvidence: "accepted-requirements",
      path, transport: "http", recordedAt: new Date().toISOString(), selfPayment: false, reconciliation: "pending",
    };
    await env.METRICS.get(env.METRICS.idFromName("global")).recordSettlement(record);
  } catch {
    console.error("settlement-ledger: tempo receipt write failed; operator reconciliation required");
  }
}
