// IndexNow submission (scripts/indexnow.mjs): which URLs go out, in what batches and in what body. No network here.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { ENDPOINT, MAX_URLS, batches, defaultOrigin, main, parseArgs, parseSitemap, payload, selectUrls, sinceDay, verdict } from "./indexnow.mjs";

const SITE = "https://glyphcall.com";
const xml = (rows) => `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${rows.map(([loc, lastmod]) => `<url><loc>${loc}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ""}</url>`).join("")}</urlset>`;

test("the sitemap is read with and without lastmod", () => {
  assert.deepEqual(parseSitemap(xml([[`${SITE}/`, "2026-11-16"], [`${SITE}/docs`], [`${SITE}/a?x=1&amp;y=2`, "2026-11-01T10:00:00+00:00"]])), [
    { loc: `${SITE}/`, lastmod: "2026-11-16" }, { loc: `${SITE}/docs` }, { loc: `${SITE}/a?x=1&y=2`, lastmod: "2026-11-01T10:00:00+00:00" },
  ]);
  assert.deepEqual(parseSitemap("<urlset></urlset>"), []);
});

test("only the host's own https URLs are submitted, each once", () => {
  const entries = parseSitemap(xml([[`${SITE}/`], [`${SITE}/docs`], [`${SITE}/docs`], ["https://agent-data-tools.revmesh2074.workers.dev/docs"], ["https://www.glyphcall.com/docs"], ["http://glyphcall.com/plain"], ["not a url"]]));
  const picked = selectUrls(entries, SITE);
  assert.deepEqual(picked.urls, [`${SITE}/`, `${SITE}/docs`]);
  assert.equal(picked.otherHost, 4);
  assert.equal(picked.all, true);
});

test("--changed-since keeps pages whose lastmod is on or after the day, and no page without one", () => {
  const entries = parseSitemap(xml([[`${SITE}/old`, "2026-11-10"], [`${SITE}/same-day`, "2026-11-14"], [`${SITE}/new`, "2026-11-16"], [`${SITE}/timed`, "2026-11-15T08:00:00+00:00"], [`${SITE}/unknown`]]));
  const picked = selectUrls(entries, SITE, "2026-11-14");
  assert.deepEqual(picked.urls, [`${SITE}/same-day`, `${SITE}/new`, `${SITE}/timed`]);
  assert.deepEqual([picked.unchanged, picked.undated, picked.all], [1, 1, false]);
  assert.deepEqual(selectUrls(entries, SITE, "2026-11-17").urls, [], "nothing changed: nothing to send");
  assert.equal(selectUrls(entries, SITE).urls.length, 5, "without the option every page goes, as before");
});

test("a sitemap without any lastmod cannot say what changed, so everything is submitted", () => {
  const picked = selectUrls(parseSitemap(xml([[`${SITE}/`], [`${SITE}/docs`]])), SITE, "2026-11-14");
  assert.deepEqual([picked.urls.length, picked.all], [2, true]);
});

test("batches hold at most 10,000 URLs and lose none", () => {
  assert.equal(MAX_URLS, 10_000);
  const urls = Array.from({ length: 25_001 }, (_, i) => `${SITE}/p/${i}`);
  const parts = batches(urls);
  assert.deepEqual(parts.map((p) => p.length), [10_000, 10_000, 5_001]);
  assert.deepEqual(parts.flat(), urls);
  assert.deepEqual(batches([]), []);
});

test("the body names the host of its URLs and the key file on that host", () => {
  const key = /INDEXNOW_KEY = "([0-9a-f]{32})"/.exec(readFileSync(new URL("../src/index.ts", import.meta.url), "utf8"))[1];
  const body = payload(`${SITE}/`, key, [`${SITE}/`, `${SITE}/docs`]);
  assert.deepEqual(body, { host: "glyphcall.com", key, keyLocation: `https://glyphcall.com/${key}.txt`, urlList: [`${SITE}/`, `${SITE}/docs`] });
  for (const u of body.urlList) assert.equal(new URL(u).host, body.host);
  assert.equal(new URL(body.keyLocation).host, body.host);
  assert.match(key, /^[0-9a-f]{8,128}$/, "8 to 128 characters, as the protocol asks");
});

test("200 and 202 are success; 400, 403, 422 and 429 are failures that are not retried", () => {
  for (const ok of [200, 202]) assert.equal(verdict(ok).ok, true);
  for (const bad of [400, 403, 422, 429, 404, 301]) { assert.equal(verdict(bad).ok, false, String(bad)); assert.ok(!verdict(bad).retry, String(bad)); }
  assert.match(verdict(403).meaning, /key/);
  assert.match(verdict(422).meaning, /host/);
  assert.match(verdict(429).meaning, /too many/);
  assert.deepEqual([verdict(503).ok, verdict(503).retry], [false, true]);
});

