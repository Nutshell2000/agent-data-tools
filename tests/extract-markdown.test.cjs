const assert = require('node:assert/strict');
const {before, after, test} = require('node:test');
const {build} = require('esbuild');
const {createHash} = require('node:crypto');
const {Miniflare, convertV4MiniflareOptions} = require('miniflare');
const source = '# API notes\n\n| Field | Value |\n| --- | --- |\n| retry | 3 |\n\n```python\ndef run():\n    return 1  \n\n\n```\n\n[Next](./next.md)\n\n<script>UNTRUSTED_SOURCE</script>\n';
let mf, calls, validate;
before(async()=>{
 const contract=await build({entryPoints:['src/lib/extract-contract.ts'],bundle:true,write:false,format:'cjs',platform:'node'});const module={exports:{}};new Function('require','module','exports',contract.outputFiles[0].text)(require,module,module.exports);validate=new(require('ajv/dist/2020').default)({strict:false}).compile(module.exports.EXTRACT_OUTPUT_SCHEMA);
 const b=await build({stdin:{contents:`import {extract} from './src/routes/extract';export default{async fetch(r){const q=new URL(r.url).searchParams;try{return Response.json(await extract(q.get('url'),q.get('maxChars')??undefined,q.get('format')??'both',q.get('section')??undefined))}catch(e){return Response.json({error:e.message,code:e.code},{status:e.status||500})}}}`,resolveDir:process.cwd(),sourcefile:'markdown-worker.ts'},bundle:true,write:false,format:'esm',platform:'browser'});
 mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:b.outputFiles[0].text,compatibilityDate:'2026-09-01',outboundService:async r=>{
  calls.push(r.url);const path=new URL(r.url).pathname;
  if(path==='/redirect')return new Response(null,{status:302,headers:{location:'/README.md'}});
  const mime=path==='/README.md'||path==='/README.markdown'||path==='/plain.txt'?'text/plain':path==='/html.md'?'text/html':path==='/fake.md'?'application/pdf':'TEXT/MARKDOWN; charset=utf-8';
  const body=path==='/big'?'# Large\n\n```text\n'+'x'.repeat(2*1024*1024):path==='/empty'?' \n  ':path==='/leading'?' '.repeat(600)+'Visible later':source;
  return new Response(body,{headers:{'content-type':mime}});
 }}));
});
after(async()=>{await mf?.dispose();});
async function call(path,extra={}){calls=[];return mf.dispatchFetch('https://worker.test/?'+new URLSearchParams({url:'https://public.example'+path,...extra}));}
test('Markdown MIME preserves literal source/code/table syntax and hashes without executing or fetching links',async()=>{
 const r=await call('/typed');assert.equal(r.status,200);const v=await r.json();assert.equal(v.sourceFormat,'markdown');assert.equal(v.text,source);assert.equal(v.markdown,source);assert.equal(v.contentHash,'sha256:'+createHash('sha256').update(source).digest('hex'));assert.equal(v.truncated,false);
 assert.equal(v.contentSelection,'plain');assert.equal(v.linkBaseUrl,v.finalUrl);assert.equal(v.section,null);for(const name of ['headings','links','tables','codeBlocks'])assert.deepEqual(v[name],[]);assert.ok(v.warnings.includes('markdown_metadata_unparsed'));assert.equal(calls.length,1);assert.equal(validate(v),true,JSON.stringify(validate.errors));
});
test('plain-text Markdown paths are explicitly disclosed, using the final redirected path',async()=>{
 for(const path of ['/README.md','/README.markdown','/redirect']){const r=await call(path);assert.equal(r.status,200);const v=await r.json();assert.equal(v.sourceFormat,'markdown');assert.equal(v.markdown,source);assert.ok(v.warnings.includes('markdown_inferred_from_path'));}
 const plain=await(await call('/plain.txt')).json();assert.equal(plain.sourceFormat,'plain');assert.notEqual(plain.markdown,source);assert.ok(!plain.warnings.includes('markdown_inferred_from_path'));
 const fake=await call('/fake.md');assert.equal(fake.status,415);await fake.body?.cancel();
 const html=await(await call('/html.md')).json();assert.equal(html.sourceFormat,'html');assert.ok(!html.warnings.includes('markdown_inferred_from_path'));
});
test('Markdown representation limits, format-specific hashes and input truncation remain explicit',async()=>{
 for(const format of ['text','markdown','both']){
  const r=await call('/big',{format,maxChars:'500'});assert.equal(r.status,200);const v=await r.json();assert.equal(v.truncated,true);assert.ok(v.warnings.includes('input_truncated'));assert.ok(v.warnings.includes('source_markdown_may_be_incomplete'));const repr=format==='markdown'?'markdown':'text';assert.equal(v[repr].length,500);assert.equal(v.contentHash,'sha256:'+createHash('sha256').update(v[repr]).digest('hex'));assert.equal(validate(v),true,JSON.stringify(validate.errors));
 }
});
test('blank Markdown and HTML-only section selection fail before useful execution',async()=>{
 const blank=await call('/empty');assert.equal(blank.status,422);await blank.body?.cancel();
 const scoped=await call('/typed',{section:'api-notes'});assert.equal(scoped.status,415);assert.equal((await scoped.json()).code,'EXTRACTION_SECTION_UNSUPPORTED');
 for(const format of ['text','markdown','both']){const r=await call('/leading',{format,maxChars:'500'});assert.equal(r.status,422);assert.equal((await r.json()).code,'EXTRACTION_EMPTY');}
});
