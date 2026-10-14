import type { Env } from "../lib/env";
import { domainInfo } from "./domain";

type Info = Awaited<ReturnType<typeof domainInfo>>;
type Flag = { level: "high" | "medium" | "info"; code: string; message: string };

/** Domain facts turned into a trust verdict with named, explainable flags. */
export async function domainReport(_env: Env, name: string) {
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
      flags.push({ level: "info", code: "age_unknown", message: "Registration date not available for this TLD." });
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
