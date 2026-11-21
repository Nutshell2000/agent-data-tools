// A v2 payment names the terms it accepts (`accepted`), and the x402 library runs the payment only when that object is
// exactly one of the terms this service quotes: scheme, network, amount, asset, payTo and maxTimeoutSeconds compared
// field by field, as typed. A buyer that built `accepted` itself (from a stored quote, a marketplace listing or the
// v1-shaped body) is refused with "No matching payment requirements" for a difference that changes nothing about the
// money: an address in another letter case, a v1 network name, a missing or different timeout, an extra field.
// 21 Nov 2026: one buyer was refused 21 times in three days on /contents this way and paid twice; /weather/forecast
// refused 15 payments in one day.
//
// `accepted` only selects which of our terms the payment is for. What moves money is the signed authorization inside the
// payload (recipient, token, value, validity, nonce), and the facilitator checks that against OUR terms whatever
// `accepted` said. So when the buyer's `accepted` clearly means one of our terms (same scheme and network, the same
// amount, and the same recipient and token where it names them), the payment is sent on with that term written exactly
// as we quote it. A different amount is never aligned: the price is ours to state and the buyer's to agree to.
import { decodePaymentRequiredHeader, decodePaymentSignatureHeader, encodePaymentSignatureHeader } from "@x402/core/http";

const V1_NETWORKS: Readonly<Record<string, string>> = { base: "eip155:8453", polygon: "eip155:137", arbitrum: "eip155:42161", "base-sepolia": "eip155:84532", solana: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp" };
const CORE_FIELDS = new Set(["scheme", "network", "amount", "asset", "payTo", "maxTimeoutSeconds", "extra"]);

type Terms = Record<string, unknown>;
const text = (v: unknown) => (typeof v === "string" ? v.trim() : typeof v === "number" && Number.isFinite(v) ? String(v) : "");
const same = (a: unknown, b: unknown) => text(a).toLowerCase() === text(b).toLowerCase();
/** A whole number of atomic units as written ("10000", 10000, "10000.0"), or null. */
const atomic = (v: unknown): bigint | null => { const m = /^(\d+)(?:\.0+)?$/.exec(text(v)); return m ? BigInt(m[1]) : null; };
const networkOf = (v: unknown) => { const n = text(v).toLowerCase(); return Object.hasOwn(V1_NETWORKS, n) ? V1_NETWORKS[n] : text(v); };

export interface Alignment {
  /** The payment header to send on, when the buyer's `accepted` means one of our terms; else undefined. */
  header?: string;
  /** What differs between the buyer's `accepted` and the nearest of our terms: field names, never values. */
  differs: string[];
}

/**
 * Compares a v2 payment's `accepted` with the terms of the 402 it was answered with. Never throws; an unreadable header
 * gives `{ differs: ["unreadable"] }`.
 */
export function alignAccepted(paymentHeader: string | null | undefined, requiredHeader: string | null | undefined): Alignment {
  let payload: Record<string, unknown>, ours: Terms[];
  try {
    payload = decodePaymentSignatureHeader(paymentHeader ?? "") as unknown as Record<string, unknown>;
    ours = (decodePaymentRequiredHeader(requiredHeader ?? "").accepts ?? []) as unknown as Terms[];
  } catch { return { differs: ["unreadable"] }; }
  const theirs = payload?.accepted;
  if (!theirs || typeof theirs !== "object" || Array.isArray(theirs)) return { differs: ["accepted missing"] };
  const t = theirs as Terms;
  const scheme = text(t.scheme) || "exact";
  const network = networkOf(t.network);
  const onNetwork = ours.filter((o) => text(o.network) === network);
  if (!onNetwork.length) return { differs: [network ? "network not offered" : "network missing"] };
  const term = onNetwork.find((o) => text(o.scheme) === scheme);
  if (!term) return { differs: ["scheme"] };

  const differs: string[] = [];
  const theirAmount = atomic(t.amount ?? t.maxAmountRequired), ourAmount = atomic(term.amount);
  const amountOk = theirAmount !== null && ourAmount !== null && theirAmount === ourAmount;
  if (!amountOk) differs.push(theirAmount === null ? "amount missing" : ourAmount !== null && theirAmount > ourAmount ? "amount higher than quoted" : "amount lower than quoted");
  else if (t.amount !== term.amount) differs.push("amount form");
  const assetOk = t.asset === undefined || same(t.asset, term.asset);
  if (!assetOk) differs.push("asset"); else if (t.asset !== term.asset) differs.push("asset form");
  const payToOk = t.payTo === undefined || same(t.payTo, term.payTo);
  if (!payToOk) differs.push("payTo"); else if (t.payTo !== term.payTo) differs.push("payTo form");
  if (t.network !== term.network) differs.push("network form");
  if (t.scheme !== term.scheme) differs.push("scheme form");
  if (t.maxTimeoutSeconds !== term.maxTimeoutSeconds) differs.push("maxTimeoutSeconds");
  const ourExtra = (term.extra && typeof term.extra === "object" ? term.extra : {}) as Terms;
  const theirExtra = (t.extra && typeof t.extra === "object" && !Array.isArray(t.extra) ? t.extra : {}) as Terms;
  if (Object.keys(ourExtra).some((k) => JSON.stringify(theirExtra[k]) !== JSON.stringify(ourExtra[k]))) differs.push("extra");
  const added = Object.keys(t).filter((k) => !CORE_FIELDS.has(k) && k !== "maxAmountRequired").sort();
  if (added.length) differs.push(`added fields ${added.slice(0, 6).map((k) => k.replace(/[^A-Za-z0-9_]/g, "").slice(0, 24)).join(",")}`);

  if (!differs.length || !amountOk || !assetOk || !payToOk) return { differs };
  try {
    // Their own extra entries are kept (a token domain a client added); ours win where both name one.
    const accepted = { ...term, ...(Object.keys(theirExtra).length || Object.keys(ourExtra).length ? { extra: { ...theirExtra, ...ourExtra } } : {}) };
    return { header: encodePaymentSignatureHeader({ ...payload, x402Version: 2, accepted } as never), differs };
  } catch { return { differs }; }
}

/** " (differs: a, b)" for a refusal reason, or "" when nothing can be said. */
export const differsNote = (a: Alignment) => (a.differs.length ? ` (differs: ${a.differs.join(", ")})` : "");
