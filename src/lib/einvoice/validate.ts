// Business-rule check for an e-invoice (14 Nov 2026). The rule numbers are the published ones: BR-* from EN 16931-1
// (the European e-invoice standard) and BR-DE-* from XRechnung 3.0 (KoSIT). The explanations and fixes are our own
// wording. This is a subset: the rules a plain invoice with lines, VAT and a bank transfer can break. Rules about parts
// the model does not carry (allowances and charges, attachments, card and direct-debit payments, tax representative)
// are not run, and `coverage` in every answer says so. It is not the official KoSIT validator and does not replace it
// for a formal conformance statement.
import { round2, type Invoice, type Line } from "./model";

export type Level = "error" | "warning";
export interface RuleDoc {
  id: string;
  level: Level;
  /** "EN 16931" or "XRechnung". */
  standard: "EN 16931" | "XRechnung";
  /** Business term numbers the rule is about (BT-…, BG-…). */
  field: string;
  /** What the rule requires, one sentence. */
  rule: string;
  /** How to fix a file that breaks it. */
  fix: string;
}
export interface Finding { rule: string; level: Level; field: string; message: string; fix: string; location?: string }

const R = (id: string, standard: RuleDoc["standard"], level: Level, field: string, rule: string, fix: string): RuleDoc => ({ id, level, standard, field, rule, fix });
const EN = (id: string, field: string, rule: string, fix: string, level: Level = "error") => R(id, "EN 16931", level, field, rule, fix);
const DE = (id: string, field: string, rule: string, fix: string, level: Level = "error") => R(id, "XRechnung", level, field, rule, fix);

const CATEGORIES: Readonly<Record<string, { key: string; name: string; reason: boolean; buyerVat: boolean }>> = Object.freeze({
  S: { key: "S", name: "Standard rated", reason: false, buyerVat: false },
  Z: { key: "Z", name: "Zero rated", reason: false, buyerVat: false },
  E: { key: "E", name: "Exempt from VAT", reason: true, buyerVat: false },
  AE: { key: "AE", name: "Reverse charge", reason: true, buyerVat: true },
  K: { key: "IC", name: "Intra-community supply", reason: true, buyerVat: true },
  G: { key: "G", name: "Export outside the EU", reason: true, buyerVat: false },
});

const categoryRules: RuleDoc[] = Object.entries(CATEGORIES).flatMap(([code, c]) => [
  EN(`BR-${c.key}-01`, "BG-23, BT-118", `An invoice with a line in VAT category "${c.name}" (${code}) must have ${code === "S" ? "at least one" : "exactly one"} VAT breakdown row for that category.`, `Add a VAT breakdown row with category ${code}${code === "S" ? " for each VAT rate used" : ""}, or correct the category on the line.`),
  EN(`BR-${c.key}-02`, c.buyerVat ? "BT-31, BT-32, BT-48" : "BT-31, BT-32", `An invoice with a "${c.name}" line must state the seller's VAT identifier or tax registration number${c.buyerVat ? ", and the buyer's VAT identifier" : ""}.`, c.buyerVat ? "Add the seller's VAT number (or tax number) and the buyer's VAT number." : "Add the seller's VAT number, or the national tax number if there is no VAT number."),
  EN(`BR-${c.key}-05`, "BT-152", code === "S" ? "On a standard-rated line the VAT rate must be greater than zero." : `On a "${c.name}" line the VAT rate must be 0.`, code === "S" ? "Set the line's VAT rate (for example 19), or change its category to Z, E or AE if no VAT applies." : "Set the line's VAT rate to 0, or change its category to S if VAT is charged."),
  EN(`BR-${c.key}-08`, "BT-116", code === "S" ? "For each standard VAT rate, the taxable amount in the VAT breakdown must equal the sum of the net amounts of the lines with that rate." : `The taxable amount of the "${c.name}" VAT breakdown row must equal the sum of the net amounts of its lines.`, "Recompute the breakdown row's taxable amount from the lines (plus charges, minus allowances, in that category)."),
  EN(`BR-${c.key}-09`, "BT-117", code === "S" ? "The VAT amount of a standard-rated breakdown row must equal its taxable amount times its rate." : `The VAT amount of the "${c.name}" breakdown row must be 0.`, code === "S" ? "Set the row's VAT amount to taxable amount x rate / 100, rounded to two decimals." : "Set the row's VAT amount to 0.00."),
  EN(`BR-${c.key}-10`, "BT-120, BT-121", c.reason ? `A "${c.name}" VAT breakdown row must give a VAT exemption reason (text or code).` : `A "${c.name}" VAT breakdown row must not give a VAT exemption reason.`, c.reason ? "Add the exemption reason text, for example the legal basis or \"Reverse charge\"." : "Remove the exemption reason from that row."),
]);

