// Writers for the two EN 16931 syntaxes (14 Nov 2026): UN/CEFACT Cross Industry Invoice D16B (what XRechnung-CII,
// ZUGFeRD and Factur-X carry) and OASIS UBL 2.1 Invoice (XRechnung-UBL, Peppol). Element order follows the schemas;
// tests/einvoice.test.cjs holds the order against the official XRechnung test-suite files.
import type { Invoice, Party } from "./model";

export const FORMATS = ["xrechnung", "xrechnung-ubl", "zugferd", "ubl"] as const;
export type Format = (typeof FORMATS)[number];

export const SPEC_XRECHNUNG = "urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0";
export const SPEC_EN16931 = "urn:cen.eu:en16931:2017";
const PROCESS_PEPPOL = "urn:fdc:peppol.eu:2017:poacc:billing:01:1.0";

export const formatInfo = (format: Format) => ({
  syntax: format === "xrechnung-ubl" || format === "ubl" ? ("UBL" as const) : ("CII" as const),
  specification: format === "xrechnung" || format === "xrechnung-ubl" ? SPEC_XRECHNUNG : SPEC_EN16931,
  businessProcess: format === "xrechnung" || format === "xrechnung-ubl" ? PROCESS_PEPPOL : undefined,
});

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
const amt = (n: number | undefined) => (n ?? 0).toFixed(2);
/** Quantities, prices and rates: up to four decimals, no trailing zeros. */
const dec = (n: number | undefined) => String(Math.round((n ?? 0) * 10000) / 10000);
const el = (name: string, value: string | undefined, attrs = "") => (value === undefined || value === "" ? "" : `<${name}${attrs}>${esc(value)}</${name}>`);
const wrap = (name: string, inner: string) => (inner ? `<${name}>${inner}</${name}>` : "");
const d102 = (iso: string | undefined) => (iso ? `<udt:DateTimeString format="102">${iso.replace(/-/g, "")}</udt:DateTimeString>` : "");

function ciiParty(tag: string, p: Party = {}, withContact: boolean): string {
  const contact = withContact
    ? wrap("ram:DefinedTradeContact",
        el("ram:PersonName", p.contactName) +
        wrap("ram:TelephoneUniversalCommunication", el("ram:CompleteNumber", p.phone)) +
        wrap("ram:EmailURIUniversalCommunication", el("ram:URIID", p.email)))
    : "";
  return wrap(tag,
    el("ram:Name", p.name) +
    wrap("ram:SpecifiedLegalOrganization", el("ram:ID", p.legalId)) +
    contact +
    wrap("ram:PostalTradeAddress", el("ram:PostcodeCode", p.postCode) + el("ram:LineOne", p.street) + el("ram:CityName", p.city) + el("ram:CountryID", p.country)) +
    wrap("ram:URIUniversalCommunication", el("ram:URIID", p.endpointId, ` schemeID="${esc(p.endpointScheme ?? "EM")}"`)) +
    wrap("ram:SpecifiedTaxRegistration", el("ram:ID", p.vatId, ' schemeID="VA"')) +
    wrap("ram:SpecifiedTaxRegistration", el("ram:ID", p.taxNumber, ' schemeID="FC"')));
}

