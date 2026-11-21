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
// Personal words are held as salted SHA-256 hashes, so this public file checks for them without spelling them (21 Nov 2026).
const { createHash } = require("node:crypto");
const PRIVATE_WORDS = new Set(["0816a9e41fea8b25f98a767bc50fc07f28b1d319ab29f3fc3cbd734640414390","9e289a8e88161f5414cd1e69c056ee06bf36170e0b30aff8d6aa0a9d8b6f5574","d3495dc3ccedf1d14b96684e8cb0a3c8592b8bbb66b1983565b4d25e2915d0c1"]);
const PERSONAL_PATTERN = /personnummer|\b\d{6}-?\d{4}\b/i;
const personal = (html) => PERSONAL_PATTERN.test(html) || (html.toLowerCase().match(/[a-z\u00e0-\u00ff]+/g) ?? []).some((w) => PRIVATE_WORDS.has(createHash("sha256").update(`adt-private-word:${w}`).digest("hex")));

test("/about names SpellzCode as the seller, links the trust files and carries no personal details", async () => {
  const res = await get("/about");
  assert.equal(res.status, 200);
  const html = await res.text();
  for (const want of ["SpellzCode", "/.well-known/paycheck.json", "/status", "/changelog", "/.well-known/security.txt", 'id="security"']) assert.ok(html.includes(want), want);
  assert.match(html, /registration: in progress/i);
  assert.equal(personal(html), false, "no personal details on the page");
});

test("/changelog lists releases newest first, without personal names", async () => {
  const res = await get("/changelog");
  assert.equal(res.status, 200);
  const html = await res.text();
  const versions = [...html.matchAll(/<li><strong>(\d+\.\d+\.\d+)<\/strong>/g)].map((m) => m[1]);
  assert.ok(versions.length > 100, `only ${versions.length} releases`);
  const num = (v) => v.split(".").map(Number).reduce((a, n) => a * 1000 + n, 0);
  for (let i = 1; i < versions.length; i++) assert.ok(num(versions[i - 1]) > num(versions[i]), `${versions[i - 1]} before ${versions[i]}`);
  assert.equal(personal(html), false, "no personal details on the page");
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
  for (const p of ["/about", "/terms", "/privacy", "/refunds", "/faq", "/contact"]) assert.ok(L.COMPANY_FOOTER.includes(`href="${p}"`), `COMPANY_FOOTER must link ${p}`);
  assert.match(readFileSync("src/endpoints.ts", "utf8"), /export const SERVICE_NAME = "Agent Data Tools";/);
  assert.match(readFileSync("src/discovery.ts", "utf8"), /provider: \{ organization: "SpellzCode", url: `\$\{origin\}\/about` \}/);
});

test("buyer trust pages /contact, /refunds and /faq render with the real refund rule and free-call counts", async () => {
  for (const [path, needle] of [["/contact", "mailto:"], ["/refunds", "Unused credits"], ["/faq", "trial=1"]]) {
    const r = await get(path);
    assert.equal(r.status, 200, path);
    assert.match(await r.text(), new RegExp(needle), path);
  }
  assert.match(L.REFUNDS_HTML, /Used credits are not refundable/);
  assert.ok(L.FAQ_HTML.includes("href=\"/refunds\""), "FAQ links the refund rule");
});