test("--changed-since takes an ISO date or a git ref", () => {
  const noGit = () => { throw new Error("git must not be asked for a date"); };
  assert.equal(sinceDay("2026-11-14", noGit), "2026-11-14");
  assert.equal(sinceDay("2026-11-14T23:30:00-02:00", noGit), "2026-11-15", "a time is read in UTC");
  assert.equal(sinceDay("origin/main~1", (ref) => (ref === "origin/main~1" ? "1794650000" : "")), new Date(1794650000 * 1000).toISOString().slice(0, 10));
  assert.throws(() => sinceDay("no-such-ref", () => ""), /neither an ISO date nor a git ref/);
  assert.throws(() => sinceDay("2026-13-45", noGit), /not a date/);
});

test("arguments: the old invocations still work", () => {
  assert.deepEqual(parseArgs([]), { dry: false, origin: undefined, changedSince: undefined });
  assert.deepEqual(parseArgs(["--dry"]), { dry: true, origin: undefined, changedSince: undefined });
  assert.deepEqual(parseArgs(["https://tools.funwords.eu/", "--dry"]), { dry: true, origin: "https://tools.funwords.eu", changedSince: undefined });
  assert.deepEqual(parseArgs(["--changed-since", "origin/main~1"]), { dry: false, origin: undefined, changedSince: "origin/main~1" });
  assert.deepEqual(parseArgs(["--changed-since", "2026-11-14", "https://glyphcall.com", "--dry"]), { dry: true, origin: "https://glyphcall.com", changedSince: "2026-11-14" });
  assert.throws(() => parseArgs(["--changed-since"]), /needs/);
  assert.throws(() => parseArgs(["--changed-since", "--dry"]), /needs/);
  assert.throws(() => parseArgs(["--changedsince", "x"]), /unknown option/);
});

test("with no origin, the one host submitted is the public site of wrangler.jsonc", () => {
  assert.equal(defaultOrigin(readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8")), "https://glyphcall.com");
  assert.equal(defaultOrigin("{}"), "https://agent-data-tools.revmesh2074.workers.dev");
});

test("a run against a stand-in network: one POST for the public host, changed pages only, and a refusal fails the run", async () => {
  const key = /INDEXNOW_KEY = "([0-9a-f]{32})"/.exec(readFileSync(new URL("../src/index.ts", import.meta.url), "utf8"))[1];
  const sitemap = xml([[`${SITE}/old`, "2026-11-10"], [`${SITE}/new`, "2026-11-16"], ["https://agent-data-tools.revmesh2074.workers.dev/new", "2026-11-16"]]);
  const net = (answers) => {
    const posts = [];
    const fetch = async (url, init) => {
      if (url === `${SITE}/${key}.txt`) return new Response(key);
      if (url === `${SITE}/sitemap.xml`) return new Response(sitemap);
      assert.equal(url, ENDPOINT, "nothing else is fetched");
      assert.equal(init.method, "POST");
      assert.match(init.headers["content-type"], /^application\/json/);
      posts.push(JSON.parse(init.body));
      return new Response("", { status: answers[posts.length - 1] ?? 200 });
    };
    return { fetch, posts };
  };
  const log = console.log;
  console.log = () => {};
  try {
    const ok = net([200]);
    assert.equal(await main(["--changed-since", "2026-11-14"], ok), true);
    assert.deepEqual(ok.posts, [{ host: "glyphcall.com", key, keyLocation: `${SITE}/${key}.txt`, urlList: [`${SITE}/new`] }]);
    const all = net([202]);
    assert.equal(await main([], all), true);
    assert.deepEqual(all.posts[0].urlList, [`${SITE}/old`, `${SITE}/new`]);
    const dry = net([]);
    assert.equal(await main(["--dry"], dry), true);
    assert.deepEqual(dry.posts, [], "a dry run posts nothing");
    const none = net([]);
    assert.equal(await main(["--changed-since", "2026-11-17"], none), true);
    assert.deepEqual(none.posts, [], "nothing changed: no request");
    for (const status of [400, 403, 422, 429]) {
      const refused = net([status]);
      assert.equal(await main([], refused), false, String(status));
      assert.equal(refused.posts.length, 1, `${status} is not retried`);
    }
    const flaky = net([503, 200]);
    assert.equal(await main([], { ...flaky, retryWaitMs: 1 }), true);
    assert.equal(flaky.posts.length, 2, "a server error is tried once more");
    const noKey = net([]);
    await assert.rejects(main([], { fetch: async (url, init) => (url.endsWith(".txt") ? new Response("not found", { status: 404 }) : noKey.fetch(url, init)) }), /does not serve the key/);
  } finally { console.log = log; }
});
