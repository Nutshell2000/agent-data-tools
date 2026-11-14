// /document/text (14 Nov 2026): Word, Excel and PowerPoint files read inside the Worker (lib/zip.ts + saxes), a PDF
// through the PDF reader, from a URL or an uploaded file. No network: every file is built here.
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const { before, after, test } = require('node:test');
const { build } = require('esbuild');
const { Miniflare, convertV4MiniflareOptions } = require('miniflare');

async function load(entry) {
  const b = await build({ entryPoints: [entry], bundle: true, format: 'cjs', platform: 'node', write: false, logLevel: 'silent', external: ['@cloudflare/puppeteer', 'cloudflare:workers'] });
  const m = { exports: {} };
  const req = (id) => (id === '@cloudflare/puppeteer' ? { default: {} } : id === 'cloudflare:workers' ? { DurableObject: class {} } : require(id));
  new Function('module', 'exports', 'require', b.outputFiles[0].text)(m, m.exports, req);
  return m.exports;
}

/** A ZIP archive of the given parts: deflated unless `stored`, as office applications write them. */
function zip(parts, { stored = false, flags = 0 } = {}) {
  const local = [], central = [];
  let offset = 0;
  for (const [name, content] of Object.entries(parts)) {
    const raw = Buffer.from(content);
    const data = stored ? raw : zlib.deflateRawSync(raw);
    const nameBytes = Buffer.from(name);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(20, 4); head.writeUInt16LE(flags, 6); head.writeUInt16LE(stored ? 0 : 8, 8);
    head.writeUInt32LE(data.length, 18); head.writeUInt32LE(raw.length, 22); head.writeUInt16LE(nameBytes.length, 26);
    local.push(head, nameBytes, data);
    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0); dir.writeUInt16LE(20, 4); dir.writeUInt16LE(20, 6); dir.writeUInt16LE(flags, 8); dir.writeUInt16LE(stored ? 0 : 8, 10);
    dir.writeUInt32LE(data.length, 20); dir.writeUInt32LE(raw.length, 24); dir.writeUInt16LE(nameBytes.length, 28); dir.writeUInt32LE(offset, 42);
    central.push(dir, nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const dirBytes = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(parts).length, 8); end.writeUInt16LE(Object.keys(parts).length, 10);
  end.writeUInt32LE(dirBytes.length, 12); end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...local, dirBytes, end]));
}

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const p = (text, style, list) => `<w:p><w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ''}${list ? '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>' : ''}</w:pPr><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
const tc = (text) => `<w:tc>${p(text)}</w:tc>`;
const DOCX_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${W}><w:body>
${p('Quarterly report', 'Title')}${p('Summary', 'Heading1')}
<w:p><w:r><w:t>Revenue grew </w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>12 %</w:t></w:r><w:r><w:tab/><w:t>year on year.</w:t><w:br/><w:t>Costs fell.</w:t></w:r><w:del><w:r><w:delText>deleted words</w:delText></w:r></w:del></w:p>
${p('First point', null, true)}${p('Second point', null, true)}${p('Details', 'Heading2')}
<w:tbl><w:tr>${tc('Item')}${tc('Amount')}</w:tr><w:tr>${tc('Licences | seats')}${tc('1 250')}</w:tr><w:tr>${tc('')}${tc('')}</w:tr></w:tbl>
${p('R&amp;D &lt;planned&gt;')}<w:p><w:pPr/></w:p></w:body></w:document>`;
const docx = (xml = DOCX_XML, options) => zip({ '[Content_Types].xml': '<Types/>', 'word/document.xml': xml }, options);

