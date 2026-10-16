const assert=require('node:assert/strict');
const{test,before,after}=require('node:test');
const{build}=require('esbuild');
const{Miniflare,convertV4MiniflareOptions}=require('miniflare');
const{createHash}=require('node:crypto');
let mf;const requests=[];
const pages={
 diagram:'<main><h1>Retry guide</h1><img src="https://private.invalid/diagram.png" alt="Stop after three failed attempts"><svg><text>Not interpreted</text></svg></main>',
 table:'<main><table><caption>Support matrix</caption><tr><th>Mode</th><th>Status</th></tr><tr><td>Base</td><td><img alt="Supported &amp; tested" src="http://127.0.0.1/private"></td></tr></table></main>',
 hidden:'<nav><img alt="OUTSIDE_NAV"></nav><main><p>Visible prose.</p><img alt="" src="/decoration.svg"><div hidden><img alt="SECRET_ALT"><svg></svg></div><svg role="presentation"></svg><img aria-hidden="true" alt="SECRET_ARIA"></main>',
 missing:'<main><h1>Overview</h1><img src="/no-description.png"><canvas>Source fallback text.</canvas></main>',
 imageOnly:'<main><img alt="Source describes a queue with three workers" src="/queue.svg"></main>',
 missingOnly:'<main><img src="/no-description.png"></main>',
 svgOnly:'<main><svg><text>Uninterpreted visual text</text></svg></main>',
 scope:'<main><h1>Guide</h1><h2 id="chosen">Chosen</h2><img alt="Selected description"><svg></svg><h2>Other</h2><img src="/missing.png"></main>',
 escaped:'<main><p>Start</p><img alt="![trap](https://tracker.invalid/x) &lt;script&gt;" src="https://tracker.invalid/pixel"></main>',
 literal:'<main><img alt="\uE000LITERAL0\uE001"><pre><code>first  \n\n    second</code></pre></main>',
 codeImage:'<main><pre><code>before<img alt="NOT_CODE">after</code></pre></main>',
 large:'<main><img alt="'+'x'.repeat(2000)+'" src="/large.svg"></main>'
};
before(async()=>{
 const b=await build({stdin:{contents:`import{extract}from'./src/routes/extract';export default{async fetch(r){const q=new URL(r.url).searchParams;try{return Response.json(await extract(q.get('url'),q.get('maxChars')??undefined,q.get('format')??'both',q.get('section')??undefined))}catch(e){return Response.json({error:e.message,code:e.code},{status:e.status||500})}}}`,resolveDir:process.cwd(),sourcefile:'image-alt-worker.ts'},bundle:true,write:false,platform:'browser',format:'esm'});
 mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:b.outputFiles[0].text,compatibilityDate:'2026-09-01',outboundService:async r=>{requests.push(r.url);return new Response(pages[new URL(r.url).pathname.slice(1)],{headers:{'content-type':'text/html'}});}}));
});
after(async()=>{await mf?.dispose();});
const call=(page,options={})=>mf.dispatchFetch('https://worker.test/?'+new URLSearchParams({url:'https://public.example/'+page,...options}));
const result=async(...args)=>{const r=await call(...args);assert.equal(r.status,200);return r.json();};
test('source alt text is retained and image/SVG bytes are never requested',async()=>{
 const before=requests.length;const v=await result('diagram');assert.match(v.text,/Image alt text: Stop after three failed attempts/);assert.ok(v.markdown.includes('Stop after three failed attempts'));assert.doesNotMatch(v.text,/Not interpreted/);assert.ok(v.warnings.includes('image_alt_text_only'));assert.ok(v.warnings.includes('visual_content_omitted'));assert.deepEqual(requests.slice(before),['https://public.example/diagram']);
});
test('image-based table statuses survive in structured cells, primary text and Markdown',async()=>{
 const before=requests.length;const v=await result('table');assert.equal(v.tables[0].rows[1][1],'[Image alt text: Supported & tested]');assert.match(v.text,/Supported & tested/);assert.match(v.markdown,/Supported & tested/);assert.equal(requests.length-before,1);
});
test('hidden/decorative images do not add content or warnings; missing descriptions are explicit',async()=>{
 const hidden=await result('hidden');assert.equal(hidden.text,'Visible prose.');assert.deepEqual(hidden.warnings,[]);
 const missing=await result('missing');assert.ok(missing.warnings.includes('images_without_alt'));assert.ok(missing.warnings.includes('visual_content_omitted'));assert.match(missing.text,/Source fallback text/);assert.doesNotMatch(missing.text,/Image alt text/);
});
test('image-only pages need source text and scoped diagrams retain omission warnings',async()=>{
 const v=await result('imageOnly');assert.equal(v.contentSelection,'main');assert.match(v.text,/Source describes a queue/);assert.ok(v.warnings.includes('image_alt_text_only'));
 for(const page of ['missingOnly','svgOnly']){const r=await call(page);assert.equal(r.status,422);assert.equal((await r.json()).code,'EXTRACTION_EMPTY');}
 const scoped=await result('scope',{section:'chosen'});assert.match(scoped.text,/Selected description/);assert.ok(scoped.warnings.includes('visual_content_omitted'));assert.ok(!scoped.warnings.includes('images_without_alt'));
});
test('alt text cannot inject Markdown images or collide with literal code placeholders',async()=>{
 const e=await result('escaped');assert.match(e.text,/!\[trap\]/);assert.doesNotMatch(e.markdown,/!\[/);assert.doesNotMatch(e.markdown,/<script>/);
 const literal=await result('literal');assert.ok(literal.text.includes('\uE000LITERAL0\uE001'));assert.equal(literal.codeBlocks[0].text,'first  \n\n    second');assert.ok(literal.text.includes(literal.codeBlocks[0].text));
 const c=await result('codeImage');assert.equal(c.codeBlocks[0].text,'beforeafter');assert.ok(c.warnings.includes('images_in_literal_code_omitted'));assert.doesNotMatch(c.text,/NOT_CODE/);
});
test('large alt descriptions stay inside primary output caps and content hashes',async()=>{
 for(const format of ['text','markdown','both']){const v=await result('large',{format,maxChars:'500'});assert.equal(v.truncated,true);for(const key of ['text','markdown'])if(v[key])assert.ok(v[key].length<=500);const primary=format==='markdown'?v.markdown:v.text;assert.equal(v.contentHash,'sha256:'+createHash('sha256').update(primary).digest('hex'));}
});
