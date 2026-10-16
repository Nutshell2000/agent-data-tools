const assert=require('node:assert/strict');
const {before,after,test}=require('node:test');
const {build}=require('esbuild');
const {Miniflare,convertV4MiniflareOptions}=require('miniflare');
const pages=require('./fixtures/extract-pages.cjs');
let mf,validateOutput,publishedExample;
test('table cells retain breaks, paragraph and list boundaries without splitting inline words',async()=>{
 const v=await result('tableBoundaries',{format:'both'});
 assert.equal(v.tables[0].caption,'API permissions');
 assert.deepEqual(v.tables[0].rows,[['Operations','Notes'],['Read Write','First rule Second rule'],['Open Close','readOnly visible [Image alt text: state diagram]']]);
 assert.match(v.text,/Read Write\tFirst rule Second rule/);
 assert.match(v.markdown,/\| Read Write \| First rule Second rule \|/);
 assert.doesNotMatch(v.text,/ReadWrite|ruleSecond|OpenClose|SECRET/);
 assert.equal(validateOutput(v),true,JSON.stringify(validateOutput.errors));
});
test('table count and row metadata limits do not remove late primary content',async()=>{
 const v=await result('manyTables',{format:'both',maxChars:'100000'});assert.equal(v.tables.length,20);assert.match(v.text,/table_20\tvalue_20/);assert.match(v.text,/row_109\tdata_109/);assert.ok(v.markdown.includes('data\\_109'));assert.equal(v.truncated,false);assert.ok(v.warnings.includes('details_truncated'));
});
test('metadata limits never erase primary table content',async()=>{
 const v=await result('tableAfterLinks',{format:'both',maxChars:'100000'});assert.match(v.text,/critical_limit\t314159/);assert.ok(v.markdown.includes('314159'));assert.ok(v.warnings.includes('details_truncated'));assert.equal(v.truncated,false);
});
test('literal code whitespace survives text and Markdown prose cleanup',async()=>{
 const v=await result('codeWhitespace',{format:'both'});assert.equal(v.text,'first  \n\n\n\n    second\nlast  ');assert.equal(v.codeBlocks[0].text,v.text);assert.ok(v.markdown.includes(v.text));
});
test('nested lists preserve hierarchy, starts and explicit item numbers',async()=>{
 const v=await result('nestedLists',{format:'both'});assert.match(v.markdown,/3\. Outer step[\s\S]*\n   - Nested detail[\s\S]*\n     8\. Deeper[\s\S]*\n7\. Next step/);assert.match(v.text,/\n   - Nested detail/);
});
test('truncated code has a complete fence inside the requested limit',async()=>{
 const v=await result('bigcode',{format:'markdown',maxChars:'500'});assert.ok(v.markdown.length<=500);assert.match(v.markdown,/^~~~text\n[\s\S]*\n~~~$/);assert.equal(v.truncated,true);
});
before(async()=>{
 const schemaBundle=await build({entryPoints:['src/discovery.ts'],bundle:true,write:false,format:'cjs',platform:'node'});const schemaModule={exports:{}};new Function('require','module','exports',schemaBundle.outputFiles[0].text)(require,schemaModule,schemaModule.exports);const response=schemaModule.exports.openApi('https://worker.test').paths['/extract'].get.responses['200'].content['application/json'];publishedExample=response.example;const schema=response.schema;const Ajv=require('ajv/dist/2020').default;validateOutput=new Ajv({strict:false}).compile(schema);
 const b=await build({stdin:{contents:`import {extract} from './src/routes/extract';export default{async fetch(r){const q=new URL(r.url).searchParams;try{return Response.json(await extract(q.get('url'),q.get('maxChars')??undefined,q.get('format')??undefined))}catch(e){return Response.json({error:e.message,code:e.code},{status:e.status||500})}}}`,resolveDir:process.cwd(),sourcefile:'quality-worker.ts'},bundle:true,write:false,format:'esm',platform:'browser'});
 mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:b.outputFiles[0].text,compatibilityDate:'2026-09-01',outboundService:async r=>new Response(pages[new URL(r.url).pathname.slice(1)]??'missing',{headers:{'content-type':'text/html'}})}));
});
after(async()=>{await mf?.dispose();});
async function call(page,params={}){const q=new URLSearchParams({url:'https://public.example/'+page,...params});return mf.dispatchFetch('https://worker.test/?'+q);}
async function result(page,params={}){const r=await call(page,params);assert.equal(r.status,200);return r.json();}

