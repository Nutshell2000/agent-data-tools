import { HTTPFacilitatorClient } from "@x402/core/server";
import type { Env } from "./env";

/**
 * Keyless facilitators need only a URL. The Coinbase CDP facilitator also needs a
 * short-lived JWT per request, signed with the CDP API key held in Worker secrets.
 */
export function buildFacilitator(env: Env): HTTPFacilitatorClient {
  const url = env.FACILITATOR_URL.replace(/\/$/, "");
  if (!env.CDP_API_KEY_ID || !env.CDP_API_KEY_SECRET) return new HTTPFacilitatorClient({ url });

  const { host, pathname } = new URL(url);
  const bearer = async (method: string, path: string) => {
    const { generateJwt } = await import("@coinbase/cdp-sdk/auth");
    const jwt = await generateJwt({
      apiKeyId: env.CDP_API_KEY_ID!,
      apiKeySecret: env.CDP_API_KEY_SECRET!,
      requestMethod: method,
      requestHost: host,
      requestPath: `${pathname}${path}`,
    });
    return { Authorization: `Bearer ${jwt}` };
  };
  return new HTTPFacilitatorClient({
    url,
    createAuthHeaders: async () => ({
      verify: await bearer("POST", "/verify"),
      settle: await bearer("POST", "/settle"),
      supported: await bearer("GET", "/supported"),
    }),
  });
}
