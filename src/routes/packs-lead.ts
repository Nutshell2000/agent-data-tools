// Lead and contact checks (packs, 17 Nov 2026). Measured 17 Nov: /pack/url-safety sold 455 calls ($4.55, 39% of all income) to one
// outside wallet, 0x72c573fd, that runs a lead-processing loop and pays other sellers for the other steps of it: contact and
// e-mail verification (agents.dyoeway.org/verify, 465 calls), tech stack and DNS checks (lordevo, sitecheck-api) and LinkedIn
// people lookups. Our own tools for those steps sold once or twice each at the same price. Each pack below is one per-item
// verdict in the url-safety style: one input, one call, a named verdict with reasons. Every section runs the same code as the
// single tool; a section that fails is reported in `failed` and the rest still answer.
import { entry, need, opt, type Entry } from "../family";
import { HttpError, type Env } from "../lib/env";
import { parseTarget } from "../lib/fetch";
import { domainReport } from "./domain-report";
import { emailCheck } from "./email";
import { phoneInfo } from "./lookups";
import { call, runSections } from "./packs";
import { urlSignals } from "./packs-research";

type Domain = Awaited<ReturnType<typeof domainReport>>;
type Mail = { validSyntax?: boolean; verdict?: string; reasons?: string[]; domain?: string; acceptsMail?: boolean; mailServers?: string[]; disposable?: boolean | null; roleAddress?: boolean; freeProvider?: boolean; hasSpf?: boolean; hasDmarc?: boolean };
type Redirects = { finalUrl: string; redirects: number; hops: { url: string; status: number }[] };

