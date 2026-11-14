// 1.177.0 (14 Nov 2026): /vat/validate answers with VIES's own earlier check when VIES stays busy, and
// /polymarket/orderbook retries the CLOB once and then answers a book read in the last two minutes.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { build } = require('esbuild');

async function load(entry) {
  const b = await build({ entryPoints: [entry], bundle: true, format: 'cjs', platform: 'node', write: false, logLevel: 'silent' });
  const m = { exports: {} };
  new Function('module', 'exports', 'require', b.outputFiles[0].text)(m, m.exports, require);
  return m.exports;
}
const memoryStore = () => {
  const stored = new Map();
  return { stored, match: async (k) => (stored.has(k) ? new Response(stored.get(k)) : undefined), put: async (k, res) => { stored.set(k, await res.text()); } };
};
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

test('vat: a clear answer is kept for a week; a busy VIES later gets that answer, marked as an earlier check', async () => {
  const { viesCheck, VIES_KEEP_SECONDS } = await load('src/routes/registries.ts');
  assert.equal(VIES_KEEP_SECONDS, 7 * 86400);
  const parts = { country: 'SE', number: '556703748501' };
  const sleep = async () => {};
  const store = memoryStore();
  const first = await viesCheck(parts, async () => json({ isValid: true, userError: 'VALID', name: 'Spotify AB', address: 'X', requestDate: '2026-11-10T08:00:00.000Z' }), sleep, store);
  assert.equal(first.fromEarlierCheck, undefined);
  // The one-hour copy has expired; the week copy remains.
  for (const k of [...store.stored.keys()]) if (!k.includes('/kept/')) store.stored.delete(k);
  const busy = await viesCheck(parts, async () => json({ isValid: false, userError: 'MS_MAX_CONCURRENT_REQ' }), sleep, store);
  assert.equal(busy.valid, true);
  assert.equal(busy.name, 'Spotify AB');
  assert.equal(busy.checkedAt, '2026-11-10T08:00:00.000Z');
  assert.equal(busy.fromEarlierCheck, true);
  assert.match(busy.note, /MS_MAX_CONCURRENT_REQ/);
  // A number VIES has never answered for: still the uncharged 502.
  await assert.rejects(viesCheck({ country: 'DE', number: '123456789' }, async () => json({ isValid: false, userError: 'MS_MAX_CONCURRENT_REQ' }), sleep, store), (e) => e.status === 502);
  // A refusal that is not "busy" (bad input) never falls back to the earlier answer.
  for (const k of [...store.stored.keys()]) if (!k.includes('/kept/')) store.stored.delete(k);
  await assert.rejects(viesCheck(parts, async () => json({ isValid: false, userError: 'INVALID_INPUT' }, 400), sleep, store), (e) => e.status === 502);
});

test('polymarket: a failed CLOB read is tried again, then a book from the last two minutes is answered; 404 stays 404', async () => {
  const { clobBook, BOOK_KEEP_SECONDS } = await load('src/routes/polymarket.ts');
  const { HttpError } = await load('src/lib/env.ts');
  assert.equal(BOOK_KEEP_SECONDS, 120);
  const sleep = async () => {};
  const store = memoryStore();
  const book = { bids: [{ price: '0.5', size: '10' }], asks: [{ price: '0.51', size: '5' }], timestamp: '1794653513968', market: '0xabc' };
  // One 502, then the book.
  let calls = 0;
  const again = await clobBook('123456789012', async () => { if (++calls === 1) throw new HttpError(502, 'the data source answered HTTP 503; try again'); return book; }, sleep, store);
  assert.equal(calls, 2);
  assert.deepEqual(again, book);
  // Down twice: the kept book, marked.
  calls = 0;
  const kept = await clobBook('123456789012', async () => { calls++; throw new HttpError(502, 'the data source answered HTTP 500; try again'); }, sleep, store);
  assert.equal(calls, 2);
  assert.deepEqual(kept, { ...book, fromEarlierRead: true });
  // Nothing kept for another token: the 502.
  await assert.rejects(clobBook('999999999999', async () => { throw new HttpError(502, 'down'); }, sleep, store), (e) => e.status === 502);
  // A closed market (404) is answered at once, not replaced by a kept book.
  calls = 0;
  await assert.rejects(clobBook('123456789012', async () => { calls++; throw new HttpError(404, 'no order book'); }, sleep, store), (e) => e.status === 404);
  assert.equal(calls, 1);
});
