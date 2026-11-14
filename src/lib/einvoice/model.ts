// The invoice as the e-invoice tools hold it (14 Nov 2026): the EN 16931 semantic model, cut to what small-business
// invoices use. Every field is optional here because the same shape carries a parsed file that may be incomplete; the
// validator (validate.ts) says what is missing, and `fromInput` fills what can be computed for a file we write.
//
// Not carried in this version: document-level allowances and charges with their own VAT lines, line-level allowances,
// item attributes and classifications, delivery address, preceding-invoice references, attachments, tax representative,
// payee other than the seller, card and direct-debit details. A parsed file that has them is still read (its totals
// are taken as written), and `unsupported` names what was seen and not carried.

export interface Party {
  name?: string;
  /** BT-31 / BT-48: VAT identifier with its country prefix. */
  vatId?: string;
  /** BT-32: the seller's national tax number (German Steuernummer). */
  taxNumber?: string;
  /** BT-30 / BT-47: company registration number. */
  legalId?: string;
  street?: string;
  city?: string;
  postCode?: string;
  /** ISO 3166-1 alpha-2. */
  country?: string;
  /** BT-34 / BT-49: electronic address (an e-mail address unless `endpointScheme` says otherwise). */
  endpointId?: string;
  endpointScheme?: string;
  contactName?: string;
  phone?: string;
  email?: string;
}

export interface Line {
  id?: string;
  name?: string;
  description?: string;
  quantity?: number;
  /** UN/ECE Recommendation 20 unit code; C62 = one (piece), HUR = hour, DAY = day. */
  unit?: string;
  /** Net price of one unit. */
  unitPrice?: number;
  netAmount?: number;
  vatCategory?: string;
  vatRate?: number;
}

export interface VatLine {
  category?: string;
  rate?: number;
  basis?: number;
  tax?: number;
  exemptionReason?: string;
}

export interface Totals {
  /** BT-106 */ lineNet?: number;
  /** BT-107 */ allowances?: number;
  /** BT-108 */ charges?: number;
  /** BT-109 */ taxBasis?: number;
  /** BT-110 */ tax?: number;
  /** BT-112 */ grand?: number;
  /** BT-113 */ prepaid?: number;
  /** BT-115 */ payable?: number;
}

export interface Payment {
  /** UNTDID 4461: 58 SEPA credit transfer, 30 credit transfer, 59 SEPA direct debit, 48 card, 10 cash, 1 not defined. */
  meansCode?: string;
  iban?: string;
  bic?: string;
  accountName?: string;
  /** BT-83: remittance information. */
  reference?: string;
  /** BT-20: payment terms as text. */
  terms?: string;
}

export interface Invoice {
  /** BT-24 */ specification?: string;
  /** BT-23 */ businessProcess?: string;
  number?: string;
  /** ISO date. */ issueDate?: string;
  /** UNTDID 1001: 380 invoice, 381 credit note, 384 corrected invoice, 389 self-billed, 326 partial. */
  typeCode?: string;
  currency?: string;
  dueDate?: string;
  deliveryDate?: string;
  /** BT-10: the buyer's reference; for German public buyers the Leitweg-ID. */
  buyerReference?: string;
  orderReference?: string;
  note?: string;
  seller?: Party;
  buyer?: Party;
  lines?: Line[];
  vat?: VatLine[];
  totals?: Totals;
  payment?: Payment;
  /** Parts of a parsed file this model does not carry. */
  unsupported?: string[];
}

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

const text = (v: unknown, max = 500): string | undefined => {
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (typeof v !== "string") return undefined;
  const s = v.trim();
  return s ? s.slice(0, max) : undefined;
};

