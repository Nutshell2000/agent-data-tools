const assert=require('node:assert/strict');const {test,before}=require('node:test');const {build}=require('esbuild');let md;
before(async()=>{const b=await build({entryPoints:['src/lib/markdown.ts'],bundle:true,write:false,format:'cjs',platform:'node'});const m={exports:{}};new Function('module','exports',b.outputFiles[0].text)(m,m.exports);md=m.exports;});
test('clipped top-level and list-contained code blocks close within the limit',()=>{
 for(const [prefix,indent] of [['',''],['3. ','   '],['   ','   ']]){const full=prefix+'```python\n'+indent+'print(1)\n'.repeat(100)+'\n'+indent+'```\n\nEnd';const clipped=md.clipMarkdown(full,500);assert.ok(clipped.length<=500);assert.ok(clipped.endsWith('\n'+indent+'```'));}
});
test('a clip inside an opening fence omits the partial block and completed blocks stay closed',()=>{
 const full='Before\n\n```python\n'+'x'.repeat(1000)+'\n```';assert.equal(md.clipMarkdown(full,15),'Before');const complete='```\nok\n```\n\n'+'rest '.repeat(100);assert.ok(md.clipMarkdown(complete,30).startsWith('```\nok\n```'));
});
test('source delimiter runs choose a safe alternative and pathological fences stay bounded',()=>{
 assert.match(md.fencedCode('`'.repeat(200000),'text'),/^~~~text\n/);assert.ok(md.fencedCode('`'.repeat(200)+'~'.repeat(200)).startsWith('    '));
});
