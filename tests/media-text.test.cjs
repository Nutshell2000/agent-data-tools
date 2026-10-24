const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const { build } = require('esbuild');

let M;
before(async () => {
  const b = await build({ entryPoints: ['src/routes/media-text.ts'], bundle: true, format: 'cjs', platform: 'node', write: false, logLevel: 'silent' });
  const m = { exports: {} };
  new Function('module', 'exports', 'require', b.outputFiles[0].text)(m, m.exports, require);
  M = m.exports;
});

// A little-endian TIFF block: IFD0 with Make and a GPS pointer, a GPS IFD at 59°19'30" N, 18°4'0" W.
function tiff() {
  const b = Buffer.alloc(146);
  b.write('II', 0, 'latin1'); b.writeUInt16LE(42, 2); b.writeUInt32LE(8, 4);
  b.writeUInt16LE(2, 8);
  const ent = (at, tag, type, count, value) => { b.writeUInt16LE(tag, at); b.writeUInt16LE(type, at + 2); b.writeUInt32LE(count, at + 4); b.writeUInt32LE(value, at + 8); };
  ent(10, 0x010f, 2, 6, 38); ent(22, 0x8825, 4, 1, 44); b.writeUInt32LE(0, 34);
  b.write('Canon\0', 38, 'latin1');
  b.writeUInt16LE(4, 44);
  ent(46, 1, 2, 2, 0); b.write('N\0', 54, 'latin1');
  ent(58, 2, 5, 3, 98);
  ent(70, 3, 2, 2, 0); b.write('W\0', 78, 'latin1');
  ent(82, 4, 5, 3, 122);
  b.writeUInt32LE(0, 94);
  [[59, 1], [19, 1], [3000, 100], [18, 1], [4, 1], [0, 1]].forEach(([n, d], i) => { b.writeUInt32LE(n, 98 + i * 8); b.writeUInt32LE(d, 102 + i * 8); });
  return b;
}
function jpeg() {
  const t = tiff();
  const app1 = Buffer.concat([Buffer.from([0xff, 0xe1]), Buffer.from([0, 0]), Buffer.from('Exif\0\0', 'latin1'), t]);
  app1.writeUInt16BE(app1.length - 2, 2);
  const sof = Buffer.from([0xff, 0xc0, 0, 17, 8, 0x01, 0xe0, 0x02, 0x80, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);
  return new Uint8Array(Buffer.concat([Buffer.from([0xff, 0xd8]), app1, sof, Buffer.from([0xff, 0xd9])]));
}

test('JPEG: size from the frame header, EXIF make and GPS position with hemispheres', () => {
  const info = M.imageInfo(jpeg());
  assert.equal(info.format, 'jpeg');
  assert.equal(info.width, 640);
  assert.equal(info.height, 480);
  assert.equal(info.exif.make, 'Canon');
  assert.equal(info.gps.lat, 59.325);
  assert.equal(info.gps.lon, -18.066667);
  assert.equal(info.gps.altitudeM, null);
});

test('PNG, GIF and WebP sizes; anything else is refused uncharged', () => {
  const png = Buffer.alloc(24); Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png); png.write('IHDR', 12, 'latin1'); png.writeUInt32BE(1200, 16); png.writeUInt32BE(630, 20);
  assert.deepEqual([M.imageInfo(new Uint8Array(png)).width, M.imageInfo(new Uint8Array(png)).height], [1200, 630]);
  const gif = Buffer.alloc(10); gif.write('GIF89a', 0, 'latin1'); gif.writeUInt16LE(16, 6); gif.writeUInt16LE(9, 8);
  assert.equal(M.imageInfo(new Uint8Array(gif)).format, 'gif');
  assert.equal(M.imageInfo(new Uint8Array(gif)).height, 9);
  const webp = Buffer.alloc(30); webp.write('RIFF', 0, 'latin1'); webp.write('WEBP', 8, 'latin1'); webp.write('VP8X', 12, 'latin1'); webp.writeUIntLE(1919, 24, 3); webp.writeUIntLE(1079, 27, 3);
  assert.deepEqual([M.imageInfo(new Uint8Array(webp)).width, M.imageInfo(new Uint8Array(webp)).height], [1920, 1080]);
  assert.throws(() => M.imageInfo(new Uint8Array(Buffer.from('<html>not an image</html>'))), (e) => e.status === 422);
});

test('a truncated EXIF block never throws past the parser', () => {
  const j = jpeg();
  const cut = j.slice(0, 60);
  const info = M.imageInfo(cut);
  assert.equal(info.format, 'jpeg');
});

test('language detection: English, Swedish, German; too short is undetermined', async () => {
  const run = (text) => M.MEDIA_TEXT.find((e) => e.endpoint.path === '/text/language').run({}, (n) => (n === 'text' ? text : undefined));
  assert.equal((await run('The quick brown fox jumps over the lazy dog while the farmer watches from the window.')).language.iso6391, 'en');
  const sv = await run('Det här är en mening skriven på svenska om väder och resor.');
  assert.equal(sv.language.iso6393, 'swe');
  assert.equal(sv.language.name, 'Swedish');
  assert.equal((await run('Ich habe heute keine Zeit, weil ich arbeiten muss und morgen früh aufstehe.')).language.iso6391, 'de');
  assert.equal((await run('ok')).language.iso6393, 'und');
});

test('user agents: browsers, operating systems, devices and bots', () => {
  const chrome = M.parseUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36');
  assert.deepEqual([chrome.browser, chrome.majorVersion, chrome.os, chrome.device, chrome.isBot], ['Chrome', 130, 'Windows', 'desktop', false]);
  const edge = M.parseUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.2849.56');
  assert.equal(edge.browser, 'Edge');
  const iphone = M.parseUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1');
  assert.deepEqual([iphone.browser, iphone.os, iphone.osVersion, iphone.device], ['Safari', 'iOS', '17.5', 'mobile']);
  const tablet = M.parseUserAgent('Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36');
  assert.equal(tablet.device, 'tablet');
  const gpt = M.parseUserAgent('Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2; +https://openai.com/gptbot)');
  assert.deepEqual([gpt.isBot, gpt.bot, gpt.device], [true, 'GPTBot (OpenAI)', 'bot']);
  assert.equal(M.parseUserAgent('curl/8.7.1').bot, 'curl');
  assert.equal(M.parseUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15').os, 'macOS');
});

test('private targets are refused before any request; names stay within 32 characters', async () => {
  for (const path of ['/image/metadata', '/url/favicon']) {
    const e = M.MEDIA_TEXT.find((f) => f.endpoint.path === path);
    await assert.rejects(Promise.resolve().then(() => e.run({}, (n) => (n === 'url' ? 'http://127.0.0.1/x' : undefined))), (err) => err.status === 400, path);
  }
  for (const e of M.MEDIA_TEXT) assert.ok(e.endpoint.summary.split(':')[0].length <= 32, e.endpoint.summary);
});
