const assert = require('node:assert/strict');
const { before, after, test } = require('node:test');
const { build } = require('esbuild');
const { Miniflare, convertV4MiniflareOptions } = require('miniflare');
const { gzipSync } = require('node:zlib');
const { createHash } = require('node:crypto');
let mf, source, validate;
const requests = [];
const ns = 'http://www.sitemaps.org/schemas/sitemap/0.9';
const xml = entries => `<urlset xmlns="${ns}">${entries.map(url => `<url><loc>${url}</loc></url>`).join('')}</urlset>`;
before(async () => {
  const sample = await import('../examples/sitemap-sample.mjs'); source = sample.SITEMAP_SOURCE;
  const bundle = await build({ stdin: { contents: `import {sitemap} from './src/routes/sitemap';export default{async fetch(r){const q=new URL(r.url).searchParams;try{return Response.json(await sitemap(q.get('url'),q.get('contains')??'',q.get('maxUrls')??undefined,q.get('offset')??undefined))}catch(e){return Response.json({error:e.message,code:e.code},{status:e.status??500})}}}`, resolveDir: process.cwd(), sourcefile: 'sitemap-fixture.ts' }, bundle: true, write: false, format: 'esm', platform: 'browser' });
  mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: bundle.outputFiles[0].text, compatibilityDate: '2026-09-01', outboundService: async request => {
    requests.push(request.url); const path = new URL(request.url).pathname;
    assert.equal(new URL(request.url).hostname, 'public.example');
    if (path === '/redirect') return new Response(null, { status: 302, headers: { location: '/source.xml' } });
    if (path === '/private') return new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/secret' } });
    if (path === '/html') return new Response('<html>not a sitemap</html>', { headers: { 'content-type': 'text/html' } });
    if (path === '/gzip') return new Response(gzipSync(source), { headers: { 'content-type': 'application/gzip' } });
    if (path === '/bomb') return new Response(gzipSync('<urlset>' + ' '.repeat(600000) + '</urlset>'), { headers: { 'content-type': 'application/gzip' } });
    if (path === '/index.xml') return new Response(sample.SITEMAP_INDEX, { headers: { 'content-type': 'application/xml' } });
    const bodies = {
      '/malformed': `<urlset xmlns="${ns}"><url><loc>https://public.example/a</url></urlset>`,
      '/dtd': '<!DOCTYPE urlset [<!ENTITY remote SYSTEM "https://private.example/secret">]><urlset><url><loc>&remote;</loc></url></urlset>',
      '/many': xml(Array.from({length:1001},(_,i)=>'https://public.example/'+i)),
      '/large': ' '.repeat(512*1024+1),
      '/depth': '<urlset>'+ '<x>'.repeat(17) + '</x>'.repeat(17) + '</urlset>',
      '/omissions': xml(['https://public.example/a','https://public.example/a','http://127.0.0.1/private','https://user:password@public.example/private','https://public.example/b']),
      '/empty': `<urlset xmlns="${ns}"/>`,
      '/entities': `<s:urlset xmlns:s="${ns}"><s:url><s:loc><![CDATA[https://public.example/a?x=1&y=2]]></s:loc><s:lastmod>2026-10-15</s:lastmod></s:url></s:urlset>`,
    };
    return new Response(bodies[path] ?? source, { headers: { 'content-type': 'application/xml' } });
  }}));
  const b = await build({ entryPoints: ['src/lib/sitemap-contract.ts'], bundle: true, write: false, platform: 'node', format: 'cjs' });
  const m = { exports: {} };new Function('module','exports',b.outputFiles[0].text)(m,m.exports);
  const Ajv = require('ajv/dist/2020').default;validate = new Ajv({strict:false}).compile(m.exports.SITEMAP_OUTPUT_SCHEMA);
});
after(async () => { await mf?.dispose(); });
const call = (path, extra = {}) => mf.dispatchFetch('https://worker.test/?' + new URLSearchParams({ url: 'https://public.example'+path, ...extra }));

