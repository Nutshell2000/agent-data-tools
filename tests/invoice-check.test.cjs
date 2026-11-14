// /invoice/check (1.180.0): the checks on extracted invoice data, with VIES replaced by a stub. No network, no model.
const assert = require('node:assert/strict');
const { before, test } = require('node:test');
const { build } = require('esbuild');

async function load(entry) {
  const b = await build({ entryPoints: [entry], bundle: true, format: 'cjs', platform: 'node', write: false, logLevel: 'silent', external: ['@cloudflare/puppeteer', 'cloudflare:workers'] });
  const m = { exports: {} };
  const req = (id) => (id === '@cloudflare/puppeteer' ? { default: {} } : id === 'cloudflare:workers' ? { DurableObject: class {} } : require(id));
  new Function('module', 'exports', 'require', b.outputFiles[0].text)(m, m.exports, req);
  return m.exports;
}

let mod, endpoints;
before(async () => {
  mod = await load('src/routes/invoice-check.ts');
  endpoints = await load('src/endpoints.ts');
});

const COOLBLUE = {
  invoice_number: '993548900', invoice_date: '19 april 2014', due_date: null, currency: 'EUR',
  seller_name: 'Coolblue B.V.', seller_vat_number: 'NL810433941B01', seller_address: 'Weena 664, 3012 CN Rotterdam', seller_country: 'Nederland',
  buyer_name: 'Pino Bluebird', buyer_vat_number: null, iban: 'NL50INGB0683251309', bic: 'INGBNL2A', payment_reference: null,
  net_amount: '€ 593,36', vat_amount: '€ 124,61', total_amount: '€ 717,97',
  line_items: [
    { description: 'Apple iPad Air Wifi 16 GB Zilver', quantity: 1, unit_price: 399, amount: 399 },
    { description: 'Decoded Leather Slim Cover', quantity: 1, unit_price: 69.99, amount: 69.99 },
    { description: 'Nintendo 3DS XL', quantity: 1, unit_price: 189, amount: 189 },
    { description: 'Nintendo AC-adapter', quantity: 1, unit_price: 14.99, amount: 14.99 },
    { description: 'Mario Kart 7 3DS', quantity: 1, unit_price: 44.99, amount: '€ 44,99' },
  ],
};
const viesOk = async (p) => ({ vat: p.country + p.number, country: p.country, number: p.number, valid: true, name: 'COOLBLUE B.V.', address: 'WEENA 00664, 3012CN ROTTERDAM' });

test('amount reads the usual invoice spellings', () => {
  const { amount } = mod;
  assert.equal(amount('€ 1.234,50'), 1234.5);
  assert.equal(amount('1,234.50'), 1234.5);
  assert.equal(amount('SEK 12,5'), 12.5);
  assert.equal(amount('1 000'), 1000);
  assert.equal(amount(593.36), 593.36);
  assert.equal(amount('n/a'), null);
  assert.equal(amount(null), null);
});

test('isoDate reads ISO, day-first and written dates, and refuses impossible ones', () => {
  const { isoDate } = mod;
  assert.equal(isoDate('2026-11-01'), '2026-11-01');
  assert.equal(isoDate('28/11/2022'), '2022-11-28');
  assert.equal(isoDate('07.05.2014'), '2014-05-07');
  assert.equal(isoDate('31/02/2026'), null);
  assert.equal(isoDate(''), null);
});

test('the published example is what invoiceChecks gives for the sample invoice', async () => {
  const r = await mod.invoiceChecks({ ...COOLBLUE, invoice_date: '2014-04-19' }, viesOk, '2026-11-14');
  const e = endpoints.ENDPOINTS.find((x) => x.path === '/invoice/check');
  assert.ok(e, '/invoice/check is in the catalog');
  assert.equal(r.verdict, e.outputExample.verdict);
  assert.deepEqual(r.checks, e.outputExample.checks);
  assert.equal(e.price, '$0.05');
});

test('a written date and comma decimals still pass', async () => {
  const r = await mod.invoiceChecks(COOLBLUE, viesOk, '2026-11-14');
  assert.equal(r.verdict, 'pass', JSON.stringify(r.checks));
});

