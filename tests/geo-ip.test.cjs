const assert = require('node:assert/strict');
const { test, before, after } = require('node:test');
const { build } = require('esbuild');

let G;
const realFetch = globalThis.fetch;
let answer;
before(async () => {
  const b = await build({ entryPoints: ['src/routes/geo-ip.ts'], bundle: true, format: 'cjs', platform: 'node', write: false, logLevel: 'silent' });
  const m = { exports: {} };
  new Function('module', 'exports', 'require', b.outputFiles[0].text)(m, m.exports, require);
  G = m.exports;
  globalThis.fetch = async (url) => answer(String(url));
});
after(() => { globalThis.fetch = realFetch; });
const run = async (path, params = {}) => G.GEO_IP.find((f) => f.endpoint.path === path).run({}, (n) => params[n]);

test('distance: known city pairs, antipodes, same point, bearing and midpoint', async () => {
  const sl = await run('/geo/distance', { lat1: '59.3293', lon1: '18.0686', lat2: '51.5072', lon2: '-0.1276' });
  assert.ok(Math.abs(sl.km - 1434) < 5, `Stockholm-London ${sl.km}`);
  assert.equal(sl.compass, 'WSW');
  const ny = await run('/geo/distance', { lat1: '40.7128', lon1: '-74.0060', lat2: '34.0522', lon2: '-118.2437' });
  assert.ok(Math.abs(ny.km - 3936) < 10, `New York-Los Angeles ${ny.km}`);
  const anti = await run('/geo/distance', { lat1: '0', lon1: '0', lat2: '0', lon2: '180' });
  assert.ok(Math.abs(anti.km - Math.PI * 6371.0088) < 0.1);
  const same = await run('/geo/distance', { lat1: '10', lon1: '20', lat2: '10', lon2: '20' });
  assert.equal(same.km, 0);
  const east = await run('/geo/distance', { lat1: '0', lon1: '0', lat2: '0', lon2: '10' });
  assert.equal(east.bearing, 90);
  assert.deepEqual(east.midpoint, { lat: 0, lon: 5 });
  await assert.rejects(run('/geo/distance', { lat1: '91', lon1: '0', lat2: '0', lon2: '0' }), (e) => e.status === 400);
});

test('IP lookup: address checks before any request, private ranges refused', async () => {
  assert.equal(G.ipKind('8.8.8.8'), 4);
  assert.equal(G.ipKind('2a00:1450:4001:80b::200e'), 6);
  assert.equal(G.ipKind('256.1.1.1'), null);
  assert.equal(G.ipKind('1::2::3'), null);
  for (const ip of ['10.0.0.1', '192.168.1.1', '172.20.0.1', '127.0.0.1', '100.64.1.1', '169.254.1.1', '224.0.0.1', '::1', 'fd00::1', 'fe80::1']) {
    await assert.rejects(run('/ip/lookup', { ip }), (e) => e.status === 400, ip);
  }
  await assert.rejects(run('/ip/lookup', { ip: 'example.com' }), (e) => e.status === 400);
});

test('IP lookup: RDAP fields, holder country from the vCard address, registry name, 404 and 502', async () => {
  answer = () => new Response(JSON.stringify({
    handle: 'NET-8-8-8-0-2', name: 'GOGL', type: 'DIRECT ALLOCATION', startAddress: '8.8.8.0', endAddress: '8.8.8.255', port43: 'whois.arin.net',
    events: [{ eventAction: 'registration', eventDate: '2023-12-28T17:24:33-05:00' }],
    entities: [{ roles: ['registrant'], handle: 'GOGL', vcardArray: ['vcard', [['version', {}, 'text', '4.0'], ['fn', {}, 'text', 'Google LLC'], ['kind', {}, 'text', 'org'],
      ['adr', { label: '1600 Amphitheatre Parkway\nMountain View\nCA\n94043\nUnited States' }, 'text', ['', '', '', '', '', '', '']]]],
      entities: [{ roles: ['abuse'], vcardArray: ['vcard', [['email', {}, 'text', 'network-abuse@google.com']]] }] }],
  }), { status: 200 });
  const out = await run('/ip/lookup', { ip: '8.8.8.8' });
  assert.equal(out.registry, 'ARIN');
  assert.equal(out.holder.name, 'Google LLC');
  assert.equal(out.abuseEmail, 'network-abuse@google.com');
  assert.equal(out.network.start, '8.8.8.0');
  assert.equal(out.registered, '2023-12-28T17:24:33-05:00');
  answer = () => new Response(JSON.stringify({ handle: '1.1.1.0 - 1.1.1.255', country: 'au', port43: 'whois.apnic.net', entities: [] }), { status: 200 });
  const ap = await run('/ip/lookup', { ip: '1.1.1.1' });
  assert.equal(ap.country, 'AU');
  assert.equal(ap.registry, 'APNIC');
  assert.equal(ap.holder, null);
  answer = () => new Response('{}', { status: 404 });
  await assert.rejects(run('/ip/lookup', { ip: '1.2.3.4' }), (e) => e.status === 404);
  answer = () => new Response('{}', { status: 503 });
  await assert.rejects(run('/ip/lookup', { ip: '1.2.3.4' }), (e) => e.status === 502);
});

