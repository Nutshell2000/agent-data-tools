// Pages for the e-invoice tools (14 Nov 2026): /e-invoice (what the three tools do, a validator form, code) and one
// page per business rule the validator runs, /e-invoice/rules/<rule number>. Why rule pages: a rejected XRechnung
// comes back with rule numbers (BR-DE-15, BR-CO-15), and that number is what the person who has to fix the file types
// into a search engine. Each page says what the rule requires, where the field sits in both XML syntaxes and how to
// fix it, from the rule table the validator itself uses (lib/einvoice/validate.ts), so page and tool cannot drift.
// Rule numbers are the published ones (EN 16931-1; XRechnung 3.0, KoSIT); the wording is ours.
import { ENDPOINTS, SERVICE_NAME, toolSlug, type Endpoint } from "../endpoints";
import { COMPANY_FOOTER } from "./legal";
import { PAGE_STYLE } from "./vat-pages";
import { TRY_FORM_CSS } from "./try-form";
import { RULES, ruleDoc, ruleSlug, type RuleDoc } from "./einvoice/validate";
import { EXAMPLE_INVOICE_JSON, SAMPLE_XRECHNUNG } from "../routes/einvoice";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const jsonLd = (value: unknown) => JSON.stringify(value).replace(/</g, "\\u003c");

export const EINVOICE_BASE = "/e-invoice";
export const EINVOICE_RULES = `${EINVOICE_BASE}/rules`;
export const einvoicePagePaths = () => [EINVOICE_BASE, EINVOICE_RULES, ...RULES.map((r) => `${EINVOICE_RULES}/${ruleSlug(r.id)}`)];
export const einvoiceRule = (slug: string) => ruleDoc(slug);

