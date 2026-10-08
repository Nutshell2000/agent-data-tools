import { HttpError } from "../lib/env";

const DOH = "https://cloudflare-dns.com/dns-query";
const RDAP = "https://rdap.org/domain/";
const HOSTNAME = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

interface DohAnswer {
  name: string;
  type: number;
  TTL: number;
  data: string;
}
interface DohResponse {
  Status: number;
  AD?: boolean;
  Answer?: DohAnswer[];
}

async function doh(name: string, type: string): Promise<DohResponse> {
  const res = await fetch(`${DOH}?name=${encodeURIComponent(name)}&type=${type}`, {
    headers: { accept: "application/dns-json" },
    signal: AbortSignal.timeout(6_000),
  });
  if (!res.ok) throw new HttpError(502, `DNS resolver returned ${res.status}`);
  return res.json();
}

const answers = (r: DohResponse, type: number) => (r.Answer ?? []).filter((a) => a.type === type).map((a) => a.data);
// TXT data arrives as one or more quoted chunks: "v=spf1 ..." "more".
const unquote = (s: string) => s.replace(/"\s+"/g, "").replace(/^"|"$/g, "");

interface Rdap {
  events?: { eventAction: string; eventDate: string }[];
  status?: string[];
  entities?: { roles?: string[]; vcardArray?: [string, [string, unknown, string, string][]] }[];
  nameservers?: { ldhName?: string }[];
  secureDNS?: { delegationSigned?: boolean };
}

/** RDAP only knows registrable domains, so strip subdomain labels until one resolves. */
async function rdapLookup(name: string): Promise<{ domain: string; data: Rdap } | null> {
  const labels = name.split(".");
  for (let i = 0; i < Math.min(labels.length - 1, 3); i++) {
    const candidate = labels.slice(i).join(".");
    try {
      const res = await fetch(RDAP + candidate, {
        // rdap.org rejects requests that carry no user agent.
        headers: { accept: "application/rdap+json", "user-agent": "AgentDataTools/1.0" },
        signal: AbortSignal.timeout(6_000),
      });
      if (res.ok) return { domain: candidate, data: await res.json() };
    } catch (e) {
      // Some registries drop the connection instead of answering 404 for a
      // subdomain, so only a timeout ends the search.
      if (e instanceof Error && e.name === "TimeoutError") return null;
    }
  }
  return null;
}

export async function domainInfo(input: string) {
  const name = input.trim().toLowerCase().replace(/\.$/, "");
  if (!HOSTNAME.test(name)) throw new HttpError(400, "name must be a valid domain such as example.com");

  const [a, aaaa, mx, ns, txt, caa, dmarcTxt, rdap] = await Promise.all([
    doh(name, "A"),
    doh(name, "AAAA"),
    doh(name, "MX"),
    doh(name, "NS"),
    doh(name, "TXT"),
    doh(name, "CAA"),
    doh(`_dmarc.${name}`, "TXT"),
    rdapLookup(name),
  ]);

  const txtRecords = answers(txt, 16).map(unquote);
  const spf = txtRecords.find((t) => /^v=spf1(\s|$)/i.test(t)) ?? null;
  const dmarc =
    answers(dmarcTxt, 16)
      .map(unquote)
      .find((t) => /^v=DMARC1/i.test(t)) ?? null;
  const mxRecords = answers(mx, 15)
    .map((d) => {
      const [priority, host] = d.split(/\s+/);
      return { priority: Number(priority), host: host?.replace(/\.$/, "") ?? "" };
    })
    .sort((x, y) => x.priority - y.priority);

  const event = (action: string) => rdap?.data.events?.find((e) => e.eventAction === action)?.eventDate ?? null;
  const registered = event("registration");
  const registrar =
    rdap?.data.entities
      ?.find((e) => e.roles?.includes("registrar"))
      ?.vcardArray?.[1]?.find((v) => v[0] === "fn")?.[3] ?? null;

  return {
    domain: name,
    // NXDOMAIN is status 3.
    exists: a.Status !== 3,
    dns: {
      a: answers(a, 1),
      aaaa: answers(aaaa, 28),
      cname: answers(a, 5).map((d) => d.replace(/\.$/, "")),
      mx: mxRecords,
      ns: answers(ns, 2).map((d) => d.replace(/\.$/, "")),
      txt: txtRecords,
      caa: answers(caa, 257),
      dnssecValidated: a.AD === true,
    },
    email: {
      acceptsMail: mxRecords.some((m) => m.host && m.host !== "."),
      spf,
      spfPolicy: spf?.match(/[-~?+]all\b/)?.[0] ?? null,
      dmarc,
      dmarcPolicy: dmarc?.match(/\bp=(\w+)/i)?.[1]?.toLowerCase() ?? null,
    },
    registration: rdap
      ? {
          registrableDomain: rdap.domain,
          registrar,
          registeredAt: registered,
          expiresAt: event("expiration"),
          updatedAt: event("last changed"),
          ageDays: registered ? Math.floor((Date.now() - Date.parse(registered)) / 86_400_000) : null,
          status: rdap.data.status ?? [],
          nameservers: (rdap.data.nameservers ?? []).map((n) => n.ldhName?.toLowerCase()).filter(Boolean),
          dnssecSigned: rdap.data.secureDNS?.delegationSigned ?? null,
        }
      : null,
    checkedAt: new Date().toISOString(),
  };
}
