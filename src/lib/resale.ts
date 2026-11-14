/**
 * Buying a call from another x402 seller and reselling its answer (14 Nov 2026, the owner chose "Resell via provider" for
 * LinkedIn and X data).
 *
 * The buyer's payment to us is verified before our handler runs and settled only after it succeeds, so a call that fails
 * upstream is uncharged for the buyer. The upstream is paid from a dedicated hot wallet whose private key is the Worker
 * secret RESALE_WALLET_KEY (a key made for this purpose only, holding a small float; never the owner's or the income
 * wallet's key). Guards, all of which refuse before any money moves:
 * - the upstream URL must be one of RESALE_UPSTREAMS, and its quote must name that upstream's pinned payTo, Base USDC, the
 *   exact scheme and an amount at or below the pinned ceiling (a seller that raises its price or swaps its wallet is refused);
 * - a per-UTC-day count of upstream purchases (RESALE_DAILY_CAP, default 150) bounds the float a day can spend;
 * - no secret, or no KV to count in, is an uncharged 503.
 * If the buyer's settlement fails after we paid upstream, we lose that one upstream price; the daily cap bounds it.
 *
 * Data protection: the answers can hold personal data about the people looked up. Every answer carries `terms`: the caller
 * needs its own lawful basis (GDPR art. 6), must not use it to harass or harm anyone, and we keep nothing (no cache, no log
 * of the inputs or the answer).
 */
import { wrapFetchWithPayment, x402Client } from "@x402/fetch";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";
import { HttpError, type Env } from "./env";

const BASE = "eip155:8453";
const BASE_USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";

export interface Upstream { url: string; payTo: string; maxAtomic: bigint; provider: string }
/** Pinned upstreams, checked 14 Nov 2026 from their live 402 quotes. */
export const RESALE_UPSTREAMS = {
  linkedinPerson: { url: "https://x402.apidirect.io/v1/linkedin/person", payTo: "0x5d07cc2a0fb4eb123a525ca0b51cf6fb485014fc", maxAtomic: 7_000n, provider: "API Direct (apidirect.io)" },
  linkedinCompanyPosts: { url: "https://x402.apidirect.io/v1/linkedin/company/posts", payTo: "0x5d07cc2a0fb4eb123a525ca0b51cf6fb485014fc", maxAtomic: 7_000n, provider: "API Direct (apidirect.io)" },
  xPosts: { url: "https://x402.apidirect.io/v1/twitter/posts", payTo: "0x5d07cc2a0fb4eb123a525ca0b51cf6fb485014fc", maxAtomic: 7_000n, provider: "API Direct (apidirect.io)" },
} as const satisfies Record<string, Upstream>;

export const RESALE_TERMS = "Third-party data about real people. You need your own lawful basis to process it (EU GDPR art. 6) and must not use it to harass, harm, profile for discrimination or contact people who object. This service keeps no copy of your inputs or the answer.";

type Requirement = { network?: string; scheme?: string; asset?: string; payTo?: string; amount?: string; maxAmountRequired?: string };

/** The requirements we would pay: Base USDC, exact scheme, the pinned payTo, at or below the pinned ceiling. Exported for the tests. */
export function acceptable(up: Upstream, requirements: Requirement[]): Requirement[] {
  return requirements.filter((r) => {
    const amount = r.amount ?? r.maxAmountRequired;
    if (r.network !== BASE || r.scheme !== "exact" || String(r.asset).toLowerCase() !== BASE_USDC) return false;
    if (String(r.payTo).toLowerCase() !== up.payTo) return false;
    try { return amount !== undefined && BigInt(amount) > 0n && BigInt(amount) <= up.maxAtomic; } catch { return false; }
  });
}

async function takePurchase(env: Env): Promise<void> {
  if (!env.TRIALS) throw new HttpError(503, "resale purchases cannot be counted right now; nothing was charged", "RESALE_UNAVAILABLE");
  const cap = Number(env.RESALE_DAILY_CAP) || 150;
  const key = `cap:resale:${new Date().toISOString().slice(0, 10)}`;
  const used = Number(await env.TRIALS.get(key)) || 0;
  if (used >= cap) throw new HttpError(503, "today's capacity for this provider is used up; try again after 00:00 UTC (nothing was charged)", "DAILY_CAPACITY");
  await env.TRIALS.put(key, String(used + 1), { expirationTtl: 172_800 });
}

/** One paid GET to a pinned upstream with the given query; the upstream's JSON answer. `fetcher` is for the tests. */
export async function buyUpstream(env: Env, up: Upstream, query: Record<string, string | number | undefined>, fetcher: typeof fetch = fetch): Promise<unknown> {
  const key = env.RESALE_WALLET_KEY?.trim();
  if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) throw new HttpError(503, "this provider is not switched on yet; nothing was charged", "RESALE_OFF");
  await takePurchase(env);
  const client = new x402Client();
  registerExactEvmScheme(client, { signer: privateKeyToAccount(key as `0x${string}`) });
  client.registerPolicy((_version, requirements) => acceptable(up, requirements as Requirement[]) as typeof requirements);
  const url = new URL(up.url);
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
  let res: Response;
  try {
    res = await wrapFetchWithPayment(fetcher, client)(url.toString(), { headers: { accept: "application/json" }, signal: AbortSignal.timeout(28_000) });
  } catch (e) {
    // The policy left nothing to pay (price raised, wallet changed) or the network failed before an answer.
    const why = e instanceof Error ? e.message : String(e);
    throw new HttpError(502, /no .*requirement|policy|No network\/scheme/i.test(why) ? "the provider's price or payment terms changed, so the call was not bought; nothing was charged" : "the provider did not answer; nothing was charged", "UPSTREAM_FAILED");
  }
  const body = await res.json().catch(() => null);
  if (res.status === 404) throw new HttpError(404, "the provider found nothing for that input; nothing was charged");
  if (res.status === 400 || res.status === 422) throw new HttpError(400, `the provider refused the input${body && typeof body === "object" && "error" in body ? `: ${String((body as { error: unknown }).error).slice(0, 200)}` : ""}; nothing was charged`);
  if (!res.ok || body === null) throw new HttpError(502, `the provider answered HTTP ${res.status}; nothing was charged`, "UPSTREAM_FAILED");
  return body;
}