/** Business terms the rules name: what each is called and where it sits in the two syntaxes. */
const TERMS: Readonly<Record<string, readonly [name: string, cii: string, ubl: string]>> = Object.freeze({
  "BT-1": ["Invoice number", "rsm:ExchangedDocument/ram:ID", "cbc:ID"],
  "BT-2": ["Invoice issue date", "rsm:ExchangedDocument/ram:IssueDateTime/udt:DateTimeString[@format='102']", "cbc:IssueDate"],
  "BT-3": ["Invoice type code", "rsm:ExchangedDocument/ram:TypeCode", "cbc:InvoiceTypeCode"],
  "BT-5": ["Invoice currency code", "ram:ApplicableHeaderTradeSettlement/ram:InvoiceCurrencyCode", "cbc:DocumentCurrencyCode"],
  "BT-9": ["Payment due date", "ram:SpecifiedTradePaymentTerms/ram:DueDateDateTime/udt:DateTimeString", "cbc:DueDate"],
  "BT-10": ["Buyer reference", "ram:ApplicableHeaderTradeAgreement/ram:BuyerReference", "cbc:BuyerReference"],
  "BT-20": ["Payment terms", "ram:SpecifiedTradePaymentTerms/ram:Description", "cac:PaymentTerms/cbc:Note"],
  "BT-24": ["Specification identifier", "rsm:ExchangedDocumentContext/ram:GuidelineSpecifiedDocumentContextParameter/ram:ID", "cbc:CustomizationID"],
  "BT-27": ["Seller name", "ram:SellerTradeParty/ram:Name", "cac:AccountingSupplierParty/cac:Party/cac:PartyLegalEntity/cbc:RegistrationName"],
  "BT-29": ["Seller identifier", "ram:SellerTradeParty/ram:ID", "cac:AccountingSupplierParty/cac:Party/cac:PartyIdentification/cbc:ID"],
  "BT-30": ["Seller legal registration identifier", "ram:SellerTradeParty/ram:SpecifiedLegalOrganization/ram:ID", "cac:AccountingSupplierParty/cac:Party/cac:PartyLegalEntity/cbc:CompanyID"],
  "BT-31": ["Seller VAT identifier", "ram:SellerTradeParty/ram:SpecifiedTaxRegistration/ram:ID[@schemeID='VA']", "cac:AccountingSupplierParty/cac:Party/cac:PartyTaxScheme/cbc:CompanyID (with cac:TaxScheme/cbc:ID = VAT)"],
  "BT-32": ["Seller tax registration identifier", "ram:SellerTradeParty/ram:SpecifiedTaxRegistration/ram:ID[@schemeID='FC']", "cac:AccountingSupplierParty/cac:Party/cac:PartyTaxScheme/cbc:CompanyID (with a cac:TaxScheme/cbc:ID other than VAT)"],
  "BT-34": ["Seller electronic address", "ram:SellerTradeParty/ram:URIUniversalCommunication/ram:URIID[@schemeID]", "cac:AccountingSupplierParty/cac:Party/cbc:EndpointID[@schemeID]"],
  "BG-5": ["Seller postal address", "ram:SellerTradeParty/ram:PostalTradeAddress", "cac:AccountingSupplierParty/cac:Party/cac:PostalAddress"],
  "BT-37": ["Seller city", "ram:SellerTradeParty/ram:PostalTradeAddress/ram:CityName", "cac:AccountingSupplierParty/cac:Party/cac:PostalAddress/cbc:CityName"],
  "BT-38": ["Seller post code", "ram:SellerTradeParty/ram:PostalTradeAddress/ram:PostcodeCode", "cac:AccountingSupplierParty/cac:Party/cac:PostalAddress/cbc:PostalZone"],
  "BT-40": ["Seller country code", "ram:SellerTradeParty/ram:PostalTradeAddress/ram:CountryID", "cac:AccountingSupplierParty/cac:Party/cac:PostalAddress/cac:Country/cbc:IdentificationCode"],
  "BG-6": ["Seller contact", "ram:SellerTradeParty/ram:DefinedTradeContact", "cac:AccountingSupplierParty/cac:Party/cac:Contact"],
  "BT-41": ["Seller contact point", "ram:SellerTradeParty/ram:DefinedTradeContact/ram:PersonName (or ram:DepartmentName)", "cac:AccountingSupplierParty/cac:Party/cac:Contact/cbc:Name"],
  "BT-42": ["Seller contact telephone number", "ram:SellerTradeParty/ram:DefinedTradeContact/ram:TelephoneUniversalCommunication/ram:CompleteNumber", "cac:AccountingSupplierParty/cac:Party/cac:Contact/cbc:Telephone"],
  "BT-43": ["Seller contact e-mail address", "ram:SellerTradeParty/ram:DefinedTradeContact/ram:EmailURIUniversalCommunication/ram:URIID", "cac:AccountingSupplierParty/cac:Party/cac:Contact/cbc:ElectronicMail"],
  "BT-44": ["Buyer name", "ram:BuyerTradeParty/ram:Name", "cac:AccountingCustomerParty/cac:Party/cac:PartyLegalEntity/cbc:RegistrationName"],
  "BT-48": ["Buyer VAT identifier", "ram:BuyerTradeParty/ram:SpecifiedTaxRegistration/ram:ID[@schemeID='VA']", "cac:AccountingCustomerParty/cac:Party/cac:PartyTaxScheme/cbc:CompanyID"],
  "BT-49": ["Buyer electronic address", "ram:BuyerTradeParty/ram:URIUniversalCommunication/ram:URIID[@schemeID]", "cac:AccountingCustomerParty/cac:Party/cbc:EndpointID[@schemeID]"],
  "BG-8": ["Buyer postal address", "ram:BuyerTradeParty/ram:PostalTradeAddress", "cac:AccountingCustomerParty/cac:Party/cac:PostalAddress"],
  "BT-52": ["Buyer city", "ram:BuyerTradeParty/ram:PostalTradeAddress/ram:CityName", "cac:AccountingCustomerParty/cac:Party/cac:PostalAddress/cbc:CityName"],
  "BT-53": ["Buyer post code", "ram:BuyerTradeParty/ram:PostalTradeAddress/ram:PostcodeCode", "cac:AccountingCustomerParty/cac:Party/cac:PostalAddress/cbc:PostalZone"],
  "BT-55": ["Buyer country code", "ram:BuyerTradeParty/ram:PostalTradeAddress/ram:CountryID", "cac:AccountingCustomerParty/cac:Party/cac:PostalAddress/cac:Country/cbc:IdentificationCode"],
  "BG-16": ["Payment instructions", "ram:ApplicableHeaderTradeSettlement/ram:SpecifiedTradeSettlementPaymentMeans", "cac:PaymentMeans"],
  "BT-81": ["Payment means type code", "ram:SpecifiedTradeSettlementPaymentMeans/ram:TypeCode", "cac:PaymentMeans/cbc:PaymentMeansCode"],
  "BG-17": ["Credit transfer", "ram:SpecifiedTradeSettlementPaymentMeans/ram:PayeePartyCreditorFinancialAccount", "cac:PaymentMeans/cac:PayeeFinancialAccount"],
  "BT-84": ["Payment account identifier (IBAN)", "ram:SpecifiedTradeSettlementPaymentMeans/ram:PayeePartyCreditorFinancialAccount/ram:IBANID", "cac:PaymentMeans/cac:PayeeFinancialAccount/cbc:ID"],
  "BT-106": ["Sum of invoice line net amounts", "ram:SpecifiedTradeSettlementHeaderMonetarySummation/ram:LineTotalAmount", "cac:LegalMonetaryTotal/cbc:LineExtensionAmount"],
  "BT-109": ["Invoice total amount without VAT", "ram:SpecifiedTradeSettlementHeaderMonetarySummation/ram:TaxBasisTotalAmount", "cac:LegalMonetaryTotal/cbc:TaxExclusiveAmount"],
  "BT-110": ["Invoice total VAT amount", "ram:SpecifiedTradeSettlementHeaderMonetarySummation/ram:TaxTotalAmount[@currencyID]", "cac:TaxTotal/cbc:TaxAmount"],
  "BT-112": ["Invoice total amount with VAT", "ram:SpecifiedTradeSettlementHeaderMonetarySummation/ram:GrandTotalAmount", "cac:LegalMonetaryTotal/cbc:TaxInclusiveAmount"],
  "BT-115": ["Amount due for payment", "ram:SpecifiedTradeSettlementHeaderMonetarySummation/ram:DuePayableAmount", "cac:LegalMonetaryTotal/cbc:PayableAmount"],
  "BG-23": ["VAT breakdown", "ram:ApplicableHeaderTradeSettlement/ram:ApplicableTradeTax", "cac:TaxTotal/cac:TaxSubtotal"],
  "BT-116": ["VAT category taxable amount", "ram:ApplicableHeaderTradeSettlement/ram:ApplicableTradeTax/ram:BasisAmount", "cac:TaxTotal/cac:TaxSubtotal/cbc:TaxableAmount"],
  "BT-117": ["VAT category tax amount", "ram:ApplicableHeaderTradeSettlement/ram:ApplicableTradeTax/ram:CalculatedAmount", "cac:TaxTotal/cac:TaxSubtotal/cbc:TaxAmount"],
  "BT-118": ["VAT category code", "ram:ApplicableHeaderTradeSettlement/ram:ApplicableTradeTax/ram:CategoryCode", "cac:TaxTotal/cac:TaxSubtotal/cac:TaxCategory/cbc:ID"],
  "BT-119": ["VAT category rate", "ram:ApplicableHeaderTradeSettlement/ram:ApplicableTradeTax/ram:RateApplicablePercent", "cac:TaxTotal/cac:TaxSubtotal/cac:TaxCategory/cbc:Percent"],
  "BT-120": ["VAT exemption reason text", "ram:ApplicableHeaderTradeSettlement/ram:ApplicableTradeTax/ram:ExemptionReason", "cac:TaxTotal/cac:TaxSubtotal/cac:TaxCategory/cbc:TaxExemptionReason"],
  "BT-121": ["VAT exemption reason code", "ram:ApplicableHeaderTradeSettlement/ram:ApplicableTradeTax/ram:ExemptionReasonCode", "cac:TaxTotal/cac:TaxSubtotal/cac:TaxCategory/cbc:TaxExemptionReasonCode"],
  "BG-25": ["Invoice line", "rsm:SupplyChainTradeTransaction/ram:IncludedSupplyChainTradeLineItem", "cac:InvoiceLine"],
  "BT-126": ["Invoice line identifier", "ram:IncludedSupplyChainTradeLineItem/ram:AssociatedDocumentLineDocument/ram:LineID", "cac:InvoiceLine/cbc:ID"],
  "BT-129": ["Invoiced quantity", "ram:IncludedSupplyChainTradeLineItem/ram:SpecifiedLineTradeDelivery/ram:BilledQuantity", "cac:InvoiceLine/cbc:InvoicedQuantity"],
  "BT-130": ["Invoiced quantity unit of measure code", "ram:SpecifiedLineTradeDelivery/ram:BilledQuantity/@unitCode", "cac:InvoiceLine/cbc:InvoicedQuantity/@unitCode"],
  "BT-131": ["Invoice line net amount", "ram:IncludedSupplyChainTradeLineItem/ram:SpecifiedLineTradeSettlement/ram:SpecifiedTradeSettlementLineMonetarySummation/ram:LineTotalAmount", "cac:InvoiceLine/cbc:LineExtensionAmount"],
  "BT-146": ["Item net price", "ram:IncludedSupplyChainTradeLineItem/ram:SpecifiedLineTradeAgreement/ram:NetPriceProductTradePrice/ram:ChargeAmount", "cac:InvoiceLine/cac:Price/cbc:PriceAmount"],
  "BT-151": ["Invoiced item VAT category code", "ram:IncludedSupplyChainTradeLineItem/ram:SpecifiedLineTradeSettlement/ram:ApplicableTradeTax/ram:CategoryCode", "cac:InvoiceLine/cac:Item/cac:ClassifiedTaxCategory/cbc:ID"],
  "BT-152": ["Invoiced item VAT rate", "ram:IncludedSupplyChainTradeLineItem/ram:SpecifiedLineTradeSettlement/ram:ApplicableTradeTax/ram:RateApplicablePercent", "cac:InvoiceLine/cac:Item/cac:ClassifiedTaxCategory/cbc:Percent"],
  "BT-153": ["Item name", "ram:IncludedSupplyChainTradeLineItem/ram:SpecifiedTradeProduct/ram:Name", "cac:InvoiceLine/cac:Item/cbc:Name"],
});
export const termsOf = (r: RuleDoc) => r.field.split(",").map((f) => f.trim()).filter((f) => Object.hasOwn(TERMS, f));

