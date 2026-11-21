// Sitemap <lastmod> (16 Nov 2026): a true day or nothing. The rules that map a page to its source files cover every
// sitemap URL; dates come from git history and never from the day of the build.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { before, test } from "node:test";
import { pathToFileURL } from "node:url";
import { ROOT, assertFullHistory, changedInRelease, commitTimes, loadSite, pageLastmod, render, sourcesFor, utcDay } from "./build-page-lastmod.mjs";

let site;
before(async () => { site = await loadSite(); });

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const today = () => new Date().toISOString().slice(0, 10);

test("every sitemap URL resolves to a mapping rule whose files exist", () => {
  // 21 Nov 2026: about 690 (per-chain copies of one method left the sitemap, lib/tool-clones.ts).
  assert.ok(site.paths.length > 600, `${site.paths.length} sitemap paths`);
  for (const page of site.paths) {
    const files = sourcesFor(page, site);
    assert.ok(files?.length, `no rule in sourcesFor (scripts/build-page-lastmod.mjs) for ${page}`);
    for (const f of files) assert.ok(existsSync(path.join(ROOT, f)), `${page}: ${f} does not exist`);
  }
  assert.equal(sourcesFor("/not-a-page", site), undefined);
  assert.equal(sourcesFor("/tools/not-a-tool", site), undefined);
});

test("a tool page follows its own route file, the page template and, with search copy, the copy file", () => {
  const [page, tool] = [...site.toolOfPage].find(([, t]) => site.routeFilesOf.get(t)?.[0] === "src/routes/bic.ts" && !site.seoTools.has(t));
  assert.deepEqual(sourcesFor(page, site), ["src/routes/bic.ts", "src/lib/tool-pages.ts"], tool);
  assert.deepEqual(sourcesFor("/tools/weather", site), ["src/endpoints.ts", "src/tools.ts", "src/lib/tool-pages.ts", ...(site.seoTools.has("/weather") ? ["src/lib/tool-seo.ts"] : [])]);
  assert.ok(sourcesFor("/tools/sanctions-check", site).includes("src/lib/tool-seo.ts"));
  assert.ok(site.routeFilesOf.size > 500, "route files were matched to tools");
});

test("the sitemap carries a valid past day or no lastmod at all, and the committed days are not all the same", () => {
  const entries = [...site.xml.matchAll(/<url><loc>([^<]+)<\/loc>(?:<lastmod>([^<]*)<\/lastmod>)?<\/url>/g)];
  assert.equal(entries.length, site.paths.length, "every <url> is a loc with at most one lastmod");
  const days = entries.map((m) => m[2]).filter((d) => d !== undefined);
  for (const day of days) {
    assert.match(day, DAY);
    assert.ok(!Number.isNaN(Date.parse(day)) && day <= today(), `${day} is a real day, not after today`);
  }
  assert.equal(days.length, Object.keys(site.PAGE_LASTMOD).filter((p) => site.paths.includes(p)).length);
  if (days.length > 1) assert.ok(new Set(days).size > 1, "one date for every page is the date of the build, not of the pages");
});

test("the sitemap element: a known past day, otherwise nothing", () => {
  const dates = { "/a": "2026-11-14", "/b": "2026-11-16", "/future": "2026-11-17", "/bad": "16 Nov 2026", "/unreal": "2026-13-45" };
  assert.equal(site.lastmodTag("/a", "2026-11-16", dates), "<lastmod>2026-11-14</lastmod>");
  assert.equal(site.lastmodTag("/b", "2026-11-16", dates), "<lastmod>2026-11-16</lastmod>");
  for (const p of ["/future", "/bad", "/unreal", "/missing", "toString", "__proto__"]) assert.equal(site.lastmodTag(p, "2026-11-16", dates), "", p);
});

