// Tool packs (1.60.0): one paid call runs several of our tools on the same input and returns one report, at a lower price
// than buying the tools one by one. Bazaar search on 24 Oct 2026, summed 30-day payers over the top 20: crypto market
// overview 50, token analysis 42 (the #1 there has 22 payers), email deliverability 36, security audit 36, website audit 23,
// ip intelligence 24, wallet profile 14. Every section runs the same code as the single tool; a section that fails is
// reported in `failed` and the rest still answer. Only when every section fails is the call refused (502, uncharged).
import { entry, need, opt, pick, type Entry, type Input } from "../family";
import { HttpError, type Env } from "../lib/env";
import { bitcoinFees } from "./bitcoin";
import { CHAIN_READS } from "./chain-reads";
import { CHECKS } from "./checks";
import { contractRisk } from "./contract-risk";
import { domainInfo } from "./domain";
import { emailCheck } from "./email";
import { FEAR_GREED } from "./fear-greed";
import { GEO_IP } from "./geo-ip";
import { HYPERLIQUID } from "./hyperliquid";
import { LOOKUPS } from "./lookups";
import { PRICES } from "./prices";
import { PUBLIC_DATA } from "./public-data";
import { SANCTIONS } from "./sanctions";
import { tokenReport } from "./token-report";
import { UTILS } from "./utils";
import { dohQuery, RESOLVERS, WEB_CHECKS } from "./web-checks";

const ALL: Entry[] = [...CHAIN_READS, ...CHECKS, ...FEAR_GREED, ...GEO_IP, ...HYPERLIQUID, ...LOOKUPS, ...PRICES, ...PUBLIC_DATA, ...SANCTIONS, ...UTILS, ...WEB_CHECKS];
const byPath = new Map(ALL.map((e) => [e.endpoint.path, e]));
/** Runs one of our tools in-process with the given inputs (the same handler the single tool's route uses). */
export function call(env: Env, path: string, inputs: Record<string, string | number | undefined>) {
  const e = byPath.get(path);
  if (!e) throw new Error(`pack references unknown tool ${path}`);
  const q: Input = (n) => (inputs[n] === undefined ? undefined : String(inputs[n]));
  return Promise.resolve().then(() => e.run(env, q));
}
type Section = { ok: true; data: unknown } | { ok: false; error: string };
const settle = async (p: Promise<unknown>): Promise<Section> => {
  try { return { ok: true, data: await p }; }
  catch (e) { return { ok: false, error: String((e as Error)?.message ?? e).slice(0, 200) }; }
};
/** Runs named sections in parallel; the pack fails (uncharged) only when every one failed. */
export async function runSections(sections: Record<string, Promise<unknown>>) {
  const names = Object.keys(sections);
  const done = await Promise.all(names.map((n) => settle(sections[n])));
  const data: Record<string, unknown> = {}, failed: Record<string, string> = {};
  names.forEach((n, i) => { const s = done[i]; if (s.ok) data[n] = s.data; else failed[n] = s.error; });
  if (!Object.keys(data).length) throw new HttpError(502, `every part of this pack failed (${Object.values(failed)[0] ?? "no answer"}); nothing was charged`);
  return { data, failed };
}
const pick2 = <T extends Record<string, unknown>>(o: unknown, keys: (keyof T)[]) => (o && typeof o === "object" ? Object.fromEntries(keys.filter((k) => k in (o as T)).map((k) => [k, (o as T)[k]])) : null);
const CHAINS = ["base", "eth", "arb", "op", "polygon"] as const;
const PRICE_CHAIN: Record<string, string> = { base: "base", eth: "ethereum", arb: "arbitrum", op: "optimism" };