const tool = (path: string) => ENDPOINTS.find((e) => e.path === path) as Endpoint;
const head = (title: string, description: string, url: string, origin: string, extra = "") => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(url)}">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(description)}"><meta property="og:url" content="${esc(url)}"><meta property="og:image" content="${esc(origin)}/og.png">
<link rel="icon" href="/favicon.ico">${extra}
<style>${PAGE_STYLE}${TRY_FORM_CSS}</style></head><body><main>`;
const foot = () => `<footer><a href="${EINVOICE_BASE}">E-invoice API</a> · <a href="${EINVOICE_RULES}">All validation rules</a> · <a href="/tools">All ${ENDPOINTS.length} tools</a> · ${COMPANY_FOOTER}</footer>
</main></body></html>`;

/** The upload form: a plain multipart POST to the validator as a free trial, no script. */
const validatorForm = (label: string) => `<form class="try" method="post" action="/einvoice/validate?trial=1" enctype="multipart/form-data">
<h2>${esc(label)}</h2>
<div class="field"><label for="einv-file">An XRechnung, ZUGFeRD or Factur-X file from your computer (XML, or the PDF with the XML inside)</label><input id="einv-file" name="file" type="file" accept=".xml,.pdf,application/xml,text/xml,application/pdf" required><small>Up to 5 MB. Read in memory for this one request and not stored.</small></div>
<button type="submit" class="btn primary">Validate my e-invoice</button>
</form>`;

const standardName = (r: RuleDoc) => (r.standard === "XRechnung" ? "XRechnung 3.0 (the German CIUS of EN 16931, published by KoSIT)" : "EN 16931-1, the European standard for electronic invoices");

/** One rule's page. `tryIt`: a browser may run the validator free here. */
export function einvoiceRulePage(r: RuleDoc, origin: string, tryIt: boolean, brand: string = SERVICE_NAME): string {
  const url = `${origin}${EINVOICE_RULES}/${ruleSlug(r.id)}`;
  const terms = termsOf(r);
  const names = terms.map((t) => TERMS[t][0]).join(", ");
  const title = `${r.id}: ${r.rule.replace(/\.$/, "")} · ${r.standard} e-invoice ${r.level === "error" ? "error" : "warning"} and fix`.slice(0, 160);
  const description = `What ${r.id} means in an ${r.standard === "XRechnung" ? "XRechnung" : "EN 16931 (XRechnung, ZUGFeRD, Factur-X, Peppol)"} e-invoice, which XML element it concerns in CII and UBL, and how to fix it. Check your file here.`;
  const related = RULES.filter((o) => o !== r && o.field.split(",").some((f) => terms.includes(f.trim()))).slice(0, 8);
  const faq: [string, string][] = [
    [`What does ${r.id} mean?`, `${r.rule} It is a rule of ${standardName(r)}.`],
    [`How do I fix ${r.id}?`, r.fix],
    [`Is ${r.id} an error or a warning?`, r.level === "error" ? `An error: a validator reports the invoice as not conformant, and a recipient that validates incoming e-invoices can reject it.` : `A warning: the invoice is still conformant, but the value should be corrected.`],
    ...(r.standard === "XRechnung" ? [[`Does ${r.id} apply to ZUGFeRD and Factur-X too?`, `Only when the file declares the XRechnung specification identifier (the ZUGFeRD profile "XRECHNUNG" does). Files in the plain EN 16931 profile are checked against the European rules, not the German additions.`] as [string, string]] : []),
  ];
  return `${head(title, description, url, origin, `\n<script type="application/ld+json">${jsonLd({ "@context": "https://schema.org", "@type": "FAQPage", mainEntity: faq.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })) })}</script>`)}
