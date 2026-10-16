const assert=require('node:assert/strict');
const {before,after,test}=require('node:test');
const {build}=require('esbuild');
const {Miniflare,convertV4MiniflareOptions}=require('miniflare');
let mf,requests;
const page=base=>`<html><head>${base}<link rel="canonical" href="reference.html"></head><body><main><h1 id="scope">API</h1><a href="retry.html">Retries</a><a href="https://fixed.example/guide">Fixed</a><a href="javascript:alert(1)">Unsafe</a></main></body></html>`;
before(async()=>{
 const b=await build({stdin:{contents:`import{extract}from'./src/routes/extract';export default{async fetch(r){const q=new URL(r.url).searchParams;return Response.json(await extract(q.get('url'),'20000','both',q.get('section')??undefined))}}`,resolveDir:process.cwd(),sourcefile:'links-worker.ts'},bundle:true,write:false,format:'esm',platform:'browser'});
 mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:b.outputFiles[0].text,compatibilityDate:'2026-09-01',outboundService:async r=>{
  requests.push(r.url);const u=new URL(r.url);
  if(u.pathname==='/redirect')return new Response(null,{status:302,headers:{location:'/archive/index.html'}});
  const bases={absolute:'<base href="https://docs.example/v2/"><base href="https://ignored.example/">',relative:'<base target="_blank"><base href="../v2/">',inert:'<template><base href="https://inert.example/"></template><svg><base href="https://foreign.example/"></svg><base href="https://docs.example/v2/">',empty:'<base href="">'};
  const base=u.pathname==='/archive/index.html'?'<base href="../v2/">':u.pathname==='/unsafe'?`<base href="${u.searchParams.get('base')}"><base href="https://ignored.example/">`:bases[u.pathname.slice(1)]??'';
  return new Response(page(base),{headers:{'content-type':'text/html'}});
 }}));
});
after(async()=>{await mf?.dispose();});
async function result(path,params={}){requests=[];const r=await mf.dispatchFetch('https://worker.test/?'+new URLSearchParams({url:'https://public.example'+path,...params}));assert.equal(r.status,200);return r.json();}
test('first declared document base resolves HTML links and canonical without fetching either',async()=>{
 const v=await result('/absolute');assert.equal(v.linkBaseUrl,'https://docs.example/v2/');assert.equal(v.links[0].href,'https://docs.example/v2/retry.html');assert.equal(v.canonical,'https://docs.example/v2/reference.html');assert.match(v.markdown,/https:\/\/docs\.example\/v2\/retry.html/);assert.equal(v.links[1].href,'https://fixed.example/guide');assert.ok(!v.links.some(x=>x.href.startsWith('javascript:')));assert.ok(v.warnings.includes('document_base_applied'));assert.equal(requests.length,1);
});
test('relative bases use the actual final URL after redirects and still apply to a selected section',async()=>{
 const v=await result('/redirect',{section:'scope'});assert.equal(v.finalUrl,'https://public.example/archive/index.html');assert.equal(v.linkBaseUrl,'https://public.example/v2/');assert.equal(v.links[0].href,'https://public.example/v2/retry.html');assert.equal(v.section.id,'scope');assert.equal(requests.length,2);
});
test('inert/foreign base nodes and target-only nodes do not supersede a real href',async()=>{
 const inert=await result('/inert');assert.equal(inert.links[0].href,'https://docs.example/v2/retry.html');
 const relative=await result('/relative');assert.equal(relative.linkBaseUrl,'https://public.example/v2/');
 const empty=await result('/empty');assert.equal(empty.linkBaseUrl,empty.finalUrl);assert.equal(empty.links[0].href,'https://public.example/retry.html');
});
test('unsupported, credentialed, invalid and oversized first bases warn and retain the final-URL fallback',async()=>{
 for(const base of ['javascript:alert(1)','data:text/html,test','file:///tmp/','ftp://docs.example/','https://user:password@docs.example/','http://[invalid','https://docs.example/'+'x'.repeat(4100)]){
  const v=await result('/unsafe?'+new URLSearchParams({base}));assert.equal(v.linkBaseUrl,v.finalUrl);assert.equal(v.links[0].href,'https://public.example/retry.html');assert.ok(v.warnings.includes('document_base_ignored'));assert.equal(requests.length,1);
 }
 const absent=await result('/absent');assert.equal(absent.linkBaseUrl,absent.finalUrl);assert.ok(!absent.warnings.includes('document_base_applied'));
});
