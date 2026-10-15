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
const call = (url, method = "GET") =>
  app.fetch(new Request("https://api.test" + url, { method }), env, {
    waitUntil() {},
  });
test("owned cached examples match their sources, hashes and declared truncation", async () => {
  const manifest = await (await call("/examples/extract/manifest.json")).json();
  assert.equal(manifest.toolVersion, "1.1.1");
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
  const binary = "public/clients/reader/1.1.1/reader-client.mjs";
  const bytes = await fs.readFile(binary);
  const checksum = (
    await fs.readFile("public/clients/reader/1.1.1/SHA256SUMS", "utf8")
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