const xlsx = () => zip({
  'xl/workbook.xml': '<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sales" sheetId="1" r:id="rId1"/><sheet name="Empty" sheetId="2" r:id="rId2"/></sheets></workbook>',
  'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="worksheets/sheet2.xml"/></Relationships>',
  'xl/sharedStrings.xml': '<sst><si><t>Region</t></si><si><t>Total</t></si><si><r><t>Nor</t></r><r><t>dics</t></r><rPh><t>ignored</t></rPh></si></sst>',
  'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2" t="inlineStr"><is><t>note</t></is></c><c r="C2"><v>1250.5</v></c><c r="D2" t="b"><v>1</v></c></row><row r="3"></row></sheetData></worksheet>',
  'xl/worksheets/sheet2.xml': '<worksheet><sheetData/></worksheet>',
});
const slide = (...lines) => `<p:sld xmlns:a="a" xmlns:p="p"><p:cSld><p:spTree>${lines.map((l) => `<p:sp><p:txBody><a:p><a:r><a:t>${l}</a:t></a:r></a:p></p:txBody></p:sp>`).join('')}</p:spTree></p:cSld></p:sld>`;
const pptx = () => zip({ 'ppt/presentation.xml': '<p:presentation xmlns:p="p"/>', 'ppt/slides/slide10.xml': slide('Thank you'), 'ppt/slides/slide2.xml': slide('Agenda', 'Numbers'), 'ppt/slides/slide1.xml': slide('Kick-off') });

function tinyPdf(line = 'Invoice 2026-001 total 1250 SEK') {
  const stream = `BT /F1 18 Tf 72 720 Td (${line}) Tj ET`;
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  let out = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((body, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${body}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(out, 'latin1'));
}

let D, Z;
before(async () => { D = await load('src/routes/document.ts'); Z = await load('src/lib/zip.ts'); });

test('the ZIP reader reads stored and deflated entries and refuses what it cannot read safely', async () => {
  for (const stored of [false, true]) {
    const bytes = zip({ 'a.txt': 'hello', 'dir/b.xml': '<x>å</x>' }, { stored });
    assert.equal(Z.isZip(bytes), true);
    const entries = Z.zipEntries(bytes);
    assert.deepEqual([...entries.keys()], ['a.txt', 'dir/b.xml']);
    assert.equal(await Z.zipText(bytes, entries, 'dir/b.xml', 1000), '<x>å</x>');
    assert.equal(await Z.zipText(bytes, entries, 'missing', 1000), null);
  }
  // A part that expands past the limit is refused, whatever its header claims.
  const bomb = zip({ 'big.xml': 'A'.repeat(200_000) });
  await assert.rejects(Z.zipText(bomb, Z.zipEntries(bomb), 'big.xml', 50_000), (e) => e.status === 422 && /larger than this tool reads/.test(e.message));
  const locked = zip({ 'a.txt': 'secret' }, { flags: 1 });
  await assert.rejects(Z.zipText(locked, Z.zipEntries(locked), 'a.txt', 1000), (e) => e.status === 422 && /password-protected/.test(e.message));
  assert.throws(() => Z.zipEntries(new Uint8Array(Buffer.from('PK\u0003\u0004 not really a zip file at all, just some text'))), (e) => e.status === 422);
  const cut = zip({ 'a.txt': 'hello world hello world' }).slice(0, 30);
  assert.equal(Z.isZip(cut), true);
  assert.throws(() => Z.zipEntries(cut), (e) => e.status === 422);
});

test('Word: headings, lists, tables, line breaks and tabs; deleted text is left out', async () => {
  const md = await D.readDocument(docx(), 'markdown', 50_000);
  assert.equal(md.type, 'docx');
  assert.equal(md.format, 'markdown');
  assert.equal(md.truncated, false);
  assert.equal(md.text, [
    '# Quarterly report', '# Summary', 'Revenue grew 12 %\tyear on year.\nCosts fell.', '- First point\n- Second point', '## Details',
    '| Item | Amount |\n| --- | --- |\n| Licences \\| seats | 1 250 |', 'R&D <planned>',
  ].join('\n\n'));
  assert.equal(md.chars, md.text.length);
  const plain = await D.readDocument(docx(undefined, { stored: true }), 'text', 50_000);
  assert.equal(plain.format, 'text');
  assert.match(plain.text, /^Quarterly report\n\nSummary\n\n/);
  assert.match(plain.text, /Item\tAmount\nLicences \| seats\t1 250/);
  assert.ok(!/deleted words/.test(md.text + plain.text));
  const short = await D.readDocument(docx(DOCX_XML.replace('First point', 'x'.repeat(3000))), 'markdown', 1000);
  assert.equal(short.chars, 1000);
  assert.equal(short.truncated, true);
});

test('Excel: each sheet as a table, cells placed by their reference', async () => {
  const md = await D.readDocument(xlsx(), 'markdown', 50_000);
  assert.equal(md.type, 'xlsx');
  assert.deepEqual(md.sheets, [{ name: 'Sales', rows: 2, columns: 4 }, { name: 'Empty', rows: 0, columns: 0 }]);
  assert.equal(md.text, '## Sales\n\n| Region |  | Total |  |\n| --- | --- | --- | --- |\n| Nordics | note | 1250.5 | TRUE |');
  assert.match(md.note, /Dates and times are given in ISO form/);
  const plain = await D.readDocument(xlsx(), 'text', 50_000);
  assert.equal(plain.text, 'Sales\nRegion\t\tTotal\nNordics\tnote\t1250.5\tTRUE');
});

test('PowerPoint: slides in their own order, not the order of the file names', async () => {
  const md = await D.readDocument(pptx(), 'markdown', 50_000);
  assert.equal(md.type, 'pptx');
  assert.equal(md.slides, 3);
  assert.equal(md.text, '## Slide 1\n\nKick-off\n\n## Slide 2\n\nAgenda\nNumbers\n\n## Slide 10\n\nThank you');
});

test('a PDF is read through the PDF reader; other files are refused with the reason', async () => {
  const pdf = await D.readDocument(tinyPdf(), 'markdown', 50_000);
  assert.equal(pdf.type, 'pdf');
  assert.equal(pdf.format, 'text');
  assert.equal(pdf.pages, 1);
  assert.match(pdf.text, /Invoice 2026-001 total 1250 SEK/);
  const refused = (bytes, pattern, status = 415) => assert.rejects(D.readDocument(bytes, 'markdown', 50_000), (e) => e.status === status && pattern.test(e.message), String(pattern));
  await refused(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0]), /old binary Office file.*nothing was charged/);
  await refused(new TextEncoder().encode('<!doctype html><html><body>a web page, not a document at all</body></html>'), /not a Word.*nothing was charged/);
  await refused(zip({ 'mimetype': 'application/epub+zip', 'book.opf': '<package/>' }), /not a Word/);
  await refused(docx(`<w:document ${W}><w:body><w:p></w:p></w:body></w:document>`), /holds no text/, 422);
  await refused(docx('<w:document><w:body><w:p>'), /not well-formed XML/, 422);
  await refused(docx('<!DOCTYPE x [<!ENTITY a "b">]><w:document/>'), /not well-formed XML/, 422);
  await refused(docx(DOCX_XML, { flags: 1 }), /password-protected/, 422);
});

