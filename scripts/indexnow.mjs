#!/usr/bin/env node
// Tell IndexNow search engines (Bing, Yandex, Seznam, Naver) about every page in the live sitemap.
// Run after a deploy that adds or changes pages: node scripts/indexnow.mjs [origin] [--dry]
// The key file must already be live at <origin>/<key>.txt (src/index.ts INDEXNOW_KEY).
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const dry = args.includes("--dry");
const origin = (args.find((a) => !a.startsWith("--")) ?? "https://agent-data-tools.revmesh2074.workers.dev").replace(/\/$/, "");
const key = /INDEXNOW_KEY = "([0-9a-f]{32})"/.exec(readFileSync(new URL("../src/index.ts", import.meta.url), "utf8"))?.[1];
if (!key) throw new Error("INDEXNOW_KEY not found in src/index.ts");

const keyFile = await fetch(`${origin}/${key}.txt`);
if (!keyFile.ok || (await keyFile.text()).trim() !== key) throw new Error(`${origin}/${key}.txt does not serve the key yet; deploy first`);
const sitemap = await (await fetch(`${origin}/sitemap.xml`)).text();
const urlList = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].replaceAll("&amp;", "&"));
console.log(`${urlList.length} URLs from ${origin}/sitemap.xml`);
if (dry) process.exit(0);

const res = await fetch("https://api.indexnow.org/indexnow", {
  method: "POST",
  headers: { "content-type": "application/json; charset=utf-8" },
  body: JSON.stringify({ host: new URL(origin).host, key, keyLocation: `${origin}/${key}.txt`, urlList }),
});
// 200 and 202 both mean accepted; 422 means a URL does not belong to the host or the key does not match.
console.log(`IndexNow: HTTP ${res.status} ${await res.text()}`);
if (res.status !== 200 && res.status !== 202) process.exit(1);