test('actual results in every representation conform to the published OpenAPI schema',async()=>{
 assert.equal(validateOutput(publishedExample),true,JSON.stringify(validateOutput.errors));
 for(const format of ['text','markdown','both'])for(const page of ['table','code','short','spans']){const v=await result(page,{format});assert.equal(validateOutput(v),true,JSON.stringify(validateOutput.errors));}
});
test('short semantic articles exclude unrelated page chrome and outside links',async()=>{
 const v=await result('short');assert.match(v.text,/Version 2 fixes parsing/);assert.doesNotMatch(v.text,/Unrelated/);assert.equal(v.contentSelection,'main');
 const links=await result('entities');assert.ok(!links.links.some(l=>l.href.endsWith('/outside')));
});
test('hidden content and cookie banners are excluded without losing visible text',async()=>{
 const v=await result('hidden');assert.match(v.text,/Keep this information/);assert.doesNotMatch(v.text,/HIDDEN_|COOKIE_NOTICE/);
});
test('code output retains indentation and language and optional Markdown has fences',async()=>{
 const v=await result('code',{format:'both'});assert.equal(v.codeBlocks[0].language,'python');assert.match(v.codeBlocks[0].text,/\n    return/);assert.match(v.markdown,/```python\ndef greet\(name\):\n    return/);assert.match(v.markdown,/`x < 2`/);
});
test('tables retain separate cells, captions and header rows in structured and Markdown output',async()=>{
 const v=await result('table',{format:'both'});assert.equal(v.tables[0].caption,'Plan limits');assert.deepEqual(v.tables[0].rows,[['Plan','Requests'],['Starter','100'],['Pro','2,000']]);assert.deepEqual(v.tables[0].headerRows,[0]);assert.match(v.markdown,/\| Starter \| 100 \|/);assert.match(v.text,/Starter\t100/);
});
test('HTML entities decode once, relative metadata resolves and unsafe links are discarded',async()=>{
 const v=await result('entities');assert.match(v.text,/© 2026 — €5 & &lt;tag&gt;/);assert.equal(v.canonical,'https://public.example/docs/prices');assert.equal(v.links[0].href,'https://public.example/next?a=1&b=2');assert.ok(!v.links.some(l=>l.href.startsWith('javascript:')));
});
test('omitted closing tags preserve paragraph and list boundaries',async()=>{
 const v=await result('malformed',{format:'both'});assert.match(v.text,/First paragraph\n+Second paragraph/);assert.match(v.markdown,/- First item\n- Second item/);assert.match(v.text,/Last paragraph/);
});
test('empty JS shells and challenge pages fail before a useful-output charge can settle',async()=>{
 for(const [page,code]of [['shell','EXTRACTION_EMPTY'],['challenge','EXTRACTION_BLOCKED']]){const r=await call(page);assert.equal(r.status,422);assert.equal((await r.json()).code,code);}
});
test('invalid limits and format fail as input errors rather than silently changing the request',async()=>{
 for(const params of [{maxChars:'nonsense'},{maxChars:'Infinity'},{format:'pdf'}]){const r=await call('short',params);assert.equal(r.status,400);await r.body?.cancel();}
});
test('content hashes are deterministic for the returned representation and table spans are explicit',async()=>{
 const a=await result('table'),b=await result('table');assert.match(a.contentHash,/^sha256:[a-f0-9]{64}$/);assert.equal(a.contentHash,b.contentHash);
 const spans=await result('spans');assert.equal(spans.tables[0].hasSpans,true);assert.ok(spans.warnings.includes('table_spans_present'));
});

 test('complex HTML is rejected and large code cannot escape output and metadata budgets',async()=>{
  for(const page of ['deep','many']){const r=await call(page);assert.equal(r.status,422);assert.equal((await r.json()).code,'EXTRACTION_COMPLEXITY');}
  const v=await result('bigcode',{maxChars:'500',format:'both'});assert.ok(v.text.length<=500);assert.ok(v.markdown.length<=500);assert.ok(v.codeBlocks[0].text.length<=500);assert.equal(v.codeBlocks[0].truncated,true);assert.equal(v.truncated,true);assert.ok(v.warnings.includes('markdown_truncated'));
 });

 test('ordered steps retain their start number and code inherits a declared language',async()=>{
  const v=await result('ordered',{format:'both'});assert.match(v.markdown,/3\. Third step\n4\. Fourth step/);assert.equal(v.codeBlocks[0].language,'python3');
 });
