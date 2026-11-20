// Composed answers (20 Nov 2026). Research into the top x402 earners found that buyers pay for a *job result*, not a
// data point: tollkit's diligence and attest endpoints, StableEnrich's bundles, dTelecom's one-call session. These
// routes chain tools we already own into one paid call, return a deterministic contract, and attach an Ed25519
// receipt (the same key as payee attestations, via signPayload) so a buyer can verify what was served.
import { entry, need, type Entry } from "../family";
import { HttpError, type Env } from "../lib/env";
import { call, runSections } from "./packs";
import { signPayload } from "./payee";

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

export const ANSWERS: Entry[] = [
  entry("/answers/page-evidence", "Page evidence pack: read, headers and signed hash",
    "One call for one public URL: fetch the page as clean text, read its HTTPS/security headers, and return a SHA-256 of the text with an Ed25519-signed receipt naming the URL, the result hash and the payment terms. Use when an agent needs citable evidence that a page said something at a point in time. Failures are never charged; nulls are never guesses.",
    ["page-evidence", "signed-evidence", "web-evidence", "attestation", "answer"],
    { url: { type: "string", description: "Public http(s) URL to capture", required: true, example: "https://example.com" } },
    { pack: "page-evidence", url: "https://example.com", text: "Example Domain", hashSha256: "…", security: { https: true, score: 80 }, signature: null, failed: {} },
    async (env, q) => {
      const url = need(q, "url", 2000);
      const { data, failed } = await runSections({
        text: call(env, "/extract", { url }),
        security: call(env, "/http/security-headers", { url }),
      });
      const text = (data.text as { text?: string } | undefined)?.text ?? "";
      if (!text) throw new HttpError(404, "the page returned no readable text; nothing was charged");
      const result = { url, text: text.slice(0, 20000), textLength: text.length, security: data.security ?? null, hashSha256: await sha256(text) };
      return { pack: "page-evidence", ...result, receipt: await receipt(env, "page-evidence", url, result), failed };
    }, "$0.05"),

  entry("/answers/company-diligence", "Company diligence: domain, company and sanctions in one answer",
    "One call for one company domain: site identity, tech stack, email security, hosting, DNS and registration age, plus an OFAC name screen. Use when an agent must vet a counterparty before dealing with it: a deterministic answer with a signed receipt and per-section failures. Public sources only; no private data.",
    ["company-diligence", "vendor-diligence", "counterparty", "company-research", "answer"],
    { domain: { type: "string", description: "Company domain such as stripe.com", required: true, example: "stripe.com" } },
    { pack: "company-diligence", domain: "stripe.com", site: { siteName: "Stripe" }, registration: { registrar: "SafeNames Ltd.", ageDays: 11000 }, sanctions: null, receipt: null, failed: {} },
    async (env, q) => {
      const domain = need(q, "domain", 300);
      const { data, failed } = await runSections({
        intel: call(env, "/pack/domain-intel", { domain }),
        sanctions: call(env, "/sanctions/check", { name: domain.replace(/\..*$/, "") }),
      });
      if (!data.intel) throw new HttpError(502, "the company lookup failed; nothing was charged");
      const intel = data.intel as Record<string, unknown>;
      const result = { domain, intel, sanctions: data.sanctions ?? null };
      return { pack: "company-diligence", ...result, receipt: await receipt(env, "company-diligence", domain, result), failed };
    }, "$0.05"),
];
