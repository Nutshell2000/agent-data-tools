const assert = require("node:assert/strict");
const { test, before } = require("node:test");
const { build } = require("esbuild");
const Module = require("node:module");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { createHash } = require("node:crypto");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
let app,
  assetFetches = 0;
before(async () => {
  const b = await build({
    entryPoints: ["src/index.ts"],
    bundle: true,
    write: false,
    format: "cjs",
    platform: "node",
    external: ["cloudflare:workers"],
  });
  const mod = new Module(path.resolve("src/index.ts"), module);
  mod.filename = path.resolve("src/index.ts");
  mod.paths = Module._nodeModulePaths(process.cwd());
  const original = mod.require.bind(mod);
  mod.require = (name) =>
    name === "cloudflare:workers"
      ? { DurableObject: class {} }
      : original(name);
  mod._compile(b.outputFiles[0].text, mod.filename);
  app = mod.exports.default;
});
const env = {
  PAYWALL: "on",
  PAY_TO: "0x2074c40346ae2a90e0e4a391bcee6f16bf5277f5",
  NETWORK: "eip155:8453",
  ASSETS: {
    async fetch(request) {
      assetFetches++;
      const file = path.join(
        process.cwd(),
        "public",
        new URL(request.url).pathname,
      );
      try {
        return new Response(await fs.readFile(file), {
          headers: {
            "Content-Type": file.endsWith(".json")
              ? "application/json"
              : "text/plain",
          },
        });
      } catch {
        return new Response("missing", { status: 404 });
      }
    },
  },
};
const call = (url, method = "GET", accept = "application/json") =>
  app.fetch(new Request("https://api.test" + url, { method, headers: { accept } }), env, {
    waitUntil() {},
  });
test("owned cached examples match their sources, hashes and declared truncation", async () => {
  const manifest = await (await call("/examples/extract/manifest.json")).json();
  assert.equal(manifest.toolVersion, "1.3.0");
  assert.equal(manifest.samples.length, 3);
  assert.equal(manifest.demonstration, true);
  for (const sample of manifest.samples) {
    const source = await (
      await call(new URL(sample.sourceUrl).pathname)
    ).text();
    assert.equal(
      createHash("sha256").update(source).digest("hex"),
      sample.sourceSha256,
    );
    const output = await (
      await call(new URL(sample.resultUrl).pathname)
    ).text();
    assert.equal(
      createHash("sha256").update(output).digest("hex"),
      sample.resultSha256,
    );
    const v = JSON.parse(output);
    assert.equal(v.demonstration, true);
    assert.equal(v.result.truncated, sample.id === "long-document");
    assert.equal(
      v.result.contentHash,
      "sha256:" + createHash("sha256").update(v.result.text).digest("hex"),
    );
    assert.ok(!("receipt" in v));
  }
  const html = await (await call("/examples/extract/")).text();
  assert.match(html, /not production purchases or payment receipts/);
  assert.equal(
    (await call("/examples/extract/manifest.json", "HEAD")).status,
    200,
  );
});
test("static routes cannot expose arbitrary assets or private seller-kit files", async () => {
  for (const url of [
    "/examples/extract/not-listed.json",
    "/clients/reader/1.1.1/private.txt",
    "/clients/reader/1.1.1/..%2F..%2F_files/secret.zip",
    "/_files/secret.zip",
  ]) {
    const before = assetFetches;
    assert.equal((await call(url)).status, 404);
    assert.equal(assetFetches, before);
  }
});
test("standalone client checksum matches and the bundle runs outside the repository", async () => {
  const binary = "public/clients/reader/1.3.0/reader-client.mjs";
  const bytes = await fs.readFile(binary);
  const checksum = (
    await fs.readFile("public/clients/reader/1.3.0/SHA256SUMS", "utf8")
  ).split(/\s+/)[0];
  assert.equal(createHash("sha256").update(bytes).digest("hex"), checksum);
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "reader-client-check-"));
  const target = path.join(temp, "reader-client.mjs");
  try {
    await fs.copyFile(binary, target);
    const result = await promisify(execFile)(
      process.execPath,
      [target, "--help"],
      { cwd: temp, env: { ...process.env, X402_PRIVATE_KEY: "" } },
    );
    assert.equal(JSON.parse(result.stdout).ok, true);
    assert.equal(result.stderr, "");
  } finally {
    await fs.unlink(target);
    await fs.rmdir(temp);
  }
});


