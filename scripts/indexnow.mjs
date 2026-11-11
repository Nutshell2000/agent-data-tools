#!/usr/bin/env node
// Tell IndexNow search engines (Bing, Yandex, Seznam, Naver) about every page in the live sitemap.
// Run after a deploy that adds or changes pages: node scripts/indexnow.mjs [origin] [--dry]
// The key file must already be live at <origin>/<key>.txt (src/index.ts INDEXNOW_KEY).
import { readFileSync } from "node:fs";

// With no origin given it submits two hosts: the Worker's own, and the public home of the human pages
// (PUBLIC_SITE_ORIGIN in wrangler.jsonc). Every page's canonical URL is on the public host, so that is the host a
// search engine indexes; until 11 Nov 2026 only the Worker's host was submitted and Bing held none of the pages.
const args = process.argv.slice(2);
const dry = args.includes("--dry");
const given = args.find((a) => !a.startsWith("--"));
const publicSite = /"PUBLIC_SITE_ORIGIN":\s*"(https:\/\/[^"]+)"/.exec(readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8"))?.[1];
const origins = [...new Set((given ? [given] : ["https://agent-data-tools.revmesh2074.workers.dev", publicSite]).filter(Boolean).map((o) => o.replace(/\/$/, "")))];
const key = /INDEXNOW_KEY = "([0-9a-f]{32})"/.exec(readFileSync(new URL("../src/index.ts", import.meta.url), "utf8"))?.[1];
if (!key) throw new Error("INDEXNOW_KEY not found in src/index.ts");

let failed = false;
for (const origin of origins) {
  const keyFile = await fetch(`${origin}/${key}.txt`);
  if (!keyFile.ok || (await keyFile.text()).trim() !== key) throw new Error(`${origin}/${key}.txt does not serve the key yet; deploy first`);
  const sitemap = await (await fetch(`${origin}/sitemap.xml`)).text();
  const urlList = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].replaceAll("&amp;", "&"));
  console.log(`${urlList.length} URLs from ${origin}/sitemap.xml`);
  if (dry) continue;
  const res = await fetch("https://api.indexnow.org/indexnow", {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify({ host: new URL(origin).host, key, keyLocation: `${origin}/${key}.txt`, urlList }),
  });
  // 200 and 202 both mean accepted; 422 means a URL does not belong to the host or the key does not match.
  console.log(`IndexNow ${new URL(origin).host}: HTTP ${res.status} ${await res.text()}`);
  if (res.status !== 200 && res.status !== 202) failed = true;
}
if (failed) process.exit(1);
