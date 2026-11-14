// E-invoice tools (/einvoice/create, /einvoice/validate, /einvoice/to-json): the reader, the writers and the rule
// check, on the official XRechnung test-suite invoices in tests/fixtures/einvoice. No network.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { before, test } = require('node:test');
const { build } = require('esbuild');

async function load(entry) {
  const b = await build({ entryPoints: [entry], bundle: true, format: 'cjs', platform: 'node', write: false, logLevel: 'silent', external: ['@cloudflare/puppeteer', 'cloudflare:workers'] });
  const m = { exports: {} };
  const req = (id) => (id === '@cloudflare/puppeteer' ? { default: {} } : id === 'cloudflare:workers' ? { DurableObject: class {} } : require(id));
  new Function('module', 'exports', 'require', b.outputFiles[0].text)(m, m.exports, req);
  return m.exports;
}
const fixture = (name) => fs.readFileSync(path.join(__dirname, 'fixtures', 'einvoice', name), 'utf8');

let P, V, W, M, route;
before(async () => {
  P = await load('src/lib/einvoice/parse.ts');
  V = await load('src/lib/einvoice/validate.ts');
  W = await load('src/lib/einvoice/write.ts');
  M = await load('src/lib/einvoice/model.ts');
  route = await load('src/routes/einvoice.ts');
});

const SAMPLES = ['xrechnung-01.01a-cii.xml', 'xrechnung-01.01a-ubl.xml', 'xrechnung-01.05a-cii.xml'];
const PLAIN = {
  number: 'RE-1', date: '14.11.2026', dueDate: '2026-12-14', buyerReference: '04011000-12345-06',
  seller: { name: 'Muster GmbH', vatId: 'de 123 456 789', street: 'Hauptstr. 1', city: 'Berlin', postCode: '10115', contactName: 'E. Muster', phone: '+49 30 1234567', email: 'rechnung@muster.example' },
  buyer: { name: 'Kunde AG', street: 'Marktplatz 5', city: 'Hamburg', postCode: '20095', country: 'de' },
  lines: [{ name: 'Beratung', quantity: 8, unit: 'hours', unitPrice: 120, vatRate: 19 }, { name: 'Lizenz', unitPrice: '49,90', vatRate: 19 }, { name: 'Buch', quantity: 2, unitPrice: 10, vatRate: 7 }],
  payment: { iban: 'DE02 1203 0000 0000 2020 51' },
};
const rules = (v) => [...v.errors, ...v.warnings].map((f) => f.rule);

test('the official XRechnung sample invoices read and pass every rule that runs', () => {
  for (const name of SAMPLES) {
    const { syntax, invoice } = P.readInvoice(fixture(name));
    assert.equal(syntax, name.includes('ubl') ? 'UBL' : 'CII', name);
    assert.equal(P.profileName(invoice.specification), 'XRechnung 3.0', name);
    const v = V.validateInvoice(invoice);
    assert.equal(v.profile, 'xrechnung');
    assert.deepEqual(rules(v), [], name);
    assert.ok(invoice.lines.length >= 2 && invoice.totals.grand > 0 && invoice.seller.name && invoice.payment.iban, name);
  }
});

test('the same business case reads the same from CII and from UBL', () => {
  const a = P.readInvoice(fixture('xrechnung-01.01a-cii.xml')).invoice, b = P.readInvoice(fixture('xrechnung-01.01a-ubl.xml')).invoice;
  for (const k of ['number', 'issueDate', 'currency', 'buyerReference', 'totals', 'vat']) assert.deepEqual(a[k], b[k], k);
  assert.deepEqual(a.lines.map((l) => [l.quantity, l.unitPrice, l.netAmount, l.vatRate]), b.lines.map((l) => [l.quantity, l.unitPrice, l.netAmount, l.vatRate]));
});