export function writeCii(inv: Invoice, specification: string, businessProcess?: string): string {
  const cur = inv.currency ?? "EUR";
  const t = inv.totals ?? {};
  const pay = inv.payment ?? {};
  const lines = (inv.lines ?? []).map((l) =>
    wrap("ram:IncludedSupplyChainTradeLineItem",
      wrap("ram:AssociatedDocumentLineDocument", el("ram:LineID", l.id)) +
      wrap("ram:SpecifiedTradeProduct", el("ram:Name", l.name) + el("ram:Description", l.description)) +
      wrap("ram:SpecifiedLineTradeAgreement", wrap("ram:NetPriceProductTradePrice", el("ram:ChargeAmount", dec(l.unitPrice)))) +
      wrap("ram:SpecifiedLineTradeDelivery", el("ram:BilledQuantity", dec(l.quantity), ` unitCode="${esc(l.unit ?? "C62")}"`)) +
      wrap("ram:SpecifiedLineTradeSettlement",
        wrap("ram:ApplicableTradeTax", el("ram:TypeCode", "VAT") + el("ram:CategoryCode", l.vatCategory) + el("ram:RateApplicablePercent", dec(l.vatRate))) +
        wrap("ram:SpecifiedTradeSettlementLineMonetarySummation", el("ram:LineTotalAmount", amt(l.netAmount)))))).join("");
  const vat = (inv.vat ?? []).map((v) =>
    wrap("ram:ApplicableTradeTax",
      el("ram:CalculatedAmount", amt(v.tax)) + el("ram:TypeCode", "VAT") + el("ram:ExemptionReason", v.exemptionReason) +
      el("ram:BasisAmount", amt(v.basis)) + el("ram:CategoryCode", v.category) + el("ram:RateApplicablePercent", dec(v.rate)))).join("");
  const means = pay.meansCode
    ? wrap("ram:SpecifiedTradeSettlementPaymentMeans",
        el("ram:TypeCode", pay.meansCode) +
        wrap("ram:PayeePartyCreditorFinancialAccount", el("ram:IBANID", pay.iban) + el("ram:AccountName", pay.accountName)) +
        wrap("ram:PayeeSpecifiedCreditorFinancialInstitution", el("ram:BICID", pay.bic)))
    : "";
  return `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100" xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100" xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100" xmlns:qdt="urn:un:unece:uncefact:data:standard:QualifiedDataType:100">` +
    wrap("rsm:ExchangedDocumentContext",
      wrap("ram:BusinessProcessSpecifiedDocumentContextParameter", el("ram:ID", businessProcess)) +
      wrap("ram:GuidelineSpecifiedDocumentContextParameter", el("ram:ID", specification))) +
    wrap("rsm:ExchangedDocument",
      el("ram:ID", inv.number) + el("ram:TypeCode", inv.typeCode) + wrap("ram:IssueDateTime", d102(inv.issueDate)) +
      wrap("ram:IncludedNote", el("ram:Content", inv.note))) +
    wrap("rsm:SupplyChainTradeTransaction",
      lines +
      wrap("ram:ApplicableHeaderTradeAgreement",
        el("ram:BuyerReference", inv.buyerReference) +
        ciiParty("ram:SellerTradeParty", inv.seller, true) +
        ciiParty("ram:BuyerTradeParty", inv.buyer, true) +
        wrap("ram:BuyerOrderReferencedDocument", el("ram:IssuerAssignedID", inv.orderReference))) +
      // The delivery group is mandatory in the schema even when it is empty.
      `<ram:ApplicableHeaderTradeDelivery>${wrap("ram:ActualDeliverySupplyChainEvent", wrap("ram:OccurrenceDateTime", d102(inv.deliveryDate)))}</ram:ApplicableHeaderTradeDelivery>` +
      wrap("ram:ApplicableHeaderTradeSettlement",
        el("ram:PaymentReference", pay.reference) +
        el("ram:InvoiceCurrencyCode", cur) +
        means + vat +
        wrap("ram:SpecifiedTradePaymentTerms", el("ram:Description", pay.terms) + wrap("ram:DueDateDateTime", d102(inv.dueDate))) +
        wrap("ram:SpecifiedTradeSettlementHeaderMonetarySummation",
          el("ram:LineTotalAmount", amt(t.lineNet)) +
          (t.charges !== undefined ? el("ram:ChargeTotalAmount", amt(t.charges)) : "") +
          (t.allowances !== undefined ? el("ram:AllowanceTotalAmount", amt(t.allowances)) : "") +
          el("ram:TaxBasisTotalAmount", amt(t.taxBasis)) +
          el("ram:TaxTotalAmount", amt(t.tax), ` currencyID="${esc(cur)}"`) +
          el("ram:GrandTotalAmount", amt(t.grand)) +
          (t.prepaid !== undefined ? el("ram:TotalPrepaidAmount", amt(t.prepaid)) : "") +
          el("ram:DuePayableAmount", amt(t.payable))))) +
    `</rsm:CrossIndustryInvoice>\n`;
}

function ublParty(p: Party = {}, withContact: boolean): string {
  return wrap("cac:Party",
    el("cbc:EndpointID", p.endpointId, ` schemeID="${esc(p.endpointScheme ?? "EM")}"`) +
    wrap("cac:PartyName", el("cbc:Name", p.name)) +
    wrap("cac:PostalAddress", el("cbc:StreetName", p.street) + el("cbc:CityName", p.city) + el("cbc:PostalZone", p.postCode) + wrap("cac:Country", el("cbc:IdentificationCode", p.country))) +
    (p.vatId ? wrap("cac:PartyTaxScheme", el("cbc:CompanyID", p.vatId) + wrap("cac:TaxScheme", el("cbc:ID", "VAT"))) : "") +
    (p.taxNumber ? wrap("cac:PartyTaxScheme", el("cbc:CompanyID", p.taxNumber) + wrap("cac:TaxScheme", el("cbc:ID", "FC"))) : "") +
    wrap("cac:PartyLegalEntity", el("cbc:RegistrationName", p.name) + el("cbc:CompanyID", p.legalId)) +
    (withContact ? wrap("cac:Contact", el("cbc:Name", p.contactName) + el("cbc:Telephone", p.phone) + el("cbc:ElectronicMail", p.email)) : ""));
}

