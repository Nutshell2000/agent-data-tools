const assert = require('node:assert/strict');
const {test} = require('node:test');
const {readFile} = require('node:fs/promises');
const {build} = require('esbuild');
const {Miniflare,convertV4MiniflareOptions} = require('miniflare');

async function load(path){const b=await build({entryPoints:[path],bundle:true,write:false,format:'esm',platform:'node'});return import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));}
test('static exact validators enforce representation and metadata without mutation or runtime eval',async()=>{
 const {assertToolOutput}=await load('src/lib/output-contract.ts');
 const sample=JSON.parse(await readFile('public/examples/extract/technical-guide.json','utf8')).result;
 const before=JSON.stringify(sample);assert.doesNotThrow(()=>assertToolOutput('/extract',sample));assert.equal(JSON.stringify(sample),before);
 const invalid=[{...sample,format:'text'}, {...sample,sourceMetadata:{...sample.sourceMetadata,verification:'verified'}}, {...sample,sourceMetadata:{...sample.sourceMetadata,authors:Array(6).fill({value:'author',source:'head'})}}];
 for(const value of invalid)assert.throws(()=>assertToolOutput('/extract',value),e=>e.code==='OUTPUT_CONTRACT_INVALID'&&e.status===502&&!e.message.includes('author'));
 assert.throws(()=>assertToolOutput('/sitemap',{}),e=>e.code==='OUTPUT_CONTRACT_INVALID');assert.throws(()=>assertToolOutput('/btc-fees',{}),e=>e.code==='OUTPUT_CONTRACT_INVALID');
 assert.doesNotThrow(()=>assertToolOutput('/time',{}));
 const generated=await readFile('src/lib/output-validators.generated.ts','utf8');assert.ok(!/new Function|eval\(/.test(generated));
});

test('malformed paid outputs cannot settle through HTTP or schema-aware MCP clients',async()=>{
 const recipient='0x2074c40346ae2a90e0e4a391bcee6f16bf5277f5',asset='0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',payer='0x'+'1'.repeat(40);
 const b=await build({entryPoints:['src/index.ts'],bundle:true,format:'esm',platform:'browser',write:false,external:['cloudflare:workers','node:*'],plugins:[{name:'offline-invalid-output-fixture',setup(b){
  b.onResolve({filter:/^url$/},()=>({path:'node:url',external:true}));
  b.onResolve({filter:/^\.\/facilitator$/},()=>({path:'facilitator',namespace:'fixture'}));
  b.onLoad({filter:/.*/,namespace:'fixture'},()=>({loader:'js',contents:`export function buildFacilitator(){return {getSupported:async()=>({kinds:[{x402Version:2,scheme:'exact',network:'eip155:8453',extra:{name:'USD Coin',version:'2',asset:'${asset}',assetTransferMethod:'eip3009'}}],extensions:[]}),verify:async()=>({isValid:true,payer:'${payer}'}),settle:async()=>{throw Error('Fixture must never settle')}}}`}));
  b.onLoad({filter:/[\\/]src[\\/]tools\.ts$/},async({path})=>{
   const text=await readFile(path,'utf8'),needle='const result = await handler(env, input);';assert.ok(text.includes(needle));
   return{loader:'ts',contents:text.replace(needle,'const result = { fixtureOnly: "invalid paid result" };')};
  });
 }}]});
 const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:b.outputFiles[0].text,compatibilityDate:'2026-09-01',compatibilityFlags:['nodejs_compat'],durableObjects:{METRICS:{className:'Metrics',useSQLite:true}},bindings:{PAY_TO:recipient,NETWORK:'eip155:8453',PAYWALL:'on',TRIALS_ENABLED:'off',FACILITATOR_URL:'https://fixture.invalid',BASE_RPC_URL:'https://fixture.invalid'},outboundService:()=>{throw Error('No upstream requests expected')}}));
 const {Client}=await import('@modelcontextprotocol/sdk/client/index.js');const{StreamableHTTPClientTransport}=await import('@modelcontextprotocol/sdk/client/streamableHttp.js');const client=new Client({name:'offline-contract-rejection',version:'1'});
 let nonce=0;const payment=(terms,url)=>({x402Version:2,resource:{url},accepted:terms,payload:{signature:'0x'+'a'.repeat(130),authorization:{from:payer,to:recipient,value:'2000',validAfter:'0',validBefore:String(Math.floor(Date.now()/1000)+300),nonce:'0x'+(++nonce).toString(16).padStart(64,'0')}}});
 try{
  await client.connect(new StreamableHTTPClientTransport(new URL('https://api.test/mcp'),{fetch:(u,i)=>mf.dispatchFetch(u,i)}));await client.listTools();
  for(const tool of ['extract','sitemap','btc-fees']){
   const args=tool==='btc-fees'?{}:{url:'https://public.example/test'},url='https://api.test/'+tool+'?'+new URLSearchParams(args);
   const q=await mf.dispatchFetch(url);assert.equal(q.status,402);const terms=JSON.parse(Buffer.from(q.headers.get('PAYMENT-REQUIRED'),'base64')).accepts[0];await q.body?.cancel();
   const fail=await mf.dispatchFetch(url,{headers:{'PAYMENT-SIGNATURE':Buffer.from(JSON.stringify(payment(terms,url))).toString('base64')}});assert.equal(fail.status,502);assert.equal((await fail.json()).code,'OUTPUT_CONTRACT_INVALID');assert.equal(fail.headers.has('PAYMENT-RESPONSE'),false);
   const quote=await client.callTool({name:tool,arguments:args});assert.equal(quote.isError,true);assert.equal(quote.structuredContent,undefined);assert.equal(JSON.parse(quote.content[0].text).accepts[0].amount,'2000');
   const error=await client.callTool({name:tool,arguments:args,_meta:{'x402/payment':payment(terms,'mcp://tool/'+tool)}});assert.equal(error.isError,true);assert.equal(error.structuredContent,undefined);assert.equal(JSON.parse(error.content[0].text).code,'OUTPUT_CONTRACT_INVALID');assert.ok(!error._meta?.['x402/payment-response']?.success);
  }
  const ledger=await(await mf.dispatchFetch('https://api.test/revenue')).json();assert.equal(ledger.settlements,0);assert.equal(ledger.grossAtomic,'0');
 }finally{await client.close();await mf.dispose();}
});