test('a sample written back out reads back identical, in the schema order of the original', () => {
  const order = (node, map = new Map()) => {
    const seq = [];
    for (const k of node.kids) { if (seq[seq.length - 1] !== k.name) seq.push(k.name); order(k, map); }
    if (seq.length) map.set(node.name, [...(map.get(node.name) ?? []), seq]);
    return map;
  };
  for (const name of SAMPLES) {
    const xml = fixture(name);
    const { syntax, invoice } = P.readInvoice(xml);
    const out = W.writeInvoice(invoice, syntax === 'CII' ? 'xrechnung' : 'xrechnung-ubl');
    assert.deepEqual(P.readInvoice(out).invoice, invoice, name);
    const ref = order(P.parseXml(xml));
    for (const [parent, seqs] of order(P.parseXml(out))) for (const seq of seqs) for (const r of ref.get(parent) ?? []) {
      const shared = seq.filter((n) => r.includes(n));
      assert.equal(shared.join(), r.filter((n) => shared.includes(n)).join(), `${name}: children of ${parent}`);
    }
  }
});

test('plain JSON becomes a valid file in all four formats, with the sums computed', () => {
  for (const format of W.FORMATS) {
    const made = route.createEinvoice(PLAIN, format);
    assert.deepEqual(made.invoice.totals, { lineNet: 1029.9, taxBasis: 1029.9, tax: 193.28, grand: 1223.18, payable: 1223.18 }, format);
    assert.equal(made.invoice.vat.length, 2);
    assert.equal(made.invoice.seller.vatId, 'DE123456789');
    assert.equal(made.invoice.seller.country, 'DE', 'country from the VAT number');
    assert.equal(made.invoice.lines[0].unit, 'HUR');
    assert.equal(made.invoice.payment.meansCode, '58');
    const back = P.readInvoice(made.xml);
    assert.equal(back.syntax, format.includes('ubl') ? 'UBL' : 'CII');
    assert.deepEqual(rules(V.validateInvoice(back.invoice)), [], format);
    assert.equal(P.profileName(back.invoice.specification), format.startsWith('xrechnung') ? 'XRechnung 3.0' : 'EN 16931');
    assert.equal(back.invoice.issueDate, '2026-11-14');
  }
  assert.equal(route.createEinvoice(PLAIN, 'zugferd').filename, 'factur-x.xml');
});

test('the flat fields an invoice reader returns are accepted', () => {
  const inv = M.fromInput({ invoice_number: '993548900', invoice_date: '2014-04-19', seller_name: 'Coolblue B.V.', seller_vat_number: 'NL810433941B01', seller_address: 'Weena 664, Rotterdam', buyer_name: 'A', iban: 'NL50INGB0683251309',
    net_amount: 593.36, vat_amount: 124.61, total_amount: 717.97, vatRate: 21, line_items: [{ description: 'Laptop', quantity: 1, amount: 593.36 }] });
  assert.equal(inv.number, '993548900');
  assert.equal(inv.seller.country, 'NL');
  assert.equal(inv.lines[0].unitPrice, 593.36);
  assert.deepEqual(inv.totals, { lineNet: 593.36, taxBasis: 593.36, tax: 124.61, grand: 717.97, payable: 717.97 });
});

test('data that breaks a rule is refused with the rule numbers and no file', () => {
  assert.throws(() => route.createEinvoice({ number: 'X', seller: { name: 'A' }, lines: [] }, 'xrechnung'), (e) => e.status === 422 && e.code === 'EINVOICE_INVALID' && /BR-16/.test(e.message) && /BR-DE-2/.test(e.message) && /18 rule/.test(e.message));
  // The same data without the German additions needs no buyer reference.
  const { buyerReference, ...noRef } = PLAIN;
  assert.throws(() => route.createEinvoice(noRef, 'xrechnung'), /BR-DE-15/);
  assert.ok(route.createEinvoice(noRef, 'zugferd').xml.includes('CrossIndustryInvoice'));
  assert.throws(() => route.createEinvoice({ ...PLAIN, typeCode: '381' }, 'ubl'), /credit note/);
});

