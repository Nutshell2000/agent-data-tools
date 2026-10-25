const assert = require('node:assert/strict');
const { test } = require('node:test');
const { build } = require('esbuild');

async function load() {
  const b = await build({ entryPoints: ['src/routes/gov-more.ts'], bundle: true, format: 'cjs', platform: 'node', write: false, logLevel: 'silent' });
  const m = { exports: {} };
  new Function('module', 'exports', 'require', b.outputFiles[0].text)(m, m.exports, require);
  return m.exports;
}

const FORM4 = `<?xml version="1.0"?><ownershipDocument><reportingOwner><reportingOwnerId><rptOwnerName>Doe Jane</rptOwnerName></reportingOwnerId>
<reportingOwnerRelationship><isDirector>1</isDirector><isOfficer>true</isOfficer><officerTitle>CFO</officerTitle><isTenPercentOwner>false</isTenPercentOwner></reportingOwnerRelationship></reportingOwner>
<aff10b5One>true</aff10b5One><nonDerivativeTable>
<nonDerivativeTransaction><securityTitle><value>Common Stock</value></securityTitle><transactionDate><value>2026-10-20</value></transactionDate>
<transactionCoding><transactionCode>S</transactionCode></transactionCoding><transactionAmounts><transactionShares><value>1000</value></transactionShares><transactionPricePerShare><value>250.5</value></transactionPricePerShare><transactionAcquiredDisposedCode><value>D</value></transactionAcquiredDisposedCode></transactionAmounts>
<postTransactionAmounts><sharesOwnedFollowingTransaction><value>9000</value></sharesOwnedFollowingTransaction></postTransactionAmounts></nonDerivativeTransaction>
<nonDerivativeTransaction><securityTitle><value>Common Stock</value></securityTitle><transactionDate><value>2026-10-21</value></transactionDate>
<transactionCoding><transactionCode>A</transactionCode></transactionCoding><transactionAmounts><transactionShares><value>500</value></transactionShares><transactionPricePerShare><value>0</value></transactionPricePerShare><transactionAcquiredDisposedCode><value>A</value></transactionAcquiredDisposedCode></transactionAmounts>
<postTransactionAmounts><sharesOwnedFollowingTransaction><value>9500</value></sharesOwnedFollowingTransaction></postTransactionAmounts></nonDerivativeTransaction>
</nonDerivativeTable></ownershipDocument>`;

test('Form 4: insider, role, plan flag and each trade with its meaning and dollar value', async () => {
  const { parseForm4 } = await load();
  const f = parseForm4(FORM4);
  assert.equal(f.insider, 'Doe Jane');
  assert.equal(f.role, 'director, CFO');
  assert.equal(f.plan10b5_1, true);
  assert.deepEqual(f.transactions[0], { date: '2026-10-20', security: 'Common Stock', code: 'S', meaning: 'open-market sale', acquiredOrDisposed: 'disposed', shares: 1000, price: 250.5, valueUsd: 250500, sharesOwnedAfter: 9000 });
  assert.equal(f.transactions[1].meaning, 'grant or award');
  assert.equal(f.transactions[1].price, null);
  assert.equal(f.transactions[1].valueUsd, null);
});

test('13F: rows summed by CUSIP and put/call, largest first, with weights; namespaced XML works', async () => {
  const { parse13F, ITEMS_8K } = await load();
  const row = (name, cusip, value, shares, putCall = '') => `<ns1:infoTable><ns1:nameOfIssuer>${name}</ns1:nameOfIssuer><ns1:titleOfClass>COM</ns1:titleOfClass><ns1:cusip>${cusip}</ns1:cusip><ns1:value>${value}</ns1:value><ns1:shrsOrPrnAmt><ns1:sshPrnamt>${shares}</ns1:sshPrnamt><ns1:sshPrnamtType>SH</ns1:sshPrnamtType></ns1:shrsOrPrnAmt>${putCall ? `<ns1:putCall>${putCall}</ns1:putCall>` : ''}</ns1:infoTable>`;
  const xml = `<ns1:informationTable>${row('APPLE INC', '037833100', 600, 6)}${row('APPLE INC', '037833100', 150, 1)}${row('COCA COLA CO', '191216100', 250, 10)}${row('APPLE INC', '037833100', 0, 1, 'Put')}</ns1:informationTable>`;
  const p = parse13F(xml);
  assert.equal(p.positions, 3);
  assert.equal(p.totalValueUsd, 1000);
  assert.deepEqual(p.holdings[0], { issuer: 'APPLE INC', class: 'COM', cusip: '037833100', valueUsd: 750, shares: 7, putCall: null, weightPct: 75 });
  assert.equal(p.holdings[1].issuer, 'COCA COLA CO');
  assert.equal(p.holdings[2].putCall, 'Put');
  assert.equal(ITEMS_8K['2.02'], 'Results of operations and financial condition');
  assert.equal(ITEMS_8K['1.05'], 'Material cybersecurity incident');
});

test('government data tools: names within 32 characters, descriptions within 450, "Use" guidance', async () => {
  const { GOV_MORE } = await load();
  assert.deepEqual(GOV_MORE.map((e) => e.endpoint.path), ['/sec/8k', '/sec/insider', '/sec/13f', '/gov/federal-register', '/gov/clinical-trials']);
  for (const { endpoint: e } of GOV_MORE) {
    assert.ok(e.summary.split(':')[0].length <= 32, e.summary);
    assert.ok(e.description.length <= 450, `${e.path} ${e.description.length}`);
    assert.match(e.description, /(^|\. )Use (when|to|for|before|as) /, e.path);
  }
});
