const assert=require('node:assert/strict');
const {test,before,after}=require('node:test');
const {build}=require('esbuild');
const {Miniflare,convertV4MiniflareOptions}=require('miniflare');
const {createHash}=require('node:crypto');
let mf,validateOutput;
const pages={
 long:'<html lang="en"><head><title>Whole documentation title</title><meta name="description" content="Whole-page description"></head><body><main><h1>Introduction</h1><p>'+'Unrelated introduction. '.repeat(2000)+'</p><div><h2 id="retry-policy">Retry policy</h2><p>Stop after three attempts.</p><h3 id="retry-code">Code</h3><pre><code class="language-python">def retry():\n    return 3  </code></pre><table><tr><th>Limit</th><th>Value</th></tr><tr><td>retries</td><td>3</td></tr></table></div><div><h2 id="next">Other task</h2><p>EXCLUDE_LATER</p></div></main></body></html>',
 container:'<nav><h2 id="outside">NAV</h2></nav><main><h1>Page</h1><section id="one"><h2>One</h2><p>CONTAINER_BODY</p><h2>Still inside</h2><p>CONTAINER_END</p></section><h2>Outside</h2><p>EXCLUDE_OUTSIDE</p></main>',
 anchors:'<main><h1>Intro</h1><h2><a id="legacy"></a>Legacy heading</h2><p>ANCHOR_BODY</p><h3>Subheading</h3><p>SUB_BODY</p><h2>Next</h2><p>EXCLUDE_NEXT</p></main>',
 hidden:'<main><h2 id="one">Visible</h2><p>KEEP_BODY</p><div hidden><h2 id="one">Hidden duplicate</h2></div><h2 hidden>Hidden boundary</h2><p>KEEP_AFTER_HIDDEN</p><h2>Next</h2><p>EXCLUDE_NEXT</p><div hidden id="hidden">HIDDEN</div></main>',
 duplicate:'<main><h2 id="same">First</h2><p>A</p><h2 id="same">Second</h2><p>B</p></main>',
 unsupported:'<main><p>Paragraph <span id="inline">inline</span></p></main>',
 empty:'<main><div id="empty"></div><p>Outside</p></main>',
 odd:'<main><h2 id="a&amp;&quot;日">Odd ID</h2><p>ODD_BODY</p><h2>Next</h2><p>EXCLUDE_NEXT</p></main>',
 deep:'<main>'+'<div>'.repeat(140)+'<h2 id="deep">Deep</h2>'+'</div>'.repeat(140)+'</main>',
 headtext:'<main><h1>Guide</h1><h2 id="install">Install</h2><p>FIRST_INSTALL</p><h2 id="usage">Usage</h2><p>USAGE_BODY</p><h2 id="later">Install</h2><p>SECOND_INSTALL</p></main>',
  wordy:'<main><h2 id="setup-one">Quick setup guide</h2><p>FIRST_SETUP</p><h2 id="setup-two">Advanced setup steps</h2><p>SECOND_SETUP</p></main>'
};
before(async()=>{
 const schemaBundle=await build({entryPoints:['src/lib/extract-contract.ts'],bundle:true,write:false,platform:'node',format:'cjs'});const mod={exports:{}};new Function('require','module','exports',schemaBundle.outputFiles[0].text)(require,mod,mod.exports);const Ajv=require('ajv/dist/2020').default;validateOutput=new Ajv({strict:false}).compile(mod.exports.EXTRACT_OUTPUT_SCHEMA);

 const b=await build({stdin:{contents:`import {extract} from './src/routes/extract';export default{async fetch(r){const q=new URL(r.url).searchParams;try{return Response.json(await extract(q.get('url'),q.get('maxChars')??undefined,q.get('format')??'both',q.get('section')??undefined))}catch(e){return Response.json({error:e.message,code:e.code,...(e.details??{})},{status:e.status||500})}}}`,resolveDir:process.cwd(),sourcefile:'section-worker.ts'},bundle:true,write:false,format:'esm',platform:'browser'});
 mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:b.outputFiles[0].text,compatibilityDate:'2026-09-01',outboundService:async r=>{
 const page=new URL(r.url).pathname.slice(1);return new Response(page==='plain'?'Plain page':pages[page],{headers:{'content-type':page==='plain'?'text/plain':'text/html'}});
 }}));
});
after(async()=>{await mf?.dispose();});
const call=(page,section,extra={})=>mf.dispatchFetch('https://worker.test/?'+new URLSearchParams({url:'https://public.example/'+page,maxChars:'500',...(section===undefined?{}:{section}),...extra}));
const result=async(...a)=>{const r=await call(...a);assert.equal(r.status,200);return r.json();};
test('a generic section name reads the primary content with a warning instead of refusing',async()=>{
  const v=await result('long','main');
  assert.ok(v.warnings.includes('section_generic_ignored'));
  assert.equal(v.section.id,'main');
  assert.match(v.text,/Introduction/);
  assert.doesNotMatch(v.text,/EXCLUDE/);
  assert.equal(validateOutput(v),true,JSON.stringify(validateOutput.errors));
});