// ---------- email deliverability ----------
const DKIM_SELECTORS = ["google", "selector1", "selector2", "k1", "default", "s1", "s2", "mail", "dkim"];
export function emailScore(r: { mx: number; spf: string | null; spfPolicy: string | null; dmarc: string | null; dmarcPolicy: string | null; dkim: string[]; mtaSts: boolean; tlsRpt: boolean; bimi: boolean }) {
  const issues: string[] = [];
  let score = 0;
  if (r.mx) score += 20; else issues.push("no MX record: the domain cannot receive mail");
  if (r.spf) { score += 20; if (r.spfPolicy === "+all") issues.push("SPF ends in +all, which lets anyone send as this domain"); else if (r.spfPolicy === "?all" || !r.spfPolicy) issues.push("SPF has no ~all or -all ending"); }
  else issues.push("no SPF record");
  if (r.dmarc) { score += 15; if (r.dmarcPolicy === "quarantine" || r.dmarcPolicy === "reject") score += 15; else issues.push("DMARC policy is p=none (monitor only)"); }
  else issues.push("no DMARC record");
  if (r.dkim.length) score += 15; else issues.push(`no DKIM key found at common selectors (${DKIM_SELECTORS.join(", ")}); a custom selector may still exist`);
  if (r.mtaSts) score += 5; else issues.push("no MTA-STS policy");
  if (r.tlsRpt) score += 5; else issues.push("no TLS-RPT record");
  if (r.bimi) score += 5;
  return { score: Math.min(100, score), grade: score >= 85 ? "A" : score >= 70 ? "B" : score >= 50 ? "C" : score >= 30 ? "D" : "F", issues };
}
async function txt(name: string) {
  const r = await dohQuery(RESOLVERS[0].url, name, "TXT");
  return (r.Answer ?? []).filter((a) => a.type === 16).map((a) => a.data.replace(/"\s+"/g, "").replace(/^"|"$/g, ""));
}

// ---------- reverse DNS ----------
export function reverseName(ip: string) {
  if (ip.includes(":")) {
    const parts = ip.split("::");
    const head = parts[0] ? parts[0].split(":") : [], tail = parts[1] ? parts[1].split(":") : [];
    const full = [...head, ...Array(8 - head.length - tail.length).fill("0"), ...tail].map((h) => h.padStart(4, "0"));
    return `${full.join("").split("").reverse().join(".")}.ip6.arpa`;
  }
  return `${ip.split(".").reverse().join(".")}.in-addr.arpa`;
}

