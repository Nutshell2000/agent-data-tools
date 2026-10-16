const {test,before}=require('node:test');
const assert=require('node:assert/strict');
const {build}=require('esbuild');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const{execFile}=require('node:child_process');
const{promisify}=require('node:util');
const{createHash}=require('node:crypto');
let guides;
before(async()=>{const b=await build({entryPoints:['src/guides/reader-download.ts'],bundle:true,write:false,platform:'node',format:'cjs'});const m={exports:{}};new Function('require','module','exports',b.outputFiles[0].text)(require,m,m.exports);guides=m.exports;});
const execute=promisify(execFile),version=require('../package.json').version;
const ps=(script,cwd)=>execute('pwsh',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{cwd});
async function fixture(file,fn){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'reader-two-downloads-'));try{for(const f of [file,file+'.sha256'])await fs.copyFile(`public/clients/reader/${version}/${f}`,path.join(dir,f));assert.deepEqual((await fs.readdir(dir)).sort(),[file,file+'.sha256'].sort());await fn(dir);}finally{for(const f of await fs.readdir(dir))await fs.unlink(path.join(dir,f));await fs.rmdir(dir);}}
test('each checksum file names only its executable and shares the original manifest digest',async()=>{
 const manifest=await fs.readFile(`public/clients/reader/${version}/SHA256SUMS`,'utf8');
 for(const file of ['reader-client.mjs','reader-mcp.mjs']){
 const text=await fs.readFile(`public/clients/reader/${version}/${file}.sha256`,'utf8');assert.equal(text.trim().split('\n').length,1);assert.ok(manifest.split('\n').includes(text.trim()));
 const docs=guides.readerDownloadMarkdown('https://service.example',version,file);assert.ok(docs.includes(file+'.sha256'));assert.ok(docs.includes('Do not check that whole list'));assert.ok(docs.includes('not an independent signature'));
 }
 assert.throws(()=>guides.readerVerification('unsafe; execute'));
});
test('download-instruction repair retains every previously published 1.3.0 executable byte',async()=>{
 const expected={'reader-client.mjs':'4ab8363a3380c3debb56ae552fc4f328281b209992b25d38d02df6b59e9da400','reader-mcp.mjs':'07eea006e23b894a23c0bd78f3244c8fff3cfbb7c5411b938464e14d55f5f90d','command-builder.js':'5909385fb9455fb2ed16b9ee4580a534e7541ec668a3e650c8131ae08f53a446'};
 for(const[file,hash]of Object.entries(expected))assert.equal(createHash('sha256').update(await fs.readFile('public/clients/reader/1.3.0/'+file)).digest('hex'),hash);
 const manifest=await fs.readFile('public/clients/reader/1.3.0/SHA256SUMS','utf8');assert.equal(manifest,Object.entries({'reader-client.mjs':expected['reader-client.mjs'],'command-builder.js':expected['command-builder.js'],'reader-mcp.mjs':expected['reader-mcp.mjs']}).map(([file,hash])=>`${hash}  ${file}\n`).join(''));
});
test('GNU verification succeeds with exactly two downloads and rejects tampered or missing executable',async()=>{
 const binary=process.platform==='win32'?'C:/Program Files/Git/usr/bin/sha256sum.exe':'sha256sum';
 for(const file of ['reader-client.mjs','reader-mcp.mjs'])await fixture(file,async dir=>{
 const command=guides.readerVerification(file).linux;assert.equal(command,`sha256sum -c ${file}.sha256`);
 const r=await execute(binary,['-c',file+'.sha256'],{cwd:dir});assert.match(r.stdout,/OK/);assert.equal(r.stderr,'');
 await fs.appendFile(path.join(dir,file),'\n// changed bytes');await assert.rejects(execute(binary,['-c',file+'.sha256'],{cwd:dir}));
 await fs.unlink(path.join(dir,file));await assert.rejects(execute(binary,['-c',file+'.sha256'],{cwd:dir}));
 });
});
test('published PowerShell verification rejects tampered bytes and malformed/mismatched checksum names',async()=>{
 for(const file of ['reader-client.mjs','reader-mcp.mjs'])await fixture(file,async dir=>{
 const command=guides.readerVerification(file).powershell;
 const success=await ps(command,dir);assert.match(success.stdout,/OK/);assert.equal(success.stderr,'');
 await fs.appendFile(path.join(dir,file),'\n// changed bytes');await assert.rejects(ps(command,dir));
 for(const text of ['no checksum','0'.repeat(64)+'  different.mjs\n']){await fs.writeFile(path.join(dir,file+'.sha256'),text);await assert.rejects(ps(command,dir));}
 });
});
test('macOS-style shasum verification works with exactly the chosen download',async t=>{
 if(process.platform==='win32'){t.skip('shasum is not installed here; exercised on Linux CI with the documented Perl CLI');return;}
 for(const file of ['reader-client.mjs','reader-mcp.mjs'])await fixture(file,async dir=>{
 assert.equal(guides.readerVerification(file).macos,`shasum -a 256 -c ${file}.sha256`);
 const r=await execute('shasum',['-a','256','-c',file+'.sha256'],{cwd:dir});assert.match(r.stdout,/OK/);
 await fs.appendFile(path.join(dir,file),'\n// changed bytes');await assert.rejects(execute('shasum',['-a','256','-c',file+'.sha256'],{cwd:dir}));
 });
});
