const { getAddress } = require('viem');
const assert=require('node:assert/strict');
const {before,after,test}=require('node:test');
const {build}=require('esbuild');
const {Miniflare,convertV4MiniflareOptions}=require('miniflare');
let mf,feeScenario='valid';
const recipient='0x2074c40346ae2a90e0e4a391bcee6f16bf5277f5',asset='0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',payer='0x'+'1'.repeat(40);
before(async()=>{
  const b=await build({entryPoints:['src/index.ts'],bundle:true,format:'esm',platform:'browser',write:false,external:['cloudflare:workers','node:*'],plugins:[{name:'no-network-no-signer-facilitator',setup(b){
    b.onResolve({filter:/^url$/},()=>({path:'node:url',external:true}));
    b.onResolve({filter:/^\.\/facilitator$/},()=>({path:'fixture',namespace:'fixture'}));
    b.onLoad({filter:/.*/,namespace:'fixture'},()=>({loader:'js',contents:`export function buildFacilitator(){return {
      getSupported:async()=>({kinds:[{x402Version:2,scheme:'exact',network:'eip155:8453',extra:{name:'USD Coin',version:'2',asset:'${asset}',assetTransferMethod:'eip3009'}}],extensions:[]}),
      verify:async p=>({isValid:!p.payload.authorization.nonce.endsWith('eeee'),payer:'${payer}',invalidReason:'fixture-invalid'}),
      settle:async p=>({success:!p.payload.authorization.nonce.endsWith('ffff'),network:'eip155:8453',transaction:'0x'+'2'.repeat(64),payer:'${payer}',amount:'2000',errorReason:'fixture-failure'})
    }}` }));
  }}]});
  mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:b.outputFiles[0].text,compatibilityDate:'2026-09-01',compatibilityFlags:['nodejs_compat'],durableObjects:{METRICS:{className:'Metrics',useSQLite:true}},bindings:{PAY_TO:recipient,NETWORK:'eip155:8453',PAYWALL:'on',TRIALS_ENABLED:'off',FACILITATOR_URL:'https://fixture.invalid',BASE_RPC_URL:'https://fixture.invalid',STRIPE_READ_KEY:'rk_test_fixture',REVENUE_TOKEN:'owner-fixture-token',FLUXA_PROXY_SECRET:'fluxa-fixture-secret-0123456789'},outboundService:async r=>{
    const path=new URL(r.url).pathname;
    if(new URL(r.url).hostname==='api.stripe.com'){assert.equal(r.headers.get('authorization'),'Bearer rk_test_fixture');return path.endsWith('cs_test_unpaidSession01')?Response.json({mode:'payment',status:'open',payment_status:'unpaid'}):Response.json({mode:'payment',status:'complete',payment_status:'paid',currency:'usd',amount_total:500,metadata:{adt_credits:'5000'}});}
    if(new URL(r.url).hostname==='mempool.space'){const value=path.endsWith('recommended')?(feeScenario==='invalid'?{fastestFee:3}:{fastestFee:3,halfHourFee:2,hourFee:1,economyFee:1,minimumFee:1}):path.endsWith('height')?950000:{count:20,vsize:10000,total_fee:20000};return Response.json(value);}
    if(path==='/permalink-only')return new Response('<main><p id=empty><a class=pilcrow href="#empty">¶</a></p></main>',{headers:{'content-type':'text/html'}});
    if(path==='/image-described')return new Response('<main><img alt="Source says retry at most three times" src="https://unfetched.invalid/image.png"></main>',{headers:{'content-type':'text/html'}});
    if(path==='/image-undescribed')return new Response('<main><img src="https://unfetched.invalid/image.png"></main>',{headers:{'content-type':'text/html'}});
    if(path==='/sitemap.xml')return new Response('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://public.example/docs/start</loc></url></urlset>',{headers:{'content-type':'application/xml'}});
    if(path==='/bad-sitemap.xml')return new Response('<urlset><url>',{headers:{'content-type':'application/xml'}});
    return path==='/fail'?new Response('failure',{status:500}):new Response(path==='/shell'?'<html><div id=app></div><script>run()</script></html>':'<html><title>Paid fixture</title><main><h1 id="result">Useful result</h1><p>Static page for payment flow verification.</p></main></html>',{headers:{'content-type':'text/html'}});
  }}));
});
let mfFree;
before(async()=>{
  const b=await build({entryPoints:['src/index.ts'],bundle:true,format:'esm',platform:'browser',write:false,external:['cloudflare:workers','node:*'],plugins:[{name:'url',setup(b){b.onResolve({filter:/^url$/},()=>({path:'node:url',external:true}));}}]});
  mfFree=new Miniflare(convertV4MiniflareOptions({modules:true,script:b.outputFiles[0].text,compatibilityDate:'2026-09-01',compatibilityFlags:['nodejs_compat'],durableObjects:{METRICS:{className:'Metrics',useSQLite:true}},bindings:{PAY_TO:recipient,NETWORK:'eip155:8453',PAYWALL:'on',TRIALS_ENABLED:'on',FACILITATOR_URL:'https://fixture.invalid',BASE_RPC_URL:'https://fixture.invalid'},outboundService:async r=>{
    if(new URL(r.url).hostname==='fixture.invalid')return Response.json({kinds:[{x402Version:2,scheme:'exact',network:'eip155:8453',extra:{name:'USD Coin',version:'2'}}],extensions:[]});
    return new URL(r.url).pathname==='/fail'?new Response('failure',{status:500}):new Response('<html><title>Free fixture</title><main><h1>Free result</h1><p>Static page for the free-call check.</p></main></html>',{headers:{'content-type':'text/html'}});
  }}));
});
after(async()=>{await mf?.dispose();await mfFree?.dispose();});

