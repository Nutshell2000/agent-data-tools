const assert=require('node:assert/strict');
const{test,before}=require('node:test');
const{build}=require('esbuild');
const fs=require('node:fs/promises');
const{execFile}=require('node:child_process');
const{promisify}=require('node:util');
let skill,client,document;
const origin='https://agent-data-tools.revmesh2074.workers.dev',version=require('../package.json').version;
async function load(file){const b=await build({entryPoints:[file],bundle:true,write:false,platform:'node',format:'cjs'});const m={exports:{}};new Function('require','module','exports',b.outputFiles[0].text)(require,m,m.exports);return m.exports;}
before(async()=>{skill=await load('src/guides/reader-skill.ts');client=await load('clients/reader-core.mjs');document=await fs.readFile('skills/spellzcode-x402-reader/SKILL.md','utf8');});
test('portable skill metadata and repository artifact match the maintained source and client version',()=>{
 assert.equal(document,skill.readerSkillMarkdown(origin,version));
 const front=/^---\n([\s\S]*?)\n---\n/.exec(document)?.[1];assert.ok(front);
 const name=/^name: (.+)$/m.exec(front)?.[1];assert.equal(name,'spellzcode-x402-reader');assert.match(name,/^[a-z0-9]+(?:-[a-z0-9]+)*$/);assert.ok(name.length<=64);
 const description=JSON.parse(/^description: (.+)$/m.exec(front)[1]);assert.ok(description.length>0&&description.length<=1024);assert.equal(description,skill.READER_SKILL_DESCRIPTION);
 assert.ok(front.includes(`client-version: "${version}"`));assert.ok(!front.includes('allowed-tools:'));
 assert.ok(document.includes(`/clients/reader/${version}/reader-client.mjs.sha256`));assert.ok(document.includes('This file grants no spending permission.'));
 assert.ok(document.includes('stop at the free quote'));assert.ok(document.includes('Do not modify host settings'));assert.ok(document.includes('do not automatically retry'));
 assert.doesNotMatch(document,/0x[0-9a-f]{64}\b/i);assert.ok(document.split('\n').length<100);
});
test('skill CLI examples tokenize into supported capped commands without executing a purchase',async()=>{
 const examples=[...document.matchAll(/```sh\n([\s\S]*?)\n```/g)].map(m=>m[1]);assert.equal(examples.length,2);
 for(const[at,command]of examples.entries()){
 const r=await promisify(execFile)('bash',['-c',`node(){ printf '%s\\0' "$@"; }; ${command}`]);const args=r.stdout.split('\0').slice(0,-1);assert.equal(args[0],'reader-client.mjs');const parsed=client.parseReaderArgs(args.slice(1));assert.equal(parsed.command,at===0?'quote':'buy');assert.equal(parsed.path,'/extract');assert.equal(parsed.format,'markdown');assert.equal(parsed.capAtomic,2000n);assert.equal(r.stderr,'');
 }
});
test('owned skill index points to one instruction file and does not claim installation or host activation',()=>{
 const index=skill.readerSkillIndex(origin,version);assert.equal(index.skill,origin+'/skills/spellzcode-x402-reader/SKILL.md');assert.equal(index.clientVersion,version);assert.ok(index.installation.includes('does not install'));assert.ok(index.paymentAuthorization.includes('Required separately'));assert.ok(index.note.includes('not a claim of automatic discovery'));
});