export function writeUbl(inv: Invoice, specification: string, businessProcess?: string): string {
  const cur = inv.currency ?? "EUR";
  const c = ` currencyID="${esc(cur)}"`;
  const t = inv.totals ?? {};
  const pay = inv.payment ?? {};
  const taxCategory = (tag: string, category?: string, rate?: number, reason?: string) =>
    wrap(tag, el("cbc:ID", category) + el("cbc:Percent", dec(rate)) + el("cbc:TaxExemptionReason", reason) + wrap("cac:TaxScheme", el("cbc:ID", "VAT")));
  return `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<ubl:Invoice xmlns:ubl="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">` +
    el("cbc:CustomizationID", specification) + el("cbc:ProfileID", businessProcess) +
    el("cbc:ID", inv.number) + el("cbc:IssueDate", inv.issueDate) + el("cbc:DueDate", inv.dueDate) +
    el("cbc:InvoiceTypeCode", inv.typeCode) + el("cbc:Note", inv.note) + el("cbc:DocumentCurrencyCode", cur) +
    el("cbc:BuyerReference", inv.buyerReference) +
    wrap("cac:OrderReference", el("cbc:ID", inv.orderReference)) +
    wrap("cac:AccountingSupplierParty", ublParty(inv.seller, true)) +
    wrap("cac:AccountingCustomerParty", ublParty(inv.buyer, true)) +
    wrap("cac:Delivery", el("cbc:ActualDeliveryDate", inv.deliveryDate)) +
    (pay.meansCode
      ? wrap("cac:PaymentMeans",
          el("cbc:PaymentMeansCode", pay.meansCode) + el("cbc:PaymentID", pay.reference) +
          wrap("cac:PayeeFinancialAccount", el("cbc:ID", pay.iban) + el("cbc:Name", pay.accountName) + wrap("cac:FinancialInstitutionBranch", el("cbc:ID", pay.bic))))
      : "") +
    wrap("cac:PaymentTerms", el("cbc:Note", pay.terms)) +
    wrap("cac:TaxTotal",
      el("cbc:TaxAmount", amt(t.tax), c) +
      (inv.vat ?? []).map((v) => wrap("cac:TaxSubtotal", el("cbc:TaxableAmount", amt(v.basis), c) + el("cbc:TaxAmount", amt(v.tax), c) + taxCategory("cac:TaxCategory", v.category, v.rate, v.exemptionReason))).join("")) +
    wrap("cac:LegalMonetaryTotal",
      el("cbc:LineExtensionAmount", amt(t.lineNet), c) + el("cbc:TaxExclusiveAmount", amt(t.taxBasis), c) + el("cbc:TaxInclusiveAmount", amt(t.grand), c) +
      (t.allowances !== undefined ? el("cbc:AllowanceTotalAmount", amt(t.allowances), c) : "") +
      (t.charges !== undefined ? el("cbc:ChargeTotalAmount", amt(t.charges), c) : "") +
      (t.prepaid !== undefined ? el("cbc:PrepaidAmount", amt(t.prepaid), c) : "") +
      el("cbc:PayableAmount", amt(t.payable), c)) +
    (inv.lines ?? []).map((l) =>
      wrap("cac:InvoiceLine",
        el("cbc:ID", l.id) + el("cbc:InvoicedQuantity", dec(l.quantity), ` unitCode="${esc(l.unit ?? "C62")}"`) + el("cbc:LineExtensionAmount", amt(l.netAmount), c) +
        wrap("cac:Item", el("cbc:Description", l.description) + el("cbc:Name", l.name) + taxCategory("cac:ClassifiedTaxCategory", l.vatCategory, l.vatRate)) +
        wrap("cac:Price", el("cbc:PriceAmount", dec(l.unitPrice), c)))).join("") +
    `</ubl:Invoice>\n`;
}

export function writeInvoice(inv: Invoice, format: Format): string {
  const { syntax, specification, businessProcess } = formatInfo(format);
  return syntax === "UBL" ? writeUbl(inv, specification, businessProcess) : writeCii(inv, specification, businessProcess);
}
