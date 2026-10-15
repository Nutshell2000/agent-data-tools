const assert=require('node:assert/strict');
const {test,before}=require('node:test');
const {build}=require('esbuild');
const {createHash}=require('node:crypto');
let core;
const key='0x'+'1'.repeat(64), signature='OFFLINE_SIGNATURE_DO_NOT_PRINT';
const target='https://public.example/article';
const receipt={success:true,network:'eip155:8453',transaction:'0x'+'2'.repeat(64)};
const encode=v=>Buffer.from(JSON.stringify(v)).toString('base64');
before(async()=>{const b=await build({entryPoints:['clients/reader-core.mjs'],bundle:true,write:false,format:'cjs',platform:'node'});const mod={exports:{}};new Function('require','module','exports',b.outputFiles[0].text)(require,mod,mod.exports);core=mod.exports;});
function quote(change={}){return{x402Version:2,resource:{url:core.READER_ORIGIN+'/extract'},accepts:[{scheme:'exact',network:'eip155:8453',asset:core.READER_ASSET,payTo:core.READER_RECIPIENT,amount:'2000',maxTimeoutSeconds:300,extra:{name:'USD Coin',version:'2'},...change}]};}
function fixture({change={},paidError,paidStatus=200,receiptValue=receipt,realSigning=false,invalidResult=false}={}){
 let requests=0,authorizations=0,submissions=0;
 const result={format:'text',hashFormat:'text',text:'Useful page',contentHash:'sha256:'+createHash('sha256').update('Useful page').digest('hex')};
 const deps={getKey:()=>key,fetcher:async(url,init)=>{
  requests++;assert.equal(new URL(url).origin,core.READER_ORIGIN);assert.equal(init.redirect,'error');
  if(!init.headers['PAYMENT-SIGNATURE'])return new Response(null,{status:402,headers:{'PAYMENT-REQUIRED':encode(quote(change)),'X-Request-ID':'quote-id'}});
  submissions++;const payload=JSON.parse(Buffer.from(init.headers['PAYMENT-SIGNATURE'],'base64'));assert.equal(payload.accepted.payTo,core.READER_RECIPIENT);assert.equal(payload.accepted.amount,'2000');
  if(realSigning){assert.match(payload.payload.signature,/^0x[0-9a-f]{130}$/i);assert.equal(payload.payload.authorization.to.toLowerCase(),core.READER_RECIPIENT);}
  if(paidError)throw Error(key+signature);
  return new Response(JSON.stringify(invalidResult?{}:result),{status:paidStatus,headers:{...(receiptValue?{'PAYMENT-RESPONSE':encode(receiptValue)}:{}),'X-Request-ID':'paid-id'}});
 }};
 if(!realSigning)deps.createPayload=async required=>{authorizations++;return{x402Version:2,resource:required.resource,accepted:required.accepts[0],payload:{signature}};};
 return {deps,counts:()=>({requests,authorizations,submissions})};
}
test('unsigned quote never reads a key or authorizes and reports pinned terms',async()=>{
 const f=fixture();f.deps.getKey=()=>assert.fail('quote must not access keys');const v=await core.runReader(['quote',target],f.deps);assert.equal(v.ok,true);assert.equal(v.paymentStatus,'not_signed');assert.equal(v.quote.amountAtomic,'2000');assert.deepEqual(f.counts(),{requests:1,authorizations:0,submissions:0});
});
test('wrong recipients, chains, assets, schemes and prices cannot reach signing',async()=>{
 for(const change of [{payTo:'0x'+'9'.repeat(40)},{network:'eip155:1'},{asset:'0x'+'9'.repeat(40)},{scheme:'upto'},{amount:'2001'},{amount:'0'},{amount:'NaN'},{extra:{assetTransferMethod:'permit2'}}]){
  const f=fixture({change});const v=await core.runReader(['buy',target,'--max-usdc','0.002'],f.deps);assert.equal(v.ok,false);assert.equal(v.error,'payment_terms_rejected');assert.equal(f.counts().authorizations,0);assert.equal(f.counts().submissions,0);
 }
});
test('buy needs an explicit bounded decimal cap before any network request',async()=>{
 for(const flags of [[],['--max-usdc','0.003'],['--max-usdc','0'],['--max-usdc','1e-3'],['--max-usdc','-1']]){
  const f=fixture();const v=await core.runReader(['buy',target,...flags],f.deps);assert.equal(v.ok,false);assert.equal(f.counts().requests,0);
 }
 const f=fixture();const v=await core.runReader(['buy',target,'--max-usdc','0.001'],f.deps);assert.equal(v.error,'payment_terms_rejected');assert.equal(f.counts().submissions,0);
});
test('one invocation authorizes once and returns output, request ID and settlement evidence without secrets',async()=>{
 const f=fixture();const v=await core.runReader(['buy',target,'--max-usdc','0.002'],f.deps);assert.equal(v.ok,true);assert.equal(v.result.text,'Useful page');assert.equal(v.paymentStatus,'settled');assert.equal(v.requestId,'paid-id');assert.deepEqual(v.receipt,receipt);assert.deepEqual(f.counts(),{requests:2,authorizations:1,submissions:1});assert.ok(!JSON.stringify(v).includes(key));assert.ok(!JSON.stringify(v).includes(signature));
});
test('lost responses, absent receipts and malformed results never trigger another authorization',async()=>{
 for(const options of [{paidError:true},{receiptValue:null},{invalidResult:true}]){
  const f=fixture(options);const v=await core.runReader(['buy',target,'--max-usdc','0.002'],f.deps);assert.equal(v.ok,false);assert.equal(v.retryAutomatically,false);assert.equal(v.paymentStatus,options.invalidResult?'settled':'unknown');assert.deepEqual(f.counts(),{requests:2,authorizations:1,submissions:1});assert.ok(!JSON.stringify(v).includes(key));assert.ok(!JSON.stringify(v).includes(signature));
 }
});
test('service redirects are never followed, including after signing',async()=>{
 let n=0;const first=await core.runReader(['quote',target],{fetcher:async(_u,init)=>{n++;assert.equal(init.redirect,'error');return new Response(null,{status:302,headers:{location:'https://other.example/'}});}});assert.equal(first.ok,false);assert.equal(n,1);
 const f=fixture({paidStatus:302,receiptValue:null});const v=await core.runReader(['buy',target,'--max-usdc','0.002'],f.deps);assert.equal(v.paymentStatus,'unknown');assert.equal(f.counts().submissions,1);
});
test('actual SDK can authorize an offline fixture once without a chain transaction',async()=>{
 const f=fixture({realSigning:true});const v=await core.runReader(['buy',target,'--max-usdc','0.002'],f.deps);assert.equal(v.ok,true);assert.equal(f.counts().submissions,1);
});