export const PACKS: Entry[] = [
  entry("/pack/crypto-market", "Crypto market overview: sentiment, prices, funding and signals",
    "Market sentiment, prices and signals in one call: the Fear & Greed index with its 7-day change (alternative.me, attributed), the 10 most traded Hyperliquid perpetuals with price, 24-hour change, funding and open interest, technical readings (RSI, MACD, moving averages) for up to three coins, and Bitcoin fee rates. Cheaper than the five tools bought one by one. Use for a daily market brief, a trading agent's context or a dashboard.",
    ["crypto-market-overview", "market-brief", "crypto", "pack", "sentiment", "data"], {
      coins: { type: "string", description: "Up to 3 coins for technical readings, comma separated (default BTC,ETH,SOL)", example: "BTC,ETH,SOL" },
    },
    { pack: "crypto-market", coins: ["BTC", "ETH", "SOL"], sentiment: { value: 51, classification: "Neutral", change7d: -4, attribution: "Crypto Fear & Greed Index by alternative.me" }, topMarkets: [{ coin: "BTC", markPx: 81870, change24hPct: 0.66, fundingAprPct: 10.95, openInterestUsd: 3401847000, dayVolumeUsd: 2604051652 }], signals: [{ coin: "BTC", close: 81870, rsi14: 48.2, readings: ["RSI neutral (30-70)", "price above SMA 200"] }], bitcoinFees: { nextBlock: 3, hour: 2, unit: "sat/vB" }, failed: {} },
    async (env, q) => {
      const coins = (opt(q, "coins", 60) ?? "BTC,ETH,SOL").split(",").map((c) => c.trim().toUpperCase()).filter(Boolean).slice(0, 3);
      const { data, failed } = await runSections({
        sentiment: call(env, "/crypto/fear-greed", { days: 8 }),
        markets: call(env, "/hyperliquid/market", {}),
        ...Object.fromEntries(coins.map((c) => [`signal:${c}`, call(env, "/hyperliquid/indicators", { coin: c, interval: "4h" })])),
        bitcoinFees: bitcoinFees(),
      });
      const fg = data.sentiment as { value: number; classification: string; change: { vs7d: number | null }; attribution: string } | undefined;
      const mk = data.markets as { markets: Record<string, unknown>[] } | undefined;
      const fees = data.bitcoinFees as { fees?: { nextBlock: number; hour: number }; unit?: string } | undefined;
      return {
        pack: "crypto-market", coins,
        sentiment: fg ? { value: fg.value, classification: fg.classification, change7d: fg.change.vs7d, attribution: fg.attribution } : null,
        topMarkets: mk ? mk.markets.slice(0, 10).map((m) => pick2(m, ["coin", "markPx", "change24hPct", "fundingAprPct", "openInterestUsd", "dayVolumeUsd"])) : null,
        signals: coins.filter((c) => data[`signal:${c}`]).map((c) => pick2(data[`signal:${c}`], ["coin", "interval", "close", "rsi14", "macd", "readings", "realizedVolPct"])),
        bitcoinFees: fees?.fees ? { nextBlock: fees.fees.nextBlock, hour: fees.fees.hour, unit: fees.unit ?? "sat/vB" } : null,
        failed,
      };
    }, "$0.01"),

  entry("/pack/token-analysis", "Token analysis, token security: price, supply, proxy and risk checks",
    "One call to analyse an ERC-20 token: name, symbol, decimals and supply, USD price from the deepest Uniswap v3 pool, whether it is an upgradeable proxy and who can upgrade it, and on Base the honeypot and contract risk checks (paused transfers, blacklist, owner fees, mint rights, liquidity). Give a ticker or 0x address and the network (base, eth, arb, op or polygon). Use before buying, listing or accepting an unknown token.",
    ["token-analysis", "token-research", "token-security", "erc20", "pack", "crypto"], {
      token: { type: "string", description: "Token: a ticker such as USDC or a 0x ERC-20 contract address", required: true, example: "0x4200000000000000000000000000000000000006" },
      chain: { type: "string", description: "Network: base (default), eth, arb, op or polygon", example: "base" },
    },
    { pack: "token-analysis", chain: "base", token: "0x4200000000000000000000000000000000000006", info: { name: "Wrapped Ether", symbol: "WETH", decimals: 18, totalSupply: "180000.5" }, price: { usd: 3920.15, source: "Uniswap v3" }, proxy: { isProxy: false, kind: "none", implementation: null }, risk: { verdict: "low", flags: [] }, contract: { tier: "low", flags: [] }, failed: {} },
    async (env, q) => {
      const chain = pick(q, "chain", CHAINS, "base");
      // address= and contract= as agents send them (26 Oct 2026 probe); a global alias would be wrong for tools that take both.
      const token = need((n) => q(n) ?? (n === "token" ? q("address") ?? q("contract") ?? q("symbol") : undefined), "token", 64).trim();
      const info = await call(env, `/${chain}/token-info`, { token: /^0x[0-9a-f]{40}$/i.test(token) ? token.toLowerCase() : token }) as { token: string; name: string | null; symbol: string | null; decimals: number; totalSupply: string };
      const address = info.token.toLowerCase();
      const { data, failed } = await runSections({
        ...(PRICE_CHAIN[chain] ? { price: call(env, "/price/token", { address, chain: PRICE_CHAIN[chain] }) } : {}),
        proxy: call(env, `/${chain}/proxy`, { address }),
        ...(chain === "base" ? { risk: tokenReport(env, address), contract: contractRisk(env, address) } : {}),
      });
      return {
        pack: "token-analysis", chain, token: address, info: pick2(info, ["name", "symbol", "decimals", "totalSupply"]),
        price: data.price ?? null, proxy: data.proxy ? pick2(data.proxy, ["isProxy", "kind", "implementation", "admin", "upgradeable"]) : null,
        risk: data.risk ?? null, contract: data.contract ?? null,
        ...(chain === "base" ? {} : { note: "honeypot and contract risk checks cover Base only" }), failed,
      };
    }, "$0.01"),

  entry("/pack/email-deliverability", "Email deliverability check: MX, SPF, DMARC, DKIM and score",
    "Email deliverability check for a domain in one call: MX records, SPF and its all-policy, DMARC and its policy, DKIM keys at the common selectors (Google, Microsoft, Mailchimp and others), MTA-STS, TLS-RPT and BIMI, with a 0-100 score, a grade and a list of fixes; optionally also checks one address (syntax, MX, disposable domain). Uses public DNS only and sends no mail. Use before a campaign, when mail lands in spam, or to vet a sender domain.",
    ["email-deliverability", "spf", "dmarc", "dkim", "pack", "email"], {
      domain: { type: "string", description: "The sending domain, such as example.com (or a URL; its host is used)", required: true, example: "github.com" },
      email: { type: "string", description: "Optional address to check as well", example: "support@github.com" },
    },
    { pack: "email-deliverability", domain: "github.com", score: 90, grade: "A", issues: ["no BIMI record"], mx: [{ priority: 1, host: "aspmx.l.google.com" }], spf: "v=spf1 ip4:… ~all", spfPolicy: "~all", dmarc: "v=DMARC1; p=reject; …", dmarcPolicy: "reject", dkimSelectors: ["google"], mtaSts: true, tlsRpt: true, bimi: false, address: null, failed: {} },
    async (_env, q) => {
      let domain = need(q, "domain", 300).trim().toLowerCase();
      if (/^https?:\/\//.test(domain)) { try { domain = new URL(domain).hostname; } catch { /* checked below */ } }
      domain = domain.replace(/^www\./, "").replace(/\.$/, "");
      const email = opt(q, "email", 254);
      const { data, failed } = await runSections({
        domain: domainInfo(domain),
        mtaSts: txt(`_mta-sts.${domain}`),
        tlsRpt: txt(`_smtp._tls.${domain}`),
        bimi: txt(`default._bimi.${domain}`),
        dkim: Promise.all(DKIM_SELECTORS.map(async (s) => ((await txt(`${s}._domainkey.${domain}`).catch(() => [])).some((t) => /v=DKIM1|k=rsa|p=/i.test(t)) ? s : null))).then((x) => x.filter((s): s is string => !!s)),
        ...(email ? { address: emailCheck(email) } : {}),
      });
      if (!data.domain) throw new HttpError(failed.domain?.includes("valid domain") ? 400 : 502, failed.domain ?? "the domain lookup failed");
      const d = data.domain as { exists: boolean; dns: { mx: { priority: number; host: string }[] }; email: { spf: string | null; spfPolicy: string | null; dmarc: string | null; dmarcPolicy: string | null } };
      if (!d.exists) throw new HttpError(404, `${domain} does not exist in DNS`);
      const has = (k: string, re: RegExp) => ((data[k] as string[] | undefined) ?? []).some((t) => re.test(t));
      const dkim = (data.dkim as string[] | undefined) ?? [];
      const mx = d.dns.mx.filter((m) => m.host && m.host !== ".");
      const flags = { mtaSts: has("mtaSts", /v=STSv1/i), tlsRpt: has("tlsRpt", /v=TLSRPTv1/i), bimi: has("bimi", /v=BIMI1/i) };
      const scored = emailScore({ mx: mx.length, ...d.email, dkim, ...flags });
      return { pack: "email-deliverability", domain, ...scored, mx, spf: d.email.spf, spfPolicy: d.email.spfPolicy, dmarc: d.email.dmarc, dmarcPolicy: d.email.dmarcPolicy, dkimSelectors: dkim, ...flags, address: data.address ?? null, failed };
    }, "$0.01"),

  entry("/pack/website-audit", "Website audit, security audit: uptime, SEO, security headers, redirects and DNS",
    "One call to audit a website: is it up and how fast, the redirect chain (including whether plain http moves to https), the on-page SEO audit with its score and issues, HTTP security headers and their grade, robots.txt for the page, and the domain's DNS, email authentication and registration age. Server-side HTML only, no JavaScript. Cheaper than the six tools bought one by one. Use before a launch, for a client report or to compare competitors.",
    ["website-audit", "site-audit", "security-audit", "seo-audit", "pack", "web"], { url: { type: "string", description: "Absolute http(s) URL of the page", required: true, example: "https://www.wikipedia.org/" } },
    { pack: "website-audit", url: "https://www.wikipedia.org/", uptime: { up: true, status: 200, responseMs: 135 }, httpsRedirect: true, redirects: 0, seo: { score: 73, issues: ["no canonical link"] }, security: { grade: "B", missing: ["permissions-policy"] }, robots: { allowed: true }, domain: { registeredAt: "2001-01-13T00:12:14Z", ageDays: 9050, spfPolicy: "~all", dmarcPolicy: "reject" }, failed: {} },
    async (env, q) => {
      const url = need(q, "url", 2_000);
      let host: string;
      try { host = new URL(url).hostname; } catch { throw new HttpError(400, "url must be an absolute http(s) URL"); }
      const httpUrl = url.replace(/^https:/i, "http:");
      const { data, failed } = await runSections({
        uptime: call(env, "/url/uptime", { url }),
        redirects: call(env, "/url/redirects", { url }),
        httpRedirect: call(env, "/url/redirects", { url: httpUrl }),
        seo: call(env, "/seo/audit", { url }),
        security: call(env, "/http/security-headers", { url }),
        robots: call(env, "/robots", { url }),
        domain: domainInfo(host.replace(/^www\./, "")),
      });
      const up = data.uptime as Record<string, unknown> | undefined;
      const hr = data.httpRedirect as { finalUrl?: string } | undefined;
      const dom = data.domain as { registration?: Record<string, unknown> | null; email?: Record<string, unknown> } | undefined;
      return {
        pack: "website-audit", url,
        uptime: up ? pick2(up, ["up", "status", "responseMs", "finalUrl", "server", "bytes"]) : null,
        httpsRedirect: hr?.finalUrl ? /^https:/i.test(hr.finalUrl) : null,
        redirects: (data.redirects as { redirects?: number } | undefined)?.redirects ?? null,
        seo: data.seo ? pick2(data.seo, ["score", "issues", "title", "description", "wordCount"]) : null,
        security: data.security ?? null,
        robots: data.robots ? pick2(data.robots, ["allowed", "matchedRule", "sitemaps"]) : null,
        domain: dom ? { ...(dom.registration ? pick2(dom.registration, ["registrar", "registeredAt", "expiresAt", "ageDays"]) : {}), spfPolicy: dom.email?.spfPolicy ?? null, dmarcPolicy: dom.email?.dmarcPolicy ?? null } : null,
        failed,
      };
    }, "$0.01"),

  entry("/pack/ip-intelligence", "IP intelligence: owner, network, reverse DNS and type",
    "One call for everything about an IP address: its type (public, private, loopback, carrier-grade NAT), the registry record (holding organisation, network name and range, registration country, abuse contact) and the reverse DNS name. IPv4 and IPv6. Registration country, not city geolocation. Cheaper than the tools bought one by one. Use to investigate an address in logs, a login or an abuse report.",
    ["ip-intelligence", "ip-lookup", "reverse-dns", "pack", "network", "security"], { ip: { type: "string", description: "IPv4 or IPv6 address", required: true, example: "8.8.8.8" } },
    { pack: "ip-intelligence", ip: "8.8.8.8", type: { version: 4, public: true, private: false }, registry: { holder: "Google LLC", network: "GOGL", range: "8.8.8.0 - 8.8.8.255", country: "US", abuseEmail: "network-abuse@google.com", registry: "ARIN" }, reverseDns: ["dns.google"], failed: {} },
    async (env, q) => {
      const ip = need(q, "ip", 64).trim().replace(/^\[|\]$/g, "").toLowerCase();
      const { data, failed } = await runSections({
        type: call(env, "/ip/info", { ip }),
        registry: call(env, "/ip/lookup", { ip }),
        reverseDns: dohQuery(RESOLVERS[0].url, reverseName(ip), "PTR").then((r) => (r.Answer ?? []).filter((a) => a.type === 12).map((a) => a.data.replace(/\.$/, ""))),
      });
      if (!data.type && failed.type?.includes("not an IP")) throw new HttpError(400, "ip must be an IPv4 or IPv6 address");
      const reg = data.registry as { holder?: { name: string | null } | null; network?: { name: string | null; start: string | null; end: string | null }; country?: string | null; abuseEmail?: string | null; registry?: string | null } | undefined;
      return {
        pack: "ip-intelligence", ip, type: data.type ?? null,
        registry: reg ? { holder: reg.holder?.name ?? null, network: reg.network?.name ?? null, range: reg.network?.start ? `${reg.network.start} - ${reg.network.end}` : null, country: reg.country ?? null, abuseEmail: reg.abuseEmail ?? null, registry: reg.registry ?? null } : null,
        reverseDns: data.reverseDns ?? null, failed,
      };
    }, "$0.01"),

  entry("/pack/wallet-profile", "Wallet profile: balances, activity, contract check and sanctions",
    "One call to profile an EVM wallet: native and USDC balances on Base, Ethereum, Arbitrum, Optimism and Polygon, transaction counts on Base and Ethereum, whether it is a contract or a plain wallet, its recent USDC transfers on Base, and an OFAC sanctions screen. Cheaper than the tools bought one by one. Use before paying, onboarding or trusting a counterparty wallet; for a single risk verdict use check_counterparty.",
    ["wallet-profile", "wallet-analysis", "wallet", "pack", "sanctions", "crypto"], { address: { type: "string", description: "0x wallet address", required: true, example: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045" } },
    { pack: "wallet-profile", address: "0xd8da6bf26964af9d7eed9e03e53415d37aa96045", isContract: false, balances: { usdcTotal: "12.5", networks: [{ chain: "Base", native: "0.0123", usdc: "12.5" }] }, activity: { baseNonce: 120, ethNonce: 1204 }, recentUsdc: { count: 2, transfers: [{ direction: "in", amount: "2.5", counterparty: "0x…" }] }, sanctions: { verdict: "pass" }, failed: {} },
    async (env, q) => {
      const address = need(q, "address", 64).trim().toLowerCase();
      if (!/^0x[0-9a-f]{40}$/.test(address)) throw new HttpError(400, "address must be a 0x address (40 hex characters)");
      const { data, failed } = await runSections({
        balances: call(env, "/wallet/balances", { address }),
        contract: call(env, "/base/is-contract", { address }),
        baseNonce: call(env, "/base/nonce", { address }),
        ethNonce: call(env, "/eth/nonce", { address }),
        // 1,000 blocks (about 33 minutes on Base): the published example took 11.9 s at 2,000, past many buyers' patience.
        transfers: call(env, "/base/token-transfers", { address, blocks: 1000 }),
        sanctions: call(env, "/sanctions/check", { address }),
      });
      const tr = data.transfers as { count: number; transfers: Record<string, unknown>[] } | undefined;
      return {
        pack: "wallet-profile", address,
        isContract: (data.contract as { isContract?: boolean } | undefined)?.isContract ?? null,
        balances: data.balances ?? null,
        activity: { baseNonce: (data.baseNonce as { nonce?: number } | undefined)?.nonce ?? null, ethNonce: (data.ethNonce as { nonce?: number } | undefined)?.nonce ?? null },
        recentUsdc: tr ? { count: tr.count, transfers: tr.transfers.slice(0, 10).map((t) => pick2(t, ["block", "direction", "amount", "counterparty", "tx"])) } : null,
        sanctions: data.sanctions ? pick2(data.sanctions, ["verdict", "listed", "matches", "source"]) : null,
        failed,
      };
    }, "$0.01"),
];