export const RULES: readonly RuleDoc[] = Object.freeze([
  EN("BR-01", "BT-24", "An invoice must have a specification identifier.", "Add the identifier of the standard the file follows, for example urn:cen.eu:en16931:2017 or the XRechnung identifier."),
  EN("BR-02", "BT-1", "An invoice must have an invoice number.", "Add the invoice number."),
  EN("BR-03", "BT-2", "An invoice must have an issue date.", "Add the issue date (CII: format 102, YYYYMMDD; UBL: YYYY-MM-DD)."),
  EN("BR-04", "BT-3", "An invoice must have an invoice type code.", "Add the type code: 380 for an invoice, 381 for a credit note, 384 for a corrected invoice."),
  EN("BR-05", "BT-5", "An invoice must have a currency code.", "Add the ISO 4217 currency code, for example EUR."),
  EN("BR-06", "BT-27", "An invoice must contain the seller's name.", "Add the seller's legal name."),
  EN("BR-07", "BT-44", "An invoice must contain the buyer's name.", "Add the buyer's name."),
  EN("BR-08", "BG-5", "An invoice must contain the seller's postal address.", "Add the seller's address with at least the country code."),
  EN("BR-09", "BT-40", "The seller's postal address must contain a country code.", "Add the seller's ISO 3166-1 alpha-2 country code, for example DE."),
  EN("BR-10", "BG-8", "An invoice must contain the buyer's postal address.", "Add the buyer's address with at least the country code."),
  EN("BR-11", "BT-55", "The buyer's postal address must contain a country code.", "Add the buyer's ISO 3166-1 alpha-2 country code."),
  EN("BR-12", "BT-106", "An invoice must state the sum of the invoice line net amounts.", "Add the line total (sum of all line net amounts)."),
  EN("BR-13", "BT-109", "An invoice must state the total amount without VAT.", "Add the tax basis total."),
  EN("BR-14", "BT-112", "An invoice must state the total amount with VAT.", "Add the grand total."),
  EN("BR-15", "BT-115", "An invoice must state the amount due for payment.", "Add the payable amount."),
  EN("BR-16", "BG-25", "An invoice must have at least one invoice line.", "Add at least one line with item name, quantity, unit, net price and net amount."),
  EN("BR-21", "BT-126", "Each invoice line must have a line identifier.", "Number the lines (1, 2, 3 …)."),
  EN("BR-22", "BT-129", "Each invoice line must have an invoiced quantity.", "Add the quantity to the line."),
  EN("BR-23", "BT-130", "Each invoice line must have a unit of measure code for its quantity.", "Add a UN/ECE Recommendation 20 unit code: C62 (piece), HUR (hour), DAY, KGM, LTR, MTR …"),
  EN("BR-24", "BT-131", "Each invoice line must have a line net amount.", "Add the line's net amount (quantity x net price)."),
  EN("BR-25", "BT-153", "Each invoice line must contain the item name.", "Add a name for the item or service on the line."),
  EN("BR-26", "BT-146", "Each invoice line must contain the item net price.", "Add the net price of one unit."),
  EN("BR-27", "BT-146", "The item net price must not be negative.", "Use a positive price; express a deduction as a negative quantity or as a credit note."),
  EN("BR-45", "BT-116", "Each VAT breakdown row must have a taxable amount.", "Add the taxable (basis) amount to the row."),
  EN("BR-46", "BT-117", "Each VAT breakdown row must have a VAT amount.", "Add the VAT amount to the row (0.00 when no VAT is charged)."),
  EN("BR-47", "BT-118", "Each VAT breakdown row must have a VAT category code.", "Add the category code: S, Z, E, AE, K, G or O."),
  EN("BR-48", "BT-119", "Each VAT breakdown row must have a VAT rate, except when the invoice is not subject to VAT.", "Add the rate as a percentage (19, 7, 0)."),
  EN("BR-61", "BT-84", "When the payment means is a credit transfer (codes 30 and 58), the payment account identifier must be present.", "Add the IBAN of the account to be paid, or change the payment means code."),
  EN("BR-62", "BT-34", "The seller's electronic address must have a scheme identifier.", "Add the scheme, for example EM for an e-mail address."),
  EN("BR-63", "BT-49", "The buyer's electronic address must have a scheme identifier.", "Add the scheme, for example EM for an e-mail address."),
  EN("BR-CO-04", "BT-151", "Each invoice line must have a VAT category code.", "Add the VAT category to the line (S for standard rate)."),
  EN("BR-CO-09", "BT-31, BT-48", "A VAT identifier must start with the two-letter country code of the member state that issued it (EL for Greece).", "Write the VAT number with its country prefix, for example DE123456789."),
  EN("BR-CO-10", "BT-106", "The sum of invoice line net amounts must equal the total of the line net amounts.", "Recompute the line total from the lines, or correct the line that is off."),
  EN("BR-CO-13", "BT-109", "The total without VAT must equal the line total minus document allowances plus document charges.", "Recompute: line total - allowances + charges."),
  EN("BR-CO-14", "BT-110", "The total VAT amount must equal the sum of the VAT amounts of the VAT breakdown rows.", "Recompute the VAT total from the breakdown rows."),
  EN("BR-CO-15", "BT-112", "The total with VAT must equal the total without VAT plus the total VAT amount.", "Recompute: total without VAT + VAT total."),
  EN("BR-CO-16", "BT-115", "The amount due must equal the total with VAT minus the paid amount plus the rounding amount.", "Recompute: total with VAT - prepaid amount + rounding."),
  EN("BR-CO-17", "BT-117", "The VAT amount of a breakdown row must equal its taxable amount times its rate, rounded to two decimals.", "Recompute the row: taxable amount x rate / 100."),
  EN("BR-CO-18", "BG-23", "An invoice must have at least one VAT breakdown row.", "Add a VAT breakdown with category, rate, taxable amount and VAT amount."),
  EN("BR-CO-25", "BT-9, BT-20", "When the amount due is positive, the payment due date or the payment terms must be present.", "Add a due date or a payment terms text."),
  EN("BR-CO-26", "BT-29, BT-30, BT-31", "The seller must be identifiable: a seller identifier, a legal registration identifier or a VAT identifier must be present.", "Add the seller's VAT number or company registration number."),
  EN("BR-DEC-09", "BT-106", "The sum of line net amounts may have at most 2 decimals.", "Round the amount to two decimals."),
  EN("BR-DEC-12", "BT-109", "The total without VAT may have at most 2 decimals.", "Round the amount to two decimals."),
  EN("BR-DEC-13", "BT-110", "The total VAT amount may have at most 2 decimals.", "Round the amount to two decimals."),
  EN("BR-DEC-14", "BT-112", "The total with VAT may have at most 2 decimals.", "Round the amount to two decimals."),
  EN("BR-DEC-18", "BT-115", "The amount due may have at most 2 decimals.", "Round the amount to two decimals."),
  EN("BR-DEC-19", "BT-116", "A VAT breakdown taxable amount may have at most 2 decimals.", "Round the amount to two decimals."),
  EN("BR-DEC-20", "BT-117", "A VAT breakdown VAT amount may have at most 2 decimals.", "Round the amount to two decimals."),
  EN("BR-DEC-23", "BT-131", "A line net amount may have at most 2 decimals.", "Round the line net amount to two decimals."),
  ...categoryRules,
  DE("BR-DE-1", "BG-16", "An XRechnung must contain payment instructions.", "Add the payment means code (58 for a SEPA transfer) and the account details."),
  DE("BR-DE-2", "BG-6", "An XRechnung must contain the seller contact group.", "Add the seller's contact: name, telephone number and e-mail address."),
  DE("BR-DE-3", "BT-37", "The seller's city must be given.", "Add the city to the seller's address."),
  DE("BR-DE-4", "BT-38", "The seller's post code must be given.", "Add the post code to the seller's address."),
  DE("BR-DE-5", "BT-41", "The seller's contact point (a name or department) must be given.", "Add a contact name for the seller."),
  DE("BR-DE-6", "BT-42", "The seller's contact telephone number must be given.", "Add a telephone number for the seller's contact."),
  DE("BR-DE-7", "BT-43", "The seller's contact e-mail address must be given.", "Add an e-mail address for the seller's contact."),
  DE("BR-DE-8", "BT-52", "The buyer's city must be given.", "Add the city to the buyer's address."),
  DE("BR-DE-9", "BT-53", "The buyer's post code must be given.", "Add the post code to the buyer's address."),
  DE("BR-DE-14", "BT-119", "Each VAT breakdown row must give its VAT rate.", "Add the rate to every VAT breakdown row, 0 included."),
  DE("BR-DE-15", "BT-10", "The buyer reference must be given.", "Add the buyer reference. For German public-sector buyers this is the Leitweg-ID they gave you; for other buyers use their order or customer reference."),
  DE("BR-DE-16", "BT-31, BT-32", "When a VAT category S, Z, E, AE, K, G, L or M is used, the seller's VAT identifier or tax registration number must be given.", "Add the seller's VAT number (USt-IdNr.) or tax number (Steuernummer)."),
  DE("BR-DE-17", "BT-3", "The invoice type code should be one of 326, 380, 384, 389, 381, 875, 876 or 877.", "Use 380 for an invoice, 381 for a credit note or 384 for a corrected invoice.", "warning"),
  DE("BR-DE-19", "BT-84", "With payment means code 58 (SEPA credit transfer) the payment account should be a correct IBAN.", "Check the IBAN: country code, length and check digits.", "warning"),
  DE("BR-DE-21", "BT-24", "The specification identifier should be the XRechnung identifier.", "Set it to urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0.", "warning"),
  DE("BR-DE-23-a", "BT-81, BG-17", "When the payment means code is a credit transfer (30 or 58), the credit transfer details must be given.", "Add the IBAN (and optionally BIC and account holder)."),
  DE("BR-DE-27", "BT-42", "The seller's telephone number should contain at least three digits.", "Give a real telephone number.", "warning"),
  DE("BR-DE-28", "BT-43", "The seller's e-mail address should have exactly one @ with at least two characters on each side.", "Correct the e-mail address.", "warning"),
]);

