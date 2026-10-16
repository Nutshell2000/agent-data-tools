const assert=require('node:assert/strict');
const {before,after,test}=require('node:test');
const {build}=require('esbuild');
const {Miniflare,convertV4MiniflareOptions}=require('miniflare');
const ld=v=>'<script type="application/ld+json">'+JSON.stringify(v)+'</script>';
const article=(more={})=>({'@context':'https://schema.org','@type':'TechArticle',...more});
const body='<main><h1 id="scope">Research document</h1><p>Use this public documentation for the selected task.</p></main>';
const pages={
 declared:'<meta name="author" content="Ada Example"><meta property="article:published_time" content="2024-01-02"><meta property="article:modified_time" content="2025-02-03">'+ld(article({url:'https://public.example/declared',author:{name:'Ada Example'},dateModified:'2026-03-04'})),
 matched:ld({'@context':'https://schema.org','@graph':[{'@type':'Article',url:'https://other.example/story',datePublished:'1900-01-01',author:{name:'Wrong story'}},{'@type':'TechArticle','@id':'https://public.example/matched#article',datePublished:'2024-03-01',author:[{name:'Correct author'},{'@id':'https://people.example/do-not-fetch'}]}]}),
 canonical:'<link rel="canonical" href="/canonical-page">'+ld(article({url:'https://public.example/canonical-page',datePublished:'2024-01-01'})),
 ambiguous:ld([article({datePublished:'1900-01-01'}),article({datePublished:'2000-01-01'})]),
 single:ld(article({author:'Writer as declared',datePublished:'not a normalized date'})),
 foreign:ld(article({url:'https://other.example/article',author:'Other writer',datePublished:'1900-01-01'})),
 bounded:Array.from({length:20},(_,i)=>'<meta name="author" content="Author '+i+' '+ 'x'.repeat(200)+'">').join('')+ld(article({dateModified:'x'.repeat(70000)})),
 bad:'<script type="application/ld+json">{invalid}</script><script type="application/ld+json" src="https://external.example/metadata.json"></script>',
 inert:'<template><meta name="author" content="Template author">'+ld(article({author:'Template JSON'}))+'</template><svg>'+ld(article({author:'Foreign JSON'}))+'</svg><script>throw new Error("NEVER_EXECUTE")</script><meta name="author" content="Real author">',
 nodes:ld({'@context':'https://schema.org','@graph':Array.from({length:200},()=>({'@type':'Person',name:'Unrelated'}))}),
 scripts:Array.from({length:12},()=>ld({})).join(''),
 references:ld(article({author:{'@id':'https://people.example/no-follow'},dateModified:'2024-01-01'})),
 unknown:ld({'@context':'https://other.example/context','@type':'Article',author:'Unknown vocabulary',datePublished:'1900-01-01'}),
 local:ld({'@context':'https://schema.org','@graph':[{'@type':'Person','@id':'#writer',name:'Local writer'},{'@type':'Article','@id':'https://public.example/local#article',author:{'@id':'#writer'}}]}),
 conflicting:ld({'@context':'https://schema.org','@graph':[{'@type':'Person','@id':'#writer',name:'First claim'},{'@type':'Person','@id':'#writer',name:'Different claim'},{'@type':'Article',author:{'@id':'#writer'}}]}),
 absent:'',
};
let mf,requests,validate;
before(async()=>{
 const schema=await build({entryPoints:['src/lib/extract-contract.ts'],bundle:true,write:false,format:'cjs',platform:'node'});const m={exports:{}};new Function('require','module','exports',schema.outputFiles[0].text)(require,m,m.exports);validate=new(require('ajv/dist/2020').default)({strict:false}).compile(m.exports.EXTRACT_OUTPUT_SCHEMA);
 const b=await build({stdin:{contents:`import{extract}from'./src/routes/extract';export default{async fetch(r){const q=new URL(r.url).searchParams;return Response.json(await extract(q.get('url'),'20000',q.get('format')??'both',q.get('section')??undefined))}}`,resolveDir:process.cwd(),sourcefile:'metadata-worker.ts'},bundle:true,write:false,format:'esm',platform:'browser'});
 mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:b.outputFiles[0].text,compatibilityDate:'2026-09-01',outboundService:async r=>{requests.push(r.url);return new Response('<html><head>'+pages[new URL(r.url).pathname.slice(1)]+'</head><body>'+body+'<meta name="author" content="Body side-card author"></body></html>',{headers:{'content-type':'text/html'}});}}));
});
after(async()=>{await mf?.dispose();});
async function result(page,extra={}){requests=[];const r=await mf.dispatchFetch('https://worker.test/?'+new URLSearchParams({url:'https://public.example/'+page,...extra}));assert.equal(r.status,200);const v=await r.json();assert.equal(validate(v),true,JSON.stringify(validate.errors));return v;}
test('author/date values retain provenance and differ without inventing a verified publication date',async()=>{
 const v=await result('declared');const m=v.sourceMetadata;assert.equal(m.verification,'not_verified');assert.equal(m.truncated,false);assert.deepEqual(m.authors.map(a=>a.value),['Ada Example','Ada Example']);assert.equal(m.authors[0].source,'meta:name=author');assert.equal(m.authors[1].source,'jsonld[0].author.name');assert.deepEqual(m.dates.map(d=>[d.kind,d.value]),[['published','2024-01-02'],['modified','2025-02-03'],['modified','2026-03-04']]);assert.ok(v.warnings.includes('source_date_values_differ'));assert.ok(v.warnings.includes('source_metadata_unverified'));assert.doesNotMatch(v.text,/Ada Example|dateModified/);assert.equal(requests.length,1);
});
test('page identity and canonical matches select the relevant graph node, never the unrelated article',async()=>{
 const matched=await result('matched');assert.deepEqual(matched.sourceMetadata.authors.map(a=>a.value),['Correct author']);assert.equal(matched.sourceMetadata.dates[0].value,'2024-03-01');assert.match(matched.sourceMetadata.dates[0].source,/@graph\[1\]/);assert.equal(requests.length,1);
 const canonical=await result('canonical');assert.equal(canonical.sourceMetadata.dates[0].value,'2024-01-01');
 const foreign=await result('foreign');assert.deepEqual(foreign.sourceMetadata.authors,[]);assert.deepEqual(foreign.sourceMetadata.dates,[]);
});
test('ambiguous identity-free records are omitted while one record remains explicitly unverified',async()=>{
 const ambiguous=await result('ambiguous');assert.deepEqual(ambiguous.sourceMetadata.dates,[]);assert.ok(ambiguous.warnings.includes('source_metadata_jsonld_ambiguous'));
 const single=await result('single');assert.equal(single.sourceMetadata.authors[0].value,'Writer as declared');assert.equal(single.sourceMetadata.dates[0].value,'not a normalized date');
 const unknown=await result('unknown');assert.deepEqual(unknown.sourceMetadata.dates,[]);
});
test('metadata, script and JSON graph limits do not truncate or erase the readable primary result',async()=>{
 for(const page of ['bounded','nodes','scripts']){const v=await result(page);assert.equal(v.sourceMetadata.truncated,true);assert.equal(v.truncated,false);assert.match(v.text,/selected task/);assert.ok(v.warnings.includes('source_metadata_truncated'));assert.ok(v.sourceMetadata.authors.length<=5);assert.ok(v.sourceMetadata.dates.length<=10);assert.ok([...v.sourceMetadata.authors,...v.sourceMetadata.dates].reduce((n,d)=>n+d.value.length+d.source.length,0)<=2000);assert.equal(requests.length,1);}
});
test('malformed/external JSON-LD and author references never execute or cause another request',async()=>{
 const bad=await result('bad');assert.ok(bad.warnings.includes('source_metadata_jsonld_invalid'));assert.ok(bad.warnings.includes('source_metadata_external_jsonld_ignored'));assert.equal(requests.length,1);
 const refs=await result('references');assert.deepEqual(refs.sourceMetadata.authors,[]);assert.ok(refs.warnings.includes('source_metadata_references_unresolved'));assert.equal(requests.length,1);
 const inert=await result('inert');assert.deepEqual(inert.sourceMetadata.authors.map(a=>a.value),['Real author']);assert.doesNotMatch(inert.text,/NEVER_EXECUTE|Template|Foreign JSON/);
});
test('local author references resolve with definition provenance, while conflicting definitions stay unknown',async()=>{
 const local=await result('local');assert.deepEqual(local.sourceMetadata.authors.map(a=>a.value),['Local writer']);assert.match(local.sourceMetadata.authors[0].source,/@graph\[1\]\.author\.@id -> jsonld\[0\]\.@graph\[0\]\.name/);assert.equal(requests.length,1);
 const conflicting=await result('conflicting');assert.deepEqual(conflicting.sourceMetadata.authors,[]);assert.ok(conflicting.warnings.includes('source_metadata_author_reference_ambiguous'));assert.equal(requests.length,1);
});
test('metadata stays page-level for sections and every representation; content hashes cover primary output only',async()=>{
 const original=await result('declared');for(const format of ['text','markdown','both']){const scoped=await result('declared',{format,section:'scope'});assert.deepEqual(scoped.sourceMetadata,original.sourceMetadata);assert.equal(scoped.section.id,'scope');}
 const absent=await result('absent');assert.deepEqual(absent.sourceMetadata,{verification:'not_verified',authors:[],dates:[],truncated:false});assert.equal(absent.contentHash,original.contentHash);
});