test('wrong sums, a missing reason and a bad IBAN are each found under their own rule', () => {
  const base = () => P.readInvoice(fixture('xrechnung-01.01a-cii.xml')).invoice;
  let inv = base(); inv.totals.grand += 1;
  assert.deepEqual(rules(V.validateInvoice(inv)).sort(), ['BR-CO-15', 'BR-CO-16'].filter((r) => r !== 'BR-CO-16' || Math.abs(inv.totals.grand - inv.totals.payable) >= 1).sort());
  inv = base(); inv.vat[0].tax += 0.5;
  assert.ok(rules(V.validateInvoice(inv)).includes('BR-CO-17') && rules(V.validateInvoice(inv)).includes('BR-CO-14'));
  inv = base(); inv.lines[0].netAmount += 10;
  assert.ok(rules(V.validateInvoice(inv)).includes('BR-CO-10') && rules(V.validateInvoice(inv)).includes('BR-S-08'));
  inv = base(); inv.lines[0].vatCategory = 'AE'; inv.lines[0].vatRate = 0;
  const ae = rules(V.validateInvoice(inv));
  assert.ok(ae.includes('BR-AE-01') && ae.includes('BR-AE-02'), ae.join());
  inv = base(); inv.payment.iban = 'DE00000000000000000000';
  assert.deepEqual(rules(V.validateInvoice(inv)), ['BR-DE-19']);
  inv = base(); delete inv.buyerReference; delete inv.seller.phone;
  assert.deepEqual(rules(V.validateInvoice(inv)).sort(), ['BR-DE-15', 'BR-DE-6']);
  assert.deepEqual(rules(V.validateInvoice(inv, { xrechnung: false })), []);
  assert.ok(V.ibanValid('DE02120300000000202051') && !V.ibanValid('DE02120300000000202052'));
});

test('every rule has an id, a field, a sentence and a fix, and ids are unique', () => {
  const ids = new Set();
  for (const r of V.RULES) {
    assert.match(r.id, /^BR-[A-Z0-9-]+(-[ab])?$/i, r.id);
    assert.ok(!ids.has(r.id), `duplicate ${r.id}`); ids.add(r.id);
    assert.ok(r.field && r.rule.length > 20 && r.fix.length > 10 && /\.$/.test(r.rule), r.id);
    assert.equal(V.ruleDoc(r.id.toLowerCase()), r);
  }
  assert.ok(ids.size >= 100);
});

test('what is not an e-invoice is refused plainly', () => {
  assert.throws(() => P.readInvoice('<!DOCTYPE x [<!ENTITY a SYSTEM "file:///etc/passwd">]><x>&a;</x>'), /DOCTYPE/);
  assert.throws(() => P.readInvoice('<html><body>hi</body></html>'), /root element is <html>/);
  assert.throws(() => P.readInvoice('<a><b></a>'), /not well-formed/);
});

test('the tools are listed with their inputs and the long fields travel as references', async () => {
  const E = await load('src/endpoints.ts'), L = await load('src/lib/long-input.ts'), F = await load('src/lib/file-input.ts');
  for (const p of ['/einvoice/create', '/einvoice/validate', '/einvoice/to-json']) {
    const e = E.ENDPOINTS.find((x) => x.path === p);
    assert.ok(e && e.description.length <= 600 && e.tags.length >= 5, p);
    assert.ok(L.LONG_INPUT_FIELDS[p], p);
  }
  assert.ok(F.FILE_INPUT_PATHS['/einvoice/validate'] && F.FILE_INPUT_PATHS['/einvoice/to-json']);
  JSON.parse(route.EXAMPLE_INVOICE_JSON);
  assert.ok(route.createEinvoice(JSON.parse(route.EXAMPLE_INVOICE_JSON), 'xrechnung').validation.valid);
});

test('the XML inside an official ZUGFeRD / Factur-X PDF is found, read and valid', async () => {
  const X = await load('src/lib/einvoice/pdf-xml.ts');
  const pdf = new Uint8Array(fs.readFileSync(path.join(__dirname, 'fixtures', 'einvoice', 'zugferd-en16931-einfach.pdf')));
  const xml = await X.embeddedInvoiceXml(pdf);
  assert.ok(xml && xml.includes('CrossIndustryInvoice'));
  const { syntax, invoice } = P.readInvoice(xml);
  assert.equal(syntax, 'CII');
  assert.equal(P.profileName(invoice.specification), 'EN 16931');
  assert.equal(invoice.totals.grand, 529.87);
  assert.deepEqual(rules(V.validateInvoice(invoice)), []);
  // A PDF without an embedded invoice gives null, not an error.
  assert.equal(await X.embeddedInvoiceXml(new TextEncoder().encode('%PDF-1.4\n1 0 obj\n<< /Length 5 >>\nstream\nhello\nendstream\nendobj\n%%EOF')), null);
});
