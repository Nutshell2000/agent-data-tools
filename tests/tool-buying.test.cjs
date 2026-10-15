const assert=require('node:assert/strict');
const {before,test}=require('node:test');
const Module=require('node:module');
const vm=require('node:vm');
const esbuild=require('esbuild');
let guide,discovery;
async function load(path){const entry=require.resolve(path);const b=await esbuild.build({entryPoints:[entry],bundle:true,write:false,platform:'node',format:'cjs'});const m=new Module(entry,module);m.filename=entry;m.paths=Module._nodeModulePaths(process.cwd());m._compile(b.outputFiles[0].text,entry);return m.exports;}
before(async()=>{guide=await load('../src/guides/tool-buying.ts');discovery=await load('../src/discovery.ts');});
const recipient='0x2074c40346ae2a90e0e4a391bcee6f16bf5277f5';
const ask={scheme:'exact',network:'eip155:8453',payTo:recipient,asset:'0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',amount:'2000'};
test('all catalog payment and discovery surfaces share the floor and bounded metadata',()=>{
  const api=discovery.openApi('https://api.test'),card=discovery.serviceCard('https://api.test',recipient,'eip155:8453'),mcp=discovery.mcpServerCard('https://api.test');
  assert.equal(discovery.ENDPOINTS.length,31);assert.equal(mcp.serverInfo.version,'1.0.2');
  for(const e of discovery.ENDPOINTS){assert.ok(Number(e.price.slice(1))>=0.002,e.path);assert.ok(e.description.length<=450,e.path);
    assert.equal(api.paths[e.path].get['x-payment-info'].price.amount,e.price.slice(1));assert.equal(card.endpoints.find(v=>v.url.endsWith(e.path)).price,e.price);assert.equal(mcp.tools.find(v=>v.name===e.path.slice(1)).price,e.price);
  }
  assert.ok(discovery.homePage('https://api.test',recipient).indexOf('/guides/web-reading')<discovery.homePage('https://api.test',recipient).indexOf('Tools and prices'));
});
async function execute(source,offered){
  const lines=source.split('\n');const compiled=await esbuild.transform(lines.filter(l=>l.startsWith('import ')).join('\n')+'\nexport async function run(){\n'+lines.filter(l=>!l.startsWith('import ')).join('\n')+'\n}',{loader:'ts',format:'cjs',target:'es2022'});
  let calls=0,closed=false;
  class PaymentClient{register(){return this;}setSpendControls(){return this;}registerPolicy(p){this.policy=p;return this;}}
  const apply=(client,run)=>async(...args)=>{if(!client.policy(2,[offered]).length)throw Error('quote refused');calls++;return run(...args);};
  const sandbox={module:{exports:{}},URL,process:{env:{X402_PRIVATE_KEY:'0x'+'1'.repeat(64)}},console:{log(){}},fetch:async()=>({ok:true,headers:new Headers(),json:async()=>({fixture:true})}),require(name){
    if(name==='@x402/evm')return{ExactEvmScheme:class{}};
    if(name==='viem/accounts')return{privateKeyToAccount:()=>({})};
    if(name==='@x402/fetch')return{x402Client:PaymentClient,wrapFetchWithPayment:(f,c)=>apply(c,f)};
    if(name==='@x402/mcp')return{x402Client:PaymentClient,wrapMCPClientWithPayment:(_,c)=>({callTool:apply(c,async()=>({content:[]}))})};
    if(name==='@modelcontextprotocol/sdk/client/index.js')return{Client:class{async connect(){}async close(){closed=true;}}};
    if(name==='@modelcontextprotocol/sdk/client/streamableHttp.js')return{StreamableHTTPClientTransport:class{}};
    throw Error(name);
  }};
  vm.runInNewContext(compiled.code,sandbox);return{run:()=>sandbox.module.exports.run(),counts:()=>({calls,closed})};
}
test('published HTTP and MCP examples accept the correct quote once and reject unsafe payment terms',async()=>{
  for(const kind of ['web-reading','bitcoin-fees']){
    const g=guide.toolBuyingGuide(kind,'https://api.test',recipient);
    const markdown=guide.toolGuideMarkdown(kind,'https://api.test',recipient);
    assert.ok(markdown.includes(g.http));assert.ok(markdown.includes(g.mcp));assert.match(markdown,/illustrative/);
    assert.match(guide.toolGuideHtml(kind,'https://api.test',recipient), /href="https:\/\/github.com\/Nutshell2000\/agent-data-tools\/issues">/);
    for(const source of [g.http,g.mcp]){
      const good=await execute(source,ask);await good.run();assert.equal(good.counts().calls,1);
      for(const changed of [{amount:'2001'},{amount:'0.002'},{payTo:'0x'+'9'.repeat(40)},{network:'eip155:1'},{asset:'0x'+'9'.repeat(40)},{scheme:'upto'}]){
        const bad=await execute(source,{...ask,...changed});await assert.rejects(()=>bad.run(),/quote refused/);assert.equal(bad.counts().calls,0);
        if(source===g.mcp)assert.equal(bad.counts().closed,true);
      }
    }
  }
});
