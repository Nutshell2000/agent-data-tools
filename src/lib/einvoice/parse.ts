// Readers for e-invoice XML (14 Nov 2026): UN/CEFACT CII (XRechnung-CII, ZUGFeRD, Factur-X) and UBL 2.1 Invoice or
// CreditNote (XRechnung-UBL, Peppol), into the model in model.ts. The XML is read with saxes; a DOCTYPE is refused so
// no external entity is ever resolved (the /xml/to-json rule).
import { SaxesParser } from "saxes";
import { isoDate, numberOf, type Invoice, type Line, type Party, type VatLine } from "./model";

export interface Node { name: string; attrs: Record<string, string>; kids: Node[]; text: string }

export class XmlError extends Error {}

export const MAX_XML_CHARS = 2_000_000;

export function parseXml(xml: string): Node {
  if (xml.length > MAX_XML_CHARS) throw new XmlError("the XML is larger than 2 MB");
  if (/<!DOCTYPE/i.test(xml.slice(0, 4000))) throw new XmlError("the XML has a DOCTYPE, which is not read");
  const parser = new SaxesParser({ xmlns: false });
  const root: Node = { name: "#root", attrs: {}, kids: [], text: "" };
  const stack: Node[] = [root];
  let failure: string | null = null;
  parser.on("error", (e) => { failure ??= e.message; });
  parser.on("opentag", (tag) => {
    const attrs: Record<string, string> = {};
    for (const [k, v] of Object.entries(tag.attributes as Record<string, string>)) attrs[k.includes(":") && !k.startsWith("xmlns") ? k.slice(k.indexOf(":") + 1) : k] = v;
    const node: Node = { name: tag.name.includes(":") ? tag.name.slice(tag.name.indexOf(":") + 1) : tag.name, attrs, kids: [], text: "" };
    stack[stack.length - 1].kids.push(node);
    stack.push(node);
  });
  parser.on("text", (t) => { stack[stack.length - 1].text += t; });
  parser.on("cdata", (t) => { stack[stack.length - 1].text += t; });
  parser.on("closetag", () => { if (stack.length > 1) stack.pop(); });
  try { parser.write(xml.replace(/^﻿/, "")).close(); } catch (e) { failure ??= e instanceof Error ? e.message : String(e); }
  if (failure) throw new XmlError(`the XML is not well-formed: ${failure.replace(/\s+/g, " ").slice(0, 200)}`);
  if (!root.kids.length) throw new XmlError("the XML has no root element");
  return root.kids[0];
}

const kid = (n: Node | undefined, name: string) => n?.kids.find((k) => k.name === name);
const kids = (n: Node | undefined, name: string) => n?.kids.filter((k) => k.name === name) ?? [];
/** The node at a path of child names, or undefined. */
const at = (n: Node | undefined, ...path: string[]) => { let c = n; for (const p of path) c = kid(c, p); return c; };
const txt = (n: Node | undefined, ...path: string[]) => { const v = at(n, ...path)?.text.trim(); return v ? v : undefined; };
const num = (n: Node | undefined, ...path: string[]) => numberOf(txt(n, ...path));
const date102 = (n: Node | undefined, ...path: string[]) => isoDate(txt(at(n, ...path), "DateTimeString"));
const clean = <T extends object>(o: T): T => { for (const k of Object.keys(o) as (keyof T)[]) if (o[k] === undefined) delete o[k]; return o; };

export type Syntax = "CII" | "UBL";
export const syntaxOf = (root: Node): Syntax | null =>
  root.name === "CrossIndustryInvoice" ? "CII" : root.name === "Invoice" || root.name === "CreditNote" ? "UBL" : null;