test('the listing: findable by the job, one more tool in the documents section, and it takes a file', async () => {
  const { ENDPOINTS, exampleParams } = await load('src/endpoints.ts');
  const { categoryOf } = await load('src/discovery.ts');
  const { CAPACITY_LIMITED } = await load('src/lib/capacity.ts');
  const { FILE_INPUT_PATHS } = await load('src/lib/file-input.ts');
  const tool = ENDPOINTS.find((e) => e.path === '/document/text');
  assert.equal(tool.summary.split(':')[0], 'Document to text');
  assert.ok(tool.description.length <= 450, `description is ${tool.description.length} characters`);
  assert.ok(tool.tags.length >= 5);
  assert.equal(categoryOf('/document/text'), 'Web, documents and search');
  assert.equal(CAPACITY_LIMITED.has('/document/text'), false);
  assert.equal(FILE_INPUT_PATHS['/document/text'], D.DOCUMENT_MAX_BYTES);
  assert.deepEqual(exampleParams(tool).map(([name]) => name), ['url']);
  assert.equal(tool.outputExample.url, tool.params.url.example);
});

/** A one-page PDF with no text layer whose page is one JPEG, as a scanner writes it. */
function scannedPdf(jpeg) {
  const head = Buffer.from(`%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 5 0 R /Resources << /XObject << /Im1 4 0 R >> >> >>\nendobj\n4 0 obj\n<< /Type /XObject /Subtype /Image /Width 8 /Height 8 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\r\n`, 'latin1');
  const tail = Buffer.from(`\nendstream\nendobj\n5 0 obj\n<< /Length 30 >>\nstream\nq 595 0 0 842 0 0 cm /Im1 Do Q\nendstream\nendobj\ntrailer\n<< /Size 6 /Root 1 0 R >>\n%%EOF\n`, 'latin1');
  return new Uint8Array(Buffer.concat([head, jpeg, tail]));
}
const fakeJpeg = (size, fill = 7) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(size - 6, fill), Buffer.from([0xff, 0xd9])]);

