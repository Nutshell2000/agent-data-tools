// SpellzCode company pages (1.139.0, 11 Nov 2026): /about, /changelog, security.txt and the company footer.
// Brand layer only: these pages must never carry a person's name, a street address or an organisation number until the
// owner says so, and the routing layer (origin, wallets, tool names) is not touched by them.
const assert = require("node:assert/strict");
const { before, test } = require("node:test");
const esbuild = require("esbuild");
const Module = require("node:module");
const { readFileSync } = require("node:fs");

let L;
before(async () => {
  const entry = require.resolve("../src/lib/legal.ts");
  const built = await esbuild.build({ entryPoints: [entry], bundle: true, platform: "node", format: "cjs", write: false });
  const mod = new Module(entry, null); mod.filename = entry; mod.paths = Module._nodeModulePaths(process.cwd()); mod._compile(built.outputFiles[0].text, entry); L = mod.exports;
});

const ORIGIN = "https://agent-data-tools.revmesh2074.workers.dev";
const get = async (path) => L.legal.request(`${ORIGIN}${path}`);
const PERSONAL = /peter|bellbring|alicia|personnummer|\b\d{6}-?\d{4}\b/i;

test("/about names SpellzCode as the seller, links the trust files and carries no personal details", async () => {
  const res = await get("/about");
  assert.equal(res.status, 200);
  const html = await res.text();
  for (const want of ["SpellzCode", "/.well-known/paycheck.json", "/status", "/changelog", "/.well-known/security.txt", 'id="security"']) assert.ok(html.includes(want), want);
  assert.match(html, /registration: in progress/i);
  assert.doesNotMatch(html, PERSONAL);
});

test("/changelog lists releases newest first, without personal names", async () => {
  const res = await get("/changelog");
  assert.equal(res.status, 200);
  const html = await res.text();
  const versions = [...html.matchAll(/<li><strong>(\d+\.\d+\.\d+)<\/strong>/g)].map((m) => m[1]);
  assert.ok(versions.length > 100, `only ${versions.length} releases`);
  const num = (v) => v.split(".").map(Number).reduce((a, n) => a * 1000 + n, 0);
  for (let i = 1; i < versions.length; i++) assert.ok(num(versions[i - 1]) > num(versions[i]), `${versions[i - 1]} before ${versions[i]}`);
  assert.doesNotMatch(html, PERSONAL);
});

test("security.txt follows RFC 9116: contact, an expiry under a year, canonical on the host asked", async () => {
  const res = await get("/.well-known/security.txt");
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type"), /^text\/plain/);
  const body = await res.text();
  assert.match(body, /^Contact: mailto:\S+@\S+$/m);
  assert.match(body, new RegExp(`^Canonical: ${ORIGIN}/.well-known/security.txt$`, "m"));
  const expires = Date.parse(/^Expires: (.+)$/m.exec(body)[1]);
  assert.ok(expires > Date.now() + 90 * 86_400_000 && expires < Date.now() + 365 * 86_400_000);
  const other = await (await L.legal.request("https://tools.funwords.eu/.well-known/security.txt")).text();
  assert.match(other, /^Canonical: https:\/\/tools\.funwords\.eu\/.well-known\/security.txt$/m);
  const legacy = await get("/security.txt");
  assert.equal(legacy.status, 301);
  assert.equal(legacy.headers.get("location"), "/.well-known/security.txt");
});

test("the public pages carry the company line; the product name and the agent card's organisation stay", () => {
  for (const f of ["src/lib/tool-pages.ts", "src/guides/task-guides.ts", "src/lib/browser-402.ts"]) assert.ok(readFileSync(f, "utf8").includes("${COMPANY_FOOTER}</footer>"), f);
  assert.ok(L.COMPANY_FOOTER.includes('href="/about"') && L.COMPANY_FOOTER.includes("SpellzCode"));
  for (const page of [L.PRIVACY_HTML, L.TERMS_HTML, L.SUPPORT_HTML]) assert.ok(page.includes('href="/about"'));
  assert.match(readFileSync("src/endpoints.ts", "utf8"), /export const SERVICE_NAME = "Agent Data Tools";/);
  assert.match(readFileSync("src/discovery.ts", "utf8"), /provider: \{ organization: "SpellzCode", url: `\$\{origin\}\/about` \}/);
});
