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
  const settle = retrying(client.settle.bind(client), 4);
  client.settle = ((payload: unknown, requirements: unknown) => settle(...(withoutQuery(payload, requirements) as Parameters<typeof settle>))) as typeof client.settle;

  const original = client.getSupported.bind(client);
  let lastGood: Awaited<ReturnType<typeof original>> | undefined;
  client.getSupported = async () => {
    // A cold isolate otherwise signs a CDP JWT and calls /supported before it can quote at all, which made unpaid
    // 402 quotes take ~750 ms instead of ~150 ms; probes and directories mostly hit cold isolates and rank by it.
    // The supported kinds change rarely, so the edge cache keeps them for a few hours.
    const cached = lastGood ?? await readSupported(cacheKey(client));
    if (cached) return (lastGood = cached as typeof lastGood)!;
    let lastError: unknown;
    for (let attempt = 0; attempt < 6; attempt++) {
      try {
        lastGood = await original();
        await writeSupported(cacheKey(client), lastGood);
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

/**
 * The Bazaar indexes a tool from the resource URL of its first settlement. Quotes keep the caller's exact URL
 * (published clients check it), but the settlement names the tool without its query, so a first payment on
 * /eth/balance?address=0x… lists /eth/balance and not one address. The buyer's signature does not cover the
 * resource. v2 carries it in the payload, v1 in the requirements.
 */
export function withoutQuery(payload: unknown, requirements: unknown): [unknown, unknown] {
  const strip = (url: unknown) => {
    if (typeof url !== "string") return url;
    try {
      const u = new URL(url);
      return u.search || u.hash ? u.origin + u.pathname : url;
    } catch {
      return url;
    }
  };
  const p = payload as { resource?: { url?: unknown } } | undefined;
  const r = requirements as { resource?: unknown } | undefined;
  return [
    p && typeof p === "object" && p.resource && typeof p.resource === "object" ? { ...p, resource: { ...p.resource, url: strip(p.resource.url) } } : payload,
    r && typeof r === "object" && typeof r.resource === "string" ? { ...r, resource: strip(r.resource) } : requirements,
  ];
}

const SUPPORTED_TTL_SECONDS = 6 * 3600;
const cacheKey = (client: HTTPFacilitatorClient) =>
  new Request(`https://supported-cache.invalid/v1?facilitator=${encodeURIComponent(client.url)}`);
// The Workers edge cache; absent in plain Node (tests), where every call goes to the facilitator as before.
const edgeCache = () => (typeof caches !== "undefined" ? (caches as unknown as { default?: Cache }).default : undefined);

async function readSupported(key: Request): Promise<unknown> {
  try {
    const hit = await edgeCache()?.match(key);
    return hit ? await hit.json() : undefined;
  } catch {
    return undefined;
  }
}

async function writeSupported(key: Request, value: unknown): Promise<void> {
  try {
    await edgeCache()?.put(key, new Response(JSON.stringify(value), { headers: { "content-type": "application/json", "cache-control": `max-age=${SUPPORTED_TTL_SECONDS}` } }));
  } catch {
    // Caching is an optimization only.
  }
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