function ciiParty(p: Node | undefined): Party {
  const reg = kids(p, "SpecifiedTaxRegistration").map((r) => kid(r, "ID"));
  const contact = kid(p, "DefinedTradeContact");
  const uri = at(p, "URIUniversalCommunication", "URIID");
  return clean<Party>({
    name: txt(p, "Name"),
    vatId: reg.find((r) => r?.attrs.schemeID === "VA")?.text.trim() || undefined,
    taxNumber: reg.find((r) => r?.attrs.schemeID === "FC")?.text.trim() || undefined,
    legalId: txt(p, "SpecifiedLegalOrganization", "ID"),
    street: txt(p, "PostalTradeAddress", "LineOne"),
    city: txt(p, "PostalTradeAddress", "CityName"),
    postCode: txt(p, "PostalTradeAddress", "PostcodeCode"),
    country: txt(p, "PostalTradeAddress", "CountryID"),
    endpointId: uri?.text.trim() || undefined,
    endpointScheme: uri?.attrs.schemeID,
    contactName: txt(contact, "PersonName") ?? txt(contact, "DepartmentName"),
    phone: txt(contact, "TelephoneUniversalCommunication", "CompleteNumber"),
    email: txt(contact, "EmailURIUniversalCommunication", "URIID"),
  });
}

function fromCii(root: Node): Invoice {
  const ctx = kid(root, "ExchangedDocumentContext");
  const doc = kid(root, "ExchangedDocument");
  const tx = kid(root, "SupplyChainTradeTransaction");
  const agreement = kid(tx, "ApplicableHeaderTradeAgreement");
  const delivery = kid(tx, "ApplicableHeaderTradeDelivery");
  const settle = kid(tx, "ApplicableHeaderTradeSettlement");
  const sum = kid(settle, "SpecifiedTradeSettlementHeaderMonetarySummation");
  const means = kid(settle, "SpecifiedTradeSettlementPaymentMeans");
  const terms = kid(settle, "SpecifiedTradePaymentTerms");
  const unsupported: string[] = [];
  if (kids(settle, "SpecifiedTradeAllowanceCharge").length) unsupported.push("document-level allowances and charges");
  if (kid(agreement, "SellerTaxRepresentativeTradeParty")) unsupported.push("tax representative");
  if (kid(settle, "PayeeTradeParty")) unsupported.push("separate payee");
  if (kids(agreement, "AdditionalReferencedDocument").length) unsupported.push("attached documents");
  if (kid(settle, "InvoiceReferencedDocument")) unsupported.push("preceding invoice reference");
  const lines: Line[] = kids(tx, "IncludedSupplyChainTradeLineItem").map((l) => {
    const st = kid(l, "SpecifiedLineTradeSettlement");
    if (kids(st, "SpecifiedTradeAllowanceCharge").length && !unsupported.includes("line allowances and charges")) unsupported.push("line allowances and charges");
    const q = at(l, "SpecifiedLineTradeDelivery", "BilledQuantity");
    return clean<Line>({
      id: txt(l, "AssociatedDocumentLineDocument", "LineID"),
      name: txt(l, "SpecifiedTradeProduct", "Name"),
      description: txt(l, "SpecifiedTradeProduct", "Description"),
      quantity: numberOf(q?.text),
      unit: q?.attrs.unitCode,
      unitPrice: num(l, "SpecifiedLineTradeAgreement", "NetPriceProductTradePrice", "ChargeAmount"),
      netAmount: num(st, "SpecifiedTradeSettlementLineMonetarySummation", "LineTotalAmount"),
      vatCategory: txt(st, "ApplicableTradeTax", "CategoryCode"),
      vatRate: num(st, "ApplicableTradeTax", "RateApplicablePercent"),
    });
  });
  const vat: VatLine[] = kids(settle, "ApplicableTradeTax").map((v) => clean<VatLine>({
    category: txt(v, "CategoryCode"), rate: num(v, "RateApplicablePercent"), basis: num(v, "BasisAmount"), tax: num(v, "CalculatedAmount"),
    exemptionReason: txt(v, "ExemptionReason") ?? txt(v, "ExemptionReasonCode"),
  }));
  return clean<Invoice>({
    specification: txt(ctx, "GuidelineSpecifiedDocumentContextParameter", "ID"),
    businessProcess: txt(ctx, "BusinessProcessSpecifiedDocumentContextParameter", "ID"),
    number: txt(doc, "ID"),
    issueDate: date102(doc, "IssueDateTime"),
    typeCode: txt(doc, "TypeCode"),
    currency: txt(settle, "InvoiceCurrencyCode"),
    dueDate: date102(terms, "DueDateDateTime"),
    deliveryDate: date102(delivery, "ActualDeliverySupplyChainEvent", "OccurrenceDateTime"),
    buyerReference: txt(agreement, "BuyerReference"),
    orderReference: txt(agreement, "BuyerOrderReferencedDocument", "IssuerAssignedID"),
    note: kids(doc, "IncludedNote").map((n) => txt(n, "Content")).filter(Boolean).join("\n") || undefined,
    seller: ciiParty(kid(agreement, "SellerTradeParty")),
    buyer: ciiParty(kid(agreement, "BuyerTradeParty")),
    lines,
    vat,
    totals: clean({
      lineNet: num(sum, "LineTotalAmount"), allowances: num(sum, "AllowanceTotalAmount"), charges: num(sum, "ChargeTotalAmount"),
      taxBasis: num(sum, "TaxBasisTotalAmount"), tax: numberOf(kids(sum, "TaxTotalAmount")[0]?.text), grand: num(sum, "GrandTotalAmount"),
      prepaid: num(sum, "TotalPrepaidAmount"), payable: num(sum, "DuePayableAmount"),
    }),
    payment: clean({
      meansCode: txt(means, "TypeCode"),
      iban: txt(means, "PayeePartyCreditorFinancialAccount", "IBANID") ?? txt(means, "PayeePartyCreditorFinancialAccount", "ProprietaryID"),
      bic: txt(means, "PayeeSpecifiedCreditorFinancialInstitution", "BICID"),
      accountName: txt(means, "PayeePartyCreditorFinancialAccount", "AccountName"),
      reference: txt(settle, "PaymentReference"),
      terms: txt(terms, "Description"),
    }),
    ...(unsupported.length ? { unsupported } : {}),
  });
}

