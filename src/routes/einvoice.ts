/**
 * EU e-invoices: create, validate, convert (14 Nov 2026; plan `C:\MoneyWallet\business\tool-call-market-plan-2026-11-14.md`).
 *
 * Why: German companies above EUR 800,000 turnover must issue structured e-invoices from 1 Jan 2027 and every company
 * from 1 Jan 2028; France follows for small firms in Sep 2027. The code libraries for the formats had 170,000-250,000
 * npm downloads each in the month to 14 Nov 2026, while the one ZUGFeRD node for n8n had 137: people who cannot run a
 * library (automation tools, agents, small shops' back offices) have no hosted step for it. All three tools are pure
 * computation: no model, no outside source, no personal data kept.
 *
 * What these do NOT do, said in every answer that needs it: they do not produce the ZUGFeRD/Factur-X PDF (only its
 * XML part), they do not transmit to a Peppol or French platform, and the validator is a rule subset, not the official
 * KoSIT validator (lib/einvoice/validate.ts says which rules).
 */
import { entry, pick, type Entry, type Input } from "../family";
import { HttpError } from "../lib/env";
import { fetchFile } from "../lib/fetch";
import { FILE_REF_INPUT, heldFile, isFileRef } from "../lib/file-input";
import { longInput } from "../lib/long-input";
import { fromInput, type Invoice } from "../lib/einvoice/model";
import { profileName, readInvoice, XmlError } from "../lib/einvoice/parse";
import { embeddedInvoiceXml } from "../lib/einvoice/pdf-xml";
import { COVERAGE, validateInvoice } from "../lib/einvoice/validate";
import { FORMATS, formatInfo, writeInvoice, type Format } from "../lib/einvoice/write";

export const EINVOICE_MAX_BYTES = 5 * 1024 * 1024;
/** An official XRechnung test-suite invoice (KoSIT, Apache 2.0) on GitHub raw, never a file on our own origin (the 1.44.1 lesson). */
export const SAMPLE_XRECHNUNG = "https://raw.githubusercontent.com/itplr-kosit/xrechnung-testsuite/master/src/test/business-cases/standard/01.01a-INVOICE_uncefact.xml";

const FORMAT_ALIASES: Readonly<Record<string, Format>> = Object.freeze({
  "xrechnung-cii": "xrechnung", cii: "xrechnung", "factur-x": "zugferd", facturx: "zugferd", "zugferd-xml": "zugferd", en16931: "ubl", "ubl-invoice": "ubl", peppol: "ubl", "xrechnung_ubl": "xrechnung-ubl",
});

const isPdf = (b: Uint8Array) => b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46;

/** The XML a ZUGFeRD / Factur-X PDF carries as an embedded file, or a 422 when it has none. */
async function xmlFromPdf(bytes: Uint8Array): Promise<{ xml: string; attachment: string }> {
  const xml = await embeddedInvoiceXml(bytes);
  if (!xml) throw new HttpError(422, "the PDF has no readable embedded invoice XML, so it is a plain (or encrypted) PDF, not a ZUGFeRD or Factur-X e-invoice; read its fields with /document/extract instead (nothing was charged)");
  return { xml, attachment: "embedded XML" };
}

/** The e-invoice a caller sent: `xml` text, an uploaded file, or a `url`; an XML file or a PDF that embeds one. */
async function sentInvoice(q: Input): Promise<{ xml: string; source: string; url?: string; attachment?: string }> {
  const sent = q(FILE_REF_INPUT);
  let bytes: Uint8Array | null = null;
  let source = "upload";
  let url: string | undefined;
  if (isFileRef(sent)) {
    bytes = heldFile(sent);
    if (!bytes) throw new HttpError(400, "send the file in a POST body (raw bytes, a multipart `file` part, or base64 in JSON); a file reference cannot be used in a GET");
  } else {
    const text = longInput(q("xml"));
    if (text === null) throw new HttpError(400, "send the XML in a POST body; a text reference cannot be used in a GET");
    if (text && text.trim()) {
      if (text.length > EINVOICE_MAX_BYTES) throw new HttpError(400, "xml is larger than 5 MB");
      return { xml: text, source: "xml" };
    }
    if (!q("url")?.trim()) throw new HttpError(400, "give the e-invoice as `xml` text, as a file in a POST body, or as a public `url`");
    const file = await fetchFile(q("url"), /^/, EINVOICE_MAX_BYTES, "an e-invoice file", { cacheSeconds: 600, budgetMs: 15_000 });
    bytes = file.bytes;
    url = file.url;
    source = "url";
  }
  if (isPdf(bytes)) return { ...(await xmlFromPdf(bytes)), source, ...(url ? { url } : {}) };
  return { xml: new TextDecoder().decode(bytes), source, ...(url ? { url } : {}) };
}