const BY_ID = new Map(RULES.map((r) => [r.id, r]));
const BY_SLUG = new Map(RULES.map((r) => [r.id.toLowerCase(), r]));
/** A rule by its number in any case ("br-de-15"). */
export const ruleDoc = (id: string) => BY_SLUG.get(id.trim().toLowerCase());
/** URL slug of a rule's page: "br-de-15". */
export const ruleSlug = (id: string) => id.toLowerCase();

const eq = (a: number, b: number) => Math.abs(a - b) < 0.005;
const decimals = (n: number) => { const s = String(n); const i = s.indexOf("."); return i < 0 || s.includes("e") ? 0 : s.length - i - 1; };
const TYPE_CODES_DE = new Set(["326", "380", "384", "389", "381", "875", "876", "877"]);
const VAT_NEEDING_ID = new Set(["S", "Z", "E", "AE", "K", "G", "L", "M"]);

/** ISO 13616 mod-97 check; structure only. */
export function ibanValid(iban: string): boolean {
  const s = iban.replace(/\s/g, "").toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(s)) return false;
  const moved = s.slice(4) + s.slice(0, 4);
  let rem = 0;
  for (const ch of moved) {
    const v = ch >= "A" ? String(ch.charCodeAt(0) - 55) : ch;
    for (const d of v) rem = (rem * 10 + Number(d)) % 97;
  }
  return rem === 1;
}

