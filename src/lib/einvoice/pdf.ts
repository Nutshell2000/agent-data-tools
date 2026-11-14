// The ZUGFeRD / Factur-X PDF (14 Nov 2026): a readable invoice page with the same invoice as XML embedded in it,
// written as PDF/A-3b by hand, because a Worker has no PDF library and no fonts.
//
// What makes it PDF/A-3: both fonts are embedded (data/invoice-font.generated.ts, Noto Sans, OFL), every colour is
// device-independent (CalGray, so no output intent is needed), there is no transparency, encryption or script, the
// XMP metadata names part 3 conformance B and carries the Factur-X extension schema, and the XML is an associated
// file with relationship "Alternative" (the PDF and the XML say the same thing). Streams are left uncompressed: the
// whole file is about 60 KB and writing stays synchronous.
//
// NOT verified with veraPDF or the Mustang validator when this was written; tests/einvoice.test.cjs checks the
// structure and reads the XML back out. Say "built to PDF/A-3b" and never "validated" until that has been done.
import { FONT_BOLD, FONT_REGULAR, type InvoiceFont } from "../../data/invoice-font.generated";
import type { Invoice, Party } from "./model";

const A4 = { w: 595.28, h: 841.89 };
const MARGIN = 50;

type Lang = "de" | "en";
const LABELS = {
  de: {
    invoice: "Rechnung", credit: "Gutschrift", number: "Rechnungsnummer", date: "Rechnungsdatum", due: "Fällig am", delivery: "Leistungsdatum", reference: "Ihre Referenz", order: "Bestellnummer",
    pos: "Pos.", item: "Bezeichnung", qty: "Menge", unit: "Einheit", price: "Einzelpreis", vat: "USt", net: "Netto",
    lineNet: "Summe netto", vatAt: "Umsatzsteuer", total: "Gesamtbetrag", prepaid: "Bereits gezahlt", payable: "Zahlbetrag",
    payment: "Zahlung", iban: "IBAN", bic: "BIC", holder: "Kontoinhaber", purpose: "Verwendungszweck", vatId: "USt-IdNr.", taxNo: "Steuernummer", register: "Register",
    page: "Seite", hybrid: "Diese Rechnung enthält die Rechnungsdaten als eingebettete XML (ZUGFeRD / Factur-X, EN 16931).", exempt: "Befreiungsgrund", tel: "Tel.",
  },
  en: {
    invoice: "Invoice", credit: "Credit note", number: "Invoice number", date: "Invoice date", due: "Due date", delivery: "Delivery date", reference: "Your reference", order: "Order number",
    pos: "No.", item: "Description", qty: "Qty", unit: "Unit", price: "Unit price", vat: "VAT", net: "Net",
    lineNet: "Net total", vatAt: "VAT", total: "Total", prepaid: "Already paid", payable: "Amount due",
    payment: "Payment", iban: "IBAN", bic: "BIC", holder: "Account holder", purpose: "Reference", vatId: "VAT ID", taxNo: "Tax number", register: "Register",
    page: "Page", hybrid: "This invoice carries its data as embedded XML (ZUGFeRD / Factur-X, EN 16931).", exempt: "Exemption reason", tel: "Tel.",
  },
} as const;

const UNIT_NAMES: Readonly<Record<string, readonly [string, string]>> = Object.freeze({
  C62: ["Stk.", "pcs"], H87: ["Stk.", "pcs"], HUR: ["Std.", "h"], DAY: ["Tage", "days"], MON: ["Monate", "months"], KGM: ["kg", "kg"], GRM: ["g", "g"], LTR: ["l", "l"],
  MTR: ["m", "m"], KMT: ["km", "km"], MTK: ["m²", "m²"], MTQ: ["m³", "m³"], TNE: ["t", "t"], MIN: ["Min.", "min"], LS: ["pauschal", "lump sum"], SET: ["Satz", "set"], PR: ["Paar", "pair"],
});

