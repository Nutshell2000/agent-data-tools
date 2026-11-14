// The invoice XML inside a ZUGFeRD / Factur-X PDF (14 Nov 2026). The PDF engine (unpdf's PDF.js build) returned no
// attachments for the official ZUGFeRD corpus files, so the embedded file is read directly: an embedded file is a
// stream object whose dictionary says /Type /EmbeddedFile, and a stream is never packed inside an object stream, so
// its dictionary is always in plain bytes. Flate-compressed streams are inflated with DecompressionStream. An
// encrypted PDF yields nothing readable and is reported as having no invoice XML.

const latin1 = (bytes: Uint8Array, from: number, to: number) => {
  let s = "";
  for (let i = from; i < to; i += 8192) s += String.fromCharCode(...bytes.subarray(i, Math.min(to, i + 8192)));
  return s;
};

function indexOf(bytes: Uint8Array, needle: string, from: number): number {
  const first = needle.charCodeAt(0);
  outer: for (let i = bytes.indexOf(first, from); i !== -1 && i <= bytes.length - needle.length; i = bytes.indexOf(first, i + 1)) {
    for (let j = 1; j < needle.length; j++) if (bytes[i + j] !== needle.charCodeAt(j)) continue outer;
    return i;
  }
  return -1;
}

async function inflate(data: Uint8Array): Promise<Uint8Array | null> {
  try {
    const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch { return null; }
}

// The whole text is searched: the official ZUGFeRD samples open with a licence comment longer than 4,000 characters.
const looksLikeInvoice = (xml: string) => /<(\w+:)?(CrossIndustryInvoice|CrossIndustryDocument|Invoice|CreditNote)[\s>]/.test(xml);

/** Every embedded XML invoice found, latest revision last. */
export async function embeddedInvoiceXml(pdf: Uint8Array): Promise<string | null> {
  let found: string | null = null;
  let at = 0;
  for (let guard = 0; guard < 5000; guard++) {
    const s = indexOf(pdf, "stream", at);
    if (s === -1) break;
    at = s + 6;
    // "endstream" also ends in "stream": skip it.
    if (s >= 3 && pdf[s - 1] === 0x64 && pdf[s - 2] === 0x6e && pdf[s - 3] === 0x65) continue;
    const dict = latin1(pdf, Math.max(0, s - 600), s);
    const open = dict.lastIndexOf(" obj");
    const head = open === -1 ? dict : dict.slice(open);
    if (!/\/Type\s*\/EmbeddedFile|\/Subtype\s*\/(text|application)(#2F|\/)xml/i.test(head)) continue;
    let start = s + 6;
    if (pdf[start] === 0x0d) start++;
    if (pdf[start] === 0x0a) start++;
    const length = /\/Length\s+(\d+)(?!\s+\d+\s+R)/.exec(head);
    let end = length ? start + Number(length[1]) : -1;
    if (end === -1 || end > pdf.length || indexOf(pdf, "endstream", end) - end > 4 || indexOf(pdf, "endstream", end) === -1) {
      end = indexOf(pdf, "endstream", start);
      if (end === -1) continue;
      while (end > start && (pdf[end - 1] === 0x0a || pdf[end - 1] === 0x0d)) end--;
    }
    const raw = pdf.subarray(start, end);
    const data = /\/FlateDecode/.test(head) ? await inflate(raw) : raw;
    if (!data || data.length > 5 * 1024 * 1024) continue;
    const xml = new TextDecoder().decode(data);
    if (looksLikeInvoice(xml)) found = xml;
  }
  return found;
}
