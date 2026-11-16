/**
 * Verified payee records (15 Nov 2026). The product's working name is internal:
 * paths and copy say "payee record" and never carry it.
 *
 * A business that sells to agents publishes /.well-known/agent-payee.json on its own domain: its company identifiers
 * (register ID, EU VAT number, LEI), the wallets it is paid to (each optionally signed) and how it takes e-invoices.
 * Serving the file over https on the domain proves control of the domain. We then check the company in the official
 * registers, VIES and the sanctions lists (the /pack/kyb-eu engine), check each wallet's signature and screen it
 * against OFAC, and keep the result as a record with a signed attestation any agent can verify offline.
 *
 * - Claiming is free for sellers (GET /payee/claim?domain=…), so the set of verified sellers can grow.
 * - Buyers' agents pay for /payee/check before paying a seller: is this payee a verified business, is the wallet in
 *   the quote one the business proved it controls, is anything on a sanctions list.
 *
 * Lines that stay: we never hold, move or sign funds; a record states verified facts and never rates anyone's
 * economic standing (no credit or solvency view: the IMY line in memory note credit-check-research-2026-11-11).
 */
import { getAddress, verifyMessage } from "viem";
import { entry, opt, type Entry, type Input } from "../family";
import { HttpError, isAddress, type Env } from "../lib/env";
import { capBytes, fetchPublic, parseTarget } from "../lib/fetch";
import { isSelfHost } from "../lib/self-fetch";
import { payoutWallets } from "../lib/payout-wallets";
import { CHAINS, client } from "./chain-reads";
import { coreName, kybCheck, kybDeps } from "./kyb";
import { SANCTIONS } from "./sanctions";
import { canonicalJson, liveTerms } from "./trust";

export const DECLARATION_PATH = "/.well-known/agent-payee.json";
export const KEYS_PATH = "/.well-known/agent-payee-keys.json";
/** How long a record and its attestation stand before they must be checked again. */
export const RECORD_DAYS = 30;
/** A stored record younger than this is served by /payee/check without checking again. */
const FRESH_DAYS = 7;
/** A claim within this many minutes of the last one returns the stored record (each claim reads four outside sources). */
export const CLAIM_COOLDOWN_MIN = 15;
const MAX_WALLETS = 20;
const NETWORKS = ["base", "eth", "arb", "op", "polygon", "solana", "tempo"] as const;

/** The text a wallet signs (EIP-191 personal_sign) to prove the domain's business controls it. */
export const walletMessage = (domain: string, address: string) => `agent-payee:${domain}:${address.toLowerCase()}`;

const HOST = /^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/;

