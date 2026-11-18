// Compares answer models for grounded answers (18 Nov 2026): for each question, the production search finds the
// provisions (in Swedish for Swedish questions), each model writes claims with quotes, and the production check
// (verifyClaims in src/lib/law-grounding.ts) keeps only claims whose quote is in the cited text. Reported per model:
//   answered  questions with at least one kept claim
//   kept      kept claims / all claims the model wrote (the rest were invented or misquoted, and would be dropped)
//   onTarget  questions where a kept claim cites an expected article
//   ms        average answer time
//   CF_ACCOUNT_ID=… CF_API_TOKEN=… node scripts/law-index/eval-answers.mjs <questions.json> <out.json> [model …]
import { readFileSync, writeFileSync } from "node:fs";
import { deps as makeDeps, loadModules, chatRest } from "./rest-deps.mjs";

const [, , file, outFile, ...models] = process.argv;
if (!file || !outFile) throw new Error("usage: eval-answers.mjs <questions.json> <out.json> [model …]");
const MODELS = models.length ? models : ["@cf/meta/llama-4-scout-17b-16e-instruct", "@cf/openai/gpt-oss-120b", "@cf/meta/llama-3.3-70b-instruct-fp8-fast"];
const mods = await loadModules();
const deps = makeDeps(mods);
const set = JSON.parse(readFileSync(file, "utf8"));
const stats = Object.fromEntries(MODELS.map((m) => [m, { answered: 0, claims: 0, kept: 0, onTarget: 0, ms: 0, errors: 0 }]));
const rows = [];
for (const { q, expect } of set) {
  const ql = mods.law.questionLang(q);
  const found = await mods.law.lawSearch(q, { count: 5, lang: ql.iso }, deps).catch(() => ({ candidates: [], scores: null }));
  const textLang = mods.law.INDEXED_LANGS.includes(ql.eurlex.toLowerCase()) ? ql.eurlex.toLowerCase() : "en";
  const shown = { ...found, candidates: await mods.law.inLanguage(found.candidates.slice(0, 5), textLang, deps) };
  const out = mods.law.lawAnswer(q, undefined, undefined, 5, shown);
  const sources = mods.law.sourcesOf(out.results);
  const row = { q, expect, found: out.results.map((r) => r.citation), models: {} };
  for (const model of MODELS) {
    const s = stats[model];
    const t = Date.now();
    try {
      const reply = await chatRest(model, mods.ground.groundedPrompt(ql.name, true), mods.ground.groundedContext(q, sources), 900, 0);
      const claims = mods.ground.parseClaims(reply);
      const { kept } = mods.ground.verifyClaims(claims, sources);
      s.ms += Date.now() - t; s.claims += claims.length; s.kept += kept.length;
      if (kept.length) s.answered++;
      // "GDPR, artikel 6.1 f" and "GDPR, Article 6(1)(f)" both count for an expected "GDPR, Article 6".
      const provision = (c) => /^(.*?, (?:Article|Recital) [0-9]+[a-z]?)/.exec(c.replace(/, artikel /, ", Article ").replace(/, skäl /, ", Recital "))?.[1];
      const target = kept.some((k) => expect.includes(provision(k.citation)));
      if (target) s.onTarget++;
      row.models[model] = { claims: claims.length, kept: kept.map((k) => `${k.citation}: ${k.text}`), target };
    } catch (e) { s.errors++; row.models[model] = { error: String(e).slice(0, 200) }; }
  }
  rows.push(row);
  console.log(`${q.slice(0, 70)} | ${MODELS.map((m) => `${m.split("/").pop().slice(0, 14)} ${row.models[m].kept?.length ?? "x"}/${row.models[m].claims ?? "x"}${row.models[m].target ? "*" : ""}`).join(" | ")}`);
}
const n = set.length;
const summary = Object.fromEntries(MODELS.map((m) => { const s = stats[m]; return [m, { answered: `${s.answered}/${n}`, kept: `${s.kept}/${s.claims}`, onTarget: `${s.onTarget}/${n}`, avgMs: Math.round(s.ms / Math.max(1, n - s.errors)), errors: s.errors }]; }));
console.log(JSON.stringify(summary, null, 1));
writeFileSync(outFile, JSON.stringify({ date: new Date().toISOString(), summary, rows }, null, 1));
