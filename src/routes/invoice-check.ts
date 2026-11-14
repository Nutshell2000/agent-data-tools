/**
 * One-call EU invoice check (14 Nov 2026, release 1.180.0).
 *
 * Why: the tool-sales research of 14 Nov 2026 (`C:\MoneyWallet\business\research-2026-11-14-win\`) found no seller of the
 * combined job that accounts-payable automations bring a document tool: read the invoice, then check the supplier's VAT
 * number in VIES, the IBAN, the sums and the dates, and say whether to pay or look closer. Sellers price parts of it
 * per document (Mindee ~$0.05 a page, Veryfi $0.16, an Apify e-invoice parser $50 per 1,000) and the Apify invoice
 * actors have 1-5 users each. Every part already existed here: /document/extract, /vat/validate, /validate/iban.
 *
 * The answer is facts plus flags, never an accusation: `verdict` is "pass" (every check that could run passed),
 * "review" (something is missing, unclear or could not be checked) or "fail" (a check failed: invalid VAT number,
 * invalid IBAN, sums that do not add up, a due date before the invoice date). A busy VIES makes that check "unavailable"
 * and the verdict "review"; it never fails the call. Only an unreadable file or a model failure is an uncharged error.
 */
import { entry, type Entry } from "../family";
import { HttpError } from "../lib/env";
import type { Env } from "../lib/env";
import { fetchFile } from "../lib/fetch";
import { FILE_REF_INPUT, heldFile, isFileRef } from "../lib/file-input";
import { CHAT_MODEL, extractFields } from "./ai-text";
import { DOCUMENT_MAX_BYTES, EXTRACT_CHARS, readDocument, visionOcr } from "./document";
import { vatParts, viesCheck, VIES_COUNTRIES } from "./registries";
import { ibanCheck } from "./utils";
import { coreName } from "./company-verify";

/** A real invoice that answers from Cloudflare (GitHub raw), never a file on our own origin (the 1.44.1 lesson). */
export const SAMPLE_INVOICE = "https://raw.githubusercontent.com/invoice-x/invoice2data/master/tests/compare/coolblue1.pdf";

export const INVOICE_FIELDS = [
  "invoice_number", "invoice_date", "due_date", "currency",
  "seller_name", "seller_vat_number", "seller_address", "seller_country",
  "buyer_name", "buyer_vat_number",
  "iban", "bic", "payment_reference",
  "net_amount", "vat_amount", "total_amount",
  "line_items",
] as const;
export const INVOICE_LISTS = { line_items: ["description", "quantity", "unit_price", "amount"] } as const;

export type CheckStatus = "pass" | "fail" | "warn" | "missing" | "unavailable" | "skipped";
export interface Check { check: string; status: CheckStatus; detail: string }
type Vies = (parts: { country: string; number: string }) => Promise<Record<string, unknown>>;