function read(xml: string) {
  try { return readInvoice(xml); } catch (e) {
    if (e instanceof XmlError) throw new HttpError(422, `${e.message} (nothing was charged)`);
    throw e;
  }
}

const profileOption = (q: Input): boolean | undefined => {
  const p = q("profile")?.trim().toLowerCase();
  return !p || p === "auto" ? undefined : p === "xrechnung" ? true : p === "en16931" ? false : (() => { throw new HttpError(400, "profile must be one of: auto, xrechnung, en16931"); })();
};

/** Builds and validates the e-invoice for an input invoice. Exported for the tests. */
export function createEinvoice(input: unknown, format: Format) {
  const info = formatInfo(format);
  const invoice: Invoice = { ...fromInput(input), specification: info.specification, ...(info.businessProcess ? { businessProcess: info.businessProcess } : {}) };
  if (invoice.typeCode === "381" && info.syntax === "UBL") throw new HttpError(422, "a credit note (type 381) is written in the CII formats only in this version: use format xrechnung or zugferd (nothing was charged)");
  const validation = validateInvoice(invoice);
  if (!validation.valid) {
    const list = validation.errors.slice(0, 12).map((e) => `${e.rule}: ${e.message}${e.location ? ` (${e.location})` : ""}`).join(" | ");
    throw new HttpError(422, `the invoice data breaks ${validation.errors.length} rule(s) of ${validation.profile === "xrechnung" ? "XRechnung" : "EN 16931"}, so no file was written (nothing was charged). ${list}`, "EINVOICE_INVALID");
  }
  const xml = writeInvoice(invoice, format);
  const safe = (invoice.number ?? "invoice").replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 60) || "invoice";
  return { invoice, validation, xml, filename: format === "zugferd" ? "factur-x.xml" : `${safe}.xml`, info };
}

const EXAMPLE_INVOICE = {
  number: "RE-2026-0042", issueDate: "2026-11-14", dueDate: "2026-12-14", buyerReference: "04011000-12345-06",
  seller: { name: "Muster Software GmbH", vatId: "DE123456789", street: "Hauptstrasse 1", postCode: "10115", city: "Berlin", country: "DE", contactName: "Erika Muster", phone: "+49 30 1234567", email: "rechnung@muster-software.example" },
  buyer: { name: "Kunde AG", street: "Marktplatz 5", postCode: "20095", city: "Hamburg", country: "DE", email: "einkauf@kunde.example" },
  lines: [{ name: "Beratung", quantity: 8, unit: "HUR", unitPrice: 120, vatRate: 19 }, { name: "Softwarelizenz", quantity: 1, unitPrice: 49.9, vatRate: 19 }],
  payment: { iban: "DE02120300000000202051", terms: "Zahlbar innerhalb von 30 Tagen" },
};
export const EXAMPLE_INVOICE_JSON = JSON.stringify(EXAMPLE_INVOICE);

const NOT_OFFICIAL = "Checked against a subset of the EN 16931 and XRechnung 3.0 business rules; this is not the official KoSIT validator and not tax advice.";