const money = (n: number | undefined, lang: Lang) => {
  const [whole, cents] = Math.abs(n ?? 0).toFixed(2).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, lang === "de" ? "." : ",");
  return `${(n ?? 0) < 0 ? "-" : ""}${grouped}${lang === "de" ? "," : "."}${cents}`;
};
const plain = (n: number | undefined, lang: Lang) => { const s = String(Math.round((n ?? 0) * 10000) / 10000); return lang === "de" ? s.replace(".", ",") : s; };
const day = (iso: string | undefined, lang: Lang) => (!iso ? "" : lang === "de" ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : iso);

/** Glyph ids of a text in a font; a character the font lacks becomes a question mark. */
function glyphs(font: InvoiceFont, text: string): number[] {
  const fallback = font.cmap.get(63) ?? 0;
  const out: number[] = [];
  for (const ch of text.normalize("NFC")) {
    const cp = ch.codePointAt(0)!;
    if (cp === 9 || cp === 10 || cp === 13) { out.push(font.cmap.get(32) ?? 0); continue; }
    out.push(font.cmap.get(cp) ?? fallback);
  }
  return out;
}
const widthOf = (font: InvoiceFont, text: string, size: number) => glyphs(font, text).reduce((a, g) => a + (font.widths[g] ?? 500), 0) * size / 1000;
const hex4 = (n: number) => n.toString(16).padStart(4, "0").toUpperCase();

/** Words of `text` laid into lines no wider than `max`; a single word longer than the line is cut. */
function wrap(font: InvoiceFont, text: string, size: number, max: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split(/\r?\n/)) {
    let line = "";
    for (let word of paragraph.split(/\s+/).filter(Boolean)) {
      while (widthOf(font, word, size) > max && word.length > 1) {
        let cut = word.length - 1;
        while (cut > 1 && widthOf(font, word.slice(0, cut), size) > max) cut--;
        if (line) { lines.push(line); line = ""; }
        lines.push(word.slice(0, cut));
        word = word.slice(cut);
      }
      const next = line ? `${line} ${word}` : word;
      if (line && widthOf(font, next, size) > max) { lines.push(line); line = word; } else line = next;
    }
    lines.push(line);
  }
  return lines.length ? lines : [""];
}

/** One page's drawing operators, built with text and line helpers. */
class Page {
  ops: string[] = ["/CS0 cs 0 sc /CS0 CS 0 SC"];
  text(font: "F1" | "F2", size: number, x: number, y: number, value: string, align: "left" | "right" = "left") {
    if (!value) return;
    const f = font === "F1" ? FONT_REGULAR : FONT_BOLD;
    const tx = align === "right" ? x - widthOf(f, value, size) : x;
    this.ops.push(`BT /${font} ${size} Tf ${tx.toFixed(2)} ${y.toFixed(2)} Td <${glyphs(f, value).map(hex4).join("")}> Tj ET`);
  }
  rule(x1: number, y: number, x2: number, weight = 0.6, grey = 0.55) {
    this.ops.push(`${grey} SC ${weight} w ${x1.toFixed(2)} ${y.toFixed(2)} m ${x2.toFixed(2)} ${y.toFixed(2)} l S 0 SC`);
  }
}

const partyLines = (p: Party = {}) => [p.name, p.street, [p.postCode, p.city].filter(Boolean).join(" "), p.country && p.country !== "DE" ? p.country : ""].filter((v): v is string => Boolean(v));