test('an invalid VAT number, a bad IBAN or wrong sums fail', async () => {
  const bad = await mod.invoiceChecks({ ...COOLBLUE, seller_vat_number: 'NL000000000B00' }, async (p) => ({ vat: p.country + p.number, country: p.country, valid: false }), '2026-11-14');
  assert.equal(bad.verdict, 'fail');
  assert.equal(bad.checks.find((c) => c.check === 'seller_vat').status, 'fail');
  const iban = await mod.invoiceChecks({ ...COOLBLUE, iban: 'NL51INGB0683251309' }, viesOk, '2026-11-14');
  assert.equal(iban.checks.find((c) => c.check === 'iban').status, 'fail');
  const sums = await mod.invoiceChecks({ ...COOLBLUE, total_amount: 800 }, viesOk, '2026-11-14');
  assert.equal(sums.checks.find((c) => c.check === 'totals').status, 'fail');
  const dates = await mod.invoiceChecks({ ...COOLBLUE, invoice_date: '2026-11-10', due_date: '2026-11-01' }, viesOk, '2026-11-14');
  assert.equal(dates.checks.find((c) => c.check === 'dates').status, 'fail');
});

test('an IBAN from another country than the seller, or a different registered name, asks for review', async () => {
  const r = await mod.invoiceChecks({ ...COOLBLUE, iban: 'DE89370400440532013000' }, viesOk, '2026-11-14');
  assert.equal(r.verdict, 'review');
  assert.equal(r.checks.find((c) => c.check === 'iban').status, 'warn');
  const name = await mod.invoiceChecks({ ...COOLBLUE, seller_name: 'Acme Trading Ltd' }, viesOk, '2026-11-14');
  assert.equal(name.checks.find((c) => c.check === 'seller_vat').status, 'warn');
});

test('a busy VIES makes the check unavailable and the verdict review, never an error', async () => {
  const busy = async () => { const { HttpError } = await load('src/lib/env.ts'); throw new HttpError(502, 'VIES answered MS_MAX_CONCURRENT_REQ; the member state is busy'); };
  const r = await mod.invoiceChecks(COOLBLUE, busy, '2026-11-14');
  assert.equal(r.verdict, 'review');
  assert.equal(r.checks.find((c) => c.check === 'seller_vat').status, 'unavailable');
});

test('missing VAT number, IBAN and invoice number are listed, not guessed', async () => {
  const r = await mod.invoiceChecks({ total_amount: 10 }, viesOk, '2026-11-14');
  assert.equal(r.verdict, 'review');
  for (const c of ['seller_vat', 'iban', 'dates', 'invoice_number']) assert.equal(r.checks.find((x) => x.check === c).status, 'missing', c);
});

test('VAT numbers are read with the label words invoices glue to them (1.190.0, staging proof of 1.180.0)', async () => {
  const { cleanVat } = mod;
  assert.equal(cleanVat('NL810433941B01BTW'), 'NL810433941B01');
  assert.equal(cleanVat('NL810433941BTW'), 'NL810433941');
  assert.equal(cleanVat('BTW NL810433941B01'), 'NL810433941B01');
  assert.equal(cleanVat('USt-IdNr.: DE 232 446 240'), 'DE232446240');
  assert.equal(cleanVat('VAT No: SE556703748501'), 'SE556703748501');
  assert.equal(cleanVat('IE6388047V'), 'IE6388047V');
  assert.equal(cleanVat('IE1234567FA'), 'IE1234567FA');
  assert.equal(cleanVat('ESX1234567L'), 'ESX1234567L');
  assert.equal(cleanVat('TVA FR40303265045'), 'FR40303265045');
  const r = await mod.invoiceChecks({ ...COOLBLUE, seller_vat_number: 'NL810433941B01BTW' }, viesOk, '2026-11-14');
  assert.equal(r.checks.find((c) => c.check === 'seller_vat').status, 'pass');
  assert.equal(r.verdict, 'pass');
});