/** "https://Shop.Example.com/path" or "shop.example.com" -> "shop.example.com"; refuses IPs, ports and bare names. */
export function payeeDomain(raw: string | undefined): string {
  const text = (raw ?? "").trim().toLowerCase();
  if (!text) throw new HttpError(400, "domain is required, for example example.com");
  let host: string;
  try { host = new URL(/^[a-z][a-z0-9+.-]*:\/\//.test(text) ? text : `https://${text}`).hostname; } catch { throw new HttpError(400, "domain must be a host name such as example.com"); }
  host = host.replace(/\.$/, "");
  if (!HOST.test(host) || /^\d+(\.\d+){3}$/.test(host)) throw new HttpError(400, "domain must be a public host name such as example.com (no IP address, port or path)");
  return host;
}

export interface DeclaredWallet { address: string; network: string; signature: string | null }
/**
 * How the business takes payment (declaration v2, step A of the all-rails plan). Each entry names a rail and what a
 * buyer needs to pay on it. Card and bank rails are references the business publishes (a checkout link, a Swish
 * business number, a page with bank instructions); we never execute a payment and never store card data.
 */
export type Accepted =
  | { rail: "x402"; network: string; payTo: string | null; url: string | null }
  | { rail: "mpp"; method: string; url: string | null }
  | { rail: "card"; checkoutUrl: string; provider: string | null }
  | { rail: "sepa-instant"; instructionsUrl: string }
  | { rail: "swish"; number: string };
export const RAILS = ["x402", "mpp", "card", "sepa-instant", "swish"] as const;
/** Checkout hosts of known payment providers; another host is kept but flagged. */
export const PSP_HOSTS: Record<string, string> = { "buy.stripe.com": "Stripe", "checkout.stripe.com": "Stripe", "pay.adyen.com": "Adyen", "www.paypal.com": "PayPal", "paypal.me": "PayPal", "pay.klarna.com": "Klarna", "checkout.mollie.com": "Mollie", "pay.sumup.com": "SumUp", "checkout.revolut.com": "Revolut" };

export interface Declaration {
  company: { name: string | null; country: string | null; id: string | null; vat: string | null; lei: string | null } | null;
  wallets: DeclaredWallet[];
  einvoice: { peppolId: string | null; formats: string[] } | null;
  accepts: Accepted[];
}

const httpsUrl = (v: unknown) => {
  const s = str(v, 2_000);
  if (!s) return null;
  try { const u = new URL(s); return u.protocol === "https:" ? u.href : null; } catch { return null; }
};

export function parseAccepts(raw: unknown, problems: string[]): Accepted[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) { problems.push("accepts must be a list"); return []; }
  const out: Accepted[] = [];
  for (const a of raw.slice(0, 20)) {
    const o = a && typeof a === "object" ? (a as Record<string, unknown>) : {};
    const rail = str(o.rail, 20)?.toLowerCase();
    if (rail === "x402") {
      const payTo = str(o.payTo, 100);
      if (payTo && !isAddress(payTo) && !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(payTo)) { problems.push("an x402 entry's payTo is not a wallet address"); continue; }
      out.push({ rail, network: (str(o.network, 20) ?? "base").toLowerCase(), payTo: payTo ? (isAddress(payTo) ? getAddress(payTo) : payTo) : null, url: httpsUrl(o.url) });
    } else if (rail === "mpp") {
      out.push({ rail, method: (str(o.method, 20) ?? "tempo").toLowerCase(), url: httpsUrl(o.url) });
    } else if (rail === "card") {
      const checkoutUrl = httpsUrl(o.checkoutUrl ?? o.url);
      if (!checkoutUrl) { problems.push("a card entry needs an https checkoutUrl"); continue; }
      out.push({ rail, checkoutUrl, provider: PSP_HOSTS[new URL(checkoutUrl).hostname] ?? null });
    } else if (rail === "sepa-instant" || rail === "sepa") {
      const instructionsUrl = httpsUrl(o.instructionsUrl ?? o.url);
      if (!instructionsUrl) { problems.push("a sepa-instant entry needs an https instructionsUrl (we do not store account numbers)"); continue; }
      out.push({ rail: "sepa-instant", instructionsUrl });
    } else if (rail === "swish") {
      const number = str(o.number, 20)?.replace(/[\s-]/g, "") ?? "";
      if (!/^123\d{7}$/.test(number)) { problems.push("a swish entry needs a Swish business number (123 and 7 digits)"); continue; }
      out.push({ rail, number });
    } else {
      problems.push(`unknown rail ${String(o.rail ?? "").slice(0, 20) || "(none)"}; known: ${RAILS.join(", ")}`);
    }
  }
  return out;
}

const str = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

/** Reads a declaration leniently: unknown fields are ignored, bad ones are dropped and named in `problems`. */
export function parseDeclaration(doc: unknown): { declaration: Declaration; problems: string[] } {
  const problems: string[] = [];
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return { declaration: { company: null, wallets: [], einvoice: null, accepts: [] }, problems: ["the file is not a JSON object"] };
  const d = doc as Record<string, unknown>;

  let company: Declaration["company"] = null;
  if (d.company && typeof d.company === "object") {
    const c = d.company as Record<string, unknown>;
    // Read long, then validate: cutting first would turn "Sweden" into "SW".
    const country = str(c.country, 60)?.toUpperCase() ?? null;
    const vat = str(c.vat, 60)?.toUpperCase().replace(/[\s.-]/g, "") ?? null;
    const lei = str(c.lei, 60)?.toUpperCase().replace(/\s/g, "") ?? null;
    company = { name: str(c.name, 200), country: country && /^[A-Z]{2}$/.test(country) ? country : null, id: str(c.id, 40), vat: vat && /^[A-Z]{2}[0-9A-Z]{2,13}$/.test(vat) ? vat : null, lei: lei && /^[0-9A-Z]{20}$/.test(lei) ? lei : null };
    if (country && !company.country) problems.push("company.country must be a 2-letter ISO code");
    if (vat && !company.vat) problems.push("company.vat is not shaped like an EU VAT number (country prefix and digits)");
    if (lei && !company.lei) problems.push("company.lei must be 20 letters and digits");
    if (!company.name && !company.vat && !company.lei && !company.id) { problems.push("company names no name, id, vat or lei"); company = null; }
  }

  const rawWallets = Array.isArray(d.payTo) ? d.payTo : Array.isArray(d.wallets) ? d.wallets : [];
  const wallets: DeclaredWallet[] = [];
  for (const w of rawWallets.slice(0, MAX_WALLETS)) {
    const o = typeof w === "string" ? { address: w } : w && typeof w === "object" ? (w as Record<string, unknown>) : {};
    const address = str(o.address, 100);
    if (!address) { problems.push("a payTo entry has no address"); continue; }
    const evm = isAddress(address);
    if (!evm && !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) { problems.push(`payTo ${address.slice(0, 50)} is not an EVM or Solana address`); continue; }
    const network = str(o.network, 20)?.toLowerCase() ?? (evm ? "base" : "solana");
    const signature = str(o.signature, 20_000);
    wallets.push({ address: evm ? getAddress(address) : address, network: (NETWORKS as readonly string[]).includes(network) ? network : network.slice(0, 20), signature: signature && /^0x[0-9a-fA-F]+$/.test(signature) ? signature : null });
    if (signature && !/^0x[0-9a-fA-F]+$/.test(signature)) problems.push(`the signature for ${address.slice(0, 12)}… is not 0x hex`);
  }
  if (rawWallets.length > MAX_WALLETS) problems.push(`only the first ${MAX_WALLETS} payTo entries are read`);

  let einvoice: Declaration["einvoice"] = null;
  if (d.einvoice && typeof d.einvoice === "object") {
    const e = d.einvoice as Record<string, unknown>;
    const peppol = str(e.peppolId, 80);
    const formats = Array.isArray(e.formats) ? e.formats.map((f) => str(f, 40)).filter((f): f is string => !!f).slice(0, 10) : [];
    einvoice = { peppolId: peppol && /^\d{4}:[A-Za-z0-9.:_-]{1,60}$/.test(peppol) ? peppol : null, formats };
    if (peppol && !einvoice.peppolId) problems.push("einvoice.peppolId must look like 0007:5567037485 (scheme:identifier)");
  }
  const accepts = parseAccepts(d.accepts, problems);
  return { declaration: { company, wallets, einvoice, accepts }, problems };
}

type Kyb = Awaited<ReturnType<typeof kybCheck>>;
export interface PayeeDeps {
  /** The declaration file's body, or null when the domain does not serve one (404, not JSON-shaped, unreachable). */
  declaration: (domain: string) => Promise<{ found: true; text: string } | { found: false; reason: string }>;
  kyb: (input: { q?: string; vat?: string; lei?: string; country?: string }) => Promise<Kyb>;
  /** OFAC screen of one wallet: block, review or pass. */
  walletSanctions: (address: string) => Promise<string>;
  /** EIP-191 check, contract wallets (ERC-1271) included. */
  verifySignature: (address: `0x${string}`, message: string, signature: `0x${string}`) => Promise<boolean>;
  now?: () => Date;
}

const digits = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "");