test('a single distinctive word matches one heading; a word shared by two stays an uncharged ambiguity',async()=>{
  const v=await result('long','retry');
  assert.ok(v.warnings.includes('section_matched_by_heading_word'));
  assert.equal(v.section.id,'retry-policy');
  assert.match(v.text,/Stop after three attempts/);
  assert.equal(validateOutput(v),true,JSON.stringify(validateOutput.errors));
  const r=await call('wordy','setup'); assert.equal(r.status,422);
  const e=await r.json(); assert.equal(e.code,'EXTRACTION_SECTION_AMBIGUOUS'); assert.match(e.error,/matches 2 headings/);
});

test('late heading selection returns relevant instructions, nested code and tables within the same cap',async()=>{
 const full=await result('long');assert.doesNotMatch(full.text,/Stop after three/);assert.equal(full.truncated,true);assert.equal(full.section,null);
 const v=await result('long','retry-policy');assert.match(v.text,/Stop after three attempts/);assert.match(v.text,/retries\t3/);assert.doesNotMatch(v.text,/Unrelated|EXCLUDE/);assert.equal(v.truncated,false);
 assert.deepEqual(v.section,{id:'retry-policy',title:'Retry policy',kind:'heading',headingLevel:2});assert.equal(v.title,'Whole documentation title');assert.equal(v.description,'Whole-page description');
 assert.equal(v.headings[0].id,'retry-policy');assert.equal(v.headings[1].id,'retry-code');assert.equal(v.codeBlocks[0].text,'def retry():\n    return 3  ');assert.equal(v.tables.length,1);
 assert.equal(v.contentHash,'sha256:'+createHash('sha256').update(v.text).digest('hex'));
});
test('container scope includes its own headings and excludes adjacent content and navigation',async()=>{
 const v=await result('container','one');assert.match(v.text,/CONTAINER_BODY/);assert.match(v.text,/CONTAINER_END/);assert.doesNotMatch(v.text,/EXCLUDE|NAV/);assert.equal(v.section.kind,'container');assert.equal(v.section.headingLevel,null);
 const outside=await result('container','Outside');assert.match(outside.text,/EXCLUDE_OUTSIDE/);assert.doesNotMatch(outside.text,/NAV/);assert.equal(outside.section.id,'Outside');
 const absent=await call('container','nav-only');assert.equal(absent.status,422);assert.equal((await absent.json()).code,'EXTRACTION_SECTION_NOT_FOUND');
});
test('heading anchors and hidden boundaries preserve the intended section hierarchy',async()=>{
 const a=await result('anchors','legacy');assert.match(a.text,/ANCHOR_BODY/);assert.match(a.text,/SUB_BODY/);assert.doesNotMatch(a.text,/EXCLUDE_NEXT/);assert.equal(a.headings[0].id,'legacy');
 const h=await result('hidden','one');assert.match(h.text,/KEEP_AFTER_HIDDEN/);assert.doesNotMatch(h.text,/Hidden duplicate|Hidden boundary|EXCLUDE_NEXT/);
});
test('missing, duplicate, hidden, unsupported and empty sections fail clearly',async()=>{
 for(const [page,id,code]of [['long','missing','EXTRACTION_SECTION_NOT_FOUND'],['duplicate','same','EXTRACTION_SECTION_AMBIGUOUS'],['hidden','hidden','EXTRACTION_SECTION_NOT_FOUND'],['unsupported','inline','EXTRACTION_SECTION_UNSUPPORTED'],['empty','empty','EXTRACTION_EMPTY']]){
 const r=await call(page,id);assert.equal(r.status,422);assert.equal((await r.json()).code,code);
 }
 assert.equal((await call('plain','one')).status,415);
 for(const id of ['x'.repeat(501), 'line\nbreak'])assert.equal((await call('long',id)).status,400);
});
test('a section sent as the docs-link fragment or the whole URL selects the same element',async()=>{
 for(const value of ['#retry-policy','https://docs.example/long#retry-policy']){
  const v=await result('long',value);assert.equal(v.section.id,'retry-policy');assert.match(v.text,/Stop after three attempts/);assert.doesNotMatch(v.text,/Unrelated|EXCLUDE/);
 }
 const sub=await result('long','#retry-code');assert.equal(sub.section.id,'retry-code');assert.equal(sub.section.headingLevel,3);
 const encoded=await result('odd','#'+encodeURIComponent('a&"日'));assert.equal(encoded.section.id,'a&"日');
 for(const value of ['#','#missing','#'.repeat(2)])assert.equal((await call('long',value)).status,422,value);
 assert.equal((await call('long','#retry%0Apolicy')).status,422,'a control character inside a fragment is not silently rewritten');
 assert.equal((await result('long','# Retry policy')).section.id,'retry-policy','a fragment keeps the heading-text rule');
});
test('a heading sent by its visible text resolves when that text is unique',async()=>{
 const v=await result('long','Retry policy');assert.equal(v.section.id,'retry-policy');assert.equal(v.section.title,'Retry policy');
 assert.ok(v.warnings.includes('section_matched_by_heading'));assert.match(v.text,/Stop after three attempts/);assert.doesNotMatch(v.text,/Unrelated|EXCLUDE/);
 const spaced=await result('long','  retry   POLICY ');assert.equal(spaced.section.id,'retry-policy');assert.ok(spaced.warnings.includes('section_matched_by_heading'));
 const exact=await result('long','retry-policy');assert.ok(!exact.warnings.includes('section_matched_by_heading'),'an exact id keeps the old answer');
 const ambiguous=await call('headtext','Install');assert.equal(ambiguous.status,422);const body=await ambiguous.json();
 assert.equal(body.code,'EXTRACTION_SECTION_AMBIGUOUS');assert.match(body.error,/2 headings/);assert.match(body.error,/install/);assert.match(body.error,/later/);
 const unique=await result('headtext','usage');assert.equal(unique.section.id,'usage');assert.match(unique.text,/USAGE_BODY/);
  const word=await result('long','Retry');assert.equal(word.section.id,'retry-policy');assert.ok(word.warnings.includes('section_matched_by_heading_word'),'a unique heading word now matches');
});
test('a missing section lists the ids the page offers so the next call can succeed',async()=>{
 const r=await call('long','#not-here');assert.equal(r.status,422);
 const body=await r.json();assert.equal(body.code,'EXTRACTION_SECTION_NOT_FOUND');
 assert.match(body.error,/not-here/);assert.match(body.error,/retry-policy/);assert.match(body.error,/nothing was charged/);
 assert.deepEqual(body.sections.map((s)=>s.id),['retry-policy','retry-code','next'],'headings first, hidden and navigation excluded');
 assert.deepEqual(body.sections[0],{id:'retry-policy',title:'Retry policy',kind:'heading'});
 const container=await call('container','nav-only');assert.equal(container.status,422);
 assert.deepEqual((await container.json()).sections,[{id:'one',title:null,kind:'container'}],'the nav copy stays unselectable');
 const pageWithoutIds=await call('plain','one');assert.equal(pageWithoutIds.status,415,'plain text still refuses section selection before the id lookup');
});
test('our former published section example reads the whole page where the page lacks it (stale router copies)',async()=>{
 const v=await result('container','retry-policy');assert.match(v.text,/CONTAINER_BODY/);assert.equal(v.section,null);assert.ok(v.warnings.includes('section_example_ignored'));assert.equal(validateOutput(v),true,JSON.stringify(validateOutput.errors));
 const plain=await call('plain','retry-policy');assert.equal(plain.status,200);
 const other=await call('container','not-here');assert.equal(other.status,422);
});
test('an empty section reads the whole page (planners send every listed input, filled or not)',async()=>{
 for(const id of ['', '  ']){const r=await call('long',id);assert.equal(r.status,200);const v=await r.json();assert.equal(v.section,null);}
});
test('IDs match exactly after source entity decoding and do not bypass HTML complexity limits',async()=>{
 const v=await result('odd','a&"日');assert.match(v.text,/ODD_BODY/);assert.doesNotMatch(v.text,/EXCLUDE/);assert.equal(v.section.id,'a&"日');assert.equal(validateOutput(v),true,JSON.stringify(validateOutput.errors));
 const missing=await call('odd','A&"日');assert.equal(missing.status,422);
 const deep=await call('deep','deep');assert.equal(deep.status,422);assert.equal((await deep.json()).code,'EXTRACTION_COMPLEXITY');
});
test('fragment alone retains the whole-page contract; explicit scopes still obey representation limits',async()=>{
 const fragment=await result('long#retry-policy');assert.equal(fragment.section,null);assert.doesNotMatch(fragment.text,/Stop after three/);
 for(const format of ['text','markdown','both']){const v=await result('long','retry-policy',{format});for(const key of ['text','markdown'])if(v[key])assert.ok(v[key].length<=500);}
});