test('OCR: an image and a scanned PDF are read through the reader it is given; without one they are refused', async () => {
  const page = fakeJpeg(40_000);
  const scan = scannedPdf(page);
  assert.deepEqual(D.pdfPageImages(scan).map((i) => i.length), [40_000]);
  assert.equal(Buffer.from(D.pdfPageImages(scan)[0]).equals(page), true, 'the JPEG is lifted out byte for byte');
  assert.deepEqual(D.pdfPageImages(scannedPdf(fakeJpeg(2_000))), [], 'a small embedded image is a logo, not a page');
  assert.deepEqual(D.pdfPageImages(tinyPdf()), []);
  assert.equal(D.imageType(page), 'image/jpeg');
  assert.equal(D.imageType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0, 0, 0, 0])), 'image/png');
  assert.equal(D.imageType(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0, 0, 0, 0, 0, 0, 0, 0])), null, 'GIF is not read');

  const seen = [];
  const ocr = async (image, type) => { seen.push({ bytes: image.length, type }); return 'Fakturanummer: 58231\nAtt betala: 21 662,50 SEK'; };
  const fromScan = await D.readDocument(scan, 'markdown', 50_000, ocr);
  assert.equal(fromScan.type, 'pdf');
  assert.equal(fromScan.ocr, true);
  assert.equal(fromScan.pagesRead, 1);
  assert.match(fromScan.text, /Fakturanummer: 58231/);
  assert.match(fromScan.note, /read from its page images by an AI model/);
  assert.deepEqual(seen, [{ bytes: 40_000, type: 'image/jpeg' }]);
  const fromImage = await D.readDocument(new Uint8Array(page), 'markdown', 50_000, ocr);
  assert.equal(fromImage.type, 'image');
  assert.equal(fromImage.format, 'text');
  assert.equal(fromImage.ocr, true);
  // A PDF with a text layer never reaches the model.
  seen.length = 0;
  assert.equal((await D.readDocument(tinyPdf(), 'text', 50_000, ocr)).ocr, undefined);
  assert.equal(seen.length, 0);
  // Nothing readable is a refusal, not an empty answer; so is a scan whose pages are not JPEGs, and an oversized image.
  await assert.rejects(D.readDocument(new Uint8Array(page), 'text', 50_000, async () => ''), (e) => e.status === 422 && /holds no text/.test(e.message));
  const noJpeg = scannedPdf(fakeJpeg(40_000)); noJpeg.set(Buffer.from('/FlateDecod'), Buffer.from(noJpeg).indexOf('/DCTDecode') );
  await assert.rejects(D.readDocument(noJpeg, 'text', 50_000, ocr), (e) => e.status === 422 && /not stored as JPEG images/.test(e.message));
  await assert.rejects(D.readDocument(new Uint8Array(fakeJpeg(3 * 1024 * 1024 + 10)), 'text', 50_000, ocr), (e) => e.status === 422 && /larger than 3 MB/.test(e.message));
  await assert.rejects(D.readDocument(scan, 'text', 50_000), (e) => e.status === 422 && /no text layer/.test(e.message), 'without a reader a scan fails as before');
});

