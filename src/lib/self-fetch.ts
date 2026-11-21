/**
 * Requests to the hosts this Worker serves itself (12 Nov 2026). A Worker cannot fetch its own public hostname over the
 * network: /agent-readiness on our own origin and on tools.funwords.eu answered "the site did not answer", although
 * /check/x402-seller, which already went through the SELF service binding, read our quotes fine. Tools that read a URL
 * the caller names use `selfFetch` first and fall back to the network only for other hosts.
 */
import type { Env } from "./env";

/**
 * Every hostname this service answers on, in one place (21 Nov 2026). The list used to hold four of them, so the other
 * addresses of the same Worker (the api., mcp., lex., tts. and web. hosts and the staging copy) passed the public-fetch
 * guard as if they were somebody else's site: a caller could make the service call itself over the network and use
 * the free calls that belong to its own egress address. Tools that may read our own pages ask `selfFetch` /
 * `isSelfHost` and go through the service binding; the network path (`fetchPublic`) refuses every host named here.
 */
export const SELF_HOSTS: ReadonlySet<string> = new Set(["agent-data-tools.revmesh2074.workers.dev", "tools.funwords.eu", "glyphcall.com", "www.glyphcall.com"]);
/**
 * Hosts that are ours but are NOT answered through the service binding: the other names of the same Worker and the
 * staging copy (a different Worker with testnet terms, which production must never answer for). `isOwnHost` is for the
 * few tools that send many requests to one target and must not aim them at ourselves (routes/agent-infra.ts). The
 * page readers still read our own public pages over the network like anybody's: the published examples and the build
 * of the reader's demo do exactly that, and a first version of this change that refused them broke that build.
 */
const OTHER_OWN_HOSTS: ReadonlySet<string> = new Set(["agent-data-tools-staging.revmesh2074.workers.dev", "api.glyphcall.com", "mcp.glyphcall.com", "lex.glyphcall.com", "tts.glyphcall.com", "web.glyphcall.com"]);
/** The zone whose every hostname is ours: a host added to it later is covered before anyone remembers this list. */
const OWN_ZONE = ".glyphcall.com";

/** Whether `host` is one of this service's own hostnames (no environment needed). */
export function isOwnHost(host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, "");
  return SELF_HOSTS.has(h) || OTHER_OWN_HOSTS.has(h) || h.endsWith(OWN_ZONE);
}

export function isSelfHost(env: Pick<Env, "PUBLIC_SITE_ORIGIN">, host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, "");
  if (SELF_HOSTS.has(h)) return true;
  try { return Boolean(env.PUBLIC_SITE_ORIGIN) && new URL(env.PUBLIC_SITE_ORIGIN!).hostname === h; } catch { return false; }
}

/** The answer of this Worker itself for a URL on one of its own hosts, or null when the URL is elsewhere (or no binding). */
export function selfFetch(env: Pick<Env, "SELF" | "PUBLIC_SITE_ORIGIN">, url: URL, accept: string): Promise<Response> | null {
  if (!env.SELF || !isSelfHost(env, url.hostname)) return null;
  return env.SELF.fetch(url.href, { headers: { accept, "user-agent": "agent-data-tools-self-check" } });
}
