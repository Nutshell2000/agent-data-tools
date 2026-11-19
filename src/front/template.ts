/**
 * Quote front (19 Nov 2026), step 2: a quote template and how the front rebuilds a quote from it.
 *
 * A template is one real core answer to a bare unpaid JSON GET of a tool path on one host, with the parts that belong to
 * a single request taken out:
 *   - per-answer headers (request id, date, cf-ray…; see PER_ANSWER), the MPP challenges (WWW-Authenticate) and
 *     PAYMENT-REQUIRED, which is kept decoded so its resource.url can be set per request;
 *   - the MPP route terms are kept (method, intent, request, description, scope); the front mints a fresh challenge
 *     from them for every answer (src/front/challenges.ts); a challenge is never stored.
 * fromTemplate() sets resource.url to the raw request URL (header and body) and freeTrial.url to the core's form
 * (origin + path + "?" + URLSearchParams(query) + "&trial=1", or "?trial=1" with no query), the only per-request
 * fields of a quote. tests/quote-front-template.test.cjs compares the result with the real core, byte for byte.
 */
import { termsOf, type MppTerms } from "./challenges";

export interface QuoteTemplate {
  v: 1;
  status: number;
  headers: [string, string][];
  paymentRequired: Record<string, unknown> | null;
  body: Record<string, unknown>;
  mpp: MppTerms[];
}

const PER_ANSWER = new Set(["www-authenticate", "payment-required", "x-request-id", "date", "content-length", "set-cookie", "x-quote-cache", "cf-ray", "report-to", "nel", "server", "alt-svc"]);

const b64decode = (s: string) => new TextDecoder().decode(Uint8Array.from(atob(s), (c) => c.charCodeAt(0)));
const b64encode = (s: string) => { const bytes = new TextEncoder().encode(s); let bin = ""; for (const b of bytes) bin += String.fromCharCode(b); return btoa(bin); };

/** Splits a WWW-Authenticate header that may carry several `Payment …` challenges into single challenges. */
export function splitChallenges(header: string | null): string[] {
  if (!header) return [];
  return header.split(/,\s*(?=Payment\s)/).map((s) => s.trim()).filter(Boolean);
}

/** A template from one core answer (status, headers, body text) to a bare unpaid JSON GET. */
export function toTemplate(status: number, headers: Headers, bodyText: string): QuoteTemplate {
  const kept: [string, string][] = [];
  headers.forEach((value, name) => { if (!PER_ANSWER.has(name.toLowerCase())) kept.push([name, value]); });
  const pr = headers.get("payment-required");
  const mpp: MppTerms[] = [];
  for (const raw of [...headers.entries()].filter(([n]) => n.toLowerCase() === "www-authenticate").flatMap(([, v]) => splitChallenges(v))) {
    const terms = termsOf(raw);
    if (!terms) throw new Error("not a tempo/evm challenge with a scope");
    mpp.push(terms);
  }
  return { v: 1, status, headers: kept, paymentRequired: pr ? JSON.parse(b64decode(pr)) : null, body: JSON.parse(bodyText), mpp };
}

/** The core's freeTrial.url for this request URL. */
export function trialUrl(requestUrl: URL): string {
  const params = new URLSearchParams(requestUrl.search);
  const q = params.toString();
  return `${requestUrl.origin}${requestUrl.pathname}?${q ? `${q}&` : ""}trial=1`;
}

/** Status, headers (without MPP challenges) and body text for this request, rebuilt from the template. */
export function fromTemplate(tpl: QuoteTemplate, requestUrl: string): { status: number; headers: [string, string][]; body: string } {
  const url = new URL(requestUrl);
  const headers = tpl.headers.map(([n, v]) => [n, v] as [string, string]);
  if (tpl.paymentRequired) {
    const pr = structuredClone(tpl.paymentRequired) as { resource?: { url?: string } };
    if (pr.resource) pr.resource.url = requestUrl;
    headers.push(["payment-required", b64encode(JSON.stringify(pr))]);
  }
  const body = structuredClone(tpl.body) as { resource?: { url?: string }; freeTrial?: { url?: string } };
  if (body.resource) body.resource.url = requestUrl;
  // A bare URL keeps the template's trial link: the core fills it with the tool's example inputs (a bare trial would fail).
  if (body.freeTrial?.url && url.search.length > 1) body.freeTrial.url = trialUrl(url);
  return { status: tpl.status, headers, body: JSON.stringify(body) };
}