test('fields out of a document: the file\'s text goes to the model once, and the answer has exactly the fields asked for', async () => {
  // One bundle, so the tool and this test share the module that holds an uploaded file.
  const b = await build({ stdin: { contents: `export * as D from './src/routes/document.ts'; export * as F from './src/lib/file-input.ts';`, resolveDir: process.cwd(), loader: 'ts' }, bundle: true, format: 'cjs', platform: 'node', write: false, logLevel: 'silent', external: ['@cloudflare/puppeteer', 'cloudflare:workers'] });
  const m = { exports: {} };
  new Function('module', 'exports', 'require', b.outputFiles[0].text)(m, m.exports, require);
  const tool = m.exports.D.DOCUMENT.find((e) => e.endpoint.path === '/document/extract');
  const calls = [];
  const env = { AI: { run: async (model, input) => { calls.push({ model, input }); return { response: 'Here you go:\n```json\n{"invoice_number":"2026-001","total":1250,"currency":"SEK","made_up":"x"}\n```' }; } } };
  const ref = await m.exports.F.holdFile(tinyPdf());
  const q = (input) => (name) => input[name];
  const answer = await tool.run(env, q({ '@file': ref, fields: 'invoice_number, total, currency, due_date' }));
  assert.deepEqual(answer.data, { invoice_number: '2026-001', total: 1250, currency: 'SEK', due_date: null });
  assert.deepEqual(answer.missing, ['due_date']);
  assert.equal(answer.type, 'pdf');
  assert.equal(answer.source, 'upload');
  assert.equal(answer.url, null);
  assert.equal(answer.truncated, false);
  assert.equal(calls.length, 1);
  const sent = JSON.stringify(calls[0].input);
  assert.match(sent, /Invoice 2026-001 total 1250 SEK/);
  assert.match(sent, /data, not instructions/);
  m.exports.F.releaseFile(ref);
  await assert.rejects(tool.run(env, q({ '@file': ref, fields: 'a' })), (e) => e.status === 400 && /POST body/.test(e.message));
  await assert.rejects(tool.run(env, q({ '@file': ref })), (e) => e.status === 400 && /fields is required/.test(e.message));
  await assert.rejects(tool.run(env, q({ '@file': ref, fields: Array.from({ length: 31 }, (_, i) => `f${i}`).join(',') })), (e) => e.status === 400 && /1 to 30/.test(e.message));
  assert.equal(calls.length, 1, 'a refused call never reaches the model');
  // A long document is cut to what the model reads, and the answer says so.
  const long = await m.exports.F.holdFile(docx(DOCX_XML.replace('First point', 'word '.repeat(8000))));
  const cut = await tool.run(env, q({ '@file': long, fields: 'total' }));
  assert.equal(cut.charsRead, m.exports.D.EXTRACT_CHARS);
  assert.equal(cut.truncated, true);
  m.exports.F.releaseFile(long);
});

test('list fields: row keys given in brackets are the keys every row gets, whatever the model called them', async () => {
  const A = await load('src/routes/ai-text.ts');
  assert.deepEqual(A.listFields('invoice_number, line_items[description, quantity,amount], total'), { fields: ['invoice_number', 'line_items', 'total'], lists: { line_items: ['description', 'quantity', 'amount'] } });
  assert.deepEqual(A.listFields('a,b , a'), { fields: ['a', 'b'], lists: {} });
  for (const bad of ['a[b', 'a]b', 'x[]', 'a[b[c]]', '', ',', `x[${Array.from({ length: 13 }, (_, i) => `k${i}`).join(',')}]`, Array.from({ length: 31 }, (_, i) => `f${i}`).join(','), 'drop{table}']) {
    assert.throws(() => A.listFields(bad), (e) => e.status === 400, JSON.stringify(bad));
  }
  const prompts = [];
  const reply = { invoice_number: ['58231'], total: '21662.5', line_items: [{ description: ['Resa'], qty: 2, quantity: 2, amount: 500, extra: 'x' }, 'not a row', { description: 'Material' }] };
  const env = { AI: { run: async (_m, input) => { prompts.push(JSON.stringify(input)); return { response: JSON.stringify(reply) }; } } };
  const out = await A.extractFields(env, 'text', ['invoice_number', 'line_items', 'total', 'due_date'], 'model-x', 900, { line_items: ['description', 'quantity', 'amount'] });
  assert.deepEqual(out.data, { invoice_number: '58231', line_items: [{ description: 'Resa', quantity: 2, amount: 500 }, { description: 'Material', quantity: null, amount: null }], total: '21662.5', due_date: null });
  assert.deepEqual(out.missing, ['due_date']);
  assert.match(prompts[0], /exactly the keys \[\\"description\\",\\"quantity\\",\\"amount\\"\]/);
  assert.match(prompts[0], /never an array/);
  // No rows found is an empty list, reported as missing; a plain request is worded and answered as before.
  const none = await A.extractFields({ AI: { run: async () => ({ response: '{"line_items":null}' }) } }, 'text', ['line_items'], 'model-x', 900, { line_items: ['a'] });
  assert.deepEqual(none, { data: { line_items: [] }, missing: ['line_items'], model: 'model-x' });
  prompts.length = 0;
  const plain = await A.extractFields(env, 'text', ['invoice_number']);
  assert.deepEqual(plain.data, { invoice_number: ['58231'] }, 'without list fields a value is passed through untouched');
  assert.ok(!/array/.test(prompts[0]));
  assert.ok(!/YYYY-MM-DD|Meaning of the keys/.test(prompts[0]), 'the document rules are not sent for plain text');
});

