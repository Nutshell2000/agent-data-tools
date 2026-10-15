const assert = require('node:assert/strict');
const { before, after, test } = require('node:test');
const { build } = require('esbuild');
const { Miniflare, convertV4MiniflareOptions } = require('miniflare');
let mf;
before(async () => {
  const bundle = await build({ stdin: { contents: `import {extract} from './src/routes/extract'; export default {async fetch(r){const u=new URL(r.url);try{return Response.json(await extract(u.searchParams.get('url'),u.searchParams.get('maxChars')))}catch(e){return Response.json({error:e.message},{status:e.status||500})}}}`, resolveDir: process.cwd(), sourcefile:'extract-fixture.ts' }, bundle:true, write:false, format:'esm', platform:'browser' });
  mf = new Miniflare(convertV4MiniflareOptions({ modules:true, script:bundle.outputFiles[0].text, compatibilityDate:'2026-09-01', outboundService:async request => {
    const path = new URL(request.url).pathname;
    if(path==='/redirect') return new Response(null,{status:302,headers:{location:'/article'}});
    if(path==='/private') return new Response(null,{status:302,headers:{location:'http://127.0.0.1/private'}});
    if(path==='/pdf') return new Response('%PDF',{headers:{'content-type':'application/pdf'}});
    if(path==='/fail') return new Response('upstream error',{status:500});
    if(path==='/big') return new Response('a'.repeat(2*1024*1024+100),{headers:{'content-type':'text/plain'}});
    if(path==='/plain') return new Response('a'.repeat(600),{headers:{'content-type':'text/plain'}});
    if(path==='/shell') return new Response('<html><body><div id="app"></div><script>document.write("SECRET_JS")</script></body></html>',{headers:{'content-type':'text/html'}});
    return new Response(`<html lang="en"><head><title>Research fixture</title><meta name="description" content="Static fixture"><link rel="canonical" href="https://public.example/article"></head><body><nav>EXCLUDE_NAV</nav><main><h1>Useful article</h1><p>${'Research evidence and context. '.repeat(12)}</p><h2>Next steps</h2><a href="/documentation">Read docs</a></main><footer>EXCLUDE_FOOTER</footer><script>EXCLUDE_SCRIPT</script></body></html>`,{headers:{'content-type':'text/html'}});
  }}));
});
after(async()=>{await mf?.dispose();});
const call = (path, maxChars) => mf.dispatchFetch(`https://worker.test/?url=${encodeURIComponent('https://public.example'+path)}${maxChars?'&maxChars='+maxChars:''}`);
test('real Workers HTMLRewriter extracts a static article, metadata, headings and absolute links',async()=>{
  const r=await call('/article');const v=await r.json();assert.equal(r.status,200);
  assert.equal(v.title,'Research fixture');assert.equal(v.description,'Static fixture');assert.equal(v.lang,'en');
  assert.equal(v.canonical,'https://public.example/article');assert.equal(v.headings[0].text,'Useful article');
  assert.ok(v.links.some(l=>l.href==='https://public.example/documentation'));assert.match(v.text,/Research evidence/);
  assert.doesNotMatch(v.text,/EXCLUDE_/);assert.equal(v.truncated,false);
});
test('extraction reports final URL and rejects private redirects, unsupported files and upstream failures',async()=>{
  assert.equal((await (await call('/redirect')).json()).finalUrl,'https://public.example/article');
  for(const [path,status] of [['/private',400],['/pdf',415],['/fail',502]]) {const r=await call(path);assert.equal(r.status,status);await r.body?.cancel();}
});
test('text output and oversized input expose truncation and JavaScript shells are not rendered',async()=>{
  const plain=await (await call('/plain',500)).json();assert.equal(plain.text.length,500);assert.equal(plain.textLength,600);assert.equal(plain.truncated,true);
  const big=await (await call('/big',100000)).json();assert.equal(big.text.length,100000);assert.equal(big.truncated,true);
  const shell=await (await call('/shell')).json();assert.equal(shell.text,'');assert.doesNotMatch(shell.text,/SECRET_JS/);
});
