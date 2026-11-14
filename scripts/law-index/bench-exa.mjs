// Benchmark: the EU law evaluation questions (eval-questions.json) through Exa's /search, scored like our /law/search:
// a result counts when it is the expected article of the expected act (title, URL or opening text names the article
// number and the act). Usage: node scripts/law-index/bench-exa.mjs <keyFile> [outJson]
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const here = dirname(fileURLToPath(import.meta.url));
const key = readFileSync(process.argv[2], "utf8").trim();
const set = JSON.parse(readFileSync(join(here, "eval-questions.json"), "utf8"));
const acts = JSON.parse(readFileSync(join(here, "../../src/data/eu-law-acts.json"), "utf8"));

const fold = (s) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");
/** Does this result present the expected provision ("GDPR, Article 6")? */
export function matches(result, expected) {
  const [short, label] = expected.split(", ");
  const num = label.replace(/^Article /, "");
  const act = acts.find((a) => a.short === short);
  const hay = fold(`${result.title ?? ""} ${result.url ?? ""} ${(result.text ?? "").slice(0, 1500)}`);
  const n = num.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Lenient on purpose: "Article 6", "Art. 6", "art-6", "articles 17-19", "article/16" all count.
  const article = new RegExp(`(articles?|art\\.?)[\\s/_-]*(\\d+[a-z]?[\\s,–-]+(and[\\s]+)?)*${n}(?![0-9a-z])`).test(hay);
  const cues = [short, act?.name, act?.celex, act?.celex?.slice(1, 5) + "/" + Number(act?.celex?.slice(6))].filter(Boolean).map(fold);
  const actHit = cues.some((c) => hay.includes(c)) || (short === "GDPR" && /gdpr|2016\/679/.test(hay)) || (short === "AI Act" && /ai act|2024\/1689/.test(hay));
  return article && actHit;
}

const rows = [];
let h1 = 0, h5 = 0, ms = 0;
for (const { q, expect } of set) {
  const t = Date.now();
  const r = await fetch("https://api.exa.ai/search", { method: "POST", headers: { "x-api-key": key, "content-type": "application/json" }, body: JSON.stringify({ query: q, type: "auto", numResults: 5, contents: { text: { maxCharacters: 1500 } } }) });
  const j = await r.json();
  const took = Date.now() - t; ms += took;
  const results = (j.results ?? []).map((x) => ({ title: x.title, url: x.url, text: x.text }));
  const rank = results.findIndex((x) => expect.some((e) => matches(x, e)));
  if (rank === 0) h1++;
  if (rank >= 0) h5++;
  rows.push({ q, expect, rank: rank >= 0 ? rank + 1 : null, ms: took, cost: j.costDollars?.total ?? null, top: results.slice(0, 3).map((x) => x.url) });
  console.log(`${rank === 0 ? "1 " : rank > 0 ? `${rank + 1} ` : "- "} ${q}  -> ${results.slice(0, 3).map((x) => x.url).join(" | ")}`);
}
console.log(`\nExa: hit@1 ${h1}/${set.length}  hit@5 ${h5}/${set.length}  avg ${Math.round(ms / set.length)} ms  cost $${rows.reduce((s, r) => s + (r.cost ?? 0), 0).toFixed(3)}`);
if (process.argv[3]) writeFileSync(process.argv[3], JSON.stringify({ engine: "exa auto", date: new Date().toISOString(), h1, h5, n: set.length, rows }, null, 1));
