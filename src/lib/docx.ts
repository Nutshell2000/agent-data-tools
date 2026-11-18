/**
 * A Word document of a LexGlyph answer (18 Nov 2026, Phase B of the law-firm plan): lawyers paste research into memos,
 * so the answer, each sentence's citation as a footnote, the quoted text and the provisions found go into a .docx that
 * Word, LibreOffice and Google Docs open. No library: a .docx is a ZIP of a few XML parts; this writes them stored
 * (uncompressed), which every reader accepts.
 */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** A ZIP archive with every file stored (method 0). */
export function zipStore(files: { name: string; data: string }[]): Uint8Array {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [], central: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name), data = enc.encode(f.data), crc = crc32(data);
    const local = new Uint8Array(30 + name.length);
    const v = new DataView(local.buffer);
    v.setUint32(0, 0x04034b50, true); v.setUint16(4, 20, true); v.setUint16(6, 0x0800, true); v.setUint16(8, 0, true);
    v.setUint16(10, 0, true); v.setUint16(12, 0x21, true); v.setUint32(14, crc, true); v.setUint32(18, data.length, true);
    v.setUint32(22, data.length, true); v.setUint16(26, name.length, true); v.setUint16(28, 0, true);
    local.set(name, 30);
    const cen = new Uint8Array(46 + name.length);
    const w = new DataView(cen.buffer);
    w.setUint32(0, 0x02014b50, true); w.setUint16(4, 20, true); w.setUint16(6, 20, true); w.setUint16(8, 0x0800, true);
    w.setUint16(10, 0, true); w.setUint16(12, 0, true); w.setUint16(14, 0x21, true); w.setUint32(16, crc, true);
    w.setUint32(20, data.length, true); w.setUint32(24, data.length, true); w.setUint16(28, name.length, true);
    w.setUint32(42, offset, true);
    cen.set(name, 46);
    parts.push(local, data); central.push(cen);
    offset += local.length + data.length;
  }
  const size = central.reduce((s, c) => s + c.length, 0);
  const end = new Uint8Array(22);
  const e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true);
  e.setUint32(12, size, true); e.setUint32(16, offset, true);
  const all = [...parts, ...central, end];
  const out = new Uint8Array(all.reduce((s, p) => s + p.length, 0));
  let at = 0;
  for (const p of all) { out.set(p, at); at += p.length; }
  return out;
}

const x = (s: string) => s.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]!).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
const run = (text: string, props = "") => `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ""}<w:t xml:space="preserve">${x(text)}</w:t></w:r>`;
const para = (inner: string, style?: string) => `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ""}${inner}</w:p>`;

export interface DocxAnswer {
  title: string;
  question: string;
  lang: string;
  claims: { text: string; quote: string; citation: string; url: string }[];
  provisions: { citation: string; heading?: string; text: string; url: string; version: string }[];
  labels: { answer: string; quoted: string; provisions: string; note: string; source: string };
}

/** The .docx bytes: question, answer with footnoted citations, the quotes, then the provisions found. */
export function answerDocx(a: DocxAnswer): Uint8Array {
  const notes: string[] = [];
  const body: string[] = [];
  body.push(para(run(a.title), "Title"));
  body.push(para(run(a.question, "<w:i/>")));
  if (a.claims.length) {
    body.push(para(run(a.labels.answer), "Heading1"));
    body.push(para(a.claims.map((c) => {
      notes.push(c.citation + (c.url ? ` ${c.url}` : ""));
      return `${run(`${c.text} `)}<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteReference w:id="${notes.length}"/></w:r>`;
    }).join(run(" "))));
    body.push(para(run(a.labels.quoted), "Heading1"));
    for (const c of a.claims) body.push(para(run(`“${c.quote}” `, "<w:i/>") + run(`(${c.citation})`), "Quote"));
  }
  if (a.provisions.length) {
    body.push(para(run(a.labels.provisions), "Heading1"));
    for (const p of a.provisions) {
      body.push(para(run(`${p.citation}${p.heading ? `: ${p.heading}` : ""}`), "Heading2"));
      for (const line of p.text.split("\n")) body.push(para(run(line)));
      body.push(para(run(`${p.version}. ${p.url}`, '<w:color w:val="555555"/><w:sz w:val="18"/>')));
    }
  }
  body.push(para(run(a.labels.note, '<w:color w:val="555555"/><w:sz w:val="18"/>')));
  body.push(para(run(a.labels.source, '<w:color w:val="555555"/><w:sz w:val="18"/>')));
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${W}><w:body>${body.join("")}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  const footnotes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:footnotes ${W}><w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote><w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>${notes.map((n, i) => `<w:footnote w:id="${i + 1}"><w:p><w:pPr><w:pStyle w:val="FootnoteText"/></w:pPr><w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteRef/></w:r>${run(` ${n}`)}</w:p></w:footnote>`).join("")}</w:footnotes>`;
  const style = (id: string, name: string, ppr: string, rpr: string, type = "paragraph") => `<w:style w:type="${type}" w:styleId="${id}"><w:name w:val="${name}"/>${ppr ? `<w:pPr>${ppr}</w:pPr>` : ""}${rpr ? `<w:rPr>${rpr}</w:rPr>` : ""}</w:style>`;
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles ${W}><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="22"/><w:lang w:val="${x(a.lang)}"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120"/></w:pPr></w:pPrDefault></w:docDefaults>${[
    style("Normal", "Normal", "", ""),
    style("Title", "Title", '<w:spacing w:after="240"/>', '<w:b/><w:sz w:val="36"/>'),
    style("Heading1", "heading 1", '<w:keepNext/><w:spacing w:before="240" w:after="120"/><w:outlineLvl w:val="0"/>', '<w:b/><w:sz w:val="28"/>'),
    style("Heading2", "heading 2", '<w:keepNext/><w:spacing w:before="180" w:after="60"/><w:outlineLvl w:val="1"/>', '<w:b/><w:sz w:val="24"/>'),
    style("Quote", "Quote", '<w:ind w:left="567"/>', ""),
    style("FootnoteText", "footnote text", '<w:spacing w:after="0"/>', '<w:sz w:val="18"/>'),
    style("FootnoteReference", "footnote reference", "", '<w:vertAlign w:val="superscript"/>', "character"),
  ].join("")}</w:styles>`;
  return zipStore([
    { name: "[Content_Types].xml", data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/></Types>' },
    { name: "_rels/.rels", data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>' },
    { name: "word/_rels/document.xml.rels", data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes" Target="footnotes.xml"/></Relationships>' },
    { name: "word/document.xml", data: document },
    { name: "word/styles.xml", data: styles },
    { name: "word/footnotes.xml", data: footnotes },
  ]);
}