function ublParty(wrapper: Node | undefined): Party {
  const p = kid(wrapper, "Party");
  const schemes = kids(p, "PartyTaxScheme");
  const isVat = (s: Node) => (txt(s, "TaxScheme", "ID") ?? "VAT").toUpperCase() === "VAT";
  const endpoint = kid(p, "EndpointID");
  const contact = kid(p, "Contact");
  return clean<Party>({
    name: txt(p, "PartyLegalEntity", "RegistrationName") ?? txt(p, "PartyName", "Name"),
    vatId: txt(schemes.find(isVat), "CompanyID"),
    taxNumber: txt(schemes.find((s) => !isVat(s)), "CompanyID"),
    legalId: txt(p, "PartyLegalEntity", "CompanyID"),
    street: txt(p, "PostalAddress", "StreetName"),
    city: txt(p, "PostalAddress", "CityName"),
    postCode: txt(p, "PostalAddress", "PostalZone"),
    country: txt(p, "PostalAddress", "Country", "IdentificationCode"),
    endpointId: endpoint?.text.trim() || undefined,
    endpointScheme: endpoint?.attrs.schemeID,
    contactName: txt(contact, "Name"),
    phone: txt(contact, "Telephone"),
    email: txt(contact, "ElectronicMail"),
  });
}