export async function verifyPayee(domain: string, deps: PayeeDeps) {
  const now = deps.now?.() ?? new Date();
  const flags: string[] = [];
  const sources = new Set<string>();
  const declarationUrl = `https://${domain}${DECLARATION_PATH}`;
  const base = { domain, declarationUrl, verifiedAt: now.toISOString(), expiresAt: new Date(now.getTime() + RECORD_DAYS * 86_400_000).toISOString() };

  const file = await deps.declaration(domain);
  if (!file.found) {
    return { ...base, status: "none" as const, flags: [`no declaration at ${declarationUrl} (${file.reason})`], checks: { domain: "not-proven", company: "not-declared", wallets: [], einvoice: "not-declared" }, company: null, wallets: [], einvoice: null, accepts: [] as Accepted[], sources: [] as string[] };
  }
  let parsed: unknown;
  try { parsed = JSON.parse(file.text); } catch { parsed = null; }
  const { declaration, problems } = parseDeclaration(parsed);
  flags.push(...problems.map((p) => `declaration: ${p}`));
  sources.add(`${declarationUrl} (served over https by the domain)`);

  // Company: official registers, VIES, LEI and sanctions in one pass.
  let companyCheck = "not-declared";
  let company: Record<string, unknown> | null = null;
  let review = false;
  if (declaration.company) {
    const c = declaration.company;
    const kyb = await deps.kyb({ q: c.name ?? undefined, vat: c.vat ?? undefined, lei: c.lei ?? undefined, country: c.country ?? undefined });
    for (const s of kyb.sources) sources.add(s);
    const reg = kyb.company;
    const nameDiffers = !!(c.name && reg?.name && coreName(c.name).toLowerCase() !== coreName(reg.name).toLowerCase());
    const idDiffers = !!(c.id && reg?.id && digits(c.id) !== digits(reg.id));
    if (nameDiffers) flags.push(`declared name "${c.name}" differs from the register entry "${reg!.name}"`);
    if (idDiffers) flags.push(`declared register ID ${c.id} differs from the register entry's ${reg!.id}`);
    for (const f of kyb.flags) flags.push(`company: ${f}`);
    const sanctioned = kyb.sanctions.verdict === "review";
    companyCheck = !reg ? "not-found" : kyb.verdict === "pass" && !nameDiffers && !idDiffers ? "pass" : "review";
    if (sanctioned || idDiffers || (kyb.vat as { given?: boolean; valid?: boolean } | null)?.given && (kyb.vat as { valid?: boolean }).valid === false) review = true;
    company = {
      declared: c,
      register: reg ? { name: reg.name, country: reg.country, idType: reg.idType, id: reg.id, legalForm: reg.legalForm ?? null, status: reg.status ?? null, source: reg.source } : null,
      vat: kyb.vat ? { vat: (kyb.vat as Record<string, unknown>).vat ?? null, valid: (kyb.vat as Record<string, unknown>).valid ?? null, name: (kyb.vat as Record<string, unknown>).name ?? null, derived: (kyb.vat as Record<string, unknown>).derived ?? false } : null,
      lei: kyb.lei ? { lei: kyb.lei.lei ?? null, legalName: kyb.lei.legalName ?? null, entityStatus: kyb.lei.entityStatus ?? null } : null,
      sanctions: { verdict: kyb.sanctions.verdict, matches: kyb.sanctions.matches.length, screenedNames: kyb.sanctions.screenedNames },
    };
  } else {
    flags.push("no registered business is declared, so the payee is a domain and its wallets, not a verified company");
  }

  // Wallets: a signature over walletMessage() proves control; every EVM wallet is screened against OFAC.
  const wallets = await Promise.all(declaration.wallets.map(async (w) => {
    const evm = isAddress(w.address);
    let proof: "signature" | "bad-signature" | "declared" = "declared";
    if (evm && w.signature) {
      const ok = await deps.verifySignature(w.address as `0x${string}`, walletMessage(domain, w.address), w.signature as `0x${string}`).catch(() => false);
      proof = ok ? "signature" : "bad-signature";
      if (!ok) flags.push(`the signature for ${w.address} does not verify for the text "${walletMessage(domain, w.address)}"`);
    }
    let sanctions = "not-checked";
    if (evm) {
      sanctions = await deps.walletSanctions(w.address).catch(() => "not-checked");
      if (sanctions === "block") { review = true; flags.push(`${w.address} is on the OFAC list`); }
    }
    return { address: w.address, network: w.network, proof, sanctions };
  }));
  if (wallets.some((w) => w.sanctions !== "not-checked")) sources.add("OFAC SDN list (wallet addresses)");
  if (!wallets.length) flags.push("no payTo wallet is declared");
  else if (!wallets.some((w) => w.proof === "signature")) flags.push(`no wallet is proven by a signature: sign "${walletMessage(domain, "<address>")}" with each payout wallet and put the signature next to it`);

  // Rails: an x402 payTo must be one of the declared wallets (else a quote could name a wallet nobody proved).
  const walletSet = new Set(wallets.map((w) => w.address.toLowerCase()));
  for (const a of declaration.accepts) {
    if (a.rail === "x402" && a.payTo && !walletSet.has(a.payTo.toLowerCase())) flags.push(`accepts: the x402 payTo ${a.payTo} is not in payTo, so it is not proven`);
    if (a.rail === "card" && !a.provider) flags.push(`accepts: the card checkout host ${new URL(a.checkoutUrl).hostname} is not a payment provider we know`);
  }
  if (!declaration.accepts.length) flags.push("no accepts list: buyers can only be told about the wallets in payTo");

  const proven = wallets.some((w) => w.proof === "signature");
  const status = review ? "review" as const : companyCheck === "pass" && proven ? "verified" as const : "partial" as const;
  return {
    ...base, status, flags,
    checks: { domain: "proven", company: companyCheck, wallets: wallets.map((w) => ({ address: w.address, proof: w.proof, sanctions: w.sanctions })), einvoice: declaration.einvoice ? "declared" : "not-declared" },
    company, wallets, einvoice: declaration.einvoice, accepts: declaration.accepts,
    sources: [...sources],
  };
}

