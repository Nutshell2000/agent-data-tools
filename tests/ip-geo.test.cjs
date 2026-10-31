const assert = require('node:assert/strict');
const { test } = require('node:test');
const { build } = require('esbuild');

async function load(entry) {
  const b = await build({ entryPoints: [entry], bundle: true, format: 'cjs', platform: 'node', write: false, logLevel: 'silent' });
  const m = { exports: {} };
  new Function('module', 'exports', 'require', b.outputFiles[0].text)(m, m.exports, require);
  return m.exports;
}

test('ip-geo: addresses parse, reserved ranges are known, shards round-trip and binary search finds the range', async () => {
  const g = await load('src/lib/ip-geo.ts');
  assert.equal(g.parseIp('8.8.8.8').n, 134744072n);
  assert.equal(g.parseIp('256.1.1.1'), null);
  assert.equal(g.parseIp('2001:4860:4860::8888').n, 0x20014860486000000000000000008888n);
  assert.equal(g.parseIp('::ffff:1.2.3.4').n, 0xffff01020304n);
  assert.equal(g.parseIp('1:2:3:4:5:6:7:8:9'), null);
  assert.equal(g.isReservedIp(4, g.parseIp('10.1.2.3').n), true);
  assert.equal(g.isReservedIp(4, g.parseIp('192.168.0.1').n), true);
  assert.equal(g.isReservedIp(4, g.parseIp('8.8.8.8').n), false);
  assert.equal(g.isReservedIp(6, g.parseIp('fe80::1').n), true);
  assert.equal(g.isReservedIp(6, g.parseIp('2001:4860::1').n), false);
  assert.equal(g.shardKey('2026-10', 4, 7), 'ipg:2026-10:4:7');
  assert.equal(g.shardIndex(['1000000', '8000000', '9000000'], g.parseIp('8.8.8.8').n), 1);
  assert.equal(g.shardIndex(['1000000'], 5n), -1);
  const locs = [['NA', 'US', 'California', 'Mountain View', 37.4056, -122.0775], ['EU', 'SE', 'Stockholm', 'Stockholm', 59.3294, 18.0687]];
  const v4 = g.encodeShard(4, [{ start: g.parseIp('8.8.4.0').n, end: g.parseIp('8.8.4.255').n, loc: 1 }, { start: g.parseIp('8.8.8.0').n, end: g.parseIp('8.8.8.255').n, loc: 0 }], locs);
  assert.equal(g.findInShard(4, v4, g.parseIp('8.8.8.8').n).loc[3], 'Mountain View');
  assert.equal(g.findInShard(4, v4, g.parseIp('8.8.4.1').n).loc[1], 'SE');
  assert.equal(g.findInShard(4, v4, g.parseIp('8.8.5.1').n), null);
  assert.equal(g.findInShard(4, v4, g.parseIp('8.0.0.1').n), null);
  const v6 = g.encodeShard(6, [{ start: g.parseIp('2a00:1450::').n, end: g.parseIp('2a00:1450:ffff:ffff:ffff:ffff:ffff:ffff').n, loc: 1 }], locs);
  const hit = g.findInShard(6, v6, g.parseIp('2a00:1450:4001::1').n);
  assert.equal(hit.loc[3], 'Stockholm');
  assert.equal(g.bigToIp(6, hit.start), '2a00:1450::');
  assert.equal(g.bigToIp(4, g.parseIp('8.8.8.8').n), '8.8.8.8');
});

test('ip geolocate tool: reserved and malformed input refused, shard read once, attribution in every answer', async () => {
  const { geolocate } = await load('src/routes/geo-ip.ts');
  const g = await load('src/lib/ip-geo.ts');
  const locs = [['NA', 'US', 'California', 'Mountain View', 37.4056, -122.0775]];
  const shard = g.encodeShard(4, [{ start: g.parseIp('8.8.8.0').n, end: g.parseIp('8.8.8.255').n, loc: 0 }], locs);
  let reads = 0;
  const kv = { async get(k, opts) { reads++; const type = typeof opts === 'string' ? opts : opts?.type; if (k === 'ipgeo:meta') return JSON.stringify({ month: '2026-10', v4: ['8080800'], v6: [] }); return k === 'ipg:2026-10:4:0' && type === 'arrayBuffer' ? shard.buffer.slice(shard.byteOffset, shard.byteOffset + shard.byteLength) : null; } };
  const out = await geolocate(kv, '8.8.8.8');
  assert.equal(out.city, 'Mountain View');
  assert.equal(out.country, 'US');
  assert.equal(out.countryName, 'United States');
  assert.equal(out.range, '8.8.8.0-8.8.8.255');
  assert.match(out.attribution, /DB-IP/);
  assert.equal(out.dataMonth, '2026-10');
  await assert.rejects(geolocate(kv, '10.0.0.1'), (e) => e.status === 400);
  await assert.rejects(geolocate(kv, 'not-an-ip'), (e) => e.status === 400);
  await assert.rejects(geolocate(kv, '8.8.9.9'), (e) => e.status === 404);
  await assert.rejects(geolocate(kv, '5.5.5.5'), (e) => e.status === 404);
  await assert.rejects(geolocate(kv, '2a00:1450::1'), (e) => e.status === 404);
  await assert.rejects(geolocate(null, '8.8.8.8'), (e) => e.status === 503);
});