/** A number from what a model or an invoice writes: 1 234,50 / 1,234.50 / "SEK 1.234,50" / 1234.5. */
export function amount(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  let s = v.replace(/[^\d.,\-]/g, "");
  if (!/\d/.test(s)) return null;
  const lastComma = s.lastIndexOf(","), lastDot = s.lastIndexOf(".");
  if (lastComma > lastDot) {
    // Comma is the decimal mark when it has 1-2 digits after it ("1.234,50", "12,5"); otherwise a thousands mark.
    s = /,\d{1,2}$/.test(s) ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  } else s = s.replace(/,/g, "");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** An ISO date (YYYY-MM-DD) from the common invoice spellings, or null. Day-first for dotted and slashed dates (EU invoices). */
export function isoDate(v: unknown): string | null {
  if (typeof v !== "string" || !v.trim()) return null;
  const s = v.trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return valid(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/.exec(s);
  if (m) return valid(+m[3], +m[2], +m[1]);
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : new Date(t).toISOString().slice(0, 10);
}
const valid = (y: number, mo: number, d: number) => {
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d ? dt.toISOString().slice(0, 10) : null;
};

const near = (a: number, b: number) => Math.abs(a - b) <= Math.max(0.02, Math.abs(b) * 0.001);
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" ? String(v) : null);

/** The words invoices print next to a VAT number, in the member states' languages. */
const VAT_LABELS = /^(?:VAT|VATNO|VATNR|VATID|BTW|BTWNR|TVA|IVA|NIF|CIF|MWST|UST|USTID|USTIDNR|MOMS|MOMSNR|ALV|DPH|DIC|DDV|PVM|PVN|KMKR|AFM|ANYK|NIP|NO|NR|ID|NUMBER)+|(?:VAT|BTW|TVA|IVA|MWST|UST|MOMS|ALV|DPH|PVM|PVN|KMKR)+$/;
/**
 * A VAT number as printed on an invoice, made checkable: spacing and punctuation removed, then label words before or after
 * it ("BTW", "USt-IdNr.", "VAT No") dropped. Why: PDF text often glues the label to the number; the staging proof of
 * 1.180.0 read "NL810433941B01BTW" from a real Dutch invoice and the VIES check was skipped. Exported for the tests.
 */
export function cleanVat(raw: string): string {
  // Labels go first, always: vatParts checks only the shape, so "NL810433941BTW" would pass it and VIES would call a real
  // number invalid. No EU VAT number ends in three or more letters (IE ends in up to two, ES and CY in one), and no label
  // word starts with an EU country code, so stripping them cannot cut a real number.
  let s = raw.toUpperCase().replace(/[\s.:\-\/]/g, "");
  for (let i = 0; i < 3; i++) s = s.replace(VAT_LABELS, "");
  if (vatParts(s)) return s;
  // A number with a 2-letter prefix somewhere inside the text, e.g. "OURVATNOISNL810433941B01".
  const m = /(AT|BE|BG|CY|CZ|DE|DK|EE|EL|GR|ES|FI|FR|HR|HU|IE|IT|LT|LU|LV|MT|NL|PL|PT|RO|SE|SI|SK|XI)U?\d[0-9A-Z]{1,13}/.exec(s);
  return m && vatParts(m[0]) ? m[0] : s;
}

async function vatCheck(label: string, raw: string | null, name: string | null, vies: Vies): Promise<{ check: Check; record: Record<string, unknown> | null }> {
  if (!raw) return { check: { check: `${label}_vat`, status: "missing", detail: `no ${label} VAT number on the invoice` }, record: null };
  const parts = vatParts(cleanVat(raw));
  if (!parts) return { check: { check: `${label}_vat`, status: "warn", detail: `"${raw.slice(0, 30)}" does not start with an EU country code, so it was not checked in VIES` }, record: null };
  if (!VIES_COUNTRIES.has(parts.country)) return { check: { check: `${label}_vat`, status: "skipped", detail: `${parts.country} numbers are not in EU VIES` }, record: null };
  try {
    const r = await vies(parts);
    if (r.valid !== true) return { check: { check: `${label}_vat`, status: "fail", detail: `VIES says ${parts.country}${parts.number} is not a valid VAT number` }, record: r };
    const registered = typeof r.name === "string" ? r.name : null;
    if (name && registered) {
      const a = coreName(name), b = coreName(registered);
      const same = a && b && (a === b || a.includes(b) || b.includes(a));
      return {
        check: same
          ? { check: `${label}_vat`, status: "pass", detail: `valid in VIES, registered to ${registered}` }
          : { check: `${label}_vat`, status: "warn", detail: `valid in VIES but registered to "${registered}", not "${name.slice(0, 80)}" as the invoice says` },
        record: r,
      };
    }
    return { check: { check: `${label}_vat`, status: "pass", detail: registered ? `valid in VIES, registered to ${registered}` : "valid in VIES (the member state does not share the name)" }, record: r };
  } catch (e) {
    return { check: { check: `${label}_vat`, status: "unavailable", detail: e instanceof HttpError ? e.message.replace(/; .*$/, "") : "VIES did not answer" }, record: null };
  }
}

/** Every check on extracted invoice data. Exported for the tests; `vies` is the VIES caller. */
export async function invoiceChecks(data: Record<string, unknown>, vies: Vies, today = new Date().toISOString().slice(0, 10)) {
  const checks: Check[] = [];
  const sellerName = str(data.seller_name), buyerName = str(data.buyer_name);
  const [seller, buyer] = await Promise.all([
    vatCheck("seller", str(data.seller_vat_number), sellerName, vies),
    str(data.buyer_vat_number) ? vatCheck("buyer", str(data.buyer_vat_number), buyerName, vies) : Promise.resolve(null),
  ]);
  checks.push(seller.check);
  if (buyer) checks.push(buyer.check);

  const ibanRaw = str(data.iban);
  let iban: ReturnType<typeof ibanCheck> | null = null;
  if (!ibanRaw) checks.push({ check: "iban", status: "missing", detail: "no IBAN on the invoice" });
  else {
    iban = ibanCheck(ibanRaw);
    if (!iban.valid) checks.push({ check: "iban", status: "fail", detail: `IBAN ${iban.formatted} is not valid: ${iban.reasons.join("; ")}` });
    else {
      const sellerCountry = seller.record && typeof seller.record.country === "string" ? (seller.record.country === "EL" ? "GR" : seller.record.country) : vatParts(cleanVat(str(data.seller_vat_number) ?? ""))?.country?.replace("EL", "GR") ?? null;
      checks.push(sellerCountry && sellerCountry !== "XI" && iban.country !== sellerCountry
        ? { check: "iban", status: "warn", detail: `IBAN is valid but held in ${iban.country}, while the seller's VAT number is from ${sellerCountry}: confirm the account with the supplier by a known channel before paying` }
        : { check: "iban", status: "pass", detail: `IBAN ${iban.formatted} is valid (${iban.country})` });
    }
  }

  const net = amount(data.net_amount), vat = amount(data.vat_amount), total = amount(data.total_amount);
  if (total === null) checks.push({ check: "totals", status: "missing", detail: "no total amount found" });
  else if (net !== null && vat !== null) {
    checks.push(near(net + vat, total)
      ? { check: "totals", status: "pass", detail: `net ${net} + VAT ${vat} = total ${total}` }
      : { check: "totals", status: "fail", detail: `net ${net} + VAT ${vat} = ${Math.round((net + vat) * 100) / 100}, but the total says ${total}` });
    if (net > 0 && vat >= 0) {
      const rate = Math.round((vat / net) * 1000) / 10;
      checks.push({ check: "vat_rate", status: "pass", detail: `VAT is ${rate}% of the net amount` });
    }
  } else checks.push({ check: "totals", status: "warn", detail: "net or VAT amount not stated, so the total could not be recomputed" });

  const rows = Array.isArray(data.line_items) ? (data.line_items as Record<string, unknown>[]) : [];
  const rowSums = rows.map((r) => amount(r.amount));
  if (rows.length && rowSums.every((n) => n !== null)) {
    const sum = Math.round((rowSums as number[]).reduce((a, b) => a + b, 0) * 100) / 100;
    if (net !== null && near(sum, net)) checks.push({ check: "line_items", status: "pass", detail: `${rows.length} line(s) add up to the net amount ${net}` });
    else if (total !== null && near(sum, total)) checks.push({ check: "line_items", status: "pass", detail: `${rows.length} line(s) add up to the total ${total}` });
    else if (net !== null || total !== null) checks.push({ check: "line_items", status: "warn", detail: `${rows.length} line(s) add up to ${sum}, which matches neither the net (${net ?? "not stated"}) nor the total (${total ?? "not stated"})` });
  }

  const issued = isoDate(data.invoice_date), due = isoDate(data.due_date);
  if (!issued) checks.push({ check: "dates", status: "missing", detail: "no readable invoice date" });
  else if (due && due < issued) checks.push({ check: "dates", status: "fail", detail: `due date ${due} is before the invoice date ${issued}` });
  else if (issued > today) checks.push({ check: "dates", status: "warn", detail: `invoice date ${issued} is in the future` });
  else checks.push({ check: "dates", status: "pass", detail: due ? `issued ${issued}, due ${due}${due < today ? " (overdue)" : ""}` : `issued ${issued}, no due date stated` });

  if (!str(data.invoice_number)) checks.push({ check: "invoice_number", status: "missing", detail: "no invoice number found (required on EU VAT invoices)" });

  const verdict = checks.some((c) => c.status === "fail") ? "fail" : checks.some((c) => c.status === "warn" || c.status === "missing" || c.status === "unavailable") ? "review" : "pass";
  const summary = verdict === "pass" ? "Every check that could run passed."
    : verdict === "fail" ? `Failed: ${checks.filter((c) => c.status === "fail").map((c) => c.check).join(", ")}. Do not pay before it is explained.`
    : `Look closer at: ${checks.filter((c) => c.status !== "pass" && c.status !== "skipped").map((c) => c.check).join(", ")}.`;
  return { verdict, summary, checks, seller: seller.record, buyer: buyer?.record ?? null, iban };
}

export const INVOICE_CHECK: Entry[] = [
  entry("/invoice/check", "Invoice check: validate an EU invoice before paying",
    "Check an invoice in one call: send a PDF, Word or Excel file, scan or photo (URL or POST body). It reads the fields, checks the seller's and buyer's VAT numbers in EU VIES with the registered name, validates the IBAN and its country, recomputes net + VAT = total and the line items, and checks the dates. Returns pass, review or fail with each check. Use before paying a supplier invoice or in an accounts-payable workflow.",
    ["invoice-check", "invoice-validation", "invoice-parser", "vat-validation", "accounts-payable", "iban-validation", "invoice-fraud", "document"], {
      url: { type: "string", description: "Absolute public http(s) URL of the invoice file (or send the file in a POST body instead)", required: true, example: SAMPLE_INVOICE },
    },
    {
      // The checks for the sample invoice's own figures (a 2014 Coolblue invoice from the invoice2data test set), with the
      // VIES answer of 14 Nov 2026; tests/invoice-check.test.cjs runs invoiceChecks on exactly these fields.
      url: SAMPLE_INVOICE,
      verdict: "pass",
      summary: "Every check that could run passed.",
      checks: [
        { check: "seller_vat", status: "pass", detail: "valid in VIES, registered to COOLBLUE B.V." },
        { check: "iban", status: "pass", detail: "IBAN NL50 INGB 0683 2513 09 is valid (NL)" },
        { check: "totals", status: "pass", detail: "net 593.36 + VAT 124.61 = total 717.97" },
        { check: "vat_rate", status: "pass", detail: "VAT is 21% of the net amount" },
        { check: "line_items", status: "pass", detail: "5 line(s) add up to the total 717.97" },
        { check: "dates", status: "pass", detail: "issued 2014-04-19, no due date stated" },
      ],
      invoice: { invoice_number: "993548900", invoice_date: "2014-04-19", seller_name: "Coolblue B.V.", seller_vat_number: "NL810433941B01", iban: "NL50INGB0683251309", bic: "INGBNL2A", currency: "EUR", net_amount: 593.36, vat_amount: 124.61, total_amount: 717.97 },
    },
    async (env, q) => {
      const sent = q(FILE_REF_INPUT);
      let bytes: Uint8Array;
      let url: string | null = null;
      if (isFileRef(sent)) {
        const held = heldFile(sent);
        if (!held) throw new HttpError(400, "send the invoice in a POST body (raw bytes, a multipart `file` part, or base64 in JSON); a file reference cannot be used in a GET");
        bytes = held;
      } else {
        const file = await fetchFile(q("url"), /^/, DOCUMENT_MAX_BYTES, "a document", { cacheSeconds: 600, budgetMs: 20_000 });
        bytes = file.bytes;
        url = file.url;
      }
      const doc = await readDocument(bytes, "text", EXTRACT_CHARS, visionOcr(env as Env));
      const found = await extractFields(env as Env, doc.text, [...INVOICE_FIELDS], CHAT_MODEL, 2000, INVOICE_LISTS);
      const result = await invoiceChecks(found.data, (parts) => viesCheck(parts));
      return { url, ...(url ? {} : { source: "upload" }), ...result, invoice: found.data, missingFields: found.missing, ...("ocr" in doc ? { ocr: true } : {}), model: found.model, truncated: doc.truncated, note: "Checks state facts from VIES, the IBAN rules and the invoice itself; they are not legal or tax advice. Confirm a changed bank account with the supplier by a channel you already trust." };
      // $0.05 a document: one model call and up to two VIES checks; below every per-document invoice product found on 14 Nov 2026.
    }, "$0.05"),
];
