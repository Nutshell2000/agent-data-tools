export interface Env {
  PAY_TO: string;
  NETWORK: `${string}:${string}`;
  FACILITATOR_URL: string;
  PAYWALL: string;
  TRIALS_ENABLED?: string;
  BASE_RPC_URL: string;
  CDP_API_KEY_ID?: string;
  CDP_API_KEY_SECRET?: string;
  // Set once the API is listed on RapidAPI: the secret its proxy sends with every call.
  RAPIDAPI_PROXY_SECRET?: string;
  AI: Ai;
  BROWSER: Fetcher;
  // Holds trial counters and store orders.
  TRIALS?: KVNamespace;
  // Product files under public/. The Worker runs first, so they are never served directly.
  ASSETS: Fetcher;
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
