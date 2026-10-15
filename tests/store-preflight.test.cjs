const assert = require('node:assert/strict');
const Module = require('node:module');
const { before, test } = require('node:test');
const esbuild = require('esbuild');
const { Hono } = require('hono');
let routes;
before(async () => {
  const entry = require.resolve('../src/store/routes.ts');
  const built = await esbuild.build({ entryPoints:[entry], bundle:true, platform:'node', format:'cjs', write:false });
  const m = new Module(entry,module); m.filename=entry; m.paths=Module._nodeModulePaths(process.cwd());
  m._compile(built.outputFiles[0].text,entry); routes=m.exports;
});
function fixture() {
  let assets=0, writes=0, challenges=0;
  const id='a'.repeat(32);
  const order={id,slug:'x402-seller-kit',amount:'1900000',createdAt:Date.now(),createdBlock:'0',paidAt:Date.now(),via:'x402'};
  const env={ASSETS:{fetch:async()=>{assets++;return new Response('original-paid-asset');}},TRIALS:{get:async key=>key===`order:${id}`?order:null,put:async()=>{writes++;}}};
  const app=new Hono(); app.onError((e,c)=>c.json({error:e.message},e.status??500));
  app.use(routes.buyAssetPreflight());
  app.use((c,next)=>{if(c.req.path.startsWith('/buy/')) {challenges++;return c.body(null,402,{'PAYMENT-REQUIRED':'fixture'});}return next();});
  routes.store.onError((e,c)=>c.json({error:e.message},e.status??500));
  app.route('/',routes.store);
  return {app,env,id,counts:()=>({assets,writes,challenges})};
}
test('paused seller-kit GET, HEAD and direct order creation fail before payment or writes',async()=>{
  const f=fixture();
  for(const [path,method] of [['/buy/x402-seller-kit','GET'],['/buy/x402-seller-kit','HEAD'],['/store/x402-seller-kit/order','POST']]) {
    const r=await f.app.fetch(new Request('https://example.test'+path,{method}),f.env);
    assert.equal(r.status,503);assert.equal(r.headers.has('PAYMENT-REQUIRED'),false);await r.body?.cancel();
  }
  assert.deepEqual(f.counts(),{assets:0,writes:0,challenges:0});
  assert.deepEqual(routes.buyOpenApiPaths(),{});
});
test('storefront explains pause even when the asset exists and has no purchase controls',async()=>{
  const f=fixture();
  for(const path of ['/store','/store/x402-seller-kit']) {
    const r=await f.app.fetch(new Request('https://example.test'+path),f.env);const html=await r.text();
    assert.equal(r.status,200);assert.match(html,/New purchases paused for template verification/);
    assert.doesNotMatch(html,/<form method="post"|Agents can buy it too/);
  }
  assert.equal(f.counts().assets,0);
});
test('existing paid seller-kit downloads continue to resolve while new sales are paused',async()=>{
  const f=fixture(); const r=await f.app.fetch(new Request(`https://example.test/order/${f.id}/download`),f.env);
  assert.equal(r.status,200);assert.equal(await r.text(),'original-paid-asset');
  assert.equal(r.headers.get('cache-control'),'private, no-store');assert.equal(f.counts().writes,0);
});
test('asset availability still verifies the actual file independently of sales state',async()=>{
  const product={slug:'x402-seller-kit',file:'x402-seller-kit.zip'};
  assert.equal(await routes.productAssetAvailable({ASSETS:{fetch:async()=>new Response(null,{status:404})}},product),false);
  assert.equal(await routes.productAssetAvailable({ASSETS:{fetch:async()=>new Response(null,{status:200})}},product),true);
});
