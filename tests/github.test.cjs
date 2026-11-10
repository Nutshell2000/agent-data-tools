// GitHub repository tools (10 Nov 2026): repository facts only, by the owner's decision. Mocked fetch throughout.
const assert = require("node:assert/strict");
const { before, test } = require("node:test");
const esbuild = require("esbuild");
const Module = require("node:module");

async function load(entry) {
  const built = await esbuild.build({ entryPoints: [entry], bundle: true, platform: "node", format: "cjs", write: false, external: ["cloudflare:workers"] });
  const mod = new Module(entry, null);
  mod.filename = entry;
  mod.paths = Module._nodeModulePaths(process.cwd());
  mod._compile(built.outputFiles[0].text, entry);
  return mod.exports;
}

let G;
before(async () => { G = await load(require.resolve("../src/routes/github.ts")); });

const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
// What GitHub really sends for a repository, personal fields of the owner included: none of them may reach an answer.
const REPO = {
  full_name: "vercel/next.js", html_url: "https://github.com/vercel/next.js", description: "The React Framework", homepage: "https://nextjs.org",
  stargazers_count: 131000, forks_count: 28100, subscribers_count: 1480, open_issues_count: 3400, language: "JavaScript", topics: ["react", "nextjs"],
  license: { spdx_id: "MIT", name: "MIT License" }, default_branch: "canary", created_at: "2016-10-05T23:32:51Z", pushed_at: "2026-11-10T08:41:07Z", updated_at: "2026-11-10T08:50:12Z",
  archived: false, fork: false, is_template: false, size: 2300000,
  owner: { login: "vercel", type: "Organization", id: 14985020, avatar_url: "https://avatars.githubusercontent.com/u/14985020", html_url: "https://github.com/vercel", email: "someone@example.com", gravatar_id: "", site_admin: false },
};
const RELEASE = { tag_name: "v16.0.1", name: "v16.0.1", published_at: "2026-10-28T17:02:11Z", prerelease: false, draft: false, html_url: "https://github.com/vercel/next.js/releases/tag/v16.0.1", body: "x".repeat(2000), author: { login: "a-person", avatar_url: "https://avatars.githubusercontent.com/u/1" } };

function fetcher(routes, seen = []) {
  return async (url, init) => {
    seen.push({ url, init });
    const path = url.replace("https://api.github.com", "");
    for (const [prefix, answer] of routes) if (path.startsWith(prefix)) return typeof answer === "function" ? answer(path) : answer.clone();
    return json({ message: "Not Found" }, 404);
  };
}

test("a repository as agents write it", () => {
  for (const raw of ["vercel/next.js", " vercel/next.js ", "https://github.com/vercel/next.js", "github.com/vercel/next.js/", "https://github.com/vercel/next.js/tree/canary/packages", "https://www.github.com/vercel/next.js.git", "git@github.com:vercel/next.js.git", "https://github.com/vercel/next.js?tab=readme#top"]) {
    assert.equal(G.repoName(raw), "vercel/next.js", raw);
  }
  assert.equal(G.repoName("next.js", "vercel"), "vercel/next.js");
  assert.equal(G.repoName("next.js", "@vercel"), "vercel/next.js");
  for (const bad of ["", "next.js", "a/b c", "../etc", "vercel/..", "-bad/name", "o/" + "n".repeat(101)]) assert.throws(() => G.repoName(bad), (e) => e.status === 400, bad);
});

test("repository facts: counts, languages, licence, latest release, and no personal data", async () => {
  const seen = [];
  const out = await G.repoFacts({ GITHUB_TOKEN: "tkn" }, "vercel/next.js", fetcher([
    ["/repos/vercel/next.js/languages", json({ JavaScript: 600, TypeScript: 300, Rust: 100, Empty: 0 })],
    ["/repos/vercel/next.js/releases/latest", json(RELEASE)],
    ["/repos/vercel/next.js", json(REPO)],
  ], seen));
  assert.equal(out.repo, "vercel/next.js");
  assert.equal(out.owner, "vercel");
  assert.equal(out.ownerType, "Organization");
  assert.equal(out.stars, 131000);
  assert.equal(out.watchers, 1480);
  assert.equal(out.openIssuesAndPulls, 3400);
  assert.deepEqual(out.languages, { JavaScript: 60, TypeScript: 30, Rust: 10 });
  assert.equal(out.license, "MIT");
  assert.deepEqual(out.latestRelease, { tag: "v16.0.1", name: "v16.0.1", publishedAt: "2026-10-28T17:02:11Z", prerelease: false, url: RELEASE.html_url });
  const text = JSON.stringify(out);
  for (const personal of ["avatar", "email", "someone@example.com", "gravatar", "a-person", "site_admin", "14985020"]) assert.ok(!text.includes(personal), `${personal} must not be returned`);
  // The token travels as a bearer header and every read identifies us.
  assert.equal(seen.length, 3);
  for (const s of seen) { assert.equal(s.init.headers.authorization, "Bearer tkn"); assert.match(s.init.headers["user-agent"], /AgentDataTools/); }
});