export const EINVOICE: Entry[] = [
  entry("/einvoice/create", "Create XRechnung, ZUGFeRD or Factur-X e-invoice XML from JSON",
    "Create an EU e-invoice from plain JSON: seller, buyer, lines with quantity, price and VAT rate, bank account. Returns XRechnung 3.0 XML (CII or UBL), the ZUGFeRD / Factur-X XML or EN 16931 UBL, with totals and VAT breakdown computed and checked against the business rules first. Data that breaks a rule is refused uncharged with the rule numbers. Use to issue German B2B e-invoices from a shop, ERP or workflow. XML only, not the PDF.",
    ["xrechnung", "zugferd", "factur-x", "e-invoice", "e-rechnung", "en16931", "ubl", "invoice-generator"], {
      invoice: { type: "string", description: "The invoice as JSON: number, issueDate, dueDate, buyerReference (Leitweg-ID or order reference), seller and buyer {name, vatId, street, postCode, city, country, contactName, phone, email}, lines [{name, quantity, unit, unitPrice, vatRate}], payment {iban, bic, terms}. In a POST body send it as a JSON object. The flat fields /document/extract returns (invoice_number, seller_name, line_items…) are read too", required: true, example: EXAMPLE_INVOICE_JSON },
      format: { type: "string", description: "xrechnung (default: XRechnung 3.0, CII syntax), xrechnung-ubl, zugferd (the factur-x.xml of a ZUGFeRD / Factur-X invoice, EN 16931 profile) or ubl (EN 16931 UBL)", enum: [...FORMATS] as [string, ...string[]], example: "xrechnung" },
    },
    {
      format: "xrechnung", syntax: "CII", specification: "urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0", filename: "RE-2026-0042.xml",
      totals: { lineNet: 1009.9, taxBasis: 1009.9, tax: 191.88, grand: 1201.78, payable: 1201.78 }, valid: true, warnings: [],
      xml: "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<rsm:CrossIndustryInvoice xmlns:rsm=\"urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100\" …>…</rsm:CrossIndustryInvoice>",
      note: NOT_OFFICIAL,
    },
    (_env, q) => {
      const raw = longInput(q("invoice"));
      if (raw === null) throw new HttpError(400, "send the invoice in a POST body; a text reference cannot be used in a GET");
      if (!raw?.trim()) throw new HttpError(400, "invoice is required: the invoice as JSON (see the example)");
      let input: unknown;
      try { input = JSON.parse(raw); } catch { throw new HttpError(400, "invoice must be JSON: an object with number, issueDate, seller, buyer and lines"); }
      if (!input || typeof input !== "object" || Array.isArray(input)) throw new HttpError(400, "invoice must be a JSON object with number, issueDate, seller, buyer and lines");
      const wanted = q("format")?.trim().toLowerCase();
      const format = wanted && Object.hasOwn(FORMAT_ALIASES, wanted) ? FORMAT_ALIASES[wanted] : pick(q, "format", FORMATS, "xrechnung");
      const made = createEinvoice(input, format);
      return {
        format, syntax: made.info.syntax, specification: made.info.specification, filename: made.filename,
        totals: made.invoice.totals, valid: true, warnings: made.validation.warnings,
        xml: made.xml,
        note: format === "zugferd" ? `${NOT_OFFICIAL} This is the XML part (factur-x.xml) of a ZUGFeRD / Factur-X invoice; the PDF/A-3 that carries it is not produced here.` : NOT_OFFICIAL,
      };
    }),
  entry("/einvoice/validate", "Validate an XRechnung, ZUGFeRD, Factur-X or UBL e-invoice",
    "Validate an EU e-invoice: send XRechnung, ZUGFeRD / Factur-X (XML or the PDF that embeds it), Peppol or other EN 16931 XML as text, as a file in a POST body or by URL. Returns valid or not and every broken business rule with its number (BR-CO-15, BR-DE-15…), the field, a plain message and the fix. Checks a subset of the EN 16931 and XRechnung 3.0 rules: sums, VAT, mandatory fields. Use before sending an e-invoice or when one is rejected.",
    ["xrechnung-validator", "e-invoice-validation", "zugferd", "factur-x", "en16931", "e-rechnung", "peppol", "invoice-validation"], {
      url: { type: "string", description: "Absolute public http(s) URL of the e-invoice: an XML file or a ZUGFeRD / Factur-X PDF (or send `xml`, or the file in a POST body)", example: SAMPLE_XRECHNUNG },
      xml: { type: "string", description: "The e-invoice XML as text (CII or UBL), up to 5 MB in a POST body", example: "<rsm:CrossIndustryInvoice …>…</rsm:CrossIndustryInvoice>" },
      profile: { type: "string", description: "auto (default: the German XRechnung rules run when the file names XRechnung), xrechnung or en16931", enum: ["auto", "xrechnung", "en16931"], example: "auto" },
    },
    {
      // The official XRechnung test-suite invoice 01.01a, read on 14 Nov 2026 (tests/einvoice.test.cjs holds the same file).
      url: SAMPLE_XRECHNUNG, valid: true, syntax: "CII", standard: "XRechnung 3.0", profile: "xrechnung",
      errors: [], warnings: [], rulesChecked: 103,
      invoice: { number: "123456XX", issueDate: "2016-04-04", currency: "EUR", seller: "[Seller name]", buyer: "[Buyer name]", lines: 2, totals: { lineNet: 314.86, taxBasis: 314.86, tax: 22.04, grand: 336.9, payable: 336.9 } },
      coverage: COVERAGE,
    },
    async (_env, q) => {
      const sent = await sentInvoice(q);
      const { syntax, invoice } = read(sent.xml);
      const result = validateInvoice(invoice, { xrechnung: profileOption(q) });
      return {
        ...(sent.url ? { url: sent.url } : { source: sent.source }), ...(sent.attachment ? { embeddedFile: sent.attachment } : {}),
        valid: result.valid, syntax, standard: profileName(invoice.specification), profile: result.profile,
        errors: result.errors, warnings: result.warnings, rulesChecked: result.rulesChecked,
        invoice: { number: invoice.number ?? null, issueDate: invoice.issueDate ?? null, currency: invoice.currency ?? null, seller: invoice.seller?.name ?? null, buyer: invoice.buyer?.name ?? null, lines: invoice.lines?.length ?? 0, totals: invoice.totals ?? {} },
        ...(invoice.unsupported ? { notChecked: invoice.unsupported } : {}),
        coverage: result.coverage,
      };
    }),
  entry("/einvoice/to-json", "Convert XRechnung, ZUGFeRD, Factur-X or UBL e-invoice to JSON",
    "Convert an EU e-invoice to plain JSON: send XRechnung, ZUGFeRD / Factur-X (XML or the PDF that embeds it), Peppol or other EN 16931 XML as text, as a file in a POST body or by URL. Returns number, dates, seller and buyer with VAT numbers and addresses, every line with quantity, price, VAT rate and net amount, the VAT breakdown, totals and bank account. Exact values from the file, no AI. Use to book incoming e-invoices into a sheet or ERP.",
    ["xrechnung-parser", "zugferd-to-json", "factur-x", "e-invoice", "e-rechnung", "ubl-to-json", "invoice-parser", "en16931"], {
      url: { type: "string", description: "Absolute public http(s) URL of the e-invoice: an XML file or a ZUGFeRD / Factur-X PDF (or send `xml`, or the file in a POST body)", example: SAMPLE_XRECHNUNG },
      xml: { type: "string", description: "The e-invoice XML as text (CII or UBL), up to 5 MB in a POST body", example: "<rsm:CrossIndustryInvoice …>…</rsm:CrossIndustryInvoice>" },
    },
    {
      url: SAMPLE_XRECHNUNG, syntax: "CII", standard: "XRechnung 3.0",
      invoice: {
        specification: "urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0", businessProcess: "urn:fdc:peppol.eu:2017:poacc:billing:01:1.0",
        number: "123456XX", issueDate: "2016-04-04", typeCode: "380", currency: "EUR", buyerReference: "04011000-12345-03",
        note: "Es gelten unsere Allgem. Geschäftsbedingungen, die Sie unter […] finden.",
        seller: { name: "[Seller name]", vatId: "DE 123456789", legalId: "[HRA-Eintrag]", street: "[Seller address line 1]", city: "[Seller city]", postCode: "12345", country: "DE", endpointId: "seller@email.de", endpointScheme: "EM", contactName: "nicht vorhanden", phone: "+49 1234-5678", email: "seller@email.de" },
        buyer: { name: "[Buyer name]", street: "[Buyer address line 1]", city: "[Buyer city]", postCode: "12345", country: "DE", endpointId: "buyer@info.de", endpointScheme: "EM" },
        lines: [
          { id: "Zeitschrift [...]", name: "Zeitschrift [...]", description: "Zeitschrift Inland", quantity: 1, unit: "XPP", unitPrice: 288.79, netAmount: 288.79, vatCategory: "S", vatRate: 7 },
          { id: "Porto + Versandkosten", name: "Porto + Versandkosten", quantity: 1, unit: "XPP", unitPrice: 26.07, netAmount: 26.07, vatCategory: "S", vatRate: 7 },
        ],
        vat: [{ category: "S", rate: 7, basis: 314.86, tax: 22.04 }],
        totals: { lineNet: 314.86, taxBasis: 314.86, tax: 22.04, grand: 336.9, payable: 336.9 },
        payment: { meansCode: "58", iban: "DE79000000001234567890", terms: "Zahlbar sofort ohne Abzug." },
      },
    },
    async (_env, q) => {
      const sent = await sentInvoice(q);
      const { syntax, invoice } = read(sent.xml);
      return { ...(sent.url ? { url: sent.url } : { source: sent.source }), ...(sent.attachment ? { embeddedFile: sent.attachment } : {}), syntax, standard: profileName(invoice.specification), invoice };
    }),
];
