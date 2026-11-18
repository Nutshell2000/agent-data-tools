// The production EU law search code (src/routes/law-search.ts, src/lib/law-grounding.ts) run from Node, with Cloudflare's
// REST API standing in for the Worker bindings: Workers AI, Vectorize and D1. Shared by eval-ours.mjs and
// eval-answers.mjs. Needs CF_ACCOUNT_ID and CF_API_TOKEN (`npx wrangler auth token`); LAW_D1 and LAW_INDEX pick the
// index (default eu-law-v2, the 185-act build of 18 Nov 2026).
import { build } from "esbuild";
import { createRequire } from "node:module";
import { writeFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const { CF_ACCOUNT_ID: account, CF_API_TOKEN: token } = process.env;
if (!account || !token) throw new Error("set CF_ACCOUNT_ID and CF_API_TOKEN");
export const D1 = process.env.LAW_D1 ?? "9e240b67-4933-452d-adb9-18d5015da4c6";
export const INDEX = process.env.LAW_INDEX ?? "eu-law-v2";

export async function api(path, body) {
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}${path}`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : {};
    if (r?.ok && j.success !== false) return j.result;
    if (attempt >= 3) throw new Error(`${path}: HTTP ${r?.status} ${JSON.stringify(j.errors ?? j).slice(0, 200)}`);
    await new Promise((res) => setTimeout(res, 1500 * (attempt + 1)));
  }
}
const sql = async (query, params) => (await api(`/d1/database/${D1}/query`, { sql: query, params }))[0].results;

/** The bundled TypeScript modules: law-search (with lawSearch, inLanguage, lawAnswer…) and law-grounding. */
export async function loadModules() {
  const mods = {};
  for (const [name, entry] of [["law", "../../src/routes/law-search.ts"], ["ground", "../../src/lib/law-grounding.ts"]]) {
    const out = join(here, `../../.law-eval-${name}.cjs`);
    const bundled = await build({ entryPoints: [join(here, entry)], bundle: true, platform: "node", format: "cjs", write: false });
    writeFileSync(out, bundled.outputFiles[0].text);
    mods[name] = createRequire(import.meta.url)(out);
    rmSync(out);
  }
  return mods;
}

/** One chat call through Workers AI REST, in the same two input shapes as chat() in src/routes/ai-text.ts. */
export async function chatRest(model, system, user, maxTokens = 400, temperature = 0) {
  const responses = model.startsWith("@cf/openai/gpt-oss");
  const out = await api(`/ai/run/${model}`, responses
    ? { input: [{ role: "system", content: system }, { role: "user", content: user }], reasoning: { effort: "low" }, max_output_tokens: maxTokens, temperature }
    : { messages: [{ role: "system", content: system }, { role: "user", content: user }], max_tokens: maxTokens, temperature });
  const fromOutput = Array.isArray(out?.output) ? out.output.filter((o) => o?.type === "message").flatMap((o) => (o.content ?? []).map((c) => c?.text ?? "")).join("") : "";
  const fromChoices = out?.choices?.[0]?.message?.content;
  const raw = typeof out?.response === "string" ? out.response : typeof out?.response === "object" && out?.response ? JSON.stringify(out.response) : typeof fromChoices === "string" ? fromChoices : fromOutput;
  return String(raw).replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
}

export function deps(mods, translateModel = "@cf/meta/llama-4-scout-17b-16e-instruct") {
  const where = (f) => [f.short ? "p.short = ?" : "", f.kind ? "p.kind = ?" : ""].filter(Boolean);
  return {
    async embed(q) { return (await api(`/ai/run/${mods.law.EMBED_MODEL}`, { text: [q.slice(0, 2000)] })).data[0]; },
    async vectors(v, topK, f) {
      const filter = { ...(f.short ? { short: f.short } : {}), ...(f.kind ? { kind: f.kind } : {}) };
      const r = await api(`/vectorize/v2/indexes/${INDEX}/query`, { vector: v, topK, returnMetadata: "none", ...(Object.keys(filter).length ? { filter } : {}) });
      return r.matches.map((m) => m.id);
    },
    async keywords(match, limit, f) {
      const c = where(f);
      return (await sql(`SELECT f.id AS id FROM passages_fts f JOIN passages p ON p.id = f.id WHERE passages_fts MATCH ?${c.length ? ` AND ${c.join(" AND ")}` : ""} ORDER BY bm25(passages_fts, 0, 1.0, 4.0, 3.0, 1.0) LIMIT ?`, [match, ...(f.short ? [f.short] : []), ...(f.kind ? [f.kind] : []), limit])).map((x) => x.id);
    },
    async rows(ids) { return sql(`SELECT * FROM passages WHERE id IN (${ids.map(() => "?").join(",")})`, ids); },
    async rerank(q, docs) {
      const r = await api("/ai/run/@cf/baai/bge-reranker-base", { query: q.slice(0, 1000), contexts: docs.map((text) => ({ text })), top_k: docs.length });
      return (r.response ?? []).map((x) => ({ index: x.id, score: x.score }));
    },
    async translate(q) {
      return chatRest(translateModel, "Translate the user's question about EU law into English. Keep act names, article numbers and legal terms exact. Reply with the English question only.", q.slice(0, 400), 160, 0);
    },
    async localized(provisions, lang) {
      const keys = [...new Set(provisions.map((p) => `${p.short}|${p.label}`))].slice(0, 20);
      return keys.length ? sql(`SELECT * FROM passages WHERE lang = ? AND (short || '|' || label) IN (${keys.map(() => "?").join(",")})`, [lang, ...keys]) : [];
    },
  };
}