/** Lays the invoice out on as many A4 pages as it needs. */
function layout(inv: Invoice, lang: Lang): Page[] {
  const L = LABELS[lang];
  const pages: Page[] = [];
  let page = new Page();
  let y = 0;
  const right = A4.w - MARGIN;
  const bottom = 86;
  const newPage = () => { page = new Page(); pages.push(page); y = A4.h - MARGIN; };
  const need = (space: number) => { if (y - space < bottom) { newPage(); return true; } return false; };
  newPage();

  // Seller, top left; title and facts, top right.
  const seller = inv.seller ?? {}, buyer = inv.buyer ?? {};
  page.text("F2", 13, MARGIN, y - 4, seller.name ?? "");
  let sy = y - 20;
  for (const line of partyLines(seller).slice(1)) { page.text("F1", 9, MARGIN, sy, line); sy -= 12; }
  page.text("F2", 20, right, y - 8, inv.typeCode === "381" ? L.credit : L.invoice, "right");
  const facts: [string, string][] = [[L.number, inv.number ?? ""], [L.date, day(inv.issueDate, lang)]];
  if (inv.dueDate) facts.push([L.due, day(inv.dueDate, lang)]);
  if (inv.deliveryDate) facts.push([L.delivery, day(inv.deliveryDate, lang)]);
  if (inv.buyerReference) facts.push([L.reference, inv.buyerReference]);
  if (inv.orderReference) facts.push([L.order, inv.orderReference]);
  let fy = y - 30;
  for (const [k, v] of facts) { page.text("F1", 9, right - 150, fy, k); page.text("F2", 9, right, fy, v.slice(0, 40), "right"); fy -= 13; }

  // Buyer, in the address window area.
  let by = Math.min(sy, y - 86) - 22;
  for (const [i, line] of partyLines(buyer).entries()) { page.text(i === 0 ? "F2" : "F1", 10.5, MARGIN, by, line.slice(0, 60)); by -= 14; }
  if (buyer.vatId) { page.text("F1", 9, MARGIN, by, `${L.vatId} ${buyer.vatId}`); by -= 13; }
  y = Math.min(by, fy) - 26;

  // Lines.
  const col = { pos: MARGIN, item: MARGIN + 30, qty: 330, unit: 338, price: 440, vat: 482, net: right };
  const header = () => {
    page.text("F2", 8.5, col.pos, y, L.pos); page.text("F2", 8.5, col.item, y, L.item); page.text("F2", 8.5, col.qty, y, L.qty, "right");
    page.text("F2", 8.5, col.unit, y, L.unit); page.text("F2", 8.5, col.price, y, L.price, "right"); page.text("F2", 8.5, col.vat, y, L.vat, "right"); page.text("F2", 8.5, col.net, y, L.net, "right");
    y -= 5; page.rule(MARGIN, y, right, 0.8, 0.2); y -= 14;
  };
  header();
  (inv.lines ?? []).forEach((l, i) => {
    const nameLines = wrap(FONT_REGULAR, l.name ?? "", 9.5, col.qty - 46 - col.item);
    const more = l.description ? wrap(FONT_REGULAR, l.description, 8, col.qty - 46 - col.item).slice(0, 6) : [];
    if (need(nameLines.length * 12 + more.length * 10 + 8)) header();
    const unit = UNIT_NAMES[l.unit ?? ""]?.[lang === "de" ? 0 : 1] ?? l.unit ?? "";
    page.text("F1", 9.5, col.pos, y, String(l.id ?? i + 1).slice(0, 5)); page.text("F1", 9.5, col.qty, y, plain(l.quantity, lang), "right"); page.text("F1", 9.5, col.unit, y, unit);
    page.text("F1", 9.5, col.price, y, money(l.unitPrice, lang), "right"); page.text("F1", 9.5, col.vat, y, `${plain(l.vatRate, lang)} %`, "right"); page.text("F1", 9.5, col.net, y, money(l.netAmount, lang), "right");
    for (const line of nameLines) { page.text("F1", 9.5, col.item, y, line); y -= 12; }
    for (const line of more) { page.text("F1", 8, col.item, y, line); y -= 10; }
    y -= 3; page.rule(MARGIN, y + 2, right, 0.3, 0.8); y -= 9;
  });

  // Totals.
  const t = inv.totals ?? {}, cur = inv.currency ?? "EUR";
  const rows: [string, string, boolean][] = [[L.lineNet, `${money(t.taxBasis ?? t.lineNet, lang)} ${cur}`, false]];
  for (const v of inv.vat ?? []) rows.push([`${L.vatAt} ${plain(v.rate, lang)} % (${money(v.basis, lang)})`, `${money(v.tax, lang)} ${cur}`, false]);
  rows.push([L.total, `${money(t.grand, lang)} ${cur}`, true]);
  if (t.prepaid) { rows.push([L.prepaid, `${money(t.prepaid, lang)} ${cur}`, false]); rows.push([L.payable, `${money(t.payable, lang)} ${cur}`, true]); }
  need(rows.length * 15 + 20);
  y -= 4;
  for (const [k, v, strong] of rows) {
    if (strong) { page.rule(right - 230, y + 11, right, 0.6, 0.2); }
    page.text(strong ? "F2" : "F1", strong ? 10.5 : 9.5, right - 230, y, k); page.text(strong ? "F2" : "F1", strong ? 10.5 : 9.5, right, y, v, "right"); y -= 15;
  }
  for (const v of inv.vat ?? []) if (v.exemptionReason) { need(14); for (const line of wrap(FONT_REGULAR, `${L.exempt}: ${v.exemptionReason}`, 8.5, right - MARGIN)) { page.text("F1", 8.5, MARGIN, y, line); y -= 11; } }

  // Payment and note.
  const pay = inv.payment ?? {};
  const payRows: [string, string][] = [];
  if (pay.iban) payRows.push([L.iban, pay.iban.replace(/(.{4})/g, "$1 ").trim()]);
  if (pay.bic) payRows.push([L.bic, pay.bic]);
  if (pay.accountName) payRows.push([L.holder, pay.accountName]);
  if (pay.reference) payRows.push([L.purpose, pay.reference]);
  if (payRows.length || pay.terms) {
    need(payRows.length * 12 + 40); y -= 14;
    page.text("F2", 10, MARGIN, y, L.payment); y -= 14;
    for (const [k, v] of payRows) { page.text("F1", 9, MARGIN, y, k); page.text("F1", 9, MARGIN + 90, y, v.slice(0, 70)); y -= 12; }
    if (pay.terms) for (const line of wrap(FONT_REGULAR, pay.terms, 9, right - MARGIN).slice(0, 8)) { need(12); page.text("F1", 9, MARGIN, y, line); y -= 12; }
  }
  if (inv.note) { y -= 8; for (const line of wrap(FONT_REGULAR, inv.note, 8.5, right - MARGIN).slice(0, 30)) { need(11); page.text("F1", 8.5, MARGIN, y, line); y -= 11; } }

  // Footer on every page: who the seller is, and that the XML is inside.
  const ids = [seller.vatId && `${L.vatId} ${seller.vatId}`, seller.taxNumber && `${L.taxNo} ${seller.taxNumber}`, seller.legalId && `${L.register} ${seller.legalId}`].filter(Boolean).join("  ·  ");
  const contact = [seller.contactName, seller.phone && `${L.tel} ${seller.phone}`, seller.email].filter(Boolean).join("  ·  ");
  pages.forEach((p, i) => {
    p.rule(MARGIN, 70, right, 0.4, 0.6);
    p.text("F1", 7.5, MARGIN, 58, [partyLines(seller).join(", "), ids].filter(Boolean).join("  ·  ").slice(0, 150));
    p.text("F1", 7.5, MARGIN, 47, contact.slice(0, 150));
    p.text("F1", 7, MARGIN, 34, L.hybrid);
    p.text("F1", 7.5, right, 34, `${L.page} ${i + 1} / ${pages.length}`, "right");
  });
  return pages;
}

