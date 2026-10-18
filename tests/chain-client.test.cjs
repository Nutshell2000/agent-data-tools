const assert = require('node:assert/strict');
const {test,before,after} = require('node:test');
const {build} = require('esbuild');
const {mkdtemp,readFile,rm} = require('node:fs/promises');
const {tmpdir} = require('node:os');
const {join,resolve} = require('node:path');
const {pathToFileURL} = require('node:url');
const {createHash} = require('node:crypto');
const {execFile} = require('node:child_process');
const {promisify} = require('node:util');
let core,temp,built;
const address='0x'+'1'.repeat(40),spender='0x'+'2'.repeat(40),txHash='0x'+'3'.repeat(64);
const key='0x'+'1'.repeat(64),signature='OFFLINE_SIGNATURE_NEVER_LOG';
const now='2026-10-18T00:00:00.000Z';
const receipt={success:true,network:'eip155:8453',transaction:'0x'+'4'.repeat(64),payer:address};
const encode=v=>Buffer.from(JSON.stringify(v)).toString('base64');
const inputs={tx:['--hash',txHash],wallet:['--address',address],gas:[],allowance:['--token','0x833589fcd6edb6e08f4c7c32d4f71b54bda02913','--owner',address,'--spender',spender]};
const caps={tx:'0.003',wallet:'0.005',gas:'0.002',allowance:'0.002'};
const args=(op,buy=true)=>[buy?'buy':'quote',op,...inputs[op],...(buy?['--max-usdc',caps[op]]:[])];
function result(op){
 if(op==='tx')return{chain:'base',hash:txHash,status:'success',from:address,to:spender,contractCreated:null,valueEth:'0',nonce:1,methodId:null,blockNumber:1,blockTime:now,confirmations:2,gasUsed:21000,gasPriceGwei:'0.01',executionFeeEth:'0.00000021',logCount:0,checkedAt:now};
 if(op==='wallet')return{chain:'base',chainId:8453,address,type:'eoa',delegatedTo:null,eth:{wei:'1000000000000000000',formatted:'1'},accountNonce:1,tokens:[{address:core.ASSET,symbol:'USDC',decimals:6,balance:'1',balanceFormatted:'0.000001'}],tokensChecked:8,blockNumber:1};
 if(op==='gas')return{chain:'base',chainId:8453,blockNumber:1,blockTime:now,checkedAt:now,baseFeeGwei:'0.01',priorityFeeGwei:'0.001',gasPriceGwei:'0.011',blockUsedPercent:50,suggested:{maxFeePerGasWei:'21000000',maxPriorityFeePerGasWei:'1000000'},estimatedExecutionFeeEth:{ethTransfer:'0.000000231',erc20Transfer:'0.000000715'}};
 return{chain:'base',token:core.ASSET,owner:address,spender,symbol:'USDC',decimals:6,allowance:'1',allowanceFormatted:'0.000001',approved:true,unlimited:false,checkedAt:now};
}
function fixture(op,{terms={},resource,output,receiptValue=receipt,paidStatus=200,lost=false,realSigning=false,signingError=false,rawBody,contentType='application/json'}={}){
 let requests=0,signs=0,submissions=0,keyReads=0;
 const expected=core.parseChainArgs(args(op)).url.href;
 const deps={getKey:()=>{keyReads++;return key;},fetcher:async(url,init)=>{
  requests++;assert.equal(String(url),expected);assert.equal(init.redirect,'error');
  if(!init.headers['PAYMENT-SIGNATURE'])return new Response(null,{status:402,headers:{'PAYMENT-REQUIRED':encode({x402Version:2,resource:{url:resource??expected},accepts:[{scheme:'exact',network:'eip155:8453',asset:core.ASSET,payTo:core.RECIPIENT,amount:String(core.OPERATIONS[op].maxAtomic),maxTimeoutSeconds:300,extra:{name:'USD Coin',version:'2'},...terms}]}),'X-Request-ID':'quote-id'}});
  submissions++;const p=JSON.parse(Buffer.from(init.headers['PAYMENT-SIGNATURE'],'base64'));
  assert.equal(p.accepted.amount,String(core.OPERATIONS[op].maxAtomic));
  if(realSigning){assert.match(p.payload.signature,/^0x[\da-f]{130}$/i);assert.equal(p.payload.authorization.to.toLowerCase(),core.RECIPIENT);}
  if(lost)throw Error(key+signature);
  return new Response(rawBody??JSON.stringify(output??result(op)),{status:paidStatus,headers:{'Content-Type':contentType,...(receiptValue?{'PAYMENT-RESPONSE':encode(receiptValue)}:{}),'X-Request-ID':'paid-id'}});
 }};
 if(!realSigning)deps.createPayload=async required=>{signs++;if(signingError)throw Error(key+signature);assert.equal(required.extensions,undefined);assert.equal(required.accepts.length,1);return{x402Version:2,resource:required.resource,accepted:required.accepts[0],payload:{signature}};};
 return{deps,counts:()=>({requests,signs,submissions,keyReads})};
}
before(async()=>{
 const b=await build({entryPoints:['clients/chain/core.mjs'],bundle:true,write:false,format:'cjs',platform:'node'});const m={exports:{}};new Function('require','module','exports',b.outputFiles[0].text)(require,m,m.exports);core=m.exports;
 temp=await mkdtemp(join(tmpdir(),'chain-client-'));const {buildChain}=await import(pathToFileURL(resolve('clients/chain/build.mjs')).href);built=await buildChain(temp);
});
after(async()=>{if(temp){const p=resolve(temp);assert.ok(p.startsWith(resolve(tmpdir())+require('node:path').sep)&&require('node:path').basename(p).startsWith('chain-client-'));await rm(p,{recursive:true,force:true});}});