/** The address part after the last @, or a URL's or bare host: lead lists hold all three. */
export function hostFrom(raw: string) {
  let v = raw.trim().toLowerCase();
  if (/^https?:\/\//.test(v)) { try { v = new URL(v).hostname; } catch { throw new HttpError(400, "give a domain such as example.com or a URL"); } }
  v = v.split("/")[0];
  if (v.includes("@")) v = v.slice(v.lastIndexOf("@") + 1);
  v = v.replace(/^www\./, "").replace(/\.$/, "").split(":")[0];
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(v)) throw new HttpError(400, "give a domain such as example.com or a URL");
  return v;
}
const siteOf = (raw: string) => (/^https?:\/\//i.test(raw.trim()) ? raw.trim() : `https://${hostFrom(raw)}/`);

/** E-mail verdict from the mailbox facts and the domain's trust: invalid, risky, or likely deliverable. */
export function mailVerdict(m: Mail, d: Domain | undefined) {
  const reasons = [...(m.reasons ?? [])];
  if (m.validSyntax === false || m.verdict === "undeliverable") return { verdict: "invalid" as const, reasons };
  let risky = m.verdict === "risky" || Boolean(m.roleAddress);
  const codes = d?.flags.map((f) => f.code) ?? [];
  if (d?.trust === "low") { risky = true; reasons.push(d.summary); }
  else if (codes.includes("new")) { risky = true; reasons.push("the domain was registered under six months ago"); }
  if (m.acceptsMail && m.hasSpf === false && m.hasDmarc === false) reasons.push("the domain publishes no SPF or DMARC record");
  return { verdict: (risky ? "risky" : "likely-deliverable") as "risky" | "likely-deliverable", reasons };
}

const domainView = (d: Domain | undefined) => d ? { domain: d.domain, trust: d.trust, ageDays: d.facts.ageDays, registrar: d.facts.registrar, flags: d.flags.map((f) => f.code) } : null;
const mailView = (m: Mail) => ({ acceptsMail: m.acceptsMail ?? false, mailServers: m.mailServers ?? [], disposable: m.disposable ?? null, roleAddress: m.roleAddress ?? false, freeProvider: m.freeProvider ?? false, hasSpf: m.hasSpf ?? false, hasDmarc: m.hasDmarc ?? false });

/** A web address's risk: redirects followed, destination domain checked, named signals. Shared by contact and vendor checks. */
async function siteCheck(env: Env, raw: string) {
  const input = parseTarget(siteOf(raw));
  const redirects = await call(env, "/url/redirects", { url: input.href }).catch(() => null) as Redirects | null;
  const final = redirects?.finalUrl ? new URL(redirects.finalUrl) : null;
  const host = (final ?? input).hostname.replace(/^www\./, "");
  // A domain lookup that times out must not kill the whole check: the address-level signals
  // (bare IP, punycode, plain HTTP, redirect chain) still resolve, so the call stays charged.
  let d: Domain | undefined;
  const failed: Record<string, string> = {};
  try { d = await domainReport(env, host); } catch (e) { failed.domain = (e as Error)?.message ?? "domain report did not answer"; }
  const hosts = redirects ? [...new Set(redirects.hops.map((x) => new URL(x.url).hostname))] : [input.hostname];
  const { risk, signals } = urlSignals(input, final, hosts, d?.facts.ageDays ?? null);
  const lowTrust = d?.trust === "low" && risk === "low";
  if (lowTrust && d) signals.push({ level: "medium", code: "domain_low_trust", message: d.summary });
  return { url: input.href, finalUrl: final?.href ?? null, risk: lowTrust ? "medium" : risk, signals, domain: d, failed };
}

const BAD_NAMES = /^(n\/?a|none|test|unknown)$/i;

export const PACKS_LEAD: Entry[] = [
  entry("/pack/email-verify", "Email verification, verify email address: deliverability, disposable and domain risk",
    "Verify an email address in one call: syntax, whether the domain exists and has mail servers (MX), disposable and role addresses, free-provider flag, SPF and DMARC, and the sending domain's age and trust flags, rolled into one verdict (likely-deliverable, risky or invalid) with reasons. It does not contact the mail server, so it cannot confirm one mailbox exists. Use to clean a lead list, screen a sign-up or check a contact before outreach.",
    ["email-verification", "verify-email", "email-validation", "email-checker", "lead-verification", "pack"], {
      email: { type: "string", description: "The email address to verify", required: true, example: "alex.morgan@stripe.com" },
    },
    { pack: "email-verify", email: "alex.morgan@stripe.com", verdict: "likely-deliverable", reasons: [], mailbox: { acceptsMail: true, mailServers: ["aspmx.l.google.com"], disposable: false, roleAddress: false, freeProvider: false, hasSpf: true, hasDmarc: true }, domain: { domain: "stripe.com", trust: "high", ageDays: 11000, registrar: "SafeNames Ltd.", flags: [] }, note: "Checks syntax, DNS and provider lists. It does not contact the mail server.", failed: {} },
    async (env, q) => {
      const email = need(q, "email", 320).trim().toLowerCase();
      const m = await emailCheck(email) as Mail;
      if (m.validSyntax === false || !m.domain) return { pack: "email-verify", email, verdict: "invalid", reasons: m.reasons ?? ["not a valid email address"], mailbox: null, domain: null, note: "Syntax check only: the address is malformed.", failed: {} };
      // The domain report is the only network call here; if it times out we still answer with the mailbox facts.
      const d = await domainReport(env, m.domain).catch(() => undefined) as Domain | undefined;
      const failed = d ? {} : { domain: "domain report did not answer" };
      const { verdict, reasons } = mailVerdict(m, d);
      return { pack: "email-verify", email, verdict, reasons, mailbox: mailView(m), domain: domainView(d), note: "Checks syntax, DNS and provider lists. It does not contact the mail server, so it cannot confirm that this particular mailbox exists.", failed };
    }, "$0.01"),

  entry("/pack/contact-verify", "Contact verification, verify lead contact details: email, phone and website",
    "Verify a lead's contact details in one call: the email (mail servers, disposable or role address, domain age), the phone number (valid, E.164 format, country, line type) and the website (redirects, destination domain age, risk signals). Give any of the three; each gets a status (ok, review or invalid) and so does the call. Offline checks and public DNS: nothing is dialled or sent. Use to qualify leads, clean a CRM or vet a prospect.",
    ["contact-verification", "lead-verification", "verify-contact", "lead-qualification", "data-enrichment", "pack"], {
      email: { type: "string", description: "Email address to verify", example: "alex.morgan@stripe.com" },
      phone: { type: "string", description: "Phone number, ideally with +country code", example: "+1 650-253-0000" },
      country: { type: "string", description: "Two-letter country for a phone number without +code (US, GB, SE…)", example: "US" },
      website: { type: "string", description: "Website or domain of the lead", example: "stripe.com" },
    },
    { pack: "contact-verify", overall: "ok", email: { value: "alex.morgan@stripe.com", status: "ok", verdict: "likely-deliverable", reasons: [], mailbox: { acceptsMail: true, mailServers: ["aspmx.l.google.com"], disposable: false, roleAddress: false, freeProvider: false, hasSpf: true, hasDmarc: true }, domain: { domain: "stripe.com", trust: "high", ageDays: 11000, registrar: "SafeNames Ltd.", flags: [] } }, phone: null, website: null, failed: {} },
    async (env, q) => {
      const email = opt(q, "email", 320)?.trim().toLowerCase(), phone = opt(q, "phone", 40)?.trim(), website = opt(q, "website", 2000)?.trim();
      if (!email && !phone && !website) throw new HttpError(400, "give at least one of email, phone or website");
      const country = opt(q, "country", 2);
      const { data, failed } = await runSections({
        ...(email ? { email: emailCheck(email).then(async (m) => {
          const mail = m as Mail;
          if (mail.validSyntax === false || !mail.domain) return { mail, domain: undefined };
          return { mail, domain: await domainReport(env, mail.domain).catch(() => undefined) };
        }) } : {}),
        ...(phone ? { phone: Promise.resolve().then(() => phoneInfo(phone, country)).catch((e) => ({ valid: false, error: String((e as Error)?.message ?? e).slice(0, 120) })) } : {}),
        ...(website ? { website: siteCheck(env, website) } : {}),
      });
      const e = data.email as { mail: Mail; domain: Domain | undefined } | undefined;
      const p = data.phone as { valid?: boolean; possible?: boolean; e164?: string; country?: string; type?: string; error?: string } | undefined;
      const w = data.website as Awaited<ReturnType<typeof siteCheck>> | undefined;
      const emailOut = e ? (() => { const v = mailVerdict(e.mail, e.domain); return { value: email, status: v.verdict === "invalid" ? "invalid" : v.verdict === "risky" ? "review" : "ok", verdict: v.verdict, reasons: v.reasons, mailbox: e.mail.validSyntax === false ? null : mailView(e.mail), domain: domainView(e.domain) }; })() : null;
      const phoneOut = p ? { value: phone, status: p.valid ? "ok" : "invalid", valid: Boolean(p.valid), possible: p.possible ?? false, e164: p.e164 ?? null, country: p.country ?? null, type: p.type ?? null, ...(p.error ? { error: p.error } : {}) } : null;
      const webOut = w ? { value: website, status: w.risk === "low" ? "ok" : "review", url: w.url, finalUrl: w.finalUrl, risk: w.risk, signals: w.signals, domain: domainView(w.domain) } : null;
      const statuses = [emailOut?.status, phoneOut?.status, webOut?.status].filter(Boolean) as string[];
      const overall = statuses.includes("invalid") ? "review" : statuses.includes("review") ? "review" : "ok";
      return { pack: "contact-verify", overall: statuses.every((s) => s === "invalid") ? "invalid" : overall, email: emailOut, phone: phoneOut, website: webOut, failed: { ...failed, ...(w?.failed ?? {}) } };
    }, "$0.01"),

  entry("/pack/vendor-check", "Vendor check, supplier due diligence: website risk, domain age and sanctions screen",
    "Screen a vendor before you buy from it: where its website really leads, the destination domain's age and trust flags, HTTPS and security headers, named risk signals and, with a company name, a sanctions screen (OFAC, EU, UN, UK). One verdict: pass, review or block. Heuristic signals from public facts, not legal advice. Use for supplier onboarding, marketplace seller checks or a payee's website before an invoice is paid.",
    ["vendor-check", "supplier-due-diligence", "vendor-screening", "kyb-check", "due-diligence", "pack"], {
      domain: { type: "string", description: "The vendor's website or domain (a URL, a domain or an email address works)", required: true, example: "stripe.com" },
      name: { type: "string", description: "Company name for the sanctions screen (recommended)", example: "Stripe" },
    },
    { pack: "vendor-check", domain: "stripe.com", verdict: "pass", reasons: [], website: { url: "https://stripe.com/", finalUrl: "https://stripe.com/", risk: "low", signals: [], domain: { domain: "stripe.com", trust: "high", ageDays: 11000, registrar: "SafeNames Ltd.", flags: [] }, security: { https: true, score: 80, grade: "B" } }, sanctions: { screened: "Stripe", verdict: "pass", matches: 0 }, failed: {} },
    async (env, q) => {
      const host = hostFrom(need(q, "domain", 2000));
      const name = opt(q, "name", 200)?.trim();
      const screen = name && !BAD_NAMES.test(name);
      const site = await siteCheck(env, `https://${host}/`);
      const finalUrl = site.finalUrl ? new URL(site.finalUrl) : null;
      // siteCheck already resolved (it has its own address-level verdict), so it is guaranteed to answer and
      // the pack never 502s just because the security headers or sanctions list timed out.
      const { data, failed } = await runSections({
        site: Promise.resolve(site),
        headers: finalUrl && finalUrl.protocol === "https:" ? call(env, "/http/security-headers", { url: finalUrl.href }) : Promise.reject(new Error("the final page is not served over HTTPS")),
        ...(screen ? { sanctions: call(env, "/sanctions/check", { name }) } : {}),
      });
      const h = data.headers as { score?: number; grade?: string } | undefined;
      const s = data.sanctions as { verdict?: string; matches?: unknown[] } | undefined;
      const reasons: string[] = [];
      let verdict: "pass" | "review" | "block" = "pass";
      if (s?.verdict === "block") { verdict = "block"; reasons.push("the name matches a sanctions list entry"); }
      else if (s?.verdict === "review") { verdict = "review"; reasons.push("the name partly matches a sanctions list entry: check the matches"); }
      if (site.risk !== "low") { if (verdict === "pass") verdict = "review"; reasons.push(...site.signals.filter((x) => x.level !== "info").map((x) => x.message)); }
      const own = { ...failed, ...site.failed };
      if (!screen) reasons.push("no company name was given, so no sanctions screen was run");
      return {
        pack: "vendor-check", domain: host, verdict, reasons,
        website: { url: site.url, finalUrl: site.finalUrl, risk: site.risk, signals: site.signals, domain: domainView(site.domain), security: { https: finalUrl ? finalUrl.protocol === "https:" : null, score: h?.score ?? null, grade: h?.grade ?? null } },
        sanctions: screen ? { screened: name, verdict: s?.verdict ?? null, matches: s?.matches?.length ?? null } : null,
        failed: own,
      };
    }, "$0.01"),
];