test('IP lookup: ARIN refusing Workers (525) falls back to the registry whois via RIPEstat', async () => {
  // Production, 7 Nov 2026: rdap.org redirects ARIN space to rdap.arin.net, which answers Cloudflare egress with 525.
  const asked = [];
  answer = (url) => {
    asked.push(url);
    if (url.startsWith('https://rdap.org/')) return new Response('error code: 525', { status: 525 });
    return Response.json({ data: { authorities: ['arin'], records: [
      [{ key: 'NetRange', value: '8.8.8.0 - 8.8.8.255' }, { key: 'NetName', value: 'GOGL' }, { key: 'NetHandle', value: 'NET-8-8-8-0-2' },
        { key: 'NetType', value: 'Direct Allocation' }, { key: 'Organization', value: 'Google LLC (GOGL)' }, { key: 'RegDate', value: '2023-12-28' },
        { key: 'Updated', value: '2023-12-28' }, { key: 'source', value: 'ARIN' }],
      [{ key: 'OrgAbuseEmail', value: 'network-abuse@google.com' }, { key: 'source', value: 'ARIN' }],
      [{ key: 'OrgName', value: 'Google LLC' }, { key: 'OrgId', value: 'GOGL' }, { key: 'Country', value: 'US' }],
    ] } });
  };
  const out = await run('/ip/lookup', { ip: '8.8.8.8' });
  assert.ok(asked.some((u) => u.startsWith('https://stat.ripe.net/data/whois/data.json?resource=8.8.8.8')));
  assert.deepEqual(out.network, { name: 'GOGL', handle: 'NET-8-8-8-0-2', start: '8.8.8.0', end: '8.8.8.255', type: 'Direct Allocation' });
  assert.deepEqual(out.holder, { name: 'Google LLC', handle: 'GOGL', kind: 'org', country: 'US' });
  assert.equal(out.registry, 'ARIN');
  assert.equal(out.country, 'US');
  assert.equal(out.abuseEmail, 'network-abuse@google.com');
  assert.equal(out.registered, '2023-12-28');
  // RIPE-style keys (RIPE NCC, APNIC, AFRINIC) read the same way.
  const ripe = G.fromWhois('193.0.6.139', 4, { authorities: ['ripe'], records: [
    [{ key: 'inetnum', value: '193.0.0.0 - 193.0.7.255' }, { key: 'netname', value: 'RIPE-NCC' }, { key: 'country', value: 'NL' }, { key: 'org', value: 'ORG-RIEN1-RIPE' }, { key: 'status', value: 'ASSIGNED PA' }, { key: 'created', value: '2003-03-17T12:15:57Z' }],
    [{ key: 'org-name', value: 'Reseaux IP Europeens Network Coordination Centre (RIPE NCC)' }, { key: 'country', value: 'NL' }, { key: 'abuse-mailbox', value: 'abuse@ripe.net' }],
  ] });
  assert.equal(ripe.registry, 'RIPE NCC');
  assert.equal(ripe.network.start, '193.0.0.0');
  assert.equal(ripe.holder.name, 'Reseaux IP Europeens Network Coordination Centre (RIPE NCC)');
  assert.equal(ripe.country, 'NL');
  assert.equal(ripe.abuseEmail, 'abuse@ripe.net');
  assert.equal(G.fromWhois('1.2.3.4', 4, { records: [] }), null);
});

test('holder country: ARIN spelled-out country and a vCard country field', () => {
  const mk = (label, parts) => [{ roles: ['registrant'], vcardArray: ['vcard', [['fn', {}, 'text', 'X'], ['adr', { label }, 'text', parts]]] }];
  assert.equal(G.holderOf(mk('a\nb\nUnited States', ['', '', '', '', '', '', ''])).country, 'US');
  assert.equal(G.holderOf(mk('', ['', '', '', '', '', '', 'se'])).country, 'SE');
  assert.equal(G.holderOf(mk('somewhere', ['', '', '', '', '', '', ''])).country, null);
});
