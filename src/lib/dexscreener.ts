// DexScreener's public API, shared by /liquidity-pool-audit and /token-report. It rate-limits Cloudflare's shared
// egress addresses (HTTP 429 on every Worker call from staging on 22 Oct while the same request from a PC passed), so a
// 429 or 5xx is retried a few times with short waits, and answers are kept 30 s in the edge cache so repeated
// lookups of the same pair or token do not spend the limit again.
const UA = "Mozilla/5.0 (compatible; AgentDataTools/1.0)";
const CACHE_SECONDS = 30;
const RETRY_WAITS_MS = [250, 700, 1500];

/** GET a DexScreener API path ("/latest/dex/pairs/base/0x…"); returns the Response (ok or the last failure). */
export async function dexscreener(path: string, timeoutMs = 8000): Promise<Response> {
  const url = `https://api.dexscreener.com${path}`;
  const cache = typeof caches !== "undefined" ? (caches as unknown as { default: Cache }).default : undefined;
  const key = new Request(url);
  const hit = await cache?.match(key).catch(() => undefined);
  if (hit) return hit;
  const deadline = Date.now() + timeoutMs;
  let last: Response | undefined;
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { headers: { accept: "application/json", "user-agent": UA }, signal: AbortSignal.timeout(Math.max(1000, deadline - Date.now())) });
    if (res.ok) {
      const body = await res.text();
      const fresh = new Response(body, { status: 200, headers: { "content-type": "application/json", "cache-control": `max-age=${CACHE_SECONDS}` } });
      await cache?.put(key, fresh.clone()).catch(() => undefined);
      return fresh;
    }
    last = res;
    const wait = RETRY_WAITS_MS[attempt];
    if (!(res.status === 429 || res.status >= 500) || wait === undefined || Date.now() + wait > deadline) break;
    await res.body?.cancel();
    await new Promise((r) => setTimeout(r, wait));
  }
  console.warn(`dexscreener ${path.split("/").slice(0, 4).join("/")} HTTP ${last.status}`);
  return last;
}