function fromUbl(root: Node): Invoice {
  const credit = root.name === "CreditNote";
  const total = kid(root, "LegalMonetaryTotal");
  const means = kid(root, "PaymentMeans");
  const taxTotal = kids(root, "TaxTotal")[0];
  const unsupported: string[] = [];
  if (kids(root, "AllowanceCharge").length) unsupported.push("document-level allowances and charges");
  if (kid(root, "TaxRepresentativeParty")) unsupported.push("tax representative");
  if (kid(root, "PayeeParty")) unsupported.push("separate payee");
  if (kids(root, "AdditionalDocumentReference").length) unsupported.push("attached documents");
  if (kid(root, "BillingReference")) unsupported.push("preceding invoice reference");
  const lines: Line[] = kids(root, credit ? "CreditNoteLine" : "InvoiceLine").map((l) => {
    if (kids(l, "AllowanceCharge").length && !unsupported.includes("line allowances and charges")) unsupported.push("line allowances and charges");
    const q = kid(l, credit ? "CreditedQuantity" : "InvoicedQuantity");
    const item = kid(l, "Item");
    return clean<Line>({
      id: txt(l, "ID"), name: txt(item, "Name"), description: txt(item, "Description"),
      quantity: numberOf(q?.text), unit: q?.attrs.unitCode,
      unitPrice: num(l, "Price", "PriceAmount"), netAmount: num(l, "LineExtensionAmount"),
      vatCategory: txt(item, "ClassifiedTaxCategory", "ID"), vatRate: num(item, "ClassifiedTaxCategory", "Percent"),
    });
  });
  const vat: VatLine[] = kids(taxTotal, "TaxSubtotal").map((v) => clean<VatLine>({
    category: txt(v, "TaxCategory", "ID"), rate: num(v, "TaxCategory", "Percent"), basis: num(v, "TaxableAmount"), tax: num(v, "TaxAmount"),
    exemptionReason: txt(v, "TaxCategory", "TaxExemptionReason") ?? txt(v, "TaxCategory", "TaxExemptionReasonCode"),
  }));
  return clean<Invoice>({
    specification: txt(root, "CustomizationID"),
    businessProcess: txt(root, "ProfileID"),
    number: txt(root, "ID"),
    issueDate: isoDate(txt(root, "IssueDate")),
    typeCode: txt(root, credit ? "CreditNoteTypeCode" : "InvoiceTypeCode"),
    currency: txt(root, "DocumentCurrencyCode"),
    dueDate: isoDate(txt(root, "DueDate") ?? txt(means, "PaymentDueDate")),
    deliveryDate: isoDate(txt(root, "Delivery", "ActualDeliveryDate")),
    buyerReference: txt(root, "BuyerReference"),
    orderReference: txt(root, "OrderReference", "ID"),
    note: kids(root, "Note").map((n) => n.text.trim()).filter(Boolean).join("\n") || undefined,
    seller: ublParty(kid(root, "AccountingSupplierParty")),
    buyer: ublParty(kid(root, "AccountingCustomerParty")),
    lines,
    vat,
    totals: clean({
      lineNet: num(total, "LineExtensionAmount"), allowances: num(total, "AllowanceTotalAmount"), charges: num(total, "ChargeTotalAmount"),
      taxBasis: num(total, "TaxExclusiveAmount"), tax: num(taxTotal, "TaxAmount"), grand: num(total, "TaxInclusiveAmount"),
      prepaid: num(total, "PrepaidAmount"), payable: num(total, "PayableAmount"),
    }),
    payment: clean({
      meansCode: txt(means, "PaymentMeansCode"),
      iban: txt(means, "PayeeFinancialAccount", "ID"),
      bic: txt(means, "PayeeFinancialAccount", "FinancialInstitutionBranch", "ID"),
      accountName: txt(means, "PayeeFinancialAccount", "Name"),
      reference: txt(means, "PaymentID"),
      terms: txt(root, "PaymentTerms", "Note"),
    }),
    ...(unsupported.length ? { unsupported } : {}),
  });
}

/** The invoice in an e-invoice XML, with the syntax it was written in. Throws XmlError for anything else. */
export function readInvoice(xml: string): { syntax: Syntax; invoice: Invoice } {
  const root = parseXml(xml);
  const syntax = syntaxOf(root);
  if (!syntax) throw new XmlError(`the root element is <${root.name}>, not a CII CrossIndustryInvoice or a UBL Invoice or CreditNote`);
  return { syntax, invoice: syntax === "CII" ? fromCii(root) : fromUbl(root) };
}

/** Which standard a specification identifier (BT-24) names, in plain words. */
export function profileName(specification: string | undefined): string {
  const s = (specification ?? "").toLowerCase();
  if (!s) return "unknown (no specification identifier)";
  if (s.includes("xrechnung")) return `XRechnung ${/xrechnung_(\d+\.\d+)/.exec(s)?.[1] ?? ""}`.trim();
  if (s.includes("peppol.eu:2017:poacc:billing:3")) return "Peppol BIS Billing 3.0";
  if (s.includes("factur-x.eu") || s.includes("zugferd")) return `Factur-X / ZUGFeRD ${/:(minimum|basicwl|basic|extended)\b/.exec(s)?.[1] ?? ""}`.trim();
  if (s.startsWith("urn:cen.eu:en16931:2017")) return "EN 16931";
  return "other";
}