export type PayeeRecord = Awaited<ReturnType<typeof verifyPayee>>;

// ---- Signed attestation (Ed25519). The private key is the Worker secret PAYEE_SIGNING_KEY, a JWK with d and x. ----

const b64url = (bytes: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
async function sha256Hex(text: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

interface SigningJwk { kty: string; crv: string; x: string; d?: string }
function signingJwk(env: Pick<Env, "PAYEE_SIGNING_KEY">): SigningJwk | null {
  if (!env.PAYEE_SIGNING_KEY) return null;
  try {
    const jwk = JSON.parse(env.PAYEE_SIGNING_KEY) as SigningJwk;
    return jwk.kty === "OKP" && jwk.crv === "Ed25519" && jwk.x && jwk.d ? jwk : null;
  } catch { return null; }
}
const keyId = async (x: string) => (await sha256Hex(x)).slice(0, 16);

/** The public keys document (JWKS) a verifier reads; empty while no key is configured. */
export async function publicKeys(env: Pick<Env, "PAYEE_SIGNING_KEY">) {
  const jwk = signingJwk(env);
  return { keys: jwk ? [{ kty: "OKP", crv: "Ed25519", x: jwk.x, kid: await keyId(jwk.x), use: "sig", alg: "EdDSA" }] : [], format: "Attestation signature = Ed25519 over the UTF-8 bytes of the attestation's canonical text (sorted-key JSON of payload)." };
}

export async function attest(record: PayeeRecord, env: Pick<Env, "PAYEE_SIGNING_KEY">, issuer: string) {
  const payload = {
    v: 1, iss: issuer, sub: record.domain, status: record.status,
    company: record.company ? (() => {
      const r = (record.company as { register: Record<string, unknown> | null; vat: Record<string, unknown> | null; lei: Record<string, unknown> | null }).register;
      const vat = (record.company as { vat: Record<string, unknown> | null }).vat;
      const lei = (record.company as { lei: Record<string, unknown> | null }).lei;
      return { name: r?.name ?? null, country: r?.country ?? null, id: r?.id ?? null, vat: vat?.valid ? vat.vat : null, lei: lei?.lei ?? null };
    })() : null,
    wallets: record.wallets.filter((w) => w.proof === "signature").map((w) => ({ address: w.address, network: w.network })),
    einvoice: record.einvoice?.peppolId ? { peppolId: record.einvoice.peppolId } : null,
    iat: record.verifiedAt, exp: record.expiresAt,
  };
  const canonical = canonicalJson(payload);
  const jwk = signingJwk(env);
  if (!jwk) return { payload, canonical, alg: "EdDSA", kid: null, signature: null, keys: `${issuer}${KEYS_PATH}`, note: "Not signed: the signing key is not configured on this deployment." };
  // Only the key's own fields: workerd refuses the "alg": "Ed25519" that Node's exportKey adds (it wants EdDSA or none).
  const key = await crypto.subtle.importKey("jwk", { kty: "OKP", crv: "Ed25519", x: jwk.x, d: jwk.d } as JsonWebKey, { name: "Ed25519" }, false, ["sign"]);
  const sig = await crypto.subtle.sign({ name: "Ed25519" }, key, new TextEncoder().encode(canonical));
  return { payload, canonical, alg: "EdDSA", kid: await keyId(jwk.x), signature: b64url(sig), keys: `${issuer}${KEYS_PATH}`, note: "Verify the signature over the canonical text with the key named by kid. It attests what was checked at iat; check again after exp." };
}

// ---- Storage: KV TRIALS. One record per domain; a wallet points at its domain only when proven by a signature. ----

const recKey = (domain: string) => `payee:rec:${domain}`;
const walletKey = (address: string) => `payee:wallet:${address.toLowerCase()}`;
const TTL = (RECORD_DAYS + 5) * 86_400;

export async function storeRecord(env: Env, record: PayeeRecord) {
  if (!env.TRIALS) return;
  await env.TRIALS.put(recKey(record.domain), JSON.stringify(record), { expirationTtl: TTL, metadata: { status: record.status, verifiedAt: record.verifiedAt } });
  await Promise.all(record.wallets.filter((w) => w.proof === "signature").map((w) => env.TRIALS!.put(walletKey(w.address), record.domain, { expirationTtl: TTL })));
}
export async function readRecord(env: Env, domain: string): Promise<PayeeRecord | null> {
  const text = await env.TRIALS?.get(recKey(domain));
  if (!text) return null;
  try { return JSON.parse(text) as PayeeRecord; } catch { return null; }
}
export async function domainOfWallet(env: Env, address: string): Promise<string | null> {
  return (await env.TRIALS?.get(walletKey(address))) ?? null;
}
/** Every stored record's domain and status (KV list metadata, no record reads). */
export async function registry(env: Env, limit = 1000) {
  if (!env.TRIALS) return [];
  const out: { domain: string; status: string; verifiedAt: string }[] = [];
  let cursor: string | undefined;
  do {
    const page = await env.TRIALS.list<{ status: string; verifiedAt: string }>({ prefix: "payee:rec:", cursor, limit: 1000 });
    for (const k of page.keys) out.push({ domain: k.name.slice("payee:rec:".length), status: k.metadata?.status ?? "unknown", verifiedAt: k.metadata?.verifiedAt ?? "" });
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor && out.length < limit);
  return out.slice(0, limit);
}

// ---- Live dependencies ----

const runOf = (list: Entry[], path: string) => list.find((e) => e.endpoint.path === path)!.run;
const asInput = (o: Record<string, string | undefined>): Input => (n) => o[n];

export function payeeDeps(env: Env): PayeeDeps {
  return {
    declaration: async (domain) => {
      const url = new URL(`https://${domain}${DECLARATION_PATH}`);
      try {
        const res = isSelfHost(env, domain) && env.SELF
          ? await env.SELF.fetch(url.href, { headers: { accept: "application/json" } })
          : await fetchPublic(url, "application/json", [404, 410, 403]);
        if (!res.ok) { await res.body?.cancel().catch(() => {}); return { found: false, reason: `HTTP ${res.status}` }; }
        const text = res.body ? await new Response(capBytes(res.body, 65_536, () => {})).text() : "";
        return text.trim().startsWith("{") ? { found: true, text } : { found: false, reason: "the file is not JSON" };
      } catch (e) {
        return { found: false, reason: String((e as Error)?.message ?? e).slice(0, 120) };
      }
    },
    kyb: (input) => kybCheck(input, kybDeps(env)),
    walletSanctions: async (address) => ((await runOf(SANCTIONS, "/sanctions/check")(env, asInput({ address }))) as { verdict: string }).verdict,
    verifySignature: async (address, message, signature) => {
      try { if (await verifyMessage({ address, message, signature })) return true; } catch { /* not an EOA signature; try ERC-1271 */ }
      const base = CHAINS.find((c) => c.slug === "base")!;
      return client(env, base).verifyMessage({ address, message, signature });
    },
  };
}

/** Our own declaration: the payout wallets this service quotes. No company yet (no registered business). */
export function ownDeclaration(env: Env, origin: string) {
  return {
    version: 1,
    company: null,
    payTo: payoutWallets(env).map((address) => ({ address, network: isAddress(address) ? "base" : "solana" })),
    documentation: `${origin}/payee`,
  };
}

/** The stored record when under FRESH_DAYS old, otherwise checked now (and stored when the domain declares anything). */
export async function recordFor(env: Env, domain: string, deps: PayeeDeps): Promise<{ record: PayeeRecord; fresh: boolean }> {
  const stored = await readRecord(env, domain);
  if (stored && Date.now() - Date.parse(stored.verifiedAt) < FRESH_DAYS * 86_400_000) return { record: { ...stored, accepts: stored.accepts ?? [] }, fresh: true };
  const record = await verifyPayee(domain, deps);
  if (record.status !== "none") await storeRecord(env, record).catch(() => {});
  return { record, fresh: true };
}

// ---- The paid check ----

export type Verdict = "pass" | "partial" | "review" | "unknown" | "block";

/** Compares the wallets a live quote names with the record's. */
export function walletMatches(live: string[], record: PayeeRecord | null) {
  const known = new Map((record?.wallets ?? []).map((w) => [w.address.toLowerCase(), w.proof]));
  return live.map((address) => {
    const proof = known.get(address.toLowerCase());
    return { address, match: proof === "signature" ? "signed" : proof ? "declared" : "not-declared" };
  });
}

export function checkVerdict(record: PayeeRecord | null, matches: ReturnType<typeof walletMatches>, walletBlock: boolean): { verdict: Verdict; reasons: string[] } {
  const reasons: string[] = [];
  if (walletBlock) return { verdict: "block", reasons: ["the wallet is on the OFAC list: do not pay it"] };
  if (!record || record.status === "none") return { verdict: "unknown", reasons: ["the payee has published no verified payee record"] };
  const notDeclared = matches.filter((m) => m.match === "not-declared");
  if (notDeclared.length) reasons.push(`the quote pays ${notDeclared.map((m) => m.address).join(", ")}, which ${record.domain}'s record does not declare`);
  if (record.status === "review") return { verdict: "review", reasons: [...reasons, ...record.flags.slice(0, 5)] };
  if (notDeclared.length) return { verdict: "review", reasons };
  if (record.status === "verified") return { verdict: "pass", reasons };
  return { verdict: "partial", reasons: record.flags.slice(0, 5) };
}

const EX_DOMAIN = "agent-data-tools.revmesh2074.workers.dev";
/** The attestation issuer stays this service's own origin on every host, so a verifier always finds the same keys. */
export const ISSUER = `https://${EX_DOMAIN}`;

export const PAYEE: Entry[] = [
  entry("/payee/check", "Payee check: is this payee a verified business before you pay?",
    "Check a payee before paying it, by domain, paid endpoint URL or payout wallet: its verified record (company in official registers, EU VIES and LEI, OFAC, EU, UN and UK sanctions, wallets proven by signature), the wallet in a live quote compared with the proven ones, and pass, partial, review, unknown or block with reasons and a signed attestation. Never pays or signs. Use before the first payment to a seller.",
    ["payee-check", "payee-verification", "kyb", "seller-trust", "sanctions", "x402"], {
      domain: { type: "string", description: "The payee's domain, e.g. shop.example.com (give domain, url or address)", example: EX_DOMAIN },
      url: { type: "string", description: "Or: a paid endpoint; its domain's record is read and its quote's wallet compared", example: `https://${EX_DOMAIN}/weather` },
      address: { type: "string", description: "Or: a payout wallet (0x); finds the domain that proved it by signature", example: "0x6293ded2684F1A76E26bEcef87c137D691Fbf800" },
    },
    {
      domain: EX_DOMAIN, verdict: "partial",
      reasons: ["no registered business is declared, so the payee is a domain and its wallets, not a verified company", "no wallet is proven by a signature: sign \"agent-payee:agent-data-tools.revmesh2074.workers.dev:<address>\" with each payout wallet and put the signature next to it"],
      wallets: [],
      record: { domain: EX_DOMAIN, status: "partial", declarationUrl: `https://${EX_DOMAIN}${DECLARATION_PATH}`, verifiedAt: "2026-11-15T12:00:00.000Z", expiresAt: "2026-12-15T12:00:00.000Z", checks: { domain: "proven", company: "not-declared", wallets: [{ address: "0x6293ded2684F1A76E26bEcef87c137D691Fbf800", proof: "declared", sanctions: "pass" }], einvoice: "not-declared" } },
      attestation: { alg: "EdDSA", kid: "…", signature: "…", keys: `https://${EX_DOMAIN}${KEYS_PATH}` },
      fresh: true,
      note: "A record states what was checked and when; it is not a guarantee that the seller delivers, and not a credit view.",
    },
    async (env, q) => {
      const rawUrl = opt(q, "url", 2_000);
      const rawAddress = opt(q, "address", 100);
      let domain = opt(q, "domain", 300) ? payeeDomain(q("domain")) : rawUrl ? payeeDomain(parseTarget(rawUrl).hostname) : null;
      let liveWallets: string[] = [];
      let walletBlock = false;
      const reasons: string[] = [];
      if (rawUrl) {
        const terms = await liveTerms(env, parseTarget(rawUrl));
        liveWallets = [...new Set(terms.accepts.map((a) => a.payTo).filter((w): w is string => Boolean(w)))];
        if (!liveWallets.length) reasons.push("the URL did not answer with x402 payment terms, so no wallet was compared");
      }
      if (rawAddress) {
        if (!isAddress(rawAddress)) throw new HttpError(400, "address must be a 0x wallet (40 hex characters)");
        liveWallets = [...new Set([...liveWallets, getAddress(rawAddress)])];
        domain ??= await domainOfWallet(env, rawAddress);
      }
      if (!domain && !rawAddress) throw new HttpError(400, "give domain, url or address");
      const deps = payeeDeps(env);
      const evmLive = liveWallets.filter(isAddress);
      const screened = await Promise.all(evmLive.map((w) => deps.walletSanctions(w).catch(() => "not-checked")));
      walletBlock = screened.includes("block");

      const { record, fresh } = domain ? await recordFor(env, domain, deps) : { record: null, fresh: false };
      const matches = walletMatches(liveWallets, record);
      const v = checkVerdict(record, matches, walletBlock);
      return {
        domain, verdict: v.verdict, reasons: [...reasons, ...v.reasons],
        wallets: matches.map((m) => ({ ...m, sanctions: isAddress(m.address) ? screened[evmLive.indexOf(m.address)] ?? "not-checked" : "not-checked" })),
        record, attestation: record && record.status !== "none" ? await attest(record, env, ISSUER) : null,
        fresh,
        note: "A record states what was checked and when; it is not a guarantee that the seller delivers, and not a credit view.",
      };
    }),
];

export const __test = { parseDeclaration, verifyPayee, walletMatches, checkVerdict, payeeDomain, walletMessage, attest, publicKeys };