<nav class="crumbs"><a href="/">${esc(brand)}</a> › <a href="${EINVOICE_BASE}">E-invoice API</a> › <a href="${EINVOICE_RULES}">Validation rules</a></nav>
<h1>${esc(r.id)}: what it means and how to fix it</h1>
<p class="tag">${esc(r.rule)}</p>
<div class="wrap"><table>
<tr><th>Rule</th><td><code>${esc(r.id)}</code></td></tr>
<tr><th>Standard</th><td>${esc(standardName(r))}</td></tr>
<tr><th>Severity</th><td>${r.level === "error" ? "Error (the invoice is not conformant)" : "Warning"}</td></tr>
<tr><th>Concerns</th><td>${esc(r.field)}${names ? `: ${esc(names)}` : ""}</td></tr>
</table></div>
<h2>How to fix it</h2>
<p>${esc(r.fix)}</p>
${terms.length ? `<h2>Where the field is in the XML</h2>
<div class="wrap"><table><tr><th>Term</th><th>CII (XRechnung-CII, ZUGFeRD, Factur-X)</th><th>UBL (XRechnung-UBL, Peppol)</th></tr>
${terms.map((t) => `<tr><td>${esc(t)}<br>${esc(TERMS[t][0])}</td><td><code>${esc(TERMS[t][1])}</code></td><td><code>${esc(TERMS[t][2])}</code></td></tr>`).join("\n")}
</table></div>` : ""}
${tryIt ? validatorForm("Check your own file for this rule") : `<p><a class="btn primary" href="${EINVOICE_BASE}">Validate an e-invoice</a></p>`}
<h2>From your code</h2>
<pre><code>curl -H "Authorization: Bearer $API_KEY" -H "Content-Type: application/xml" \\
  --data-binary @invoice.xml "${esc(origin)}/einvoice/validate"</code></pre>