test("old immutable download remains exact and current artifacts match every checksum", async () => {
  for (const file of ['reader-client.mjs','reader-mcp.mjs','command-builder.js','SHA256SUMS']) {
    const response=await call('/clients/reader/1.2.1/'+file);assert.equal(response.status,200);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()),await fs.readFile('clients/releases/1.2.1/'+file));
  }
  for (const file of ['reader-client.mjs','command-builder.js','SHA256SUMS']) {
    const response=await call('/clients/reader/1.2.0/'+file);
    assert.equal(response.status,200);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()),await fs.readFile('clients/releases/1.2.0/'+file));
  }
  const old = await (await call("/clients/reader/1.1.1/reader-client.mjs")).arrayBuffer();
  assert.equal(createHash("sha256").update(Buffer.from(old)).digest("hex"), "706472f78bc384af2a13e348d82a195c55d161a93816aa10c477c205e357a395");
  const checksums = await (await call("/clients/reader/1.3.0/SHA256SUMS")).text();
  for (const line of checksums.trim().split("\n")) {
    const [hash, file] = line.trim().split(/\s+/);
    const response = await call(`/clients/reader/1.3.0/${file}`);
    assert.equal(response.status, 200);
    assert.equal(createHash("sha256").update(Buffer.from(await response.arrayBuffer())).digest("hex"), hash);
  }
});
test('cached late-section proof matches its manifest and scope without claiming full coverage',async()=>{
 const manifest=await(await call('/examples/extract/manifest.json')).json();const response=await call('/examples/extract/section-result.json');assert.equal(response.status,200);
 const bytes=Buffer.from(await response.arrayBuffer());assert.equal(createHash('sha256').update(bytes).digest('hex'),manifest.sectionExample.resultSha256);
 const sample=JSON.parse(bytes);assert.equal(sample.demonstration,true);assert.equal(sample.result.section.id,'example-section-30');assert.equal(sample.result.truncated,false);assert.match(sample.result.text,/Example section 30/);assert.doesNotMatch(sample.result.text,/Example section 29/);assert.equal(sample.result.section.kind,'heading');assert.ok(sample.result.text.length<=500);assert.ok(!('receipt' in sample));
});
test('single-file checksum routes are explicit public assets and linked by the buying guides',async()=>{
 for(const file of ['reader-client.mjs','reader-mcp.mjs']){
 const r=await call('/clients/reader/1.3.0/'+file+'.sha256');assert.equal(r.status,200);const checksum=await r.text();assert.match(checksum,new RegExp('^[a-f0-9]{64}  '+file.replaceAll('.','\\.')+'\\n$'));
 }
 for(const route of ['/','/guides/web-reading','/guides/local-mcp','/guides/sitemap']){const html=await(await call(route,'GET','text/html')).text();assert.ok(html.includes('.mjs.sha256'),route);assert.ok(html.includes('Get-FileHash'),route);}
 assert.equal((await call('/clients/reader/1.3.0/anything.sha256')).status,404);
});
test('buyer skill GET/HEAD is free, byte-consistent and discoverable without exposing arbitrary skills files',async()=>{
 const route='/skills/spellzcode-x402-reader/SKILL.md';
 const response=await call(route);assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/text\/markdown/);assert.equal(response.headers.has('PAYMENT-REQUIRED'),false);
 assert.equal(await response.text(),(await fs.readFile('skills/spellzcode-x402-reader/SKILL.md','utf8')).replaceAll('https://agent-data-tools.revmesh2074.workers.dev','https://api.test'));
 const head=await call(route,'HEAD');assert.equal(head.status,200);assert.equal(await head.text(),'');
 const index=await(await call('/skills/index.json')).json();assert.equal(index.skill,'https://api.test'+route);assert.equal(index.clientVersion,'1.3.0');
 const card=await(await call('/')).json();assert.equal(card.docs.buyerSkill,'https://api.test'+route);
 for(const p of ['/','/guides/web-reading','/llms.txt']){const text=await(await call(p,'GET','text/html')).text();assert.ok(text.includes(route),p);}
 assert.equal((await call('/skills/spellzcode-x402-reader/private.json')).status,404);
 assert.equal((await call('/skills/unknown/SKILL.md')).status,404);
});

