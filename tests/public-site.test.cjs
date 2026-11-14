// The public home of the human pages (10 Nov 2026): other hosts name it as canonical; nothing else changes.
const assert = require("node:assert/strict");
const { before, test } = require("node:test");
const esbuild = require("esbuild");
const Module = require("node:module");
const { readFileSync } = require("node:fs");

let S;
before(async () => {
  const entry = require.resolve("../src/lib/public-site.ts");
  const built = await esbuild.build({ entryPoints: [entry], bundle: true, platform: "node", format: "cjs", write: false });
  const mod = new Module(entry, null); mod.filename = entry; mod.paths = Module._nodeModulePaths(process.cwd()); mod._compile(built.outputFiles[0].text, entry); S = mod.exports;
});

const WORKER = "https://agent-data-tools.revmesh2074.workers.dev", SITE = "https://tools.funwords.eu";
const page = (o) => `<head><link rel="canonical" href="${o}/tools/eth-gas"><meta property="og:url" content="${o}/tools/eth-gas"><meta property="og:image" content="${o}/og.png"></head><pre>curl "${o}/eth/gas"</pre>`;

test("a page served from another host names the public host as canonical and og:url, and nothing else", () => {
  const out = S.withPublicCanonical(page(WORKER), WORKER, SITE);
  assert.ok(out.includes(`<link rel="canonical" href="${SITE}/tools/eth-gas">`));
  assert.ok(out.includes(`<meta property="og:url" content="${SITE}/tools/eth-gas">`));
  assert.ok(out.includes(`curl "${WORKER}/eth/gas"`), "request examples keep the host that was asked");
  assert.ok(out.includes(`content="${WORKER}/og.png"`));
  assert.equal(S.withPublicCanonical(page(WORKER), WORKER, `${SITE}/`), out, "a trailing slash in the setting is ignored");
});

test("the public host itself, an unset or a malformed setting leave the page as it is", () => {
  assert.equal(S.withPublicCanonical(page(SITE), SITE, SITE), page(SITE));
  for (const bad of [undefined, "", "  ", "tools.funwords.eu", "http://tools.funwords.eu", "https://tools.funwords.eu/path", 'https://x.test"><script>']) assert.equal(S.withPublicCanonical(page(WORKER), WORKER, bad), page(WORKER), String(bad));
});

test("production names the public host; staging does not", () => {
  assert.match(readFileSync("wrangler.jsonc", "utf8"), /"PUBLIC_SITE_ORIGIN": "https:\/\/tools\.funwords\.eu"/);
  assert.ok(!/PUBLIC_SITE_ORIGIN/.test(readFileSync("wrangler.staging.jsonc", "utf8")));
});

test("pages on a retired public host move to the public site; the paid origin and unlisted hosts never do", () => {
  const NEW = "https://glyphcall.com";
  assert.equal(S.movedPageUrl("https://tools.funwords.eu/tools/eth-gas?x=1", NEW, "tools.funwords.eu"), "https://glyphcall.com/tools/eth-gas?x=1");
  assert.equal(S.movedPageUrl("https://TOOLS.funwords.eu/", `${NEW}/`, " tools.funwords.eu , old.example "), "https://glyphcall.com/");
  assert.equal(S.movedPageUrl(`${WORKER}/tools/eth-gas`, NEW, "tools.funwords.eu"), null, "the paid origin is not retired");
  assert.equal(S.movedPageUrl("https://glyphcall.com/credits", NEW, "glyphcall.com"), null, "the public site never redirects to itself");
  for (const [site, retired] of [[undefined, "tools.funwords.eu"], [NEW, undefined], [NEW, ""], ["glyphcall.com", "tools.funwords.eu"], ["https://glyphcall.com/path", "tools.funwords.eu"]]) {
    assert.equal(S.movedPageUrl("https://tools.funwords.eu/credits", site, retired), null, `${site} / ${retired}`);
  }
});
