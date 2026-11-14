// What the field names people ask for on invoices and receipts mean, and how a document's text misleads a model.
// Measured 14 Nov 2026 on invoice2data's test set (11 invoices, 57 checked fields; the harness is
// C:\MoneyWallet\business\integrations\bench-invoices): the bare prompt on Llama 4 Scout got 43 right, these rules on
// gpt-oss-120b 52. The misses they fix: the customer number returned as the invoice number, a total left null,
// a row's position number returned as its quantity, dates and amounts in the document's own spelling.

/** Only the names in a request are sent. Keys are compared in lower case with spaces as underscores. */
const FIELD_HINTS: Readonly<Record<string, string>> = {
  invoice_number: "the document's own number, labelled invoice number, invoice no., Rechnungsnummer, Rechnung Nr., factuurnummer, numéro de facture, fakturanummer, número de factura, numero fattura or bill no. Never the customer number, order number, delivery number, tax number or account number",
  invoice_date: "the date the invoice was issued (Rechnungsdatum, factuurdatum, date de facture, fakturadatum), not the order, delivery or due date",
  due_date: "the date payment is due (Fälligkeitsdatum, zahlbar bis, vervaldatum, échéance, förfallodatum), null when only payment terms are given",
  supplier_name: "the company that issued the invoice and is to be paid",
  supplier_vat_number: "the issuer's VAT identification number (VAT no., USt-IdNr., UStId, BTW-nummer, TVA, momsreg.nr, P.IVA), with its two-letter country prefix and without the label word",
  customer_name: "the company or person the invoice is addressed to",
  customer_vat_number: "the customer's VAT identification number, null when not stated",
  currency: "the ISO 4217 code of the invoice amounts (EUR for €, USD for $, GBP for £, INR for ₹ or Rs)",
  subtotal: "the net amount before tax (Netto, Zwischensumme, subtotaal, total HT, excl. VAT)",
  tax_amount: "the total tax charged (VAT, MwSt, USt, BTW, TVA, moms, GST)",
  total: "the final amount payable including tax (total, Gesamtbetrag, Rechnungsbetrag, totaal, total TTC, amount due, grand total); when the invoice shows one total only, that is it",
  iban: "the issuer's IBAN, without spaces",
  payment_reference: "the reference the payer must quote with the payment, null when none is stated",
};
const FIELD_ALIASES: Readonly<Record<string, string>> = {
  invoice_no: "invoice_number", invoice_id: "invoice_number", number: "invoice_number", date: "invoice_date", issue_date: "invoice_date",
  vendor: "supplier_name", vendor_name: "supplier_name", supplier: "supplier_name", seller: "supplier_name", seller_name: "supplier_name",
  vat_number: "supplier_vat_number", vendor_vat_number: "supplier_vat_number", seller_vat_number: "supplier_vat_number",
  customer: "customer_name", buyer: "customer_name", buyer_name: "customer_name", buyer_vat_number: "customer_vat_number",
  net_amount: "subtotal", net: "subtotal", tax: "tax_amount", vat: "tax_amount", vat_amount: "tax_amount",
  total_amount: "total", amount_due: "total", grand_total: "total", amount: "total",
};
const ROW_HINTS: Readonly<Record<string, string>> = {
  quantity: "the number of units on that row; a position or item number at the start of a row is not a quantity",
  unit_price: "the price of one unit",
  amount: "the total of that row",
  description: "the item or service text of that row",
};

const key = (name: string) => name.trim().toLowerCase().replace(/[\s.\-]+/g, "_");

/** Rules for text that came out of a file: how to write dates and amounts, and that a value may stand before its label. */
export const DOCUMENT_RULES =
  " Write every date as YYYY-MM-DD. Write every money amount as a JSON number with a decimal point and no thousands separator or currency sign."
  + ' The text comes from a PDF or a scan, so a value can stand directly before its label instead of after it: "20417Invoice no:" means the invoice number is 20417, and a label alone on a line belongs to the nearest value above or below it.';

/** The meaning of the requested keys this module knows, as lines for the system prompt; "" when it knows none. */
export function fieldHints(fields: readonly string[], lists: Readonly<Record<string, readonly string[]>>): string {
  const named = fields.flatMap((f) => {
    const k = key(f);
    const known = Object.hasOwn(FIELD_HINTS, k) ? k : Object.hasOwn(FIELD_ALIASES, k) ? FIELD_ALIASES[k] : null;
    return known ? [`${JSON.stringify(f)}: ${FIELD_HINTS[known]}.`] : [];
  });
  const rows = [...new Set(Object.values(lists).flat())].flatMap((r) => (Object.hasOwn(ROW_HINTS, key(r)) ? [`${JSON.stringify(r)}: ${ROW_HINTS[key(r)]}.`] : []));
  const lines = [...named, ...(rows.length ? [`In rows: ${rows.join(" ")}`] : [])];
  return lines.length ? `\nMeaning of the keys:\n${lines.join("\n")}` : "";
}
