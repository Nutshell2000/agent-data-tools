/**
 * Requests to the hosts this Worker serves itself (12 Nov 2026). A Worker cannot fetch its own public hostname over the
 * network: /agent-readiness on our own origin and on tools.funwords.eu answered "the site did not answer", although
 * /check/x402-seller, which already went through the SELF service binding, read our quotes fine. Tools that read a URL
 * the caller names use `selfFetch` first and fall back to the network only for other hosts.
 */
import type { Env } from "./env";

export const SELF_HOSTS: ReadonlySet<string> = new Set(["agent-data-tools.revmesh2074.workers.dev", "tools.funwords.eu"]);

export function isSelfHost(env: Pick<Env, "PUBLIC_SITE_ORIGIN">, host: string): boolean {
  const h = host.toLowerCase();
  if (SELF_HOSTS.has(h)) return true;
  try { return Boolean(env.PUBLIC_SITE_ORIGIN) && new URL(env.PUBLIC_SITE_ORIGIN!).hostname === h; } catch { return false; }
}

/** The answer of this Worker itself for a URL on one of its own hosts, or null when the URL is elsewhere (or no binding). */
export function selfFetch(env: Pick<Env, "SELF" | "PUBLIC_SITE_ORIGIN">, url: URL, accept: string): Promise<Response> | null {
  if (!env.SELF || !isSelfHost(env, url.hostname)) return null;
  return env.SELF.fetch(url.href, { headers: { accept, "user-agent": "agent-data-tools-self-check" } });
}