<p>The answer lists every broken rule with its number, the field, a message with the figures from your file and the fix. <a href="${EINVOICE_BASE}">E-invoice API</a>: validate, convert to JSON, and create XRechnung or ZUGFeRD XML from JSON.</p>
<h2>Questions</h2>
${faq.map(([q, a]) => `<h3>${esc(q)}</h3><p>${esc(a)}</p>`).join("")}
${related.length ? `<h2>Related rules</h2><ul>${related.map((o) => `<li><a href="${EINVOICE_RULES}/${ruleSlug(o.id)}">${esc(o.id)}</a>: ${esc(o.rule)}</li>`).join("")}</ul>` : ""}
<p class="small">Rule numbers are those of ${esc(r.standard === "XRechnung" ? "XRechnung 3.0 (KoSIT)" : "EN 16931-1")}; the explanation is ours. Not tax or legal advice.</p>
${foot()}`;
}

/** /e-invoice/rules: every rule the validator runs. */
export function einvoiceRulesIndexPage(origin: string, brand: string = SERVICE_NAME): string {
  const url = `${origin}${EINVOICE_RULES}`;
  const groups: [string, RuleDoc[]][] = [
    ["XRechnung rules (BR-DE)", RULES.filter((r) => r.standard === "XRechnung")],
    ["Mandatory fields (BR)", RULES.filter((r) => /^BR-\d/.test(r.id))],
    ["Sums and consistency (BR-CO)", RULES.filter((r) => r.id.startsWith("BR-CO"))],
    ["VAT categories (BR-S, BR-Z, BR-E, BR-AE, BR-IC, BR-G)", RULES.filter((r) => /^BR-(S|Z|E|AE|IC|G)-/.test(r.id))],
    ["Decimals (BR-DEC)", RULES.filter((r) => r.id.startsWith("BR-DEC"))],
  ];
  const title = `XRechnung and EN 16931 validation rules explained: ${RULES.length} error codes with fixes · ${brand}`;
  const description = `What each e-invoice validation error means and how to fix it: BR-DE rules of XRechnung, and the BR, BR-CO and VAT category rules of EN 16931 that ZUGFeRD, Factur-X and Peppol share.`;
  return `${head(title, description, url, origin)}