/** A number from JSON or from what an invoice reader returns ("1.234,50", "1,234.50", "19 %"). */
export function numberOf(v: unknown): number | undefined {
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (typeof v !== "string") return undefined;
  let s = v.replace(/[^\d.,\-]/g, "");
  if (!/\d/.test(s)) return undefined;
  const comma = s.lastIndexOf(","), dot = s.lastIndexOf(".");
  if (comma > dot) s = /,\d{1,4}$/.test(s) ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  else s = s.replace(/,/g, "");
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

/** ISO date from 2026-11-14, 20261114, 14.11.2026 or 14/11/2026 (day first, as EU invoices write it). */
export function isoDate(v: unknown): string | undefined {
  const s = text(v, 40);
  if (!s) return undefined;
  const ok = (y: number, m: number, d: number) => {
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? dt.toISOString().slice(0, 10) : undefined;
  };
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return ok(+m[1], +m[2], +m[3]);
  m = /^(\d{4})(\d{2})(\d{2})$/.exec(s);
  if (m) return ok(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/.exec(s);
  if (m) return ok(+m[3], +m[2], +m[1]);
  return undefined;
}

type Raw = Record<string, unknown>;
const obj = (v: unknown): Raw => (v && typeof v === "object" && !Array.isArray(v) ? (v as Raw) : {});
/** The first of several spellings a caller may use for one field. */
const first = (o: Raw, ...names: string[]): unknown => {
  for (const n of names) if (o[n] !== undefined && o[n] !== null && o[n] !== "") return o[n];
  return undefined;
};

const UNIT_WORDS: Readonly<Record<string, string>> = Object.freeze({
  piece: "C62", pieces: "C62", pcs: "C62", pc: "C62", unit: "C62", units: "C62", each: "C62", ea: "C62", stk: "C62", "stück": "C62", st: "C62",
  hour: "HUR", hours: "HUR", h: "HUR", hrs: "HUR", std: "HUR", stunde: "HUR", stunden: "HUR",
  day: "DAY", days: "DAY", tag: "DAY", tage: "DAY", month: "MON", months: "MON", monat: "MON",
  kg: "KGM", kilogram: "KGM", g: "GRM", l: "LTR", litre: "LTR", liter: "LTR", m: "MTR", metre: "MTR", meter: "MTR",
  km: "KMT", m2: "MTK", "m²": "MTK", m3: "MTQ", "m³": "MTQ", t: "TNE", min: "MIN", minute: "MIN", minutes: "MIN",
  pauschal: "LS", "lump sum": "LS", flat: "LS", set: "SET", pair: "PR",
});
export function unitCode(v: unknown): string {
  const s = text(v, 20);
  if (!s) return "C62";
  const key = s.toLowerCase();
  if (Object.hasOwn(UNIT_WORDS, key)) return UNIT_WORDS[key];
  return /^[A-Z0-9]{2,3}$/.test(s) ? s : "C62";
}

function party(raw: unknown, flat: Raw, prefix: "seller" | "buyer"): Party {
  const p = obj(raw);
  const addr = obj(first(p, "address"));
  const flatAddress = text(first(flat, `${prefix}_address`), 300);
  const out: Party = {
    name: text(first(p, "name", "company") ?? first(flat, `${prefix}_name`)),
    vatId: text(first(p, "vatId", "vat_id", "vat", "vatNumber", "vat_number") ?? first(flat, `${prefix}_vat_number`), 30)?.replace(/[\s.]/g, "").toUpperCase(),
    taxNumber: text(first(p, "taxNumber", "tax_number", "steuernummer"), 40),
    legalId: text(first(p, "legalId", "legal_id", "registrationNumber", "registration_number", "companyNumber"), 60),
    street: text(first(p, "street", "line1", "address1") ?? first(addr, "street", "line1") ?? flatAddress, 200),
    city: text(first(p, "city", "town") ?? first(addr, "city", "town"), 100),
    postCode: text(first(p, "postCode", "post_code", "postalCode", "postal_code", "zip") ?? first(addr, "postCode", "postalCode", "zip"), 20),
    country: text(first(p, "country", "countryCode", "country_code") ?? first(addr, "country") ?? first(flat, `${prefix}_country`), 2)?.toUpperCase(),
    endpointId: text(first(p, "endpointId", "endpoint", "electronicAddress"), 200),
    endpointScheme: text(first(p, "endpointScheme"), 10),
    contactName: text(first(p, "contactName", "contact_name", "contact"), 100),
    phone: text(first(p, "phone", "telephone", "tel"), 40),
    email: text(first(p, "email", "e_mail", "mail"), 200),
  };
  // A VAT number names its country; use it when the caller gave none.
  if (!out.country && out.vatId && /^[A-Z]{2}/.test(out.vatId)) out.country = out.vatId.slice(0, 2) === "EL" ? "GR" : out.vatId.slice(0, 2);
  if (!out.endpointId && out.email) { out.endpointId = out.email; out.endpointScheme = "EM"; }
  if (out.endpointId && !out.endpointScheme) out.endpointScheme = "EM";
  for (const k of Object.keys(out) as (keyof Party)[]) if (out[k] === undefined) delete out[k];
  return out;
}

const CATEGORY_WORDS: Readonly<Record<string, string>> = Object.freeze({
  standard: "S", s: "S", zero: "Z", z: "Z", exempt: "E", e: "E", "reverse charge": "AE", "reverse-charge": "AE", reverse_charge: "AE", ae: "AE",
  "intra-community": "K", intracommunity: "K", k: "K", export: "G", g: "G", "outside scope": "O", o: "O", l: "L", m: "M",
});
const categoryCode = (v: unknown, rate: number | undefined): string => {
  const s = text(v, 30)?.toLowerCase();
  if (s && Object.hasOwn(CATEGORY_WORDS, s)) return CATEGORY_WORDS[s];
  return rate === undefined || rate > 0 ? "S" : "Z";
};

const EXEMPTION_TEXT: Readonly<Record<string, string>> = Object.freeze({
  AE: "Reverse charge", K: "Intra-community supply", G: "Export outside the EU", E: "Exempt from VAT", O: "Not subject to VAT",
});

/**
 * An invoice from what a caller sent: our own shape (seller, buyer, lines…), common other spellings, and the flat
 * field names /document/extract and /invoice/check return (invoice_number, seller_name, line_items…), so a read
 * invoice can be written back as an e-invoice. Line totals, the VAT breakdown and the document totals are computed
 * when the caller left them out; figures the caller did send are kept as sent, and the validator reports any that
 * do not add up.
 */
export function fromInput(input: unknown): Invoice {
  const r = obj(input);
  // The VAT rate for lines that state none: the caller's own, or the one the invoice's net and VAT amounts imply
  // (an invoice reader returns amounts, not a rate: 124.61 on 593.36 is 21%). Rounded to a half percent.
  const statedNet = numberOf(first(r, "net_amount", "netAmount")), statedVat = numberOf(first(r, "vat_amount", "vatAmount"));
  const impliedRate = statedNet && statedVat !== undefined && statedNet > 0 && statedVat >= 0 ? Math.round((statedVat / statedNet) * 200) / 2 : undefined;
  const defaultRate = numberOf(first(r, "vatRate", "vat_rate", "taxRate")) ?? impliedRate;
  const defaultCategory = first(r, "vatCategory", "vat_category");
  const rawLines = first(r, "lines", "items", "line_items", "lineItems");
  const lines: Line[] = (Array.isArray(rawLines) ? rawLines : []).slice(0, 500).map((item, i) => {
    const l = obj(item);
    const quantity = numberOf(first(l, "quantity", "qty")) ?? 1;
    const net = numberOf(first(l, "netAmount", "net_amount", "amount", "total", "net"));
    let unitPrice = numberOf(first(l, "unitPrice", "unit_price", "price"));
    if (unitPrice === undefined && net !== undefined && quantity) unitPrice = Math.round((net / quantity) * 10000) / 10000;
    const rate = numberOf(first(l, "vatRate", "vat_rate", "taxRate", "vat")) ?? defaultRate;
    const name = text(first(l, "name", "title", "description", "item"), 300);
    const description = text(first(l, "name", "title") !== undefined ? first(l, "description") : undefined, 1000);
    return {
      id: text(first(l, "id", "line", "position"), 20) ?? String(i + 1),
      name,
      ...(description ? { description } : {}),
      quantity,
      unit: unitCode(first(l, "unit", "unitCode", "unit_code")),
      ...(unitPrice !== undefined ? { unitPrice } : {}),
      netAmount: net ?? (unitPrice !== undefined ? round2(quantity * unitPrice) : undefined),
      vatCategory: categoryCode(first(l, "vatCategory", "vat_category", "category") ?? defaultCategory, rate),
      vatRate: rate ?? 0,
    };
  });

  // VAT breakdown: one row per category and rate, the basis is the sum of its lines.
  const sentVat = first(r, "vat", "vatBreakdown", "vat_breakdown");
  let vat: VatLine[];
  if (Array.isArray(sentVat) && sentVat.length) {
    vat = sentVat.slice(0, 20).map((row) => {
      const v = obj(row);
      const rate = numberOf(first(v, "rate", "vatRate", "percent"));
      return { category: categoryCode(first(v, "category", "vatCategory"), rate), rate: rate ?? 0, basis: numberOf(first(v, "basis", "net", "taxable")), tax: numberOf(first(v, "tax", "vat", "amount")), exemptionReason: text(first(v, "exemptionReason", "reason"), 300) };
    });
  } else {
    const groups = new Map<string, VatLine>();
    for (const l of lines) {
      const key = `${l.vatCategory}|${l.vatRate}`;
      const g = groups.get(key) ?? { category: l.vatCategory, rate: l.vatRate, basis: 0 };
      g.basis = round2((g.basis ?? 0) + (l.netAmount ?? 0));
      groups.set(key, g);
    }
    vat = [...groups.values()].map((g) => ({ ...g, tax: round2(((g.basis ?? 0) * (g.rate ?? 0)) / 100) }));
  }
  const reason = text(first(r, "exemptionReason", "exemption_reason", "vatExemptionReason"), 300);
  for (const v of vat) {
    if (v.category && v.category !== "S" && v.category !== "Z" && !v.exemptionReason) v.exemptionReason = reason ?? EXEMPTION_TEXT[v.category];
    if (v.exemptionReason === undefined) delete v.exemptionReason;
  }

  const t = obj(first(r, "totals"));
  const lineNet = numberOf(first(t, "lineNet", "net") ?? first(r, "net_amount", "netAmount")) ?? round2(lines.reduce((a, l) => a + (l.netAmount ?? 0), 0));
  const tax = numberOf(first(t, "tax", "vat") ?? first(r, "vat_amount", "vatAmount")) ?? round2(vat.reduce((a, v) => a + (v.tax ?? 0), 0));
  const grand = numberOf(first(t, "grand", "total", "gross") ?? first(r, "total_amount", "totalAmount", "total")) ?? round2(lineNet + tax);
  const prepaid = numberOf(first(t, "prepaid", "paid") ?? first(r, "prepaid", "paidAmount"));
  const payable = numberOf(first(t, "payable", "due") ?? first(r, "payable", "amountDue")) ?? round2(grand - (prepaid ?? 0));

  const pay = obj(first(r, "payment"));
  const iban = text(first(pay, "iban", "account") ?? first(r, "iban"), 42)?.replace(/\s/g, "").toUpperCase();
  const payment: Payment = {
    meansCode: text(first(pay, "meansCode", "means_code", "code"), 3) ?? (iban ? "58" : "1"),
    iban,
    bic: text(first(pay, "bic", "swift") ?? first(r, "bic"), 11)?.toUpperCase(),
    accountName: text(first(pay, "accountName", "account_name", "holder"), 140),
    reference: text(first(pay, "reference", "remittance") ?? first(r, "payment_reference", "paymentReference"), 140),
    terms: text(first(pay, "terms") ?? first(r, "paymentTerms", "payment_terms"), 500),
  };
  for (const k of Object.keys(payment) as (keyof Payment)[]) if (payment[k] === undefined) delete payment[k];

  const invoice: Invoice = {
    number: text(first(r, "number", "invoiceNumber", "invoice_number", "id"), 60),
    issueDate: isoDate(first(r, "issueDate", "issue_date", "date", "invoiceDate", "invoice_date")),
    typeCode: text(first(r, "typeCode", "type_code", "type"), 3) ?? "380",
    currency: (text(first(r, "currency", "currencyCode"), 3) ?? "EUR").toUpperCase(),
    dueDate: isoDate(first(r, "dueDate", "due_date")),
    deliveryDate: isoDate(first(r, "deliveryDate", "delivery_date", "serviceDate", "service_date")),
    buyerReference: text(first(r, "buyerReference", "buyer_reference", "leitwegId", "leitweg_id", "reference"), 100),
    orderReference: text(first(r, "orderReference", "order_reference", "purchaseOrder", "po_number"), 100),
    note: text(first(r, "note", "notes", "comment"), 2000),
    seller: party(first(r, "seller", "supplier", "from"), r, "seller"),
    buyer: party(first(r, "buyer", "customer", "to"), r, "buyer"),
    lines,
    vat,
    totals: { lineNet, taxBasis: lineNet, tax, grand, ...(prepaid !== undefined ? { prepaid } : {}), payable },
    payment,
  };
  for (const k of Object.keys(invoice) as (keyof Invoice)[]) if (invoice[k] === undefined) delete invoice[k];
  return invoice;
}
