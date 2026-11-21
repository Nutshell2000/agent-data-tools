// Composed answers (20 Nov 2026). Research into the top x402 earners found that buyers pay for a *job result*, not a
// data point: tollkit's diligence and attest endpoints, StableEnrich's bundles, dTelecom's one-call session. These
// routes chain tools we already own into one paid call, return a deterministic contract, and attach an Ed25519
// receipt (the same key as payee attestations, via signPayload) so a buyer can verify what was served.
import { entry, need, type Entry, type Input } from "../family";
import { HttpError, type Env } from "../lib/env";
import { extract } from "./extract";
import { call, runSections } from "./packs";
import { PACKS_INTEL } from "./packs-intel";
import { KEYS_PATH, signPayload } from "./payee";

const ORIGIN = "https://agent-data-tools.revmesh2074.workers.dev";
const b64 = (b: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(b)));
const sha256 = async (text: string) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)))].map((b) => b.toString(16).padStart(2, "0")).join("");

/** A tamper-evident receipt a buyer can check offline; unsigned when no PAYEE_SIGNING_KEY is configured (honest fallback). */
async function receipt(env: Env, kind: string, subject: string, result: unknown) {
  const payload = {
    v: 1, kind, subject, iss: ORIGIN, iat: new Date().toISOString(),
    resultSha256: await sha256(JSON.stringify(result)),
    terms: { currency: "USDC", network: "eip155:8453", unit: "per answer", payTo: "0x6293ded2684f1a76e26becef87c137d691fbf800" },
  };
  const signed = await signPayload(payload, env, ORIGIN);
  return { payload, signature: signed.signature, alg: signed.alg, kid: signed.kid, keys: signed.keys, note: signed.note };
}

// packs.ts's `call()` reaches only the modules packs.ts imports. /extract (a core tool) and /pack/domain-intel
// (packs-intel.ts, which imports packs.ts) are outside it: until 1.323.0 both answers called them through `call()`,
// which threw "pack references unknown tool" before any section ran, so every call ended in a 500 (found by
// smoke:examples on 21 Nov 2026). Both run from their own module now, inside a promise so a failure stays a section's.
// No archive fallback here (safety audit, 21 Nov 2026): the receipt says what the page said when it was read, so an
// Internet Archive copy must never stand in for the live page. A page that is down fails the call, uncharged.
const pageText = (url: string) => Promise.resolve().then(() => extract(url, "20000", "text", undefined, { archiveFallback: false }));
const domainIntel = (env: Env, domain: string) => Promise.resolve().then(() => {
  const pack = PACKS_INTEL.find((x) => x.endpoint.path === "/pack/domain-intel");
  if (!pack) throw new Error("the domain-intel pack is missing");
  const q: Input = (name) => (name === "domain" ? domain : undefined);
  return pack.run(env, q);
});

export const ANSWERS: Entry[] = [
  entry("/answers/page-evidence", "Page evidence pack: read, headers and signed hash",
    "One call for one public URL: fetch the page as clean text, grade its HTTP security headers, and return a SHA-256 of the extracted text with a receipt naming the URL, the result hash and the payment terms, Ed25519-signed with our published key. The hash covers the text as read, not the page's raw bytes. Use when an agent needs citable evidence that a page said something at a point in time. Failures are never charged; nulls are never guesses.",
    ["page-evidence", "signed-evidence", "web-evidence", "attestation", "answer"],
    { url: { type: "string", description: "Public http(s) URL to capture", required: true, example: "https://example.com" } },
    // The shape the handler returns (21 Nov 2026: the example used to show a top-level signature and no receipt).
    {
      pack: "page-evidence", url: "https://example.com", text: "Example Domain\nThis domain is for use in documentation examples…", textLength: 126,
      security: { grade: "D", score: 40 }, hashSha256: "…",
      receipt: {
        payload: { v: 1, kind: "page-evidence", subject: "https://example.com", iss: ORIGIN, iat: "2026-11-21T00:00:00.000Z", resultSha256: "…", terms: { currency: "USDC", network: "eip155:8453", unit: "per answer", payTo: "0x6293ded2684f1a76e26becef87c137d691fbf800" } },
        signature: "…", alg: "EdDSA", kid: "…", keys: `${ORIGIN}${KEYS_PATH}`, note: "Verify Ed25519 over the UTF-8 bytes of canonical, with the key named by kid. It attests the facts at iat only.",
      },
      failed: {},
    },
    async (env, q) => {
      const url = need(q, "url", 2000);
      const { data, failed } = await runSections({
        text: pageText(url),
        security: call(env, "/http/security-headers", { url }),
      });
      const text = (data.text as { text?: string } | undefined)?.text ?? "";
      if (!text) throw new HttpError(404, "the page returned no readable text; nothing was charged");
      const result = { url, text: text.slice(0, 20000), textLength: text.length, security: data.security ?? null, hashSha256: await sha256(text) };
      return { pack: "page-evidence", ...result, receipt: await receipt(env, "page-evidence", url, result), failed };
    }, "$0.05"),

  entry("/answers/company-diligence", "Company diligence: domain intel and sanctions in one answer",
    "One call for one company domain: site identity, tech stack, email provider and email security, hosting, DNS and registration age, plus a sanctions-list screen (OFAC, EU, UN, UK) of the domain's own name, the label before the first dot. No company register is read. Use when an agent must vet a counterparty's website before dealing with it: one answer with a signed receipt and per-section failures. Public sources only; no private data.",
    ["company-diligence", "vendor-diligence", "counterparty", "company-research", "answer"],
    { domain: { type: "string", description: "Company domain such as stripe.com", required: true, example: "stripe.com" } },
    // The shape the handler returns (21 Nov 2026: the example used to show site and registration at the top level).
    {
      pack: "company-diligence", domain: "stripe.com",
      intel: { pack: "domain-intel", domain: "stripe.com", site: { siteName: "Stripe" }, email: { provider: "Google Workspace", spfPolicy: "~all", dmarcPolicy: "reject" }, registration: { registrar: "SafeNames Ltd.", ageDays: 11000 }, failed: {} },
      sanctions: { query: { name: "stripe" }, verdict: "pass", listed: false, matches: [] },
      receipt: {
        payload: { v: 1, kind: "company-diligence", subject: "stripe.com", iss: ORIGIN, iat: "2026-11-21T00:00:00.000Z", resultSha256: "…", terms: { currency: "USDC", network: "eip155:8453", unit: "per answer", payTo: "0x6293ded2684f1a76e26becef87c137d691fbf800" } },
        signature: "…", alg: "EdDSA", kid: "…", keys: `${ORIGIN}${KEYS_PATH}`, note: "Verify Ed25519 over the UTF-8 bytes of canonical, with the key named by kid. It attests the facts at iat only.",
      },
      failed: {},
    },
    async (env, q) => {
      const domain = need(q, "domain", 300);
      const { data, failed } = await runSections({
        intel: domainIntel(env, domain),
        sanctions: call(env, "/sanctions/check", { name: domain.replace(/\..*$/, "") }),
      });
      if (!data.intel) throw new HttpError(502, "the company lookup failed; nothing was charged");
      const intel = data.intel as Record<string, unknown>;
      const result = { domain, intel, sanctions: data.sanctions ?? null };
      return { pack: "company-diligence", ...result, receipt: await receipt(env, "company-diligence", domain, result), failed };
    }, "$0.05"),
];