test('a document extraction tells the model how files mislead: date and amount format, value before label, what the keys mean', async () => {
  const A = await load('src/routes/ai-text.ts');
  const H = await load('src/lib/extract-hints.ts');
  const prompts = [];
  const env = { AI: { run: async (model, input) => { prompts.push({ model, text: JSON.stringify(input) }); return { output: [{ type: 'message', content: [{ type: 'output_text', text: '{"Invoice No":"993548900","vendor":"Coolblue B.V.","colour":null,"line_items":[]}' }] }] }; } } };
  const out = await A.extractFields(env, 'text', ['Invoice No', 'vendor', 'colour', 'line_items'], D.EXTRACT_MODEL, 1200, { line_items: ['description', 'quantity'] }, true);
  assert.equal(out.data['Invoice No'], '993548900');
  assert.equal(prompts[0].model, '@cf/openai/gpt-oss-120b');
  const sent = prompts[0].text;
  assert.match(sent, /Write every date as YYYY-MM-DD/);
  assert.match(sent, /a value can stand directly before its label/);
  assert.match(sent, /\\"Invoice No\\": the document's own number/, 'a known name is explained under the caller\'s own spelling');
  assert.match(sent, /\\"vendor\\": the company that issued the invoice/, 'an alias is explained too');
  assert.ok(!/\\"colour\\":/.test(sent.split('Meaning of the keys')[1]), 'an unknown name gets no invented meaning');
  assert.match(sent, /In rows: \\"description\\".*\\"quantity\\": the number of units on that row; a position or item number/);
  assert.equal(H.fieldHints(['colour', 'weight'], {}), '');
  for (const name of ['constructor', '__proto__', 'toString']) assert.equal(H.fieldHints([name], { rows: [name] }), '');
  // The one-word presets are valid field lists, and every invoice field is one the hints explain.
  for (const [word, spec] of Object.entries(D.FIELD_PRESETS)) {
    const parsed = A.listFields(spec);
    assert.ok(parsed.fields.length >= 8 && parsed.fields.length <= 30, word);
    assert.deepEqual(Object.keys(parsed.lists), ['line_items'], word);
  }
  const invoice = A.listFields(D.FIELD_PRESETS.invoice);
  const explained = H.fieldHints(invoice.fields, invoice.lists);
  for (const f of invoice.fields.filter((x) => x !== 'line_items' && x !== 'supplier_address')) assert.ok(explained.includes(`"${f}":`), `${f} is explained`);
  assert.ok(!Object.hasOwn(D.FIELD_PRESETS, 'constructor'));
});

