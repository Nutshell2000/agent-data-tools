// Runs EU law evaluation questions through the production /law/search ranking code (lawSearch in
// src/routes/law-search.ts) over Cloudflare's REST API (rest-deps.mjs). A hit is a result whose citation is exactly an
// expected article ("GDPR, Article 6"). Questions marked heldOut are reported separately: they were written and checked
// against the article text before any search was run (15 Nov 2026; the practice-area set of 18 Nov 2026 likewise).
//   CF_ACCOUNT_ID=… CF_API_TOKEN=… [EVAL_FILE=eval-questions.json] node scripts/law-index/eval-ours.mjs [out.json]
// Cost: two to four Workers AI calls per question (a question not in English is translated first).
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { deps as makeDeps, loadModules } from "./rest-deps.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const mods = await loadModules();
const deps = makeDeps(mods);
const set = JSON.parse(readFileSync(process.env.EVAL_FILE ?? join(here, "eval-questions.json"), "utf8"));
const rows = [];
for (const { q, expect, heldOut } of set) {
  const t = Date.now();
  const found = await mods.law.lawSearch(q, { count: 5 }, deps).catch((e) => { console.warn(String(e)); return { candidates: [] }; });
  const cites = found.candidates.slice(0, 5).map((r) => `${r.short}, ${r.label}`);
  const i = cites.findIndex((c) => expect.includes(c));
  rows.push({ q, expect, heldOut: !!heldOut, rank: i >= 0 ? i + 1 : null, ms: Date.now() - t, top: cites.slice(0, 3), english: found.english });
  console.log(`${i === 0 ? "1 " : i > 0 ? `${i + 1} ` : "- "} ${heldOut ? "H" : " "} ${q}  -> ${cites.slice(0, 3).join(" | ")}`);
}
const sum = (rs) => ({ n: rs.length, h1: rs.filter((r) => r.rank === 1).length, h5: rs.filter((r) => r.rank !== null).length, ms: Math.round(rs.reduce((s, r) => s + r.ms, 0) / Math.max(1, rs.length)) });
const all = sum(rows), held = sum(rows.filter((r) => r.heldOut)), tuned = sum(rows.filter((r) => !r.heldOut));
console.log(`\nours: all ${all.h1}/${all.n} @1, ${all.h5}/${all.n} @5 | held-out ${held.h1}/${held.n} @1, ${held.h5}/${held.n} @5 | tuning set ${tuned.h1}/${tuned.n} @1, ${tuned.h5}/${tuned.n} @5 | avg ${all.ms} ms`);
if (process.argv[2]) writeFileSync(process.argv[2], JSON.stringify({ engine: "ours /law/search", date: new Date().toISOString(), all, held, tuned, rows }, null, 1));