const latin1 = (s: string) => { const b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 0xff; return b; };
const utf8 = (s: string) => new TextEncoder().encode(s);
const fromBase64 = (b64: string) => { const raw = atob(b64); const b = new Uint8Array(raw.length); for (let i = 0; i < raw.length; i++) b[i] = raw.charCodeAt(i); return b; };
const pdfString = (s: string) => `(${s.replace(/[\\()]/g, "\\$&").replace(/[^\x20-\x7e]/g, "?")})`;
const xmlEsc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function toUnicode(font: InvoiceFont): string {
  const pairs = [...font.cmap.entries()].map(([cp, gid]) => `<${hex4(gid)}> <${hex4(cp)}>`);
  const blocks: string[] = [];
  for (let i = 0; i < pairs.length; i += 100) blocks.push(`${Math.min(100, pairs.length - i)} beginbfchar\n${pairs.slice(i, i + 100).join("\n")}\nendbfchar`);
  return `/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n${blocks.join("\n")}\nendcmap\nCMapName currentdict /CMap defineresource pop\nend\nend`;
}

function xmp(inv: Invoice, created: string, xmlName: string): string {
  const title = xmlEsc(`${inv.typeCode === "381" ? "Credit note" : "Invoice"} ${inv.number ?? ""}`.trim());
  const author = xmlEsc(inv.seller?.name ?? "");
  const property = (name: string, description: string) => `<rdf:li rdf:parseType="Resource"><pdfaProperty:name>${name}</pdfaProperty:name><pdfaProperty:valueType>Text</pdfaProperty:valueType><pdfaProperty:category>external</pdfaProperty:category><pdfaProperty:description>${description}</pdfaProperty:description></rdf:li>`;
  return `<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
<rdf:Description rdf:about="" xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/"><pdfaid:part>3</pdfaid:part><pdfaid:conformance>B</pdfaid:conformance></rdf:Description>
<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:format>application/pdf</dc:format><dc:title><rdf:Alt><rdf:li xml:lang="x-default">${title}</rdf:li></rdf:Alt></dc:title><dc:creator><rdf:Seq><rdf:li>${author}</rdf:li></rdf:Seq></dc:creator></rdf:Description>
<rdf:Description rdf:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/"><xmp:CreatorTool>Glyphcall e-invoice API</xmp:CreatorTool><xmp:CreateDate>${created}</xmp:CreateDate><xmp:ModifyDate>${created}</xmp:ModifyDate></rdf:Description>
<rdf:Description rdf:about="" xmlns:pdf="http://ns.adobe.com/pdf/1.3/"><pdf:Producer>Glyphcall e-invoice API</pdf:Producer></rdf:Description>
<rdf:Description rdf:about="" xmlns:pdfaExtension="http://www.aiim.org/pdfa/ns/extension/" xmlns:pdfaSchema="http://www.aiim.org/pdfa/ns/schema#" xmlns:pdfaProperty="http://www.aiim.org/pdfa/ns/property#">
<pdfaExtension:schemas><rdf:Bag><rdf:li rdf:parseType="Resource"><pdfaSchema:schema>Factur-X PDFA Extension Schema</pdfaSchema:schema><pdfaSchema:namespaceURI>urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#</pdfaSchema:namespaceURI><pdfaSchema:prefix>fx</pdfaSchema:prefix>
<pdfaSchema:property><rdf:Seq>${property("DocumentFileName", "The name of the embedded XML document")}${property("DocumentType", "The type of the hybrid document in capital letters, e.g. INVOICE or ORDER")}${property("Version", "The actual version of the standard applying to the embedded XML document")}${property("ConformanceLevel", "The conformance level of the embedded XML document")}</rdf:Seq></pdfaSchema:property>
</rdf:li></rdf:Bag></pdfaExtension:schemas>
</rdf:Description>
<rdf:Description rdf:about="" xmlns:fx="urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#"><fx:DocumentType>INVOICE</fx:DocumentType><fx:DocumentFileName>${xmlName}</fx:DocumentFileName><fx:Version>1.0</fx:Version><fx:ConformanceLevel>EN 16931</fx:ConformanceLevel></rdf:Description>
</rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
}

export const ZUGFERD_XML_NAME = "factur-x.xml";

/**
 * The hybrid invoice: `inv` drawn on A4 pages, with `xml` (the EN 16931 CII XML of the same invoice) embedded as
 * factur-x.xml. `now` and `id` make the output reproducible in tests.
 */
export function writeZugferdPdf(inv: Invoice, xml: string, options: { lang?: Lang; now?: Date; id?: string } = {}): Uint8Array {
  const lang: Lang = options.lang ?? (["DE", "AT"].includes(inv.seller?.country ?? "") ? "de" : "en");
  const now = options.now ?? new Date();
  const stamp = now.toISOString().slice(0, 19);
  const pdfDate = `D:${stamp.replace(/[-:T]/g, "")}Z`;
  const pages = layout(inv, lang);
  const xmlBytes = utf8(xml);

  // Object numbers: 1 catalog, 2 pages, 3 metadata, 4 file spec, 5 embedded file, then per font 5 objects, then per page 2.
  const fonts = [FONT_REGULAR, FONT_BOLD];
  const fontBase = 6, pageBase = fontBase + fonts.length * 5;
  const total = pageBase + pages.length * 2 - 1;
  const parts: Uint8Array[] = [];
  const offsets: number[] = [];
  let size = 0;
  const push = (b: Uint8Array) => { parts.push(b); size += b.length; };
  const object = (n: number, dict: string, stream?: Uint8Array) => {
    offsets[n] = size;
    if (stream) { push(latin1(`${n} 0 obj\n${dict.replace(/>>$/, `/Length ${stream.length} >>`)}\nstream\n`)); push(stream); push(latin1("\nendstream\nendobj\n")); }
    else push(latin1(`${n} 0 obj\n${dict}\nendobj\n`));
  };

  push(latin1("%PDF-1.7\n%\xE2\xE3\xCF\xD3\n"));
  const kids = pages.map((_, i) => `${pageBase + i * 2} 0 R`).join(" ");
  object(1, `<< /Type /Catalog /Pages 2 0 R /Metadata 3 0 R /Lang ${pdfString(lang === "de" ? "de-DE" : "en")} /Names << /EmbeddedFiles << /Names [${pdfString(ZUGFERD_XML_NAME)} 4 0 R] >> >> /AF [4 0 R] >>`);
  object(2, `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`);
  object(3, "<< /Type /Metadata /Subtype /XML >>", utf8(xmp(inv, `${stamp}Z`, ZUGFERD_XML_NAME)));
  object(4, `<< /Type /Filespec /F ${pdfString(ZUGFERD_XML_NAME)} /UF ${pdfString(ZUGFERD_XML_NAME)} /Desc (Factur-X / ZUGFeRD invoice) /AFRelationship /Alternative /EF << /F 5 0 R /UF 5 0 R >> >>`);
  object(5, `<< /Type /EmbeddedFile /Subtype /text#2Fxml /Params << /ModDate (${pdfDate}) /Size ${xmlBytes.length} >> >>`, xmlBytes);
  fonts.forEach((f, i) => {
    const n = fontBase + i * 5;
    const file = fromBase64(f.base64);
    const widths = f.widths.map((w) => w).join(" ");
    object(n, `<< /Type /Font /Subtype /Type0 /BaseFont /${f.name} /Encoding /Identity-H /DescendantFonts [${n + 1} 0 R] /ToUnicode ${n + 4} 0 R >>`);
    object(n + 1, `<< /Type /Font /Subtype /CIDFontType2 /BaseFont /${f.name} /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ${n + 2} 0 R /DW 500 /W [0 [${widths}]] /CIDToGIDMap /Identity >>`);
    object(n + 2, `<< /Type /FontDescriptor /FontName /${f.name} /Flags 4 /FontBBox [${f.bbox.join(" ")}] /ItalicAngle 0 /Ascent ${f.ascent} /Descent ${f.descent} /CapHeight ${f.capHeight} /StemV ${f.stemV} /FontFile2 ${n + 3} 0 R >>`);
    object(n + 3, `<< /Length1 ${file.length} >>`, file);
    object(n + 4, "<< >>", latin1(toUnicode(f)));
  });
  pages.forEach((p, i) => {
    const n = pageBase + i * 2;
    object(n, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${A4.w} ${A4.h}] /Resources << /Font << /F1 ${fontBase} 0 R /F2 ${fontBase + 5} 0 R >> /ColorSpace << /CS0 [/CalGray << /WhitePoint [0.9505 1 1.089] /Gamma 2.2 >>] >> >> /Contents ${n + 1} 0 R >>`);
    object(n + 1, "<< >>", latin1(p.ops.join("\n")));
  });

  const xref = size;
  let table = `xref\n0 ${total + 1}\n0000000000 65535 f \n`;
  for (let n = 1; n <= total; n++) table += `${String(offsets[n]).padStart(10, "0")} 00000 n \n`;
  const id = (options.id ?? [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("")).toUpperCase();
  push(latin1(`${table}trailer\n<< /Size ${total + 1} /Root 1 0 R /ID [<${id}> <${id}>] >>\nstartxref\n${xref}\n%%EOF\n`));

  const out = new Uint8Array(size);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

/** Base64 of bytes, in chunks so a large file does not overflow the call stack. */
export function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