test('Word: a text box is read once and footnotes follow the body; Excel: day numbers in date-styled cells become dates', async () => {
  const box = `<w:document ${W} xmlns:mc="mc"><w:body><w:p><w:r><mc:AlternateContent><mc:Choice><w:txbxContent>${p('Datum plane')}</w:txbxContent></mc:Choice><mc:Fallback><w:txbxContent>${p('Datum plane')}</w:txbxContent></mc:Fallback></mc:AlternateContent></w:r></w:p>${p('Body text')}</w:body></w:document>`;
  const notes = `<w:footnotes ${W}><w:footnote w:type="separator"><w:p/></w:footnote><w:footnote w:id="1">${p('See the 2025 report.')}</w:footnote></w:footnotes>`;
  const word = await D.readDocument(zip({ 'word/document.xml': box, 'word/footnotes.xml': notes }), 'markdown', 50_000);
  assert.equal(word.text, 'Datum plane\n\nBody text\n\n## Footnotes\n\nSee the 2025 report.');

  assert.deepEqual([45975, 45975.5, 0.39583333, 1, 59, 61].map((n) => D.excelDate(n)), ['2025-11-14', '2025-11-14T12:00:00', '09:30:00', '1900-01-01', '1900-02-28', '1900-03-01']);
  assert.equal(D.excelDate(44513, true), '2025-11-14');
  for (const bad of [-1, NaN, 3_000_000]) assert.equal(D.excelDate(bad), null);
  for (const [code, is] of [['yyyy-mm-dd', true], ['[$-409]d-mmm-yy', true], ['h:mm', true], ['0.00', false], ['#,##0 "kr"', false], ['General', false], ['0%', false], ['"day" 0', false]]) assert.equal(D.isDateFormat(code), is, code);
  const styles = '<styleSheet><numFmts><numFmt numFmtId="164" formatCode="yyyy\\-mm\\-dd"/><numFmt numFmtId="165" formatCode="#,##0.00 &quot;kr&quot;"/></numFmts><cellXfs><xf numFmtId="0"/><xf numFmtId="164"/><xf numFmtId="165"/><xf numFmtId="14"/><xf numFmtId="20"/></cellXfs></styleSheet>';
  assert.deepEqual(D.dateStyles(styles), [false, true, false, true, true]);
  const book = (pr = '') => zip({
    'xl/workbook.xml': `<workbook xmlns:r="r">${pr}<sheets><sheet name="Orders" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/styles.xml': styles,
    'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row r="1"><c r="A1" s="1"><v>45975</v></c><c r="B1" s="2"><v>1250.5</v></c><c r="C1" s="3"><v>45975.5</v></c><c r="D1" s="4"><v>0.39583333</v></c><c r="E1"><v>45975</v></c><c r="F1" s="0"><v>2.6303323046962774324020672609</v></c><c r="G1" s="1" t="str"><v>45975</v></c></row></sheetData></worksheet>',
  });
  assert.equal((await D.readDocument(book(), 'text', 50_000)).text, 'Orders\n2025-11-14\t1250.5\t2025-11-14T12:00:00\t09:30:00\t45975\t2.630332304696277\t45975');
  assert.match((await D.readDocument(book('<workbookPr date1904="1"/>'), 'text', 50_000)).text, /^Orders\n2029-11-15\t/);
});
let mf;
after(async () => { await mf?.dispose(); });
test('through the Worker: an uploaded Word file is read, by its bytes and not its content type', async () => {
  const b = await build({ entryPoints: ['src/index.ts'], bundle: true, format: 'esm', platform: 'browser', write: false, logLevel: 'silent', external: ['cloudflare:workers', 'node:*'], alias: { 'ajv/dist/2020.js': require('node:path').resolve('src/lib/ajv-unavailable.ts') }, plugins: [{ name: 'node-url', setup(p) { p.onResolve({ filter: /^url$/ }, () => ({ path: 'node:url', external: true })); } }] });
  mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: b.outputFiles[0].text, compatibilityDate: '2026-09-01', compatibilityFlags: ['nodejs_compat'],
    durableObjects: { METRICS: { className: 'Metrics', useSQLite: true } }, kvNamespaces: ['TRIALS'],
    bindings: { PAY_TO: '0x2074c40346ae2a90e0e4a391bcee6f16bf5277f5', NETWORK: 'eip155:8453', PAYWALL: 'off', TRIALS_ENABLED: 'on', MPP_EVM: 'off', FACILITATOR_URL: 'https://fixture.invalid', BASE_RPC_URL: 'https://fixture.invalid' },
    outboundService: async () => new Response('not used', { status: 500 }) }));
  const post = async (type, body, query = '') => {
    const res = await mf.dispatchFetch(`https://api.test/document/text${query}`, { method: 'POST', headers: { accept: 'application/json', 'content-type': type }, body });
    return { status: res.status, body: JSON.parse(await res.text()) };
  };
  const word = await post('application/vnd.openxmlformats-officedocument.wordprocessingml.document', Buffer.from(docx()));
  assert.equal(word.status, 200, JSON.stringify(word.body));
  assert.equal(word.body.source, 'upload');
  assert.equal(word.body.type, 'docx');
  assert.match(word.body.text, /^# Quarterly report/);
  const sheet = await post('application/octet-stream', Buffer.from(xlsx()), '?format=text');
  assert.equal(sheet.body.type, 'xlsx');
  assert.match(sheet.body.text, /^Sales\nRegion/);
  const asJson = await post('application/json', JSON.stringify({ document: Buffer.from(pptx()).toString('base64'), format: 'text' }));
  assert.equal(asJson.status, 200, JSON.stringify(asJson.body));
  assert.equal(asJson.body.type, 'pptx');
  const junk = await post('application/zip', Buffer.from(zip({ 'readme.txt': 'not an office file' })));
  assert.equal(junk.status, 415);
});