<nav class="crumbs"><a href="/">${esc(brand)}</a> › <a href="${EINVOICE_BASE}">E-invoice API</a></nav>
<h1>E-invoice validation rules, explained</h1>
<p class="tag">The ${RULES.length} business rules our validator runs on XRechnung, ZUGFeRD, Factur-X and other EN 16931 invoices: what each means, where the field is in the XML, and the fix.</p>
${groups.map(([name, list]) => `<h2>${esc(name)}</h2>
<div class="wrap"><table><tr><th>Rule</th><th>What it requires</th></tr>
${list.map((r) => `<tr><td><a href="${EINVOICE_RULES}/${ruleSlug(r.id)}"><code>${esc(r.id)}</code></a></td><td>${esc(r.rule)}</td></tr>`).join("\n")}
</table></div>`).join("\n")}
<p>This is a subset of the two standards: the rules a plain invoice with lines, VAT and a bank transfer can break. Rules about allowances and charges, attachments, card and direct-debit payments are not run.</p>
${foot()}`;
}

/** /e-invoice: the product page of the three tools. */
export function einvoiceIndexPage(origin: string, tryIt: boolean, brand: string = SERVICE_NAME): string {
  const url = `${origin}${EINVOICE_BASE}`;
  const create = tool("/einvoice/create"), validate = tool("/einvoice/validate"), toJson = tool("/einvoice/to-json");
  const title = `E-invoice API: create, validate and convert XRechnung, ZUGFeRD and Factur-X · ${brand}`;
  const description = "Create XRechnung and ZUGFeRD / Factur-X XML from JSON, validate e-invoices against EN 16931 and XRechnung business rules with plain-language errors, and convert e-invoice XML to JSON. One HTTP call each, no library to run.";
  const faq: [string, string][] = [
    ["Which formats does it handle?", "XRechnung 3.0 in both syntaxes (UN/CEFACT CII and UBL), the XML of ZUGFeRD 2.x and Factur-X in the EN 16931 profile, and other EN 16931 UBL or CII invoices such as Peppol BIS Billing 3.0. A ZUGFeRD or Factur-X PDF can be sent as it is: the embedded XML is read."],
    ["Does it create the ZUGFeRD PDF?", "No. It creates the XML part (factur-x.xml). Producing the PDF/A-3 that carries the XML is not done here yet."],
    ["Is this the official validator?", "No. It runs a subset of the EN 16931 and XRechnung 3.0 business rules, listed on the rules page, and explains each failure. A file that passes here can still fail the official KoSIT validator, which also checks the XML schema and every code list."],
    ["When do German companies have to issue e-invoices?", "As the law stands on 14 November 2026: companies with more than EUR 800,000 turnover in the previous year from 1 January 2027, all companies from 1 January 2028, for invoices between businesses in Germany. Receiving e-invoices has been mandatory since 1 January 2025. A postponement has been proposed; check the current state with your tax adviser."],
    ["Are my invoices stored?", "No. A file is read in memory for the one request and is not stored or logged."],
  ];
  return `${head(title, description, url, origin, `\n<script type="application/ld+json">${jsonLd({ "@context": "https://schema.org", "@type": "FAQPage", mainEntity: faq.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })) })}</script>`)}