test('all four unsigned quotes are pinned and never read a key or authorize',async()=>{
 for(const op of Object.keys(inputs)){const f=fixture(op);f.deps.getKey=()=>assert.fail('quote must not read key');const v=await core.runChain(args(op,false),f.deps);assert.equal(v.ok,true);assert.equal(v.paymentStatus,'not_signed');assert.equal(v.quote.usdc,Number(caps[op]).toFixed(6));assert.equal(f.counts().requests,1);assert.equal(f.counts().signs,0);}
});
test('input and per-operation caps reject before any network access',async()=>{
 const invalid=[['buy','gas'],['buy','gas','--max-usdc','0.003'],['buy','tx','--hash',txHash,'--max-usdc','0.004'],['buy','wallet','--address',address,'--max-usdc','0.006'],['quote','wallet','--address','0x123'],['quote','tx','--hash','bad'],['quote','gas','--origin','https://evil.example'],['quote','gas','--url','https://evil.example'],['quote','toString'],['--help','extra'],['quote','gas','--max-usdc','0.002','--max-usdc','0.002'],['quote','allowance','--token',address,'--owner',address],['quote','gas','--max-usdc','0'],['quote','gas','--max-usdc','1e-3'],['quote','gas','--max-usdc','-1'],['quote','gas','--max-usdc','0.0000001']];
 for(const a of invalid){const r=await core.runChain(a,{fetcher:()=>assert.fail('invalid arguments must not fetch')});assert.equal(r.ok,false);assert.equal(r.paymentStatus,'not_signed');}
});
test('payment pins, exact resource query and each lower user cap reject before signing',async()=>{
 for(const terms of [{payTo:spender},{network:'eip155:1'},{asset:address},{scheme:'upto'},{amount:'5001'},{amount:'0'},{amount:'NaN'},{amount:'9'.repeat(5000)},{maxTimeoutSeconds:0},{extra:{assetTransferMethod:'permit2'}},{extra:{name:'Other Coin'}},{extra:{version:'1'}}]){const f=fixture('wallet',{terms});const v=await core.runChain(args('wallet'),f.deps);assert.equal(v.error,'payment_terms_rejected');assert.equal(f.counts().keyReads,0);assert.equal(f.counts().signs,0);}
 for(const resource of [core.ORIGIN+'/base-tx',core.ORIGIN+'/wallet?address='+spender,'https://other.example/wallet?address='+address]){const f=fixture('wallet',{resource});const v=await core.runChain(args('wallet'),f.deps);assert.equal(v.error,'unexpected_payment_resource');assert.equal(f.counts().signs,0);}
 for(const op of Object.keys(inputs)){const f=fixture(op);const v=await core.runChain(['buy',op,...inputs[op],'--max-usdc','0.001'],f.deps);assert.equal(v.error,'payment_terms_rejected');assert.equal(f.counts().signs,0);}
});
test('each explicit purchase authorizes once, validates identity and retains settlement evidence',async()=>{
 for(const op of Object.keys(inputs)){const f=fixture(op,{output:{...result(op),debug:key+signature}});const v=await core.runChain(args(op),f.deps);assert.equal(v.ok,true);assert.equal(v.paymentStatus,'settled');assert.equal(v.requestId,'paid-id');assert.equal(v.receipt.transaction,receipt.transaction);assert.deepEqual(f.counts(),{requests:2,signs:1,submissions:1,keyReads:1});assert.ok(!JSON.stringify(v).includes(signature));assert.ok(!JSON.stringify(v).includes(key));assert.ok(!('debug'in v.result));assert.ok(v.limitations.length);}
});
test('wrong identities and malformed required numeric fields remain settled defects with no retry',async()=>{
 for(const [op,change]of [['tx',{hash:'0x'+'9'.repeat(64)}],['tx',{status:'confirmed'}],['tx',{confirmations:-1}],['wallet',{address:spender}],['wallet',{chainId:1}],['wallet',{eth:{wei:'NaN',formatted:'0'}}],['wallet',{tokensChecked:0}],['wallet',{tokens:[{address:core.ASSET,symbol:'USDC',decimals:6,balance:'1',balanceFormatted:'10'}]}],['gas',{suggested:{maxFeePerGasWei:'-1',maxPriorityFeePerGasWei:'0'}}],['gas',{blockUsedPercent:101}],['allowance',{owner:spender}],['allowance',{approved:false}],['allowance',{allowance:'9'.repeat(78)}],['allowance',{allowanceFormatted:'1'}]]){const f=fixture(op,{output:{...result(op),...change}});const r=await core.runChain(args(op),f.deps);assert.equal(r.ok,false);assert.equal(r.error,'invalid_result');assert.equal(r.paymentStatus,'settled');assert.equal(r.receipt.transaction,receipt.transaction);assert.equal(r.retryAutomatically,false);assert.equal(f.counts().signs,1);assert.equal(f.counts().submissions,1);}
});
test('pending/reverted status, partial wallets and a positive but small allowance stay factual',async()=>{
 const pending={...result('tx'),status:'pending',blockNumber:null,blockTime:null,confirmations:0,gasUsed:null,gasPriceGwei:null,executionFeeEth:null,logCount:null};
 for(const output of [pending,{...result('tx'),status:'reverted'}]){const f=fixture('tx',{output});const v=await core.runChain(args('tx'),f.deps);assert.equal(v.ok,true);assert.equal(v.result.status,output.status);assert.equal(f.counts().submissions,1);assert.ok(v.limitations.some(s=>s.includes('does not prove')));}
 const w=await core.runChain(args('wallet'),fixture('wallet',{output:{...result('wallet'),tokens:[],tokensChecked:3}}).deps);assert.equal(w.ok,true);assert.deepEqual(w.result.tokens,[]);assert.ok(w.limitations.some(s=>s.includes('not proof of zero')));
 const a=await core.runChain(args('allowance'),fixture('allowance').deps);assert.equal(a.result.approved,true);assert.equal(a.result.allowance,'1');assert.ok(a.limitations.some(s=>s.includes('does not prove it covers')));assert.ok(!('readyToSend'in a.result));
});
test('lost replies, signing failures, missing/invalid receipts and HTTP failures never reauthorize',async()=>{
 for(const options of [{lost:true},{signingError:true},{receiptValue:null},{receiptValue:{...receipt,network:'eip155:1'}},{receiptValue:{...receipt,transaction:'bad'}},{paidStatus:402,receiptValue:null},{paidStatus:502,receiptValue:null}]){const f=fixture('tx',options);const v=await core.runChain(args('tx'),f.deps);assert.equal(v.ok,false);assert.equal(v.paymentStatus,'unknown');assert.equal(v.retryAutomatically,false);assert.equal(f.counts().signs,1);assert.equal(f.counts().submissions,options.signingError?0:1);assert.ok(v.guidance.includes('reconcile'));assert.ok(!JSON.stringify(v).includes(key));assert.ok(!JSON.stringify(v).includes(signature));}
 const f=fixture('gas',{receiptValue:{success:false,network:'eip155:8453',transaction:'untrusted',errorMessage:key+signature}});const v=await core.runChain(args('gas'),f.deps);assert.equal(v.paymentStatus,'reported_not_settled');assert.equal(v.receipt.transaction,null);assert.ok(!JSON.stringify(v).includes(signature));
});
test('redirects and arbitrary error bodies never leak content or cause another submission',async()=>{
 let calls=0;const q=await core.runChain(['quote','gas'],{fetcher:async(_u,i)=>{calls++;assert.equal(i.redirect,'error');return new Response(key+signature,{status:302,headers:{location:'https://other.example'}});}});assert.equal(q.ok,false);assert.equal(calls,1);assert.ok(!JSON.stringify(q).includes(key));
 for(const paidStatus of [302,503]){const f=fixture('gas',{paidStatus,receiptValue:null,rawBody:key+signature});const r=await core.runChain(args('gas'),f.deps);assert.equal(r.paymentStatus,'unknown');assert.equal(f.counts().submissions,1);assert.ok(!JSON.stringify(r).includes(signature));}
 for(const rawBody of ['broken JSON','x'.repeat(512*1024+1)]){const f=fixture('gas',{rawBody});const r=await core.runChain(args('gas'),f.deps);assert.equal(r.ok,false);assert.equal(r.paymentStatus,'settled');assert.equal(f.counts().submissions,1);}
 const f=fixture('gas',{contentType:'text/html'});const r=await core.runChain(args('gas'),f.deps);assert.equal(r.error,'invalid_result');assert.equal(r.paymentStatus,'settled');assert.equal(f.counts().submissions,1);
});
test('real SDK signs all four capped offline fixtures without a chain transaction',async()=>{
 for(const op of Object.keys(inputs)){const f=fixture(op,{realSigning:true});const v=await core.runChain(args(op),f.deps);assert.equal(v.ok,true);assert.equal(f.counts().submissions,1);}
});
test('bundle is deterministic, standalone, machine-readable and uses a single-file checksum',async()=>{
 const bytes=await readFile(join(temp,'chain-client.mjs')),checksum=await readFile(join(temp,'chain-client.mjs.sha256'),'utf8');assert.equal(checksum,createHash('sha256').update(bytes).digest('hex')+'  chain-client.mjs\n');assert.equal(built.version,'1.0.0');
 const {buildChain}=await import(pathToFileURL(resolve('clients/chain/build.mjs')).href);const again=await buildChain(temp);assert.equal(again.sha256,built.sha256);
 const env={...process.env};delete env.X402_PRIVATE_KEY;
 const help=await promisify(execFile)(process.execPath,[join(temp,'chain-client.mjs'),'--help'],{cwd:temp,env});assert.equal(JSON.parse(help.stdout).clientVersion,'1.0.0');assert.equal(JSON.parse(help.stdout).paymentStatus,'not_signed');assert.equal(help.stderr,'');
 await assert.rejects(promisify(execFile)(process.execPath,[join(temp,'chain-client.mjs'),'buy','gas'],{cwd:temp,env}),e=>e.code===1&&JSON.parse(e.stdout).error==='explicit_bounded_cap_required'&&e.stderr==='');
});
