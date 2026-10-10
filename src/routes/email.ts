import { HttpError } from "../lib/env";

const DOH = "https://cloudflare-dns.com/dns-query";
// Community-maintained list of throwaway mailbox providers (CC0).
const DISPOSABLE_LIST = "https://raw.githubusercontent.com/disposable-email-domains/disposable-email-domains/main/disposable_email_blocklist.conf";
const FREE_PROVIDERS = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "msn.com", "yahoo.com", "ymail.com", "icloud.com", "me.com",
  "aol.com", "proton.me", "protonmail.com", "gmx.com", "gmx.net", "mail.com", "zoho.com", "yandex.com", "yandex.ru", "fastmail.com", "hey.com",
]);
const ROLE_NAMES = new Set([
  "admin", "administrator", "info", "support", "sales", "contact", "help", "billing", "office", "hello", "team", "noreply", "no-reply",
  "postmaster", "abuse", "webmaster", "hostmaster", "security", "marketing", "jobs", "careers", "press", "legal", "privacy",
]);
const SYNTAX = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63})$/;

let disposable: { loadedAt: number; domains: Set<string> } | undefined;

/** The list changes slowly, so one copy per isolate per day is enough. */
async function disposableDomains(): Promise<Set<string> | null> {
  if (disposable && Date.now() - disposable.loadedAt < 86_400_000) return disposable.domains;
  try {
    const res = await fetch(DISPOSABLE_LIST, { signal: AbortSignal.timeout(6_000), headers: { "user-agent": "AgentDataTools/1.0" } });
    if (!res.ok) return disposable?.domains ?? null;
    disposable = { loadedAt: Date.now(), domains: new Set((await res.text()).split("\n").map((l) => l.trim()).filter(Boolean)) };
    return disposable.domains;
  } catch {
    return disposable?.domains ?? null;
  }
}

async function txt(name: string): Promise<string[]> {
  const res = await fetch(`${DOH}?name=${encodeURIComponent(name)}&type=TXT`, { headers: { accept: "application/dns-json" }, signal: AbortSignal.timeout(6_000) });
  if (!res.ok) return [];
  const body = (await res.json()) as { Answer?: { type: number; data: string }[] };
  return (body.Answer ?? []).filter((a) => a.type === 16).map((a) => a.data.replace(/"\s+"/g, "").replace(/^"|"$/g, ""));
}

async function mxHosts(domain: string): Promise<{ exists: boolean; hosts: string[] }> {
  const res = await fetch(`${DOH}?name=${encodeURIComponent(domain)}&type=MX`, { headers: { accept: "application/dns-json" }, signal: AbortSignal.timeout(6_000) });
  if (!res.ok) throw new HttpError(502, `DNS resolver returned ${res.status}`);
  const body = (await res.json()) as { Status: number; Answer?: { type: number; data: string }[] };
  const hosts = (body.Answer ?? [])
    .filter((a) => a.type === 15)
    .map((a) => a.data.split(/\s+/)[1]?.replace(/\.$/, "") ?? "")
    // A lone "." is a null MX: the domain states that it accepts no mail.
    .filter((h) => h && h !== ".");
  return { exists: body.Status !== 3, hosts };
}

export async function emailCheck(input: string) {
  const address = input.trim().toLowerCase();
  if (!address) throw new HttpError(400, "missing required query parameter: address");
  const match = SYNTAX.exec(address);
  if (!match || address.includes("..")) {
    return { address, validSyntax: false, verdict: "invalid", reasons: ["not a valid email address"] };
  }
  const domain = match[1];
  const local = address.slice(0, address.lastIndexOf("@"));

  const [mx, list, spf, dmarc] = await Promise.all([mxHosts(domain), disposableDomains(), txt(domain), txt(`_dmarc.${domain}`)]);
  const isDisposable = list ? list.has(domain) : null;
  const isRole = ROLE_NAMES.has(local.split("+")[0]);

  const reasons = [
    !mx.exists && "domain does not exist",
    mx.exists && mx.hosts.length === 0 && "domain has no mail servers",
    isDisposable && "disposable mailbox provider",
    isRole && "role address, not a person",
  ].filter((r): r is string => Boolean(r));

  return {
    address,
    validSyntax: true,
    domain,
    domainExists: mx.exists,
    acceptsMail: mx.hosts.length > 0,
    mailServers: mx.hosts.slice(0, 5),
    disposable: isDisposable,
    roleAddress: isRole,
    freeProvider: FREE_PROVIDERS.has(domain),
    hasSpf: spf.some((t) => /^v=spf1/i.test(t)),
    hasDmarc: dmarc.some((t) => /^v=DMARC1/i.test(t)),
    // No mailbox probe is made, so "deliverable" can only ever be "likely".
    verdict: !mx.exists || mx.hosts.length === 0 ? "undeliverable" : isDisposable ? "risky" : "likely-deliverable",
    reasons,
    note: "Checks syntax, DNS and provider lists. It does not contact the mail server, so it cannot confirm that this particular mailbox exists.",
  };
}
