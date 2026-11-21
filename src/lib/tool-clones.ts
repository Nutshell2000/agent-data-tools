/**
 * Per-chain copies of one method (SEO audit of 21 Nov 2026): /tools/eth-balance, /tools/base-balance, … /tools/sei-balance
 * are the same page for 18 networks (97-98% shared text), so search engines would index one of them at best and spend
 * the new domain's crawl on the rest. One page per method is listed in the sitemap and indexed (eth when it has the
 * method, else base, else the first network in NETWORKS that has it); the others stay up for agents and people who
 * follow a link, with `noindex, follow`. Not a canonical: the pages are not equivalent (another network, another
 * request URL), and a canonical to a page that does not do the asked thing is a hint search engines may ignore.
 */
import { ENDPOINTS } from "../endpoints";

/** The EVM networks that carry the same per-chain methods, in the order a representative is picked. */
export const NETWORKS = ["eth", "base", "arb", "op", "polygon", "avax", "gnosis", "linea", "zksync", "scroll", "mantle", "celo", "sonic", "unichain", "hyperevm", "bera", "ink", "sei"] as const;

const NETWORK_SET = new Set<string>(NETWORKS);

function split(path: string): { network: string; method: string } | undefined {
  const m = /^\/([a-z0-9]+)\/([a-z0-9-]+)$/.exec(path);
  return m && NETWORK_SET.has(m[1]) ? { network: m[1], method: m[2] } : undefined;
}

let representatives: Map<string, string> | undefined;
function byMethod(): Map<string, string> {
  if (representatives) return representatives;
  const paths = new Set(ENDPOINTS.map((e) => e.path));
  const out = new Map<string, string>();
  for (const path of paths) {
    const s = split(path);
    if (!s || out.has(s.method)) continue;
    const first = NETWORKS.find((n) => paths.has(`/${n}/${s.method}`));
    if (first) out.set(s.method, `/${first}/${s.method}`);
  }
  return (representatives = out);
}

/** The representative tool path when `path` is a per-chain copy of another network's page, else undefined. */
export function chainCloneOf(path: string): string | undefined {
  const s = split(path);
  if (!s) return undefined;
  const rep = byMethod().get(s.method);
  return rep && rep !== path ? rep : undefined;
}
