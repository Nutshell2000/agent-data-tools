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
  mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:b.outputFiles[0].text,compatibilityDate:'2026-09-01',compatibilityFlags:['nodejs_compat'],durableObjects:{METRICS:{className:'Metrics',useSQLite:true}},bindings:{PAY_TO:recipient,NETWORK:'eip155:8453',PAYWALL:'on',TRIALS_ENABLED:'off',FACILITATOR_URL:'https://fixture.invalid',BASE_RPC_URL:'https://fixture.invalid'},outboundService:async r=>{
    const path=new URL(r.url).pathname;
    if(new URL(r.url).hostname==='mempool.space'){const value=path.endsWith('recommended')?(feeScenario==='invalid'?{fastestFee:3}:{fastestFee:3,halfHourFee:2,hourFee:1,economyFee:1,minimumFee:1}):path.endsWith('height')?950000:{count:20,vsize:10000,total_fee:20000};return Response.json(value);}
    if(path==='/permalink-only')return new Response('<main><p id=empty><a class=pilcrow href="#empty">¶</a></p></main>',{headers:{'content-type':'text/html'}});
    if(path==='/image-described')return new Response('<main><img alt="Source says retry at most three times" src="https://unfetched.invalid/image.png"></main>',{headers:{'content-type':'text/html'}});
    if(path==='/image-undescribed')return new Response('<main><img src="https://unfetched.invalid/image.png"></main>',{headers:{'content-type':'text/html'}});
    if(path==='/sitemap.xml')return new Response('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://public.example/docs/start</loc></url></urlset>',{headers:{'content-type':'application/xml'}});
    if(path==='/bad-sitemap.xml')return new Response('<urlset><url>',{headers:{'content-type':'application/xml'}});
    return path==='/fail'?new Response('failure',{status:500}):new Response(path==='/shell'?'<html><div id=app></div><script>run()</script></html>':'<html><title>Paid fixture</title><main><h1 id="result">Useful result</h1><p>Static page for payment flow verification.</p></main></html>',{headers:{'content-type':'text/html'}});
  }}));
});
after(async()=>{await mf?.dispose();});
function errorBody(result){return result.structuredContent??JSON.parse(result.content[0].text);}
function payload(requirements,nonce='3'.repeat(64),url='https://api.test/extract'){
  return{x402Version:2,resource:{url},accepted:requirements,payload:{signature:'0x'+'a'.repeat(130),authorization:{from:payer,to:recipient,value:'2000',validAfter:'0',validBefore:String(Math.floor(Date.now()/1000)+300),nonce:'0x'+nonce}}};
}
async function revenue(){return(await mf.dispatchFetch('https://api.test/revenue')).json();}
test('actual HTTP paywall links successful payment to completed output and never settles failed execution or HEAD',async()=>{
  const url='https://api.test/extract?url=https%3A%2F%2Fpublic.example%2Farticle';
  const q=await mf.dispatchFetch(url);assert.equal(q.status,402);
  const requirements=JSON.parse(Buffer.from(q.headers.get('PAYMENT-REQUIRED'),'base64')).accepts[0];
  assert.equal(requirements.amount,'2000');await q.body?.cancel();
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
    await client.connect(transport);const listed=(await client.listTools()).tools;assert.equal(listed.length,32);assert.equal(listed.find(t=>t.name==='extract').annotations.idempotentHint,false);const api=await(await mf.dispatchFetch('https://api.test/openapi.json')).json();assert.deepEqual(listed.filter(t=>t.outputSchema).map(t=>t.name),['extract','sitemap','btc-fees']);for(const tool of listed.filter(t=>t.outputSchema)) assert.deepEqual(tool.outputSchema,api.paths['/'+tool.name].get.responses['200'].content['application/json'].schema);
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
 try{await c.connect(new StreamableHTTPClientTransport(new URL('https://api.test/mcp'),{fetch:(u,i)=>mf.dispatchFetch(u,i)}));feeScenario='valid';const good=await c.callTool({name:'btc-fees',arguments:{},_meta:{'x402/payment':payload(terms,'b'.repeat(60)+'cd03','mcp://tool/btc-fees')}});assert.ok(!good.isError,JSON.stringify(good));assert.equal(good.structuredContent.source,'https://mempool.space/api');assert.equal(good._meta['x402/payment-response'].success,true);
 feeScenario='invalid';const bad=await c.callTool({name:'btc-fees',arguments:{},_meta:{'x402/payment':payload(terms,'b'.repeat(60)+'cd04','mcp://tool/btc-fees')}});assert.equal(bad.isError,true);assert.equal(errorBody(bad).code,'SOURCE_INVALID');assert.ok(!bad._meta?.['x402/payment-response']?.success);
 }finally{feeScenario='valid';await c.close();}assert.equal((await revenue()).settlements,before+2);
});

test('permalink-only pages fail as empty over paid HTTP/MCP fixtures without settlement',async()=>{
 const before=(await revenue()).settlements,url='https://api.test/extract?url=https%3A%2F%2Fpublic.example%2Fpermalink-only';const q=await mf.dispatchFetch(url);assert.equal(q.status,402);const terms=JSON.parse(Buffer.from(q.headers.get('PAYMENT-REQUIRED'),'base64')).accepts[0];await q.body?.cancel();
 const failed=await mf.dispatchFetch(url,{headers:{'PAYMENT-SIGNATURE':Buffer.from(JSON.stringify(payload(terms,'d'.repeat(60)+'de01'))).toString('base64')}});assert.equal(failed.status,422);assert.equal((await failed.json()).code,'EXTRACTION_EMPTY');assert.equal(failed.headers.has('PAYMENT-RESPONSE'),false);
 const{Client}=await import('@modelcontextprotocol/sdk/client/index.js');const{StreamableHTTPClientTransport}=await import('@modelcontextprotocol/sdk/client/streamableHttp.js');const c=new Client({name:'offline-permalink-flow',version:'1'});
 try{await c.connect(new StreamableHTTPClientTransport(new URL('https://api.test/mcp'),{fetch:(u,i)=>mf.dispatchFetch(u,i)}));await c.listTools();const bad=await c.callTool({name:'extract',arguments:{url:'https://public.example/permalink-only'},_meta:{'x402/payment':payload(terms,'d'.repeat(60)+'de02','mcp://tool/extract')}});assert.equal(bad.isError,true);assert.equal(errorBody(bad).code,'EXTRACTION_EMPTY');assert.ok(!bad._meta?.['x402/payment-response']?.success);
 }finally{await c.close();}assert.equal((await revenue()).settlements,before);
});