export interface Validation {
  valid: boolean;
  profile: "en16931" | "xrechnung";
  errors: Finding[];
  warnings: Finding[];
  rulesChecked: number;
  coverage: string;
}

export const COVERAGE = "A subset of EN 16931 and XRechnung 3.0 business rules for invoices with lines, VAT and bank-transfer payment. Not checked: the XML schema itself, code lists beyond the common codes, allowances and charges, attachments, card and direct-debit payments. A file that passes here can still fail the official KoSIT validator.";

/** Runs the rules. `xrechnung` adds the German BR-DE rules; by default they run when the file names XRechnung. */
export function validateInvoice(inv: Invoice, options: { xrechnung?: boolean } = {}): Validation {
  const xr = options.xrechnung ?? /xrechnung/i.test(inv.specification ?? "");
  const found: Finding[] = [];
  const hit = (id: string, message: string, location?: string) => {
    const doc = BY_ID.get(id);
    if (!doc) throw new Error(`unknown rule ${id}`);
    found.push({ rule: id, level: doc.level, field: doc.field, message, fix: doc.fix, ...(location ? { location } : {}) });
  };
  const need = (id: string, value: unknown, what: string, location?: string) => { if (value === undefined || value === "") hit(id, `${what} is missing.`, location); };

  const s = inv.seller ?? {}, b = inv.buyer ?? {}, t = inv.totals ?? {}, pay = inv.payment ?? {};
  const lines = inv.lines ?? [], vat = inv.vat ?? [];
  need("BR-01", inv.specification, "The specification identifier (BT-24)");
  need("BR-02", inv.number, "The invoice number (BT-1)");
  need("BR-03", inv.issueDate, "The issue date (BT-2)");
  need("BR-04", inv.typeCode, "The invoice type code (BT-3)");
  need("BR-05", inv.currency, "The currency code (BT-5)");
  need("BR-06", s.name, "The seller's name (BT-27)");
  need("BR-07", b.name, "The buyer's name (BT-44)");
  if (!s.street && !s.city && !s.postCode && !s.country) hit("BR-08", "The seller's postal address (BG-5) is missing.");
  need("BR-09", s.country, "The seller's country code (BT-40)");
  if (!b.street && !b.city && !b.postCode && !b.country) hit("BR-10", "The buyer's postal address (BG-8) is missing.");
  need("BR-11", b.country, "The buyer's country code (BT-55)");
  need("BR-12", t.lineNet, "The sum of line net amounts (BT-106)");
  need("BR-13", t.taxBasis, "The total without VAT (BT-109)");
  need("BR-14", t.grand, "The total with VAT (BT-112)");
  need("BR-15", t.payable, "The amount due (BT-115)");
  if (!lines.length) hit("BR-16", "The invoice has no lines (BG-25).");
  if (s.endpointId && !s.endpointScheme) hit("BR-62", "The seller's electronic address (BT-34) has no scheme identifier.");
  if (b.endpointId && !b.endpointScheme) hit("BR-63", "The buyer's electronic address (BT-49) has no scheme identifier.");
  if (!s.vatId && !s.legalId && !s.taxNumber) hit("BR-CO-26", "The seller has no VAT identifier, registration identifier or tax number.");
  for (const [who, id] of [["seller", s.vatId], ["buyer", b.vatId]] as const)
    if (id && !/^[A-Z]{2}/.test(id)) hit("BR-CO-09", `The ${who}'s VAT identifier "${id.slice(0, 20)}" does not start with a two-letter country code.`);

  lines.forEach((l: Line, i) => {
    const at = `line ${l.id ?? i + 1}`;
    need("BR-21", l.id, "The line identifier (BT-126)", `line ${i + 1}`);
    need("BR-22", l.quantity, "The invoiced quantity (BT-129)", at);
    need("BR-23", l.unit, "The unit of measure code (BT-130)", at);
    need("BR-24", l.netAmount, "The line net amount (BT-131)", at);
    need("BR-25", l.name, "The item name (BT-153)", at);
    need("BR-26", l.unitPrice, "The item net price (BT-146)", at);
    need("BR-CO-04", l.vatCategory, "The line's VAT category code (BT-151)", at);
    if (l.unitPrice !== undefined && l.unitPrice < 0) hit("BR-27", `The item net price is ${l.unitPrice}, which is negative.`, at);
    if (l.netAmount !== undefined && decimals(l.netAmount) > 2) hit("BR-DEC-23", `The line net amount ${l.netAmount} has more than 2 decimals.`, at);
    const c = l.vatCategory ? CATEGORIES[l.vatCategory] : undefined;
    if (c && l.vatRate !== undefined) {
      if (l.vatCategory === "S" ? !(l.vatRate > 0) : l.vatRate !== 0) hit(`BR-${c.key}-05`, `The line is "${c.name}" (${l.vatCategory}) but its VAT rate is ${l.vatRate}.`, at);
    }
  });

  if (!vat.length) hit("BR-CO-18", "The invoice has no VAT breakdown (BG-23).");
  vat.forEach((v, i) => {
    const at = `VAT breakdown ${i + 1}`;
    need("BR-45", v.basis, "The taxable amount (BT-116)", at);
    need("BR-46", v.tax, "The VAT amount (BT-117)", at);
    need("BR-47", v.category, "The VAT category code (BT-118)", at);
    if (v.rate === undefined && v.category !== "O") { hit("BR-48", "The VAT rate (BT-119) is missing.", at); if (xr) hit("BR-DE-14", "The VAT rate (BT-119) is missing.", at); }
    if (v.basis !== undefined && decimals(v.basis) > 2) hit("BR-DEC-19", `The taxable amount ${v.basis} has more than 2 decimals.`, at);
    if (v.tax !== undefined && decimals(v.tax) > 2) hit("BR-DEC-20", `The VAT amount ${v.tax} has more than 2 decimals.`, at);
    if (v.basis !== undefined && v.tax !== undefined && v.rate !== undefined) {
      const expected = round2((v.basis * v.rate) / 100);
      if (!eq(expected, v.tax)) hit("BR-CO-17", `The VAT amount is ${v.tax}, but ${v.basis} x ${v.rate}% is ${expected.toFixed(2)}.`, at);
    }
  });

  // Category rules: each category used on a line needs its breakdown row, identifiers, basis and reason.
  const noDocLevel = !(inv.unsupported ?? []).some((u) => u.includes("allowances"));
  for (const [code, c] of Object.entries(CATEGORIES)) {
    const own = lines.filter((l) => l.vatCategory === code);
    const rows = vat.filter((v) => v.category === code);
    if (own.length && (code === "S" ? rows.length === 0 : rows.length !== 1)) hit(`BR-${c.key}-01`, `There ${own.length === 1 ? "is 1 line" : `are ${own.length} lines`} in VAT category ${code} but ${rows.length} VAT breakdown row(s) for it.`);
    if (own.length && ((!s.vatId && !s.taxNumber) || (c.buyerVat && !b.vatId))) hit(`BR-${c.key}-02`, c.buyerVat && !b.vatId ? `A "${c.name}" invoice needs the buyer's VAT identifier (BT-48).` : `A "${c.name}" invoice needs the seller's VAT identifier (BT-31) or tax number (BT-32).`);
    rows.forEach((row) => {
      const at = `VAT breakdown ${code}${code === "S" ? ` ${row.rate}%` : ""}`;
      if (noDocLevel && row.basis !== undefined && own.every((l) => l.netAmount !== undefined)) {
        const sum = round2(own.filter((l) => code !== "S" || l.vatRate === row.rate).reduce((a, l) => a + (l.netAmount ?? 0), 0));
        if (!eq(sum, row.basis)) hit(`BR-${c.key}-08`, `The taxable amount is ${row.basis}, but its lines add up to ${sum.toFixed(2)}.`, at);
      }
      if (code !== "S" && row.tax !== undefined && !eq(row.tax, 0)) hit(`BR-${c.key}-09`, `The VAT amount is ${row.tax}; it must be 0 for "${c.name}".`, at);
      if (c.reason ? !row.exemptionReason : !!row.exemptionReason) hit(`BR-${c.key}-10`, c.reason ? `The "${c.name}" row has no VAT exemption reason.` : `The "${c.name}" row carries a VAT exemption reason, which is not allowed.`, at);
    });
  }

  // Totals.
  const dec2 = (id: string, n: number | undefined, what: string) => { if (n !== undefined && decimals(n) > 2) hit(id, `${what} ${n} has more than 2 decimals.`); };
  dec2("BR-DEC-09", t.lineNet, "The sum of line net amounts"); dec2("BR-DEC-12", t.taxBasis, "The total without VAT"); dec2("BR-DEC-13", t.tax, "The total VAT amount");
  dec2("BR-DEC-14", t.grand, "The total with VAT"); dec2("BR-DEC-18", t.payable, "The amount due");
  if (t.lineNet !== undefined && lines.length && lines.every((l) => l.netAmount !== undefined)) {
    const sum = round2(lines.reduce((a, l) => a + (l.netAmount ?? 0), 0));
    if (!eq(sum, t.lineNet)) hit("BR-CO-10", `The sum of line net amounts is ${t.lineNet}, but the lines add up to ${sum.toFixed(2)}.`);
  }
  if (t.lineNet !== undefined && t.taxBasis !== undefined) {
    const expected = round2(t.lineNet - (t.allowances ?? 0) + (t.charges ?? 0));
    if (!eq(expected, t.taxBasis)) hit("BR-CO-13", `The total without VAT is ${t.taxBasis}, but line total - allowances + charges is ${expected.toFixed(2)}.`);
  }
  if (vat.length && vat.every((v) => v.tax !== undefined)) {
    const sum = round2(vat.reduce((a, v) => a + (v.tax ?? 0), 0));
    if (!eq(sum, t.tax ?? 0)) hit("BR-CO-14", `The total VAT amount is ${t.tax ?? "missing"}, but the VAT breakdown adds up to ${sum.toFixed(2)}.`);
  }
  if (t.taxBasis !== undefined && t.grand !== undefined) {
    const expected = round2(t.taxBasis + (t.tax ?? 0));
    if (!eq(expected, t.grand)) hit("BR-CO-15", `The total with VAT is ${t.grand}, but total without VAT + VAT is ${expected.toFixed(2)}.`);
  }
  if (t.grand !== undefined && t.payable !== undefined) {
    const expected = round2(t.grand - (t.prepaid ?? 0));
    // A rounding amount (BT-114) is not carried; a difference under one currency unit is left to it.
    if (!eq(expected, t.payable) && Math.abs(expected - t.payable) >= 1) hit("BR-CO-16", `The amount due is ${t.payable}, but total with VAT - prepaid is ${expected.toFixed(2)}.`);
  }
  if ((t.payable ?? 0) > 0 && !inv.dueDate && !pay.terms) hit("BR-CO-25", "The amount due is positive but there is no due date (BT-9) and no payment terms (BT-20).");
  const transfer = pay.meansCode === "30" || pay.meansCode === "58";
  if (transfer && !pay.iban) hit("BR-61", `The payment means code is ${pay.meansCode} (credit transfer) but no account (BT-84) is given.`);

  if (xr) {
    if (!pay.meansCode) hit("BR-DE-1", "The payment instructions (BG-16) are missing.");
    if (!s.contactName && !s.phone && !s.email) hit("BR-DE-2", "The seller contact group (BG-6) is missing.");
    need("BR-DE-3", s.city, "The seller's city (BT-37)");
    need("BR-DE-4", s.postCode, "The seller's post code (BT-38)");
    need("BR-DE-5", s.contactName, "The seller's contact point (BT-41)");
    need("BR-DE-6", s.phone, "The seller's contact telephone number (BT-42)");
    need("BR-DE-7", s.email, "The seller's contact e-mail address (BT-43)");
    need("BR-DE-8", b.city, "The buyer's city (BT-52)");
    need("BR-DE-9", b.postCode, "The buyer's post code (BT-53)");
    need("BR-DE-15", inv.buyerReference, "The buyer reference (BT-10)");
    if (!s.vatId && !s.taxNumber && [...lines.map((l) => l.vatCategory), ...vat.map((v) => v.category)].some((c) => c && VAT_NEEDING_ID.has(c))) hit("BR-DE-16", "The seller's VAT identifier (BT-31) or tax number (BT-32) is missing.");
    if (inv.typeCode && !TYPE_CODES_DE.has(inv.typeCode)) hit("BR-DE-17", `The invoice type code is ${inv.typeCode}.`);
    if (pay.meansCode === "58" && pay.iban && !ibanValid(pay.iban)) hit("BR-DE-19", `"${pay.iban.slice(0, 34)}" is not a correct IBAN.`);
    if (inv.specification && !/^urn:cen\.eu:en16931:2017#compliant#urn:(xoev-de|xeinkauf\.de):kosit:(standard:)?xrechnung_\d+\.\d+/.test(inv.specification)) hit("BR-DE-21", `The specification identifier is "${inv.specification.slice(0, 120)}".`);
    if (transfer && !pay.iban) hit("BR-DE-23-a", "The credit transfer details (BG-17) are missing.");
    if (s.phone && (s.phone.match(/\d/g) ?? []).length < 3) hit("BR-DE-27", `The telephone number "${s.phone.slice(0, 30)}" has fewer than three digits.`);
    if (s.email && !/^[^@\s.][^@\s]*[^@\s.]@[^@\s.][^@\s]*[^@\s.]$/.test(s.email)) hit("BR-DE-28", `"${s.email.slice(0, 60)}" does not look like an e-mail address.`);
  }

  const errors = found.filter((f) => f.level === "error"), warnings = found.filter((f) => f.level === "warning");
  return { valid: errors.length === 0, profile: xr ? "xrechnung" : "en16931", errors, warnings, rulesChecked: RULES.filter((r) => xr || r.standard === "EN 16931").length, coverage: COVERAGE };
}
