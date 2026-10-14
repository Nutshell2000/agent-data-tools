import { HTTPFacilitatorClient } from "@x402/core/server";
import type { Env } from "./env";

/**
 * Keyless facilitators need only a URL. The Coinbase CDP facilitator also needs a
 * short-lived JWT per request, signed with the CDP API key held in Worker secrets.
 */
export function buildFacilitator(env: Env): HTTPFacilitatorClient {
  return withResilientSupported(buildClient(env));
}

/**
 * The facilitator front door sometimes answers a Worker with a transient bot-challenge 403.
 * That would turn an ordinary paywall request into a 500, so retry and fall back to the
 * last good response.
 */
function withResilientSupported(client: HTTPFacilitatorClient): HTTPFacilitatorClient {
  // An HTML error page means the request was stopped at the edge and never reached the
  // facilitator, so retrying verify/settle cannot double-process a payment.
  const edgeBlock = (err: unknown) => /\((403|429|5\d\d)\):\s*<(!doctype|html)/i.test(String((err as Error)?.message ?? err));
  const retrying = <A extends unknown[], R>(call: (...args: A) => Promise<R>, attempts: number) =>
    async (...args: A): Promise<R> => {
      let lastError: unknown;
      for (let attempt = 0; attempt < attempts; attempt++) {
        try {
          return await call(...args);
        } catch (err) {
          lastError = err;
          if (!edgeBlock(err)) throw err;
          await new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1)));
        }
      }
      throw lastError;
    };
  client.verify = retrying(client.verify.bind(client), 4);
  client.settle = retrying(client.settle.bind(client), 4);

  const original = client.getSupported.bind(client);
  let lastGood: Awaited<ReturnType<typeof original>> | undefined;
  client.getSupported = async () => {
    let lastError: unknown;
    for (let attempt = 0; attempt < 6; attempt++) {
      try {
        lastGood = await original();
        return lastGood;
      } catch (err) {
        lastError = err;
        await new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1)));
      }
    }
    if (lastGood) return lastGood;
    throw lastError;
  };
  return client;
}

function buildClient(env: Env): HTTPFacilitatorClient {
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