test("a page's day is the newest commit among its files; this release's files count as today; unknown stays unknown", () => {
  const at = (iso) => Date.parse(iso) / 1000;
  const times = new Map([["home.ts", at("2026-11-10T08:00:00Z")], ["products.ts", at("2026-11-12T23:30:00-02:00")], ["old.ts", at("2026-10-01T12:00:00Z")], ["tomorrow.ts", at("2026-11-17T12:00:00Z")]]);
  const files = { "/": ["home.ts", "products.ts"], "/p": ["products.ts"], "/old": ["old.ts"], "/edited": ["old.ts", "edited.ts"], "/untracked-source": ["old.ts", "nowhere.ts"], "/future": ["tomorrow.ts"] };
  const out = pageLastmod({ paths: [...Object.keys(files), "/no-rule"], sourcesOf: (p) => files[p], times, changed: new Set(["edited.ts"]), today: "2026-11-16" });
  assert.deepEqual(out.dates, { "/": "2026-11-13", "/p": "2026-11-13", "/old": "2026-10-01", "/edited": "2026-11-16" }, "23:30 at -02:00 is the 13th in UTC");
  assert.deepEqual(out.unmapped, ["/no-rule"]);
  assert.deepEqual(out.unknown, ["/untracked-source"]);
  assert.deepEqual(out.future, ["/future"]);
  assert.ok(new Set(Object.values(out.dates)).size > 1);
  assert.equal(utcDay(0), "1970-01-01");
  assert.match(render(out.dates), /^\/\/ Generated[^]*\n  "\/": "2026-11-13",\n  "\/edited": "2026-11-16",\n  "\/old": "2026-10-01",\n  "\/p": "2026-11-13",\n\};\n$/);
  assert.match(render({}), /= \{\};\n$/);
});

test("dates are read from a real git history, and a shallow clone is refused", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "page-lastmod-"));
  try {
    const repo = path.join(dir, "repo");
    const env = { ...process.env, GIT_AUTHOR_NAME: "test", GIT_AUTHOR_EMAIL: "test@example.invalid", GIT_COMMITTER_NAME: "test", GIT_COMMITTER_EMAIL: "test@example.invalid", GIT_CONFIG_GLOBAL: path.join(dir, "no-gitconfig"), GIT_CONFIG_NOSYSTEM: "1" };
    const git = (cwd, when, ...args) => execFileSync("git", args, { cwd, env: { ...env, GIT_AUTHOR_DATE: when, GIT_COMMITTER_DATE: when }, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" });
    git(dir, "", "init", "-q", "-b", "main", "repo");
    const commit = (when, files) => { for (const [f, text] of Object.entries(files)) writeFileSync(path.join(repo, f), text); git(repo, when, "add", "-A"); git(repo, when, "commit", "-q", "-m", `change ${Object.keys(files).join(" ")}`); };
    commit("2026-11-01T10:00:00Z", { "a.ts": "1", "b.ts": "1" });
    commit("2026-11-05T10:00:00Z", { "b.ts": "2" });
    commit("2026-11-09T10:00:00Z", { "c.ts": "1" });
    assertFullHistory(repo);
    const times = commitTimes(repo);
    assert.deepEqual(Object.fromEntries([...times].map(([f, t]) => [f, utcDay(t)])), { "c.ts": "2026-11-09", "b.ts": "2026-11-05", "a.ts": "2026-11-01" });
    assert.deepEqual([...changedInRelease(repo, "none")], [], "a clean tree changes nothing");
    writeFileSync(path.join(repo, "a.ts"), "edited");
    writeFileSync(path.join(repo, "new file.ts"), "new");
    assert.deepEqual([...changedInRelease(repo, "none")].sort(), ["a.ts", "new file.ts"]);
    git(repo, "2026-11-10T10:00:00Z", "checkout", "-q", "-b", "feature");
    git(repo, "2026-11-10T10:00:00Z", "add", "-A");
    git(repo, "2026-11-10T10:00:00Z", "commit", "-q", "-m", "feature");
    assert.deepEqual([...changedInRelease(repo, "main")].sort(), ["a.ts", "new file.ts"], "committed on the branch, not yet on the base");

    git(dir, "", "clone", "-q", "--depth", "1", pathToFileURL(repo).href, "shallow");
    assert.throws(() => assertFullHistory(path.join(dir, "shallow")), /shallow/);
  } finally { rmSync(dir, { recursive: true, force: true, maxRetries: 3 }); }
});
