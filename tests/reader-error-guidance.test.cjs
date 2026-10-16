const assert=require('node:assert/strict');
const {test,before}=require('node:test');
const {build}=require('esbuild');
let core,mcp,Client,InMemoryTransport;
const target='https://public.example/docs',key='0x'+'1'.repeat(64),secret='DO_NOT_ECHO_SIGNATURE_OR_CONTENT';
const encode=v=>Buffer.from(JSON.stringify(v)).toString('base64');
before(async()=>{
 async function load(entry){const b=await build({entryPoints:[entry],bundle:true,write:false,platform:'node',format:'cjs'});const m={exports:{}};new Function('require','module','exports',b.outputFiles[0].text)(require,m,m.exports);return m.exports;}
 core=await load('clients/reader-core.mjs');mcp=await load('clients/reader-mcp-core.mjs');
 ({Client}=await import('@modelcontextprotocol/sdk/client/index.js'));({InMemoryTransport}=await import('@modelcontextprotocol/sdk/inMemory.js'));
});
function fixture({status=422,code='EXTRACTION_SECTION_NOT_FOUND',body,receipt,lose=false,quoteStatus=402}={}){
 let requests=0,signs=0,submissions=0;
 const deps={getKey:()=>key,createPayload:async r=>{signs++;return{x402Version:2,resource:r.resource,accepted:r.accepts[0],payload:{signature:secret}};},fetcher:async(url,init)=>{
  requests++;assert.equal(init.redirect,'error');assert.equal(new URL(url).origin,core.READER_ORIGIN);
  if(!init.headers['PAYMENT-SIGNATURE'])return new Response(quoteStatus===402?null:JSON.stringify({code,error:secret}),{status:quoteStatus,headers:{'X-Request-ID':'quote-id',...(quoteStatus===402?{'PAYMENT-REQUIRED':encode({x402Version:2,resource:{url:core.READER_ORIGIN+new URL(url).pathname},accepts:[{scheme:'exact',network:'eip155:8453',asset:core.READER_ASSET,payTo:core.READER_RECIPIENT,amount:'2000',maxTimeoutSeconds:300}]})}:{})}});
  submissions++;if(lose)throw Error(key+secret);
  return new Response(body===undefined?JSON.stringify({code,error:key+secret,privateContent:secret}):typeof body==='function'?body():body,{status,headers:{'X-Request-ID':'paid-id',...(receipt?{'PAYMENT-RESPONSE':encode(receipt)}:{}),...(status===302?{location:'https://external.example/'}:{})}});
 }};return{deps,counts:()=>({requests,signs,submissions})};
}
const buy=(f,args=['buy',target,'--max-usdc','0.002'])=>core.runReader(args,f.deps);
function noSecret(v){assert.ok(!JSON.stringify(v).includes(key));assert.ok(!JSON.stringify(v).includes(secret));}

test('invalid local URLs and rejected unpaid input provide guidance without key access or signing',async()=>{
 for(const url of ['not-a-url','ftp://public.example/file','https://user:password@public.example/','http://127.0.0.1/']){
  const r=await core.runReader(['quote',url],{fetcher:()=>assert.fail('invalid target must not fetch'),getKey:()=>assert.fail('quote must not read key')});assert.equal(r.error,'invalid_public_url');assert.equal(r.paymentStatus,'not_signed');assert.match(r.guidance,/public HTTP/);assert.equal(r.retryAutomatically,false);
 }
 const f=fixture({quoteStatus:400});f.deps.getKey=()=>assert.fail('unpaid error must not read key');const r=await buy(f);assert.equal(r.httpStatus,400);assert.equal(r.error,'expected_unpaid_402_quote');assert.equal(r.serviceError.code,'EXTRACTION_SECTION_NOT_FOUND');assert.equal(r.paymentStatus,'not_signed');assert.equal(r.requestId,'quote-id');assert.deepEqual(f.counts(),{requests:1,signs:0,submissions:0});noSecret(r);
});

