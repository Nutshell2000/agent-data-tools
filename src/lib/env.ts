export interface Env {
  PAY_TO: string;
  NETWORK: `${string}:${string}`;
  /** Further networks where tools accept payment, comma-separated (see lib/networks.ts). */
  EXTRA_NETWORKS?: string;
  /** Solana address that receives USDC on Solana; when unset, Solana is not offered. */
  SOLANA_PAY_TO?: string;
  FACILITATOR_URL: string;
  PAYWALL: string;
  TRIALS_ENABLED?: string;
  BASE_RPC_URL: string;
  CDP_API_KEY_ID?: string;
  CDP_API_KEY_SECRET?: string;
  // Set once the API is listed on RapidAPI: the secret its proxy sends with every call.
  RAPIDAPI_PROXY_SECRET?: string;
  // Brave Search API key for /search, and the most upstream searches per UTC day (default 500).
  SEARCH_API_KEY?: string;
  SEARCH_DAILY_CAP?: string;
  // Restricted Stripe key that can only read Checkout Sessions; /credits/claim uses it to confirm card payments.
  STRIPE_READ_KEY?: string;
  /** Owner-only bearer token for private sales figures on /revenue (card-credit totals). Optional secret. */
  REVENUE_TOKEN?: string;
  // MPP (agent card payments for credit packs): restricted key with PaymentIntents write, and the Stripe profile id.
  STRIPE_MPP_KEY?: string;
  STRIPE_PROFILE_ID?: string;
  AI: Ai;
  BROWSER: Fetcher;
  // Holds trial counters and store orders.
  TRIALS?: KVNamespace;
  // Product files under public/. The Worker runs first, so they are never served directly.
  ASSETS: Fetcher;
  // This same Worker, for requests to its own public URL (a Worker cannot fetch its workers.dev host).
  SELF?: Fetcher;
  // Request counters. Optional so local runs without the binding still work.
  METRICS?: DurableObjectNamespace<import("../metrics").Metrics>;
}

export const trialsEnabled = (env: Pick<Env, "TRIALS_ENABLED">): boolean => env.TRIALS_ENABLED === "on";

/** Error whose message is safe to show to the caller. Not charged (status >= 400). */
export class HttpError extends Error {
  constructor(
    public status: 400 | 404 | 415 | 422 | 502 | 503 | 504,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}

export const isAddress = (v: string): v is `0x${string}` => /^0x[0-9a-fA-F]{40}$/.test(v);