test("FluxA's proxy secret serves $0.01 tools unpaid; dearer tools and a wrong secret still get the 402",async()=>{
  const fluxa=(path,secret='fluxa-fixture-secret-0123456789')=>mf.dispatchFetch('https://api.test'+path,{headers:{'x-fluxa-proxy-secret':secret,accept:'application/json'}});
  const ok=await fluxa('/uuid?count=1');assert.equal(ok.status,200);assert.equal((await ok.json()).uuids.length,1);
  const dear=await fluxa('/package-audit?ecosystem=npm&packages=left-pad');assert.equal(dear.status,402,'$0.20 tool behind a $0.01 FluxA endpoint');await dear.arrayBuffer();
  const wrong=await fluxa('/uuid','x'.repeat(31));assert.equal(wrong.status,402);await wrong.arrayBuffer();
  const rapidHeader=await mf.dispatchFetch('https://api.test/uuid',{headers:{'x-rapidapi-proxy-secret':'fluxa-fixture-secret-0123456789',accept:'application/json'}});assert.equal(rapidHeader.status,402,'the FluxA secret only works in its own header');await rapidHeader.arrayBuffer();
});

test('paused tools reject GET, HEAD and signed requests without payment or an upstream call',async()=>{
 const before=(await revenue()).settlements;
 for(const path of ['/regex/test','/air-quality','/uv','/elevation'])for(const method of ['GET','HEAD']){
  const r=await mf.dispatchFetch('https://api.test'+path,{method,headers:{'PAYMENT-SIGNATURE':'untrusted-not-a-payment'}});
  assert.equal(r.status,503);assert.equal(r.headers.has('PAYMENT-REQUIRED'),false);assert.equal(r.headers.has('PAYMENT-RESPONSE'),false);
  if(method==='GET')assert.equal((await r.json()).code,'TOOL_PAUSED');else assert.equal(await r.text(),'');
 }
 const {Client}=await import('@modelcontextprotocol/sdk/client/index.js');const{StreamableHTTPClientTransport}=await import('@modelcontextprotocol/sdk/client/streamableHttp.js');const client=new Client({name:'paused-tools-fixture',version:'1'});
 try{await client.connect(new StreamableHTTPClientTransport(new URL('https://api.test/mcp'),{fetch:(u,i)=>mf.dispatchFetch(u,i)}));
  const names=(await client.listTools()).tools.map(t=>t.name);
  for(const name of ['regex_test','air-quality','uv','elevation']){assert.ok(!names.includes(name));const r=await client.callTool({name,arguments:{}});assert.equal(r.isError,true);assert.ok(!r._meta?.['x402/payment-response']?.success);}
 }finally{await client.close();}
 assert.equal((await revenue()).settlements,before);
});
function errorBody(result){return result.structuredContent??JSON.parse(result.content[0].text);}
function payload(requirements,nonce='3'.repeat(64),url='https://api.test/extract'){
  return{x402Version:2,resource:{url},accepted:requirements,payload:{signature:'0x'+'a'.repeat(130),authorization:{from:payer,to:recipient,value:'2000',validAfter:'0',validBefore:String(Math.floor(Date.now()/1000)+300),nonce:'0x'+nonce}}};
}
async function revenue(){return(await mf.dispatchFetch('https://api.test/revenue')).json();}
test('actual HTTP paywall links successful payment to completed output and never settles failed execution or HEAD',async()=>{
  const url='https://api.test/extract?url=https%3A%2F%2Fpublic.example%2Farticle';
  const q=await mf.dispatchFetch(url);assert.equal(q.status,402);
  const requirements=JSON.parse(Buffer.from(q.headers.get('PAYMENT-REQUIRED'),'base64')).accepts[0];
  assert.equal(requirements.amount,'2000');
  // The body carries the same terms in x402 v1 shape for v1 clients (v2 clients read the header).
  const body=await q.json();assert.equal(body.x402Version,1);const v1base=body.accepts.find(a=>a.network==='base');assert.equal(v1base.maxAmountRequired,requirements.amount);assert.equal(v1base.payTo.toLowerCase(),requirements.payTo.toLowerCase());assert.equal(v1base.asset.toLowerCase(),requirements.asset.toLowerCase());assert.match(body.hint,/llms\.txt/);
  // Card payments are ready here, so a caller without a wallet gets the $5 Stripe checkout as one link.
  assert.match(body.hint,/No wallet\? Pay \$5 by card in one step at https:\/\/buy\.stripe\.com\/bJe4gz5ma1v99xMa33bII02 \(5,000 credits, about 500 calls at \$0\.01; the key is shown right after payment/);
  // A free sample shows the documented example without running the tool or settling.
  const sample=await mf.dispatchFetch('https://api.test/extract?sample=1');assert.equal(sample.status,200);assert.equal(sample.headers.get('X-Sample'),'1');
  const preview=await sample.json();assert.equal(preview.sample,true);assert.equal(preview.price,'$0.002');assert.ok(preview.example.contentHash);
  const headers={'PAYMENT-SIGNATURE':Buffer.from(JSON.stringify(payload(requirements))).toString('base64')};
  const h=await mf.dispatchFetch(url,{method:'HEAD',headers});assert.equal(h.status,402);await h.body?.cancel();
  assert.equal((await revenue()).settlements,0);
  const paid=await mf.dispatchFetch(url,{headers});assert.equal(paid.status,200);assert.ok(paid.headers.has('PAYMENT-RESPONSE'));assert.match((await paid.json()).text,/Useful result/);assert.ok(paid.headers.get('X-Request-ID'));
  const bad=await mf.dispatchFetch('https://api.test/extract?url=https%3A%2F%2Fpublic.example%2Ffail',{headers:{'PAYMENT-SIGNATURE':Buffer.from(JSON.stringify(payload(requirements,'4'.repeat(64)))).toString('base64')}});assert.equal(bad.status,502);await bad.body?.cancel();
  for(const suffix of ['eeee','ffff']) {
    const rejected=await mf.dispatchFetch(url,{headers:{'PAYMENT-SIGNATURE':Buffer.from(JSON.stringify(payload(requirements,'6'.repeat(60)+suffix))).toString('base64')}});
    assert.ok(rejected.status>=400);
    const receipt=rejected.headers.get('PAYMENT-RESPONSE');
    if(receipt) assert.equal(JSON.parse(Buffer.from(receipt,'base64')).success,false);
    await rejected.body?.cancel();
  }
  const empty=await mf.dispatchFetch('https://api.test/extract?url=https%3A%2F%2Fpublic.example%2Fshell',{headers:{'PAYMENT-SIGNATURE':Buffer.from(JSON.stringify(payload(requirements,'7'.repeat(64)))).toString('base64')}});assert.equal(empty.status,422);assert.equal((await empty.json()).code,'EXTRACTION_EMPTY');assert.ok(!empty.headers.has('PAYMENT-RESPONSE'));
  const summary=await revenue();assert.equal(summary.settlements,1);assert.equal(summary.grossAtomic,'2000');
  const counts=Object.values(summary.funnel.days).reduce((a,d)=>{for(const[k,v]of Object.entries(d))a[k]=(a[k]||0)+v;return a;},{});
  assert.equal(counts['http:/extract:completed'],1);assert.equal(counts['http:/extract:settled'],1);assert.equal(counts['http:/extract:execution_failed'],2);
  assert.equal(counts['http:/extract:verification_failed'],1);assert.equal(counts['http:/extract:settlement_failed'],1);
});
test('actual MCP transport supplies a free quote and returns a separately tracked paid fixture result',async()=>{
  const {Client}=await import('@modelcontextprotocol/sdk/client/index.js');
  const {StreamableHTTPClientTransport}=await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
  const client=new Client({name:'offline-payment-fixture',version:'1.0.0'});
  const transport=new StreamableHTTPClientTransport(new URL('https://api.test/mcp'),{fetch:async(input,init)=>{
    const req=new Request(input,init);return mf.dispatchFetch(req.url,{method:req.method,headers:req.headers,...(req.method==='POST'?{body:await req.text()}:{} )});
  }});
  try{
    await client.connect(transport);const listed=(await client.listTools()).tools;assert.equal(listed.length,268);assert.equal(listed.find(t=>t.name==='extract').annotations.idempotentHint,false);const api=await(await mf.dispatchFetch('https://api.test/openapi.json')).json();assert.deepEqual(listed.filter(t=>t.outputSchema).map(t=>t.name).sort(),['btc_fees','extract','sitemap']);for(const tool of listed.filter(t=>t.outputSchema)) assert.deepEqual(tool.outputSchema,Object.values(api.paths).find(p=>p.get?.operationId===tool.name).get.responses['200'].content['application/json'].schema);
    const quote=await client.callTool({name:'extract',arguments:{url:'https://public.example/article'}});
    assert.equal(quote.isError,true);assert.equal(quote.structuredContent,undefined);const required=quote.structuredContent??JSON.parse(quote.content[0].text);assert.equal(required.accepts[0].amount,'2000');
    const result=await client.callTool({name:'extract',arguments:{url:'https://public.example/article'},_meta:{'x402/payment':payload(required.accepts[0],'5'.repeat(64),'mcp://tool/extract')}});
    assert.ok(!result.isError,JSON.stringify(result));assert.match(result.structuredContent.text,/Useful result/);assert.equal(result.structuredContent.contentHash,JSON.parse(result.content[0].text).contentHash);assert.ok(result._meta.requestId);assert.equal(result._meta['x402/payment-response'].success,true);
    const empty=await client.callTool({name:'extract',arguments:{url:'https://public.example/shell'},_meta:{'x402/payment':payload(required.accepts[0],'8'.repeat(64),'mcp://tool/extract')}});assert.equal(empty.isError,true);assert.equal(errorBody(empty).code,'EXTRACTION_EMPTY');assert.ok(!empty._meta?.['x402/payment-response']?.success);
    const summary=await revenue();assert.equal(summary.settlements,2);assert.equal(summary.grossAtomic,'4000');
    const day=Object.values(summary.funnel.days).at(-1);assert.equal(day['mcp:/extract:quote'],1);assert.equal(day['mcp:/extract:attempt'],2);assert.equal(day['mcp:/extract:completed'],1);
  }finally{await client.close();}
});


test('sitemap HTTP and MCP fixtures settle successful output but never malformed XML or HEAD',async()=>{
  const before=(await revenue()).settlements;
  const url='https://api.test/sitemap?url=https%3A%2F%2Fpublic.example%2Fsitemap.xml';
  const quote=await mf.dispatchFetch(url);assert.equal(quote.status,402);
  const terms=JSON.parse(Buffer.from(quote.headers.get('PAYMENT-REQUIRED'),'base64')).accepts[0];await quote.body?.cancel();assert.equal(terms.amount,'2000');
  const headers={'PAYMENT-SIGNATURE':Buffer.from(JSON.stringify(payload(terms,'9'.repeat(64),'https://api.test/sitemap'))).toString('base64')};
  const head=await mf.dispatchFetch(url,{method:'HEAD',headers});assert.equal(head.status,402);await head.body?.cancel();assert.equal((await revenue()).settlements,before);
  const paid=await mf.dispatchFetch(url,{headers});assert.equal(paid.status,200);assert.ok(paid.headers.has('PAYMENT-RESPONSE'));assert.equal((await paid.json()).entries[0].url,'https://public.example/docs/start');
  const bad=await mf.dispatchFetch('https://api.test/sitemap?url=https%3A%2F%2Fpublic.example%2Fbad-sitemap.xml',{headers:{'PAYMENT-SIGNATURE':Buffer.from(JSON.stringify(payload(terms,'c'.repeat(64),'https://api.test/sitemap'))).toString('base64')}});assert.equal(bad.status,422);assert.equal((await bad.json()).code,'SITEMAP_INVALID');assert.equal(bad.headers.has('PAYMENT-RESPONSE'),false);
  const {Client}=await import('@modelcontextprotocol/sdk/client/index.js');const {StreamableHTTPClientTransport}=await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
  const client=new Client({name:'offline-sitemap-fixture',version:'1.0.0'});
  await client.connect(new StreamableHTTPClientTransport(new URL('https://api.test/mcp'),{fetch:async(input,init)=>{const r=new Request(input,init);return mf.dispatchFetch(r.url,{method:r.method,headers:r.headers,...(r.method==='POST'?{body:await r.text()}:{})});}}));
  try{
    const q=await client.callTool({name:'sitemap',arguments:{url:'https://public.example/sitemap.xml'}});assert.equal(q.isError,true);const required=q.structuredContent??JSON.parse(q.content[0].text);
    const result=await client.callTool({name:'sitemap',arguments:{url:'https://public.example/sitemap.xml'},_meta:{'x402/payment':payload(required.accepts[0],'d'.repeat(64),'mcp://tool/sitemap')}});assert.ok(!result.isError,JSON.stringify(result));assert.equal(result.structuredContent.kind,'urlset');assert.equal(result._meta['x402/payment-response'].success,true);
    const invalid=await client.callTool({name:'sitemap',arguments:{url:'https://public.example/bad-sitemap.xml'},_meta:{'x402/payment':payload(required.accepts[0],'e'.repeat(60)+'1111','mcp://tool/sitemap')}});assert.equal(invalid.isError,true);assert.equal(errorBody(invalid).code,'SITEMAP_INVALID');assert.ok(!invalid._meta?.['x402/payment-response']?.success);
  }finally{await client.close();}
  const summary=await revenue();assert.equal(summary.settlements,before+2);
});


test('explicit section HTTP/MCP output settles only after successful selection',async()=>{
 const before=(await revenue()).settlements;
 const url='https://api.test/extract?url=https%3A%2F%2Fpublic.example%2Farticle&section=result&format=both';
 const q=await mf.dispatchFetch(url);assert.equal(q.status,402);const required=JSON.parse(Buffer.from(q.headers.get('PAYMENT-REQUIRED'),'base64'));await q.body?.cancel();
 const headers=n=>({'PAYMENT-SIGNATURE':Buffer.from(JSON.stringify(payload(required.accepts[0],'1'.repeat(60)+n))).toString('base64')});
 const paid=await mf.dispatchFetch(url,{headers:headers('ab01')});assert.equal(paid.status,200);assert.equal((await paid.json()).section.id,'result');assert.equal(paid.headers.has('PAYMENT-RESPONSE'),true);
 const bad=await mf.dispatchFetch(url.replace('section=result','section=missing'),{headers:headers('ab02')});assert.equal(bad.status,422);assert.equal((await bad.json()).code,'EXTRACTION_SECTION_NOT_FOUND');assert.equal(bad.headers.has('PAYMENT-RESPONSE'),false);
 const {Client}=await import('@modelcontextprotocol/sdk/client/index.js');const{StreamableHTTPClientTransport}=await import('@modelcontextprotocol/sdk/client/streamableHttp.js');const client=new Client({name:'offline-section-fixture',version:'1'});
 try{await client.connect(new StreamableHTTPClientTransport(new URL('https://api.test/mcp'),{fetch:(url,init)=>mf.dispatchFetch(url,init)}));
 const success=await client.callTool({name:'extract',arguments:{url:'https://public.example/article',section:'result'},_meta:{'x402/payment':payload(required.accepts[0],'1'.repeat(60)+'ab03','mcp://tool/extract')}});assert.ok(!success.isError,JSON.stringify(success));assert.equal(success.structuredContent.section.id,'result');assert.equal(success._meta['x402/payment-response'].success,true);
 const failure=await client.callTool({name:'extract',arguments:{url:'https://public.example/article',section:'missing'},_meta:{'x402/payment':payload(required.accepts[0],'1'.repeat(60)+'ab04','mcp://tool/extract')}});assert.equal(failure.isError,true);assert.equal(errorBody(failure).code,'EXTRACTION_SECTION_NOT_FOUND');assert.ok(!failure._meta?.['x402/payment-response']?.success);
 }finally{await client.close();}
 assert.equal((await revenue()).settlements,before+2);
});


test('source-described image pages settle but image-only pages without text do not over HTTP or MCP',async()=>{
 const before=(await revenue()).settlements;
 const url='https://api.test/extract?url=https%3A%2F%2Fpublic.example%2Fimage-described';const q=await mf.dispatchFetch(url);assert.equal(q.status,402);const terms=JSON.parse(Buffer.from(q.headers.get('PAYMENT-REQUIRED'),'base64')).accepts[0];await q.body?.cancel();
 const headers=n=>({'PAYMENT-SIGNATURE':Buffer.from(JSON.stringify(payload(terms,'a'.repeat(60)+n))).toString('base64')});
 const good=await mf.dispatchFetch(url,{headers:headers('bc01')});assert.equal(good.status,200);const data=await good.json();assert.match(data.text,/Image alt text: Source says retry/);assert.ok(data.warnings.includes('image_alt_text_only'));assert.equal(good.headers.has('PAYMENT-RESPONSE'),true);
 const bad=await mf.dispatchFetch(url.replace('image-described','image-undescribed'),{headers:headers('bc02')});assert.equal(bad.status,422);assert.equal((await bad.json()).code,'EXTRACTION_EMPTY');assert.equal(bad.headers.has('PAYMENT-RESPONSE'),false);
 const{Client}=await import('@modelcontextprotocol/sdk/client/index.js');const{StreamableHTTPClientTransport}=await import('@modelcontextprotocol/sdk/client/streamableHttp.js');const client=new Client({name:'offline-alt-fixture',version:'1'});
 try{await client.connect(new StreamableHTTPClientTransport(new URL('https://api.test/mcp'),{fetch:(url,init)=>mf.dispatchFetch(url,init)}));
 const successful=await client.callTool({name:'extract',arguments:{url:'https://public.example/image-described'},_meta:{'x402/payment':payload(terms,'a'.repeat(60)+'bc03','mcp://tool/extract')}});assert.ok(!successful.isError,JSON.stringify(successful));assert.match(successful.structuredContent.text,/Image alt text: Source says retry/);assert.equal(successful._meta['x402/payment-response'].success,true);
 const failed=await client.callTool({name:'extract',arguments:{url:'https://public.example/image-undescribed'},_meta:{'x402/payment':payload(terms,'a'.repeat(60)+'bc04','mcp://tool/extract')}});assert.equal(failed.isError,true);assert.equal(errorBody(failed).code,'EXTRACTION_EMPTY');assert.ok(!failed._meta?.['x402/payment-response']?.success);
 }finally{await client.close();}assert.equal((await revenue()).settlements,before+2);
});


test('Bitcoin fee HTTP/MCP purchases settle valid data and never charge invalid upstream output',async()=>{
 const before=(await revenue()).settlements;const url='https://api.test/btc-fees';const q=await mf.dispatchFetch(url);assert.equal(q.status,402);const terms=JSON.parse(Buffer.from(q.headers.get('PAYMENT-REQUIRED'),'base64')).accepts[0];await q.body?.cancel();
 const headers=n=>({'PAYMENT-SIGNATURE':Buffer.from(JSON.stringify(payload(terms,'b'.repeat(60)+n,'https://api.test/btc-fees'))).toString('base64')});
 feeScenario='valid';const success=await mf.dispatchFetch(url,{headers:headers('cd01')});assert.equal(success.status,200);const data=await success.json();assert.equal(data.unit,'sat/vB');assert.equal(data.typicalPaymentVbytes,141);assert.equal(success.headers.has('PAYMENT-RESPONSE'),true);
 feeScenario='invalid';const fail=await mf.dispatchFetch(url,{headers:headers('cd02')});assert.equal(fail.status,502);assert.equal((await fail.json()).code,'SOURCE_INVALID');assert.equal(fail.headers.has('PAYMENT-RESPONSE'),false);
 const{Client}=await import('@modelcontextprotocol/sdk/client/index.js');const{StreamableHTTPClientTransport}=await import('@modelcontextprotocol/sdk/client/streamableHttp.js');const c=new Client({name:'offline-fee-flow',version:'1'});
 try{await c.connect(new StreamableHTTPClientTransport(new URL('https://api.test/mcp'),{fetch:(u,i)=>mf.dispatchFetch(u,i)}));feeScenario='valid';const good=await c.callTool({name:'btc_fees',arguments:{},_meta:{'x402/payment':payload(terms,'b'.repeat(60)+'cd03','mcp://tool/btc-fees')}});assert.ok(!good.isError,JSON.stringify(good));assert.equal(good.structuredContent.source,'https://mempool.space/api');assert.equal(good._meta['x402/payment-response'].success,true);
 feeScenario='invalid';const bad=await c.callTool({name:'btc_fees',arguments:{},_meta:{'x402/payment':payload(terms,'b'.repeat(60)+'cd04','mcp://tool/btc-fees')}});assert.equal(bad.isError,true);assert.equal(errorBody(bad).code,'SOURCE_INVALID');assert.ok(!bad._meta?.['x402/payment-response']?.success);
 }finally{feeScenario='valid';await c.close();}assert.equal((await revenue()).settlements,before+2);
});

test('permalink-only pages fail as empty over paid HTTP/MCP fixtures without settlement',async()=>{
 const before=(await revenue()).settlements,url='https://api.test/extract?url=https%3A%2F%2Fpublic.example%2Fpermalink-only';const q=await mf.dispatchFetch(url);assert.equal(q.status,402);const terms=JSON.parse(Buffer.from(q.headers.get('PAYMENT-REQUIRED'),'base64')).accepts[0];await q.body?.cancel();
 const failed=await mf.dispatchFetch(url,{headers:{'PAYMENT-SIGNATURE':Buffer.from(JSON.stringify(payload(terms,'d'.repeat(60)+'de01'))).toString('base64')}});assert.equal(failed.status,422);assert.equal((await failed.json()).code,'EXTRACTION_EMPTY');assert.equal(failed.headers.has('PAYMENT-RESPONSE'),false);
 const{Client}=await import('@modelcontextprotocol/sdk/client/index.js');const{StreamableHTTPClientTransport}=await import('@modelcontextprotocol/sdk/client/streamableHttp.js');const c=new Client({name:'offline-permalink-flow',version:'1'});
 try{await c.connect(new StreamableHTTPClientTransport(new URL('https://api.test/mcp'),{fetch:(u,i)=>mf.dispatchFetch(u,i)}));await c.listTools();const bad=await c.callTool({name:'extract',arguments:{url:'https://public.example/permalink-only'},_meta:{'x402/payment':payload(terms,'d'.repeat(60)+'de02','mcp://tool/extract')}});assert.equal(bad.isError,true);assert.equal(errorBody(bad).code,'EXTRACTION_EMPTY');assert.ok(!bad._meta?.['x402/payment-response']?.success);
 }finally{await c.close();}assert.equal((await revenue()).settlements,before);
});

test('card credits: a paid checkout issues one key that pays HTTP and MCP calls; fake keys and unpaid checkouts get nothing',async()=>{
 const settled=(await revenue()).settlements;
 const claim=s=>mf.dispatchFetch('https://api.test/credits/claim?session_id='+s,{headers:{accept:'application/json'}});
 assert.equal((await claim('cs_test_unpaidSession01')).status,402);
 const first=await (await claim('cs_test_paidSession0001')).json();
 assert.match(first.apiKey,/^adt_/);assert.equal(first.creditsAdded,5000);assert.equal(first.balanceCredits,5000);
 const again=await (await claim('cs_test_paidSession0001')).json();
 assert.equal(again.apiKey,first.apiKey);assert.equal(again.balanceCredits,5000);
 const auth={authorization:'Bearer '+first.apiKey};
 const ok=await mf.dispatchFetch('https://api.test/extract?url=https%3A%2F%2Fpublic.example%2Farticle',{headers:auth});
 assert.equal(ok.status,200);assert.equal(ok.headers.get('X-Credits-Charged'),'2');assert.equal(ok.headers.get('X-Credits-Remaining'),'4998');assert.equal(ok.headers.has('PAYMENT-RESPONSE'),false);
 const bad=await mf.dispatchFetch('https://api.test/extract?url=https%3A%2F%2Fpublic.example%2Ffail',{headers:{'x-api-key':first.apiKey}});
 assert.ok(bad.status>=400);assert.equal(bad.headers.get('X-Credits-Remaining'),'4998');
 const fake='adt_'+'z'.repeat(43);
 assert.equal((await mf.dispatchFetch('https://api.test/extract?url=https%3A%2F%2Fpublic.example%2Farticle',{headers:{authorization:'Bearer '+fake}})).status,401);
 const {Client}=await import('@modelcontextprotocol/sdk/client/index.js');const{StreamableHTTPClientTransport}=await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
 const call=async(key,args)=>{const client=new Client({name:'credits-fixture',version:'1'});
  try{await client.connect(new StreamableHTTPClientTransport(new URL('https://api.test/mcp'),{requestInit:{headers:{authorization:'Bearer '+key}},fetch:(u,i)=>mf.dispatchFetch(u,i)}));return await client.callTool({name:'extract',arguments:args});}finally{await client.close();}};
 const paidMcp=await call(first.apiKey,{url:'https://public.example/article'});
 assert.notEqual(paidMcp.isError,true);
 const failedMcp=await call(first.apiKey,{url:'https://public.example/fail'});
 assert.equal(failedMcp.isError,true);
 const quote=await call('none',{url:'https://public.example/article'});
 assert.equal(quote.isError,true);assert.ok(JSON.parse(quote.content[0].text).accepts.length>0);
 assert.match(quote.content.at(-1).text,/^PAYMENT NEEDED \(\$0\.002 .*https:\/\/api\.test\/credits/);
 // Card payments are ready here, so the assistant gets the $5 Stripe checkout as one link to show its user.
 assert.match(quote.content.at(-1).text,/pay \$5 by card in one step at https:\/\/buy\.stripe\.com\/bJe4gz5ma1v99xMa33bII02 \(Stripe; 5,000 credits, about 500 calls at \$0\.01; the key is shown right after payment/);assert.match(quote.content.at(-1).text,/connect to https:\/\/api\.test\/mcp\/account instead/);
 const viaUrl=new Client({name:'credits-url-fixture',version:'1'});
 try{await viaUrl.connect(new StreamableHTTPClientTransport(new URL('https://api.test/mcp/k/'+first.apiKey),{fetch:(u,i)=>mf.dispatchFetch(u,i)}));const r=await viaUrl.callTool({name:'extract',arguments:{url:'https://public.example/article'}});assert.notEqual(r.isError,true);}finally{await viaUrl.close();}
 assert.equal((await mf.dispatchFetch('https://api.test/mcp/k/not-a-key',{method:'POST'})).status,401);
 for(const p of ['/mcp','/mcp/chain']){const g=await mf.dispatchFetch('https://api.test'+p);assert.equal(g.status,405);assert.equal(g.headers.get('allow'),'POST');await g.arrayBuffer();}
 const fakeMcp=await call(fake,{url:'https://public.example/article'});
 assert.equal(fakeMcp.isError,true);assert.match(fakeMcp.content[0].text,/unknown API key/);
 const balance=await (await mf.dispatchFetch('https://api.test/credits/balance',{headers:auth})).json();
 assert.equal(balance.balanceCredits,4994);assert.equal(balance.calls,3);
 assert.equal((await revenue()).settlements,settled);
});
test('free calls: plain HTTP still gets 402, trial=1 and MCP run free, failures are not counted, and paid tools are never settled',async()=>{
 const url='https://api.test/extract?url=https%3A%2F%2Fpublic.example%2Farticle';
 const plain=await mfFree.dispatchFetch(url);assert.equal(plain.status,402);assert.match((await plain.json()).hint,/^Try it free: add trial=1/);
 const ip={'cf-connecting-ip':'198.51.100.7'};
 const first=await mfFree.dispatchFetch(url+'&trial=1',{headers:ip});assert.equal(first.status,200);assert.equal(first.headers.get('X-Free-Trial-Remaining'),'24');await first.arrayBuffer();
 const failed=await mfFree.dispatchFetch('https://api.test/extract?url=https%3A%2F%2Fpublic.example%2Ffail&trial=1',{headers:ip});assert.ok(failed.status>=400);assert.equal(failed.headers.get('X-Free-Trial-Remaining'),'24');await failed.arrayBuffer();
 const {Client}=await import('@modelcontextprotocol/sdk/client/index.js');const{StreamableHTTPClientTransport}=await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
 const client=new Client({name:'free-fixture',version:'1'});
 try{await client.connect(new StreamableHTTPClientTransport(new URL('https://api.test/mcp'),{requestInit:{headers:ip},fetch:(u,i)=>mfFree.dispatchFetch(u,i)}));
  assert.match(client.getInstructions(),/25 free successful calls.*\/credits/);
  const r=await client.callTool({name:'extract',arguments:{url:'https://public.example/article'}});
  assert.notEqual(r.isError,true);assert.match(r.content.at(-1).text,/^Free call \(23 of 25/);
  const bad=await client.callTool({name:'extract',arguments:{url:'https://public.example/fail'}});assert.equal(bad.isError,true);
  const again=await client.callTool({name:'extract',arguments:{url:'https://public.example/article'}});assert.match(again.content.at(-1).text,/^Free call \(22 of 25/);
 }finally{await client.close();}
 // A caller who has used all 25 gets the 402 and is counted as free_exhausted, the moment they are asked to pay.
 const other={'cf-connecting-ip':'198.51.100.8'};
 for(let i=0;i<25;i++){const r=await mfFree.dispatchFetch(url+'&trial=1',{headers:other});assert.equal(r.status,200);await r.arrayBuffer();}
 const over=await mfFree.dispatchFetch(url+'&trial=1',{headers:other});assert.equal(over.status,402);await over.arrayBuffer();
 const rev=await (await mfFree.dispatchFetch('https://api.test/revenue')).json();assert.equal(rev.settlements,0);
 const day=Object.values(rev.funnel.days).at(-1);assert.equal(day['http:/extract:free_call'],26);assert.equal(day['mcp:/extract:free_call'],2);assert.equal(day['http:/extract:free_exhausted'],1);
});
test('page views: a browser reading a tool page is counted with its referrer family; JSON clients are not',async()=>{
 const browser={accept:'text/html,application/xhtml+xml','user-agent':'Mozilla/5.0 Chrome/130',referer:'https://www.google.com/search?q=ofac+check+api'};
 const page=await mfFree.dispatchFetch('https://api.test/tools/check-counterparty',{headers:browser});assert.equal(page.status,200);await page.arrayBuffer();
 const json=await mfFree.dispatchFetch('https://api.test/tools/check-counterparty',{headers:{accept:'application/json'}});await json.arrayBuffer();
 const rev=await (await mfFree.dispatchFetch('https://api.test/revenue')).json();
 const day=Object.values(rev.funnel.days).at(-1);
 assert.equal(day['http:/tools/check-counterparty:page_view'],1);
 assert.equal(day['http:/from/google:referral'],1);
});
test('/revenue shows card-credit sales only to the owner token',async()=>{
  const anon=await revenue();assert.equal(anon.cardCredits,undefined);assert.ok('settlements' in anon);
  const wrong=await(await mf.dispatchFetch('https://api.test/revenue',{headers:{authorization:'Bearer owner-fixture-tokeX'}})).json();assert.equal(wrong.cardCredits,undefined);
  const owner=await(await mf.dispatchFetch('https://api.test/revenue',{headers:{authorization:'Bearer owner-fixture-token'}})).json();
  assert.equal(typeof owner.cardCredits.purchases,'number');assert.equal(typeof owner.cardCredits.purchasedUsd,'number');assert.ok('settlements' in owner);
});
test('MCP connections are counted by client name on /metrics/callers',async()=>{
  const {Client}=await import('@modelcontextprotocol/sdk/client/index.js');const{StreamableHTTPClientTransport}=await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
  const client=new Client({name:'Attribution Fixture',version:'1'});
  try{await client.connect(new StreamableHTTPClientTransport(new URL('https://api.test/mcp'),{fetch:(u,i)=>mf.dispatchFetch(u,i)}));}finally{await client.close();}
  let seen;for(let i=0;i<20&&!seen;i++){const body=await(await mf.dispatchFetch('https://api.test/metrics/callers')).json();seen=Object.values(body.mcpConnections)[0]?.attributionfixture;if(!seen)await new Promise(r=>setTimeout(r,50));}
  assert.ok(seen&&seen.open>=1,'initialize from an open /mcp connection is counted');
});

test('x402 v1: v1 terms in the 402 body beside the v2 header, X-PAYMENT settles only successful calls and is recorded',async()=>{
 const before=(await revenue()).settlements;
 const url='https://api.test/extract?url=https%3A%2F%2Fpublic.example%2Farticle';
 const quote=await mf.dispatchFetch(url);assert.equal(quote.status,402);
 assert.ok(quote.headers.get('payment-required'),'v2 header kept');
 const body=await quote.json();
 assert.equal(body.x402Version,1);
 const base=body.accepts.find(a=>a.network==='base');
 assert.equal(base.maxAmountRequired,'2000');assert.equal(base.payTo,getAddress(recipient),'payTo is quoted checksummed');assert.equal(base.payTo.toLowerCase(),recipient);assert.equal(base.asset.toLowerCase(),'0x833589fcd6edb6e08f4c7c32d4f71b54bda02913');
 assert.equal(base.resource,url);assert.deepEqual(base.extra,{name:'USD Coin',version:'2'});
 const v1=(nonce,value='2000')=>Buffer.from(JSON.stringify({x402Version:1,scheme:'exact',network:'base',payload:{signature:'0x'+'a'.repeat(130),authorization:{from:payer,to:recipient,value,validAfter:'0',validBefore:String(Math.floor(Date.now()/1000)+300),nonce:'0x'+nonce}}})).toString('base64');
 const paid=await mf.dispatchFetch(url,{headers:{'X-PAYMENT':v1('7'.repeat(60)+'aa01')}});
 assert.equal(paid.status,200);
 const receipt=JSON.parse(Buffer.from(paid.headers.get('x-payment-response'),'base64').toString());
 assert.equal(receipt.success,true);assert.equal(receipt.network,'base');assert.match(receipt.transaction,/^0x2{64}$/);
 await paid.arrayBuffer();
 const failed=await mf.dispatchFetch('https://api.test/extract?url=https%3A%2F%2Fpublic.example%2Ffail',{headers:{'X-PAYMENT':v1('7'.repeat(60)+'aa02')}});
 assert.ok(failed.status>=400&&failed.status!==402);assert.equal(failed.headers.has('x-payment-response'),false);await failed.arrayBuffer();
 const wrong=await mf.dispatchFetch(url,{headers:{'X-PAYMENT':v1('7'.repeat(60)+'aa03','1')}});
 assert.equal(wrong.status,402);assert.match((await wrong.json()).error,/at least 2000/);
 const invalid=await mf.dispatchFetch(url,{headers:{'X-PAYMENT':v1('7'.repeat(60)+'eeee')}});
 assert.equal(invalid.status,402);{const body=await invalid.json();assert.match(body.error,/^[a-z][a-z0-9_-]+$/,'a bare reason code, as the reference v1 server sends');assert.match(body.hint,/payment invalid/);}
 // Client variations that must not be refused: version as a string, the network as its CAIP-2 id, the value as a
 // number above the quote (the authorization's own value is what settles and is recorded).
 const loose=Buffer.from(JSON.stringify({x402Version:'1',scheme:'exact',network:'eip155:8453',payload:{signature:'0x'+'a'.repeat(130),authorization:{from:payer,to:recipient.toUpperCase().replace('0X','0x'),value:2500,validAfter:'0',validBefore:String(Math.floor(Date.now()/1000)+300),nonce:'0x'+'7'.repeat(60)+'aa05'}}})).toString('base64');
 const loosePaid=await mf.dispatchFetch(url,{headers:{'X-PAYMENT':loose}});
 assert.equal(loosePaid.status,200,await loosePaid.clone().text());
 assert.equal(JSON.parse(Buffer.from(loosePaid.headers.get('x-payment-response'),'base64').toString()).network,'base');
 await loosePaid.arrayBuffer();
 for(const bad of [{network:'eip155:1'},{network:'solana'}]){
  const r=await mf.dispatchFetch(url,{headers:{'X-PAYMENT':Buffer.from(JSON.stringify({x402Version:1,scheme:'exact',...bad,payload:{signature:'0x'+'a'.repeat(130),authorization:{from:payer,to:recipient,value:'2000',validAfter:'0',validBefore:'9999999999',nonce:'0x'+'7'.repeat(60)+'aa06'}}})).toString('base64')}});
  assert.equal(r.status,402);assert.match((await r.json()).error,/not accepted/);
 }
 await new Promise(r=>setTimeout(r,200));
 const after=await revenue();assert.equal(after.settlements,before+2);
 const day=Object.values(after.funnel.days).at(-1);assert.ok(day['http:/extract:refused_amount']>=1);assert.ok(day['http:/extract:refused_network']>=2);assert.ok(day['http:/extract:verification_failed']>=1);
});
