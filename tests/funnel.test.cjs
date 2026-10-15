const assert=require('node:assert/strict');
const Module=require('node:module');
const {before,test}=require('node:test');
const esbuild=require('esbuild');
let funnel;
before(async()=>{const entry=require.resolve('../src/lib/funnel.ts');const b=await esbuild.build({entryPoints:[entry],bundle:true,platform:'node',format:'cjs',write:false});const m=new Module(entry,module);m._compile(b.outputFiles[0].text,entry);funnel=m.exports;});
test('simultaneous HTTP and MCP requests retain separate stage identities and minimal safe attribution',async()=>{
  const events=[],waits=[];
  const env={METRICS:{idFromName:()=>'',get:()=>({recordFunnel:async e=>events.push(e)})}};
  await Promise.all(['/extract','/btc-fees'].map(path=>funnel.withRequestTrace(env,path,'buyer_source',p=>waits.push(p),async()=>{
    funnel.markStage('attempt');await new Promise(r=>setImmediate(r));funnel.markStage('verified');
    await funnel.withToolTrace(path,async()=>{funnel.markStage('settled');funnel.markStage('settled');funnel.markStage('completed');});
  })));
  await Promise.all(waits);
  assert.equal(events.length,8);assert.equal(new Set(events.map(e=>e.requestId)).size,4);
  for(const e of events){assert.equal(e.source,'buyer_source');assert.ok(e.path==='/extract'||e.path==='/btc-fees');assert.deepEqual(Object.keys(e).sort(),['requestId','path','transport','source','stage','at'].sort());}
  assert.equal(funnel.safeSource('https://private.example/?secret=x'),undefined);
});
test('funnel recording de-duplicates a stage and excludes customer inputs from persisted evidence',async()=>{
  const records=new Map();let pending=Promise.resolve();
  const storage={transaction(fn){const next=pending.then(()=>fn({get:async k=>structuredClone(records.get(k)),put:async(k,v)=>records.set(k,structuredClone(v))}));pending=next;return next;},list:async opts=>new Map([...records].filter(([k])=>k.startsWith(opts.prefix)&&(!opts.start||k>=opts.start)&&(!opts.end||k<opts.end))),delete:async keys=>keys.forEach(k=>records.delete(k))};
  const e={requestId:crypto.randomUUID(),path:'/extract',transport:'http',stage:'attempt',at:new Date().toISOString(),content:'PRIVATE_PAGE',signature:'PRIVATE_SIGNATURE'};
  await Promise.all([funnel.saveFunnel(storage,e),funnel.saveFunnel(storage,e)]);
  const summary=await funnel.funnelSummary(storage);assert.equal(Object.values(summary.days)[0]['http:/extract:attempt'],1);
  assert.doesNotMatch(JSON.stringify([...records]),/PRIVATE_PAGE|PRIVATE_SIGNATURE/);
  await funnel.saveFunnel(storage,{...e,requestId:crypto.randomUUID(),path:'/clients/reader/1.1.1/SHA256SUMS',stage:'visit'});
  assert.equal(Object.values((await funnel.funnelSummary(storage)).days)[0]['http:/clients/reader/1.1.1/SHA256SUMS:visit'],1);
  await assert.rejects(()=>funnel.saveFunnel(storage,{...e,source:'https://private.example'}),/invalid funnel/);
});

test('visits cover actual buying resources and exclude probes, failures and arbitrary assets',()=>{
  for(const path of ['/','/llms.txt','/openapi.json','/.well-known/x402','/guides/web-reading','/guides/web-reading.md','/examples/extract/','/examples/extract/manifest.json','/examples/extract/technical-guide.json','/clients/reader/1.1.1/reader-client.mjs','/clients/reader/1.1.1/SHA256SUMS']){
    assert.equal(funnel.isDiscoveryVisit('GET',path,200),true,path);
    for(const method of ['HEAD','POST','OPTIONS'])assert.equal(funnel.isDiscoveryVisit(method,path,200),false,method+path);
    for(const status of [301,308,400,402,404,500])assert.equal(funnel.isDiscoveryVisit('GET',path,status),false,status+path);
  }
  for(const path of ['/guides/nonexistent','/extract','/revenue','/metrics','/health','/clients/reader/1.1.1/secrets.txt','/examples/extract/private.json','/_files/x402-seller-kit.zip'])assert.equal(funnel.isDiscoveryVisit('GET',path,200),false,path);
});
