import type { Env } from "../lib/env";
import { domainInfo } from "./domain";

type Info = Awaited<ReturnType<typeof domainInfo>>;
type Flag = { level: "high" | "medium" | "info"; code: string; message: string };

/**
 * 19 Nov 2026: the report is kept in the edge cache for DOMAIN_REPORT_TTL seconds per domain. Our biggest buyer (a Mercator
 * URL-safety fan-out, ~700 links a day) runs this for every link's final host; Mercator measured /pack/url-safety at p50 1.6 s,
 * p95 3.8 s, slower than every rival vendor, and its one failure in 1,171 calls was a timeout. Registration and DNS facts
 * change slowly, the answer carries its own `checkedAt`, and the phishing blocklists are never cached here.
 */
export const DOMAIN_REPORT_TTL = 6 * 3600;
const edgeCache = (): Cache | undefined => (typeof caches !== "undefined" ? (caches as unknown as { default?: Cache }).default : undefined);
const cacheKey = (name: string) => new Request(`https://domain-report.cache.internal/${encodeURIComponent(name.toLowerCase())}`);

/** Domain facts turned into a trust verdict with named, explainable flags (cached per domain, see DOMAIN_REPORT_TTL). */
export async function domainReport(env: Env, name: string) {
  const cache = edgeCache();
  if (cache) {
    try { const hit = await cache.match(cacheKey(name)); if (hit) return (await hit.json()) as Awaited<ReturnType<typeof freshDomainReport>>; } catch { /* a cache miss is fine */ }
  }
  const report = await freshDomainReport(env, name);
  if (cache) {
    try { await cache.put(cacheKey(name), new Response(JSON.stringify(report), { headers: { "content-type": "application/json", "cache-control": `max-age=${DOMAIN_REPORT_TTL}` } })); } catch { /* never fail a report on a cache write */ }
  }
  return report;
}

async function freshDomainReport(_env: Env, name: string) {
  const info: Info = await domainInfo(name);
  const flags: Flag[] = [];
  const reg = info.registration;

  if (!info.exists) {
    flags.push({ level: "high", code: "not_resolving", message: "Domain has no DNS records and does not resolve." });
  } else {
    if (reg?.ageDays != null) {
      if (reg.ageDays < 30) flags.push({ level: "high", code: "very_new", message: `Registered only ${reg.ageDays} day(s) ago.` });
      else if (reg.ageDays < 180) flags.push({ level: "medium", code: "new", message: `Registered ${reg.ageDays} days ago (under 6 months).` });
    } else {
      flags.push({ level: "info", code: "age_unknown", message: "Registration date could not be read: the registry did not answer, or this TLD publishes none." });
    }
    if (reg?.expiresAt) {
      const left = Math.floor((Date.parse(reg.expiresAt) - Date.now()) / 86_400_000);
      if (left < 0) flags.push({ level: "high", code: "expired", message: "Registration has expired." });
      else if (left < 30) flags.push({ level: "medium", code: "expiring_soon", message: `Registration expires in ${left} day(s).` });
    }
    if (info.dns.ns.length < 2) flags.push({ level: "medium", code: "few_nameservers", message: "Fewer than two nameservers." });
    if (info.dns.a.length === 0 && info.dns.aaaa.length === 0 && info.dns.cname.length === 0) {
      flags.push({ level: "medium", code: "no_web_host", message: "No A, AAAA or CNAME record, so no website host." });
    }
    if (info.email.acceptsMail) {
      if (!info.email.spf) flags.push({ level: "medium", code: "no_spf", message: "Accepts mail but publishes no SPF record." });
      if (!info.email.dmarc) flags.push({ level: "medium", code: "no_dmarc", message: "Accepts mail but publishes no DMARC policy." });
      else if (info.email.dmarcPolicy === "none") flags.push({ level: "info", code: "dmarc_monitor_only", message: "DMARC policy is p=none (monitoring only)." });
    }
    if (!info.dns.dnssecValidated) flags.push({ level: "info", code: "no_dnssec", message: "DNSSEC is not validated." });
  }

  const high = flags.filter((f) => f.level === "high").length;
  const medium = flags.filter((f) => f.level === "medium").length;
  const trust = high > 0 ? "low" : medium > 0 ? "medium" : "high";
  return {
    domain: info.domain,
    trust,
    summary: `${trust} trust: ${high} high and ${medium} medium flag(s). Based on DNS, registration and email-authentication signals only.`,
    flags,
    facts: {
      exists: info.exists,
      registrar: reg?.registrar ?? null,
      registeredAt: reg?.registeredAt ?? null,
      expiresAt: reg?.expiresAt ?? null,
      ageDays: reg?.ageDays ?? null,
      nameservers: info.dns.ns,
      acceptsMail: info.email.acceptsMail,
      spfPolicy: info.email.spfPolicy,
      dmarcPolicy: info.email.dmarcPolicy,
      dnssecValidated: info.dns.dnssecValidated,
    },
    checkedAt: info.checkedAt,
  };
}