test("without a token no authorization header is sent; a repository without releases or languages still answers", async () => {
  const seen = [];
  const out = await G.repoFacts({}, "vercel/next.js", fetcher([["/repos/vercel/next.js/languages", json({}, 500)], ["/repos/vercel/next.js/releases", json({ message: "Not Found" }, 404)], ["/repos/vercel/next.js", json({ ...REPO, license: null, subscribers_count: undefined })]], seen));
  assert.equal(out.latestRelease, null);
  assert.deepEqual(out.languages, {});
  assert.equal(out.license, null);
  assert.equal(out.watchers, null);
  assert.ok(seen.every((s) => !("authorization" in s.init.headers)));
});

test("an expired token is retried without it instead of failing the call", async () => {
  const seen = [];
  const out = await G.repoReleases({ GITHUB_TOKEN: "old" }, "vercel/next.js", 1, async (url, init) => { seen.push(init.headers.authorization ?? null); return init.headers.authorization ? json({ message: "Bad credentials" }, 401) : json([RELEASE]); });
  assert.equal(out.count, 1);
  assert.deepEqual(seen, ["Bearer old", null]);
});

test("a missing repository is 404 and a used-up rate limit is an uncharged 503, never a wrong answer", async () => {
  await assert.rejects(G.repoFacts({}, "nobody/nothing", fetcher([])), (e) => e.status === 404 && /nobody\/nothing/.test(e.message));
  const limited = fetcher([["/repos/", json({ message: "API rate limit exceeded for 1.2.3.4." }, 403, { "x-ratelimit-remaining": "0" })]]);
  await assert.rejects(G.repoFacts({}, "vercel/next.js", limited), (e) => e.status === 503 && e.code === "GITHUB_BUSY" && !/1\.2\.3\.4/.test(e.message));
  await assert.rejects(G.repoFacts({}, "vercel/next.js", fetcher([["/repos/", json({ message: "secondary rate limit" }, 429)]])), (e) => e.status === 503);
  await assert.rejects(G.repoFacts({}, "vercel/next.js", fetcher([["/repos/", json({ message: "Repository access blocked" }, 403, { "x-ratelimit-remaining": "4000" })]])), (e) => e.status === 404);
  await assert.rejects(G.repoFacts({}, "vercel/next.js", fetcher([["/repos/", json({}, 500)]])), (e) => e.status === 502);
  await assert.rejects(G.repoFacts({}, "vercel/next.js", async () => { throw new Error("network"); }), (e) => e.status === 502);
});

test("repository search: query, language and sort reach GitHub; results carry repository fields only", async () => {
  const seen = [];
  const out = await G.repoSearch({}, "x402 payments", "stars", "Type Script;", 2, fetcher([["/search/repositories", json({ total_count: 412, items: [REPO, { ...REPO, full_name: "coinbase/x402" }, REPO] })]], seen));
  const sent = new URL(seen[0].url).searchParams;
  assert.equal(sent.get("q"), "x402 payments language:TypeScript");
  assert.equal(sent.get("sort"), "stars");
  assert.equal(sent.get("per_page"), "2");
  assert.equal(out.total, 412);
  assert.equal(out.repos.length, 2);
  assert.deepEqual(Object.keys(out.repos[0]), ["repo", "url", "description", "stars", "forks", "language", "topics", "license", "pushedAt", "archived"]);
  const best = [];
  await G.repoSearch({}, "mcp", "best-match", undefined, 5, fetcher([["/search/repositories", json({ total_count: 0, items: [] })]], best));
  assert.equal(new URL(best[0].url).searchParams.get("sort"), null);
  await assert.rejects(G.repoSearch({}, "x", "stars", undefined, 5, fetcher([["/search/", json({ message: "Validation Failed" }, 422)]])), (e) => e.status === 400);
});

test("releases: newest first without drafts, notes clipped, no author", async () => {
  const out = await G.repoReleases({}, "vercel/next.js", 2, fetcher([["/repos/vercel/next.js/releases", json([{ ...RELEASE, draft: true, tag_name: "draft" }, RELEASE, { ...RELEASE, tag_name: "v16.0.0", body: null }, { ...RELEASE, tag_name: "v15.9.9" }])]]));
  assert.equal(out.count, 2);
  assert.deepEqual(out.releases.map((r) => r.tag), ["v16.0.1", "v16.0.0"]);
  assert.equal(out.releases[0].notes.length, 1500);
  assert.equal(out.releases[0].notesTruncated, true);
  assert.equal(out.releases[1].notes, null);
  assert.ok(!JSON.stringify(out).includes("a-person"));
  await assert.rejects(G.repoReleases({}, "nobody/nothing", 2, fetcher([])), (e) => e.status === 404);
});

test("the three tools are listed with task names and required inputs", () => {
  const byPath = Object.fromEntries(G.GITHUB.map((e) => [e.endpoint.path, e.endpoint]));
  assert.deepEqual(Object.keys(byPath), ["/github/repo", "/github/search", "/github/releases"]);
  assert.equal(byPath["/github/repo"].summary.split(":")[0], "GitHub repo data");
  assert.equal(byPath["/github/search"].summary.split(":")[0], "GitHub search");
  assert.equal(byPath["/github/releases"].summary.split(":")[0], "GitHub releases");
  assert.ok(byPath["/github/repo"].params.repo.required && byPath["/github/search"].params.q.required && byPath["/github/releases"].params.repo.required);
  for (const e of Object.values(byPath)) assert.ok(!/user profile|e-?mail address|followers/i.test(e.summary), e.path);
});