test('real Workers runtime returns sitemap pages, dates, pagination and a verifiable primary hash', async () => {
  const response = await call('/source.xml', { maxUrls: '2' });assert.equal(response.status,200);const result=await response.json();
  assert.equal(result.kind,'urlset');assert.equal(result.entries.length,2);assert.equal(result.nextOffset,2);assert.equal(result.hasMore,true);
  assert.equal(result.entries[0].lastModified,'2026-10-15');assert.equal(result.reportedEntries,3);
  assert.ok(!result.text.includes('ignored-extension'));
  assert.equal(result.contentHash,'sha256:'+createHash('sha256').update(result.text).digest('hex'));
  assert.ok(validate(result),JSON.stringify(validate.errors));
  const last = await (await call('/source.xml',{maxUrls:'2',offset:'2'})).json();assert.equal(last.entries.length,1);assert.equal(last.nextOffset,null);
});
test('index files return child sitemap data without fetching children and filters can produce valid empty answers', async () => {
  const start=requests.length;const index=await(await call('/index.xml')).json();assert.equal(index.kind,'sitemapindex');assert.equal(requests.length,start+1);assert.ok(index.warnings.includes('entries_are_child_sitemaps_not_pages'));
  const empty=await(await call('/source.xml',{contains:'NO-MATCH'})).json();assert.equal(empty.entries.length,0);assert.equal(empty.matchingReportedLocations,0);assert.equal(empty.hasMore,false);assert.ok(empty.text.trim());assert.ok(validate(empty));
  const filtered=await(await call('/source.xml',{contains:'TECHNICAL'})).json();assert.equal(filtered.entries.length,1);
});
test('gzip, namespaces, CDATA and entity decoding preserve reported URLs', async () => {
  const gzip=await(await call('/gzip')).json();assert.equal(gzip.entries.length,3);
  const entities=await(await call('/entities')).json();assert.equal(entities.entries[0].url,'https://public.example/a?x=1&y=2');
  const redirected=await(await call('/redirect')).json();assert.equal(redirected.finalUrl,'https://public.example/source.xml');
});
test('duplicates and prohibited output URLs are omitted with truthful per-page counts', async () => {
  const r=await(await call('/omissions')).json();assert.equal(r.reportedEntries,5);assert.equal(r.duplicateReportedLocations,1);assert.equal(r.rejectedLocationsInPage,2);assert.equal(r.entries.length,2);assert.equal(r.uniqueReportedLocations,4);
  assert.ok(r.warnings.includes('counts_describe_reported_locations_before_public_url_validation'));
});
test('invalid XML, DTD, oversized expansion, complexity and unsupported types fail with no secondary requests', async () => {
  for(const [path,status,code] of [['/malformed',422,'SITEMAP_INVALID'],['/dtd',422,'SITEMAP_DTD'],['/bomb',422,'SITEMAP_TOO_LARGE'],['/large',422,'SITEMAP_TOO_LARGE'],['/depth',422,'SITEMAP_COMPLEXITY'],['/html',415,'SITEMAP_REQUIRED'],['/private',400,undefined]]){
    const before=requests.length,r=await call(path),body=await r.json();assert.equal(r.status,status,path+JSON.stringify(body));if(code)assert.equal(body.code,code);assert.equal(requests.length,before+1,path);
  }
});
test('a sitemap with more than 1000 entries is read from the start: the first 1000, with a warning', async () => {
  const r = await call('/many'), body = await r.json();
  assert.equal(r.status, 200, JSON.stringify(body).slice(0, 300));
  assert.equal(body.reportedEntries, 1000);
  assert.ok(body.warnings.includes('large_sitemap_read_from_start_first_512_kib_or_1000_entries'));
});
test('invalid options fail before source fetching', async () => {
  for(const extra of [{maxUrls:'0'},{maxUrls:'101'},{offset:'-1'},{offset:'1001'},{contains:'x'.repeat(201)}]){const before=requests.length;const r=await call('/source.xml',extra);assert.equal(r.status,400);await r.body?.cancel();assert.equal(requests.length,before);}
});