test('paid reader, sitemap and Bitcoin errors retain recognized reasons with one authorization and no fresh retry',async()=>{
 for(const [command,code] of [['buy','EXTRACTION_SECTION_NOT_FOUND'],['buy-sitemap','SITEMAP_DTD'],['buy-btc-fees','SOURCE_INVALID']]){
  const f=fixture({code}),args=command==='buy-btc-fees'?[command,'--max-usdc','0.002']:[command,target,'--max-usdc','0.002'];const r=await buy(f,args);assert.equal(r.ok,false);assert.equal(r.error,'paid_request_failed');assert.equal(r.serviceError.code,code);assert.ok(r.serviceError.guidance.length>20);assert.equal(r.paymentStatus,'unknown');assert.equal(r.requestId,'paid-id');assert.equal(r.retryAutomatically,false);assert.deepEqual(f.counts(),{requests:2,signs:1,submissions:1});noSecret(r);
 }
});

test('error reads are bounded and malformed, unknown or broken bodies cannot leak content or change payment status',async()=>{
 let canceled=false;
 const bodies=['not JSON',JSON.stringify({code:secret,error:key}),JSON.stringify({code:'toString',error:secret}),()=>new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('x'.repeat(9000)));},cancel(){canceled=true;}}),()=>new ReadableStream({start(c){c.error(Error(secret));}})];
 for(const body of bodies){const f=fixture({status:415,body}),r=await buy(f);assert.equal(r.serviceError.code,'HTTP_415');assert.equal(r.paymentStatus,'unknown');assert.equal(r.retryAutomatically,false);assert.equal(f.counts().signs,1);noSecret(r);}
 const unknown=await buy(fixture({status:500,body:JSON.stringify({code:secret,error:key})}));assert.equal(unknown.serviceError.code,'HTTP_500');assert.equal(unknown.paymentStatus,'unknown');noSecret(unknown);
 assert.equal(canceled,true);
});

test('service guidance does not replace settlement evidence or weaken uncertainty handling',async()=>{
 for(const receipt of [undefined,{success:false,network:'eip155:8453'},{success:true,network:'eip155:8453',transaction:'0x'+'2'.repeat(64)}]){
  const f=fixture({receipt}),r=await buy(f);assert.equal(r.paymentStatus,receipt?.success?'settled':receipt?'reported_not_settled':'unknown');assert.equal(r.serviceError.code,'EXTRACTION_SECTION_NOT_FOUND');assert.equal(r.retryAutomatically,false);assert.equal(f.counts().submissions,1);
 }
 const f=fixture({lose:true}),r=await buy(f);assert.equal(r.paymentStatus,'unknown');assert.equal(r.error,'purchase_outcome_uncertain');assert.equal(r.serviceError,undefined);assert.equal(f.counts().submissions,1);noSecret(r);
});

test('service redirects are refused before and after signing without parsing or following their destinations',async()=>{
 const f=fixture({status:302}),r=await buy(f);assert.equal(r.httpStatus,302);assert.equal(r.serviceError,null);assert.equal(r.paymentStatus,'unknown');assert.deepEqual(f.counts(),{requests:2,signs:1,submissions:1});assert.equal(r.retryAutomatically,false);
 const q=fixture({quoteStatus:302}),v=await buy(q);assert.equal(v.httpStatus,302);assert.equal(v.paymentStatus,'not_signed');assert.deepEqual(q.counts(),{requests:1,signs:0,submissions:0});
});

test('local MCP exposes recognized guidance and still locks further buys after an unknown signed result',async()=>{
 const f=fixture(),server=mcp.createReaderMcp({enabled:true,sessionCapAtomic:6000n,run:args=>core.runReader(args,f.deps)}),client=new Client({name:'offline-guidance',version:'1'});const[a,b]=InMemoryTransport.createLinkedPair();await server.connect(a);await client.connect(b);
 try{const first=await client.callTool({name:'reader_buy',arguments:{url:target,maxUsdc:'0.002'}});assert.equal(first.isError,true);assert.equal(first.structuredContent.serviceError.code,'EXTRACTION_SECTION_NOT_FOUND');assert.equal(first.structuredContent.paymentStatus,'unknown');assert.equal(first.structuredContent.session.reconciliationRequired,true);const next=await client.callTool({name:'reader_buy',arguments:{url:target,maxUsdc:'0.002'}});assert.equal(next.structuredContent.error,'reconciliation_required');const q=await client.callTool({name:'reader_quote',arguments:{url:target}});assert.equal(q.structuredContent.paymentStatus,'not_signed');assert.deepEqual(f.counts(),{requests:3,signs:1,submissions:1});noSecret(first);}
 finally{await client.close();await server.close();}
});
