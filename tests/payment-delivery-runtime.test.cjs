const assert=require('node:assert/strict');
const {before,after,test}=require('node:test');
const {build}=require('esbuild');
const {Miniflare,convertV4MiniflareOptions}=require('miniflare');
let mf;
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
  mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:b.outputFiles[0].text,compatibilityDate:'2026-09-01',compatibilityFlags:['nodejs_compat'],durableObjects:{METRICS:{className:'Metrics',useSQLite:true}},bindings:{PAY_TO:recipient,NETWORK:'eip155:8453',PAYWALL:'on',TRIALS_ENABLED:'off',FACILITATOR_URL:'https://fixture.invalid',BASE_RPC_URL:'https://fixture.invalid'},outboundService:async r=>new URL(r.url).pathname==='/fail'?new Response('failure',{status:500}):new Response('<html><title>Paid fixture</title><main><h1>Useful result</h1><p>Static page for payment flow verification.</p></main></html>',{headers:{'content-type':'text/html'}})}));
});
after(async()=>{await mf?.dispose();});
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
  const summary=await revenue();assert.equal(summary.settlements,1);assert.equal(summary.grossAtomic,'2000');
  const counts=Object.values(summary.funnel.days).reduce((a,d)=>{for(const[k,v]of Object.entries(d))a[k]=(a[k]||0)+v;return a;},{});
  assert.equal(counts['http:/extract:completed'],1);assert.equal(counts['http:/extract:settled'],1);assert.equal(counts['http:/extract:execution_failed'],1);
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
    await client.connect(transport);assert.equal((await client.listTools()).tools.length,31);
    const quote=await client.callTool({name:'extract',arguments:{url:'https://public.example/article'}});
    assert.equal(quote.isError,true);const required=quote.structuredContent??JSON.parse(quote.content[0].text);assert.equal(required.accepts[0].amount,'2000');
    const result=await client.callTool({name:'extract',arguments:{url:'https://public.example/article'},_meta:{'x402/payment':payload(required.accepts[0],'5'.repeat(64),'mcp://tool/extract')}});
    assert.ok(!result.isError,JSON.stringify(result));assert.ok(result._meta.requestId);assert.equal(result._meta['x402/payment-response'].success,true);
    const summary=await revenue();assert.equal(summary.settlements,2);assert.equal(summary.grossAtomic,'4000');
    const day=Object.values(summary.funnel.days).at(-1);assert.equal(day['mcp:/extract:quote'],1);assert.equal(day['mcp:/extract:attempt'],1);assert.equal(day['mcp:/extract:completed'],1);
  }finally{await client.close();}
});