<nav class="crumbs"><a href="/">${esc(brand)}</a></nav>
<h1>E-invoice API: create, validate, convert</h1>
<p class="tag">XRechnung, ZUGFeRD and Factur-X from one HTTP call each, for shops, ERPs, automation workflows and AI agents that cannot run a Java or Node library.</p>
<div class="wrap"><table>
<tr><th><a href="/tools/${esc(toolSlug(create.path))}">Create</a></th><td>Plain JSON in (seller, buyer, lines, VAT rate, IBAN), XRechnung or ZUGFeRD / Factur-X XML out. Line totals, VAT breakdown and totals are computed and checked first.</td></tr>
<tr><th><a href="/tools/${esc(toolSlug(validate.path))}">Validate</a></th><td>Every broken business rule with its number (BR-DE-15, BR-CO-15), the figures from your file and the fix. <a href="${EINVOICE_RULES}">${RULES.length} rules</a>.</td></tr>
<tr><th><a href="/tools/${esc(toolSlug(toJson.path))}">Convert to JSON</a></th><td>An incoming e-invoice (XML, or the PDF with the XML inside) as JSON: parties, lines, VAT, totals, bank account. Exact values, no AI.</td></tr>
</table></div>
${tryIt ? validatorForm("Validate an e-invoice now") : ""}
<h2>Create an XRechnung from JSON</h2>
<pre><code>curl -X POST "${esc(origin)}/einvoice/create" \\
  -H "Authorization: Bearer $API_KEY" -H "Content-Type: application/json" \\
  -d '${esc(JSON.stringify({ format: "xrechnung", invoice: JSON.parse(EXAMPLE_INVOICE_JSON) }, null, 1))}'</code></pre>
<p><code>format</code>: <code>xrechnung</code> (CII), <code>xrechnung-ubl</code>, <code>zugferd</code> (the factur-x.xml) or <code>ubl</code>. Data that breaks a rule is refused with the rule numbers and is not charged.</p>
<h2>Validate or convert a file</h2>
<pre><code>curl -H "Authorization: Bearer $API_KEY" -H "Content-Type: application/xml" \\
  --data-binary @invoice.xml "${esc(origin)}/einvoice/validate"

curl -H "Authorization: Bearer $API_KEY" \\
  "${esc(origin)}/einvoice/to-json?url=${esc(encodeURIComponent(SAMPLE_XRECHNUNG))}"</code></pre>
<h2>Read paper and PDF invoices too</h2>
<p>An invoice that is only a PDF or a scan has no XML to convert. <a href="/invoice-data-extraction-api">Invoice data extraction</a> reads its fields as JSON, and those fields can be passed to Create as they are.</p>
<h2>Pricing</h2>
<p>Each call counts as one ordinary call of your key. Keys and monthly plans: <a href="/credits">pricing</a>. A failed or refused call is never charged.</p>
<h2>What it does not do</h2>
<ul><li>No ZUGFeRD / Factur-X PDF: the XML part only.</li><li>No sending: it does not transmit to Peppol, to a French platform or to a public-sector portal.</li><li>Not the official KoSIT validator, and not tax advice.</li><li>Allowances and charges, attachments, card and direct-debit payments are not written, and their rules are not checked.</li></ul>
<h2>Questions</h2>
${faq.map(([q, a]) => `<h3>${esc(q)}</h3><p>${esc(a)}</p>`).join("")}
${foot()}`;
}
