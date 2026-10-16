const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { build } = require('esbuild');
const path = require('node:path');
const fs = require('node:fs/promises');
const os = require('node:os');
let core, Client, InMemoryTransport, StdioClientTransport;
before(async()=>{
  const b=await build({entryPoints:['clients/reader-mcp-core.mjs'],bundle:true,write:false,format:'cjs',platform:'node'});
  const mod={exports:{}};new Function('require','module','exports',b.outputFiles[0].text)(require,mod,mod.exports);core=mod.exports;
  ({Client}=await import('@modelcontextprotocol/sdk/client/index.js'));
  ({InMemoryTransport}=await import('@modelcontextprotocol/sdk/inMemory.js'));
  ({StdioClientTransport}=await import('@modelcontextprotocol/sdk/client/stdio.js'));
});
async function connection(options){
 const server=core.createReaderMcp(options), client=new Client({name:'offline-test',version:'1'});
 const [a,b]=InMemoryTransport.createLinkedPair();await server.connect(a);await client.connect(b);
 return{client,close:async()=>{await client.close();await server.close();}};
}
const call=async(c,name,args={})=>{
 const result=await c.callTool({name,arguments:args});
 return result.structuredContent ?? {ok:false,schemaRejected:true};
};
const page={url:'https://public.example/docs',maxUsdc:'0.002'};
test('quotes-only startup advertises no buying tools and never invokes runner at discovery',async()=>{
 let runs=0;const c=await connection({run:async args=>{runs++;assert.equal(args[0],'quote');assert.ok(!args.includes('--max-usdc'));return{ok:true,paymentStatus:'not_signed'};}});
 try{assert.deepEqual((await c.client.listTools()).tools.map(t=>t.name),['reader_session','reader_quote','sitemap_quote','btc_fees_quote']);
 assert.equal((await call(c.client,'reader_session')).buyingEnabled,false);assert.equal(runs,0);
 assert.equal((await call(c.client,'reader_quote',{url:page.url})).ok,true);assert.equal(runs,1);
 assert.equal((await call(c.client,'reader_buy',page)).ok,false);assert.equal(runs,1);
 }finally{await c.close();}
});
test('explicit opt-in enforces shared reader/sitemap session cap and maps separate options',async()=>{
 const args=[];const c=await connection({enabled:true,sessionCapAtomic:4000n,run:async a=>{args.push(a);return{ok:true,paymentStatus:'settled',receipt:{success:true}};}});
 try{const tools=(await c.client.listTools()).tools;assert.equal(tools.length,7);assert.equal(tools.find(t=>t.name==='reader_buy').annotations.destructiveHint,true);
 assert.equal((await call(c.client,'reader_buy',page)).ok,true);
 assert.deepEqual(args[0],['buy',page.url,'--format','markdown','--max-chars','20000','--max-usdc','0.002']);
 assert.equal((await call(c.client,'sitemap_buy',{...page,contains:'docs & api',maxUrls:3,offset:2})).ok,true);
 assert.deepEqual(args[1],['buy-sitemap',page.url,'--max-urls','3','--offset','2','--contains','docs & api','--max-usdc','0.002']);
 assert.equal((await call(c.client,'reader_buy',page)).error,'session_budget_exhausted');assert.equal(args.length,2);
 const s=await call(c.client,'reader_session');assert.equal(s.reservedMaxUsdc,'0.004000');assert.equal(s.remainingMaxUsdc,'0.000000');
 }finally{await c.close();}
});
test('missing/excessive caps and extra fields fail before network or signing',async()=>{
 let runs=0;const c=await connection({enabled:true,sessionCapAtomic:20000n,run:async()=>{runs++;return{ok:true};}});
 try{for(const p of [{url:page.url},{...page,maxUsdc:'0.003'},{...page,maxUsdc:'0'},{...page,maxUsdc:'1e-3'},{...page,privateKey:'secret'},{...page,format:'invalid'},{...page,maxChars:100001}])assert.equal((await call(c.client,'reader_buy',p)).ok,false);
 assert.equal(runs,0);
 }finally{await c.close();}
});
test('MCP section selection maps an explicit ID through the existing capped runner',async()=>{
 let args;const c=await connection({enabled:true,sessionCapAtomic:2000n,run:async a=>{args=a;return{ok:false,paymentStatus:'not_signed'};}});
 try{await call(c.client,'reader_buy',{...page,section:'retry-policy'});assert.deepEqual(args,['buy',page.url,'--format','markdown','--max-chars','20000','--section','retry-policy','--max-usdc','0.002']);assert.equal((await call(c.client,'reader_quote',{url:page.url,section:''})).schemaRejected,true);}finally{await c.close();}
});
test('Bitcoin fee buys share the reader/sitemap budget and cannot take a URL or bypass uncertainty locks',async()=>{
 const args=[];const c=await connection({enabled:true,sessionCapAtomic:4000n,run:async a=>{args.push(a);return{ok:true,paymentStatus:'settled'};}});
 try{assert.equal((await call(c.client,'btc_fees_quote')).ok,true);assert.deepEqual(args[0],['quote-btc-fees']);assert.equal((await call(c.client,'btc_fees_buy',{maxUsdc:'0.002'})).ok,true);assert.deepEqual(args[1],['buy-btc-fees','--max-usdc','0.002']);assert.equal((await call(c.client,'reader_buy',page)).ok,true);assert.equal((await call(c.client,'sitemap_buy',page)).error,'session_budget_exhausted');assert.equal((await call(c.client,'btc_fees_buy',{maxUsdc:'0.002',url:page.url})).schemaRejected,true);}finally{await c.close();}
 const locked=await connection({enabled:true,sessionCapAtomic:6000n,run:async()=>({ok:false,paymentStatus:'unknown'})});try{await call(locked.client,'btc_fees_buy',{maxUsdc:'0.002'});assert.equal((await call(locked.client,'reader_buy',page)).error,'reconciliation_required');}finally{await locked.close();}
});
test('concurrent buys reserve once; uncertainty locks subsequent buys but not quotes',async()=>{
 let release,runs=0;const started=new Promise(resolve=>release=resolve);let ready;
 const entered=new Promise(resolve=>ready=resolve);
 const c=await connection({enabled:true,sessionCapAtomic:6000n,run:async a=>{runs++;if(a[0]==='quote')return{ok:true,paymentStatus:'not_signed'};ready();await started;return{ok:false,paymentStatus:'unknown',error:'purchase_outcome_uncertain'};}});
 try{const first=call(c.client,'reader_buy',page);await entered;
 assert.equal((await call(c.client,'sitemap_buy',page)).error,'purchase_in_flight');assert.equal(runs,1);
 release();assert.equal((await first).session.reconciliationRequired,true);
 assert.equal((await call(c.client,'reader_buy',page)).error,'reconciliation_required');
 assert.equal((await call(c.client,'reader_quote',{url:page.url})).ok,true);assert.equal(runs,2);
 assert.equal((await call(c.client,'reader_session')).reservedMaxUsdc,'0.002000');
 }finally{release();await c.close();}
});
test('not-signed failures release reservations; signed failures and bad settled output retain them',async()=>{
 for(const paymentStatus of ['not_signed','reported_not_settled','settled']){
  const c=await connection({enabled:true,sessionCapAtomic:2000n,run:async()=>({ok:false,paymentStatus,error:'fixture_failure'})});
  try{const r=await call(c.client,'reader_buy',page);assert.equal(r.session.reservedMaxUsdc,paymentStatus==='not_signed'?'0.000000':'0.002000');assert.equal(r.session.reconciliationRequired,paymentStatus==='settled');}finally{await c.close();}
 }
});
test('unexpected runner errors are redacted and conservatively lock signed capacity',async()=>{
 const c=await connection({enabled:true,sessionCapAtomic:2000n,run:async()=>{throw Error('secret-private-key-signature');}});
 try{const r=await call(c.client,'reader_buy',page);assert.equal(r.error,'adapter_outcome_uncertain');assert.equal(r.session.reconciliationRequired,true);assert.ok(!JSON.stringify(r).includes('secret-private'));}finally{await c.close();}
});
test('process configuration requires explicit bounded session budget and accepts no secret arguments',()=>{
 assert.deepEqual(core.parseMcpArgs([]),{enabled:false,sessionCapAtomic:0n});
 assert.equal(core.parseMcpArgs(['--enable-buy','--session-max-usdc','0.006']).sessionCapAtomic,6000n);
 for(const a of [['--enable-buy'],['--session-max-usdc','0.006'],['--enable-buy','--session-max-usdc','0'],['--enable-buy','--session-max-usdc','0.021'],['--enable-buy','--session-max-usdc','1e-3'],['--key','secret']])assert.throws(()=>core.parseMcpArgs(a));
});
test('adapter default runner preserves payment pins and redirect refusal before accessing a key',async()=>{
 const previous=globalThis.fetch;let requests=0;
 const c=await connection({enabled:true,sessionCapAtomic:2000n});
 try{for(const redirected of [false,true]){
  globalThis.fetch=async(_url,options)=>{requests++;assert.equal(options.redirect,'error');assert.ok(!options.headers['PAYMENT-SIGNATURE']);
   if(redirected)return new Response(null,{status:302,headers:{location:'https://other.example/'}});
   const quote={x402Version:2,resource:{url:'https://agent-data-tools.revmesh2074.workers.dev/extract'},accepts:[{scheme:'exact',network:'eip155:8453',asset:'0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',payTo:'0x'+'9'.repeat(40),amount:'2000'}]};
   return new Response(null,{status:402,headers:{'PAYMENT-REQUIRED':Buffer.from(JSON.stringify(quote)).toString('base64')}});
  };
  const r=await call(c.client,'reader_buy',page);assert.equal(r.ok,false);assert.equal(r.paymentStatus,'not_signed');assert.equal(r.error,redirected?'expected_unpaid_402_quote':'payment_terms_rejected');assert.equal(r.session.reservedMaxUsdc,'0.000000');
 }assert.equal(requests,2);
 }finally{globalThis.fetch=previous;await c.close();}
});
test('standalone stdio bundle runs outside checkout and exposes only unpaid tools by default',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'reader-mcp-'));
 const file=path.join(dir,'reader-mcp.mjs');await fs.copyFile('public/clients/reader/1.6.0/reader-mcp.mjs',file);
 const transport=new StdioClientTransport({command:process.execPath,args:[file],cwd:dir,env:{X402_PRIVATE_KEY:''},stderr:'pipe'});
 let stderr='';transport.stderr.on('data',chunk=>stderr+=chunk);
 const client=new Client({name:'stdio-bundle-test',version:'1'});
 try{await client.connect(transport);assert.equal((await client.listTools()).tools.length,4);assert.equal((await call(client,'reader_session')).buyingEnabled,false);assert.equal(stderr,'');}
 finally{await client.close();await fs.unlink(file);await fs.rmdir(dir);}
});