test('local MCP guide and downloadable adapter are available without paid work',async()=>{
  const html=await(await call('/guides/local-mcp','GET','text/html')).text();
  assert.match(html,/<title>Buy page reads from an MCP agent/);
  assert.ok(html.includes('quotes') || html.includes('Quotes'));
  for(const phrase of ['--enable-buy','--session-max-usdc','restart','reader_quote','reader_buy','structuredContent'])assert.ok(html.includes(phrase),phrase);
  const md=await(await call('/guides/local-mcp.md')).text();
  assert.ok(md.includes('/clients/reader/1.3.0/reader-mcp.mjs'));
  assert.equal((await call('/clients/reader/1.3.0/reader-mcp.mjs')).status,200);
  assert.equal((await call('/clients/reader/1.2.0/reader-mcp.mjs')).status,404);
  for(const route of ['/','/guides/web-reading','/llms.txt'])assert.ok((await(await call(route,'GET','text/html')).text()).includes('/guides/local-mcp'),route);
});

test("homepage and guide show actual cached technical output before advanced material", async () => {
  const demo = JSON.parse(await fs.readFile("public/examples/extract/technical-guide.json", "utf8"));
  const escaped = demo.result.markdown.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]).replace(/'/g, "&#39;");
  for (const path of ["/", "/guides/web-reading"]) {
    const response = await call(path, "GET", "text/html");
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.ok(html.includes(escaped));
    assert.match(html, /View a real result.*Inspect a free quote.*Buy one page/);
    assert.match(html, /type="module" src="\/clients\/reader\/1.3.0\/command-builder.js"/);
    assert.doesNotMatch(html, /<form|type="password"|href="\/store"/);
    assert.ok(html.indexOf('id="reader-builder"') < html.indexOf(path === "/" ? "Tools and prices" : "Buy one result over HTTP"));
  }
});


test("sitemap cached output matches source and both older published client versions remain available",async()=>{
  const manifest=await(await call('/examples/sitemap/manifest.json')).json();assert.equal(manifest.toolVersion,'1.3.0');assert.equal(manifest.demonstration,true);
  const source=await(await call('/examples/sitemap/source.xml')).text();assert.equal(createHash('sha256').update(source).digest('hex'),manifest.sourceSha256);
  const output=await(await call('/examples/sitemap/result.json')).text();assert.equal(createHash('sha256').update(output).digest('hex'),manifest.resultSha256);
  const v=JSON.parse(output);assert.equal(v.demonstration,true);assert.equal(v.result.kind,'urlset');assert.equal(v.result.entries.length,2);assert.equal(v.result.nextOffset,2);assert.ok(!('receipt' in v));
  assert.equal((await call('/guides/sitemap')).status,200);
  assert.equal((await call('/examples/sitemap/hidden.xml')).status,404);
  assert.equal((await call('/examples/sitemap/result.json','HEAD')).status,200);
  for(const version of ['1.1.1','1.1.2']){
    const bytes=Buffer.from(await(await call(`/clients/reader/${version}/reader-client.mjs`)).arrayBuffer());assert.equal(createHash('sha256').update(bytes).digest('hex'),'706472f78bc384af2a13e348d82a195c55d161a93816aa10c477c205e357a395');
  }
  const browser=Buffer.from(await(await call('/clients/reader/1.1.2/command-builder.js')).arrayBuffer());assert.equal(createHash('sha256').update(browser).digest('hex'),'5b66356133ae5c307680eae0bcf690e96e14db073ea6005a311723a3e1735cd0');
});
