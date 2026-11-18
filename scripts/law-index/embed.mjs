// Embeds the English passages of a build (scripts/law-index/build.mjs --no-embed, or a build whose embedding step failed)
// with Workers AI bge-m3 and writes them as vectors-<n>.ndjson, 5,000 vectors a file, appended batch by batch.
// 18 Nov 2026: one vectors.ndjson for the 185-act build (33,307 vectors, ~700 MB of JSON) failed with "Invalid string
// length" after the whole embedding had run, so nothing is held in one string any more. Resumable: files already
// complete are skipped.
//   node scripts/law-index/embed.mjs <outDir>
import { readFileSync, appendFileSync, existsSync, writeFileSync, readdirSync, unlinkSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const ACCOUNT = "a71d95cc01c3cac8962c09cc2195eb88";
const PER_FILE = 5000;
const out = process.argv[2];
if (!out) throw new Error("usage: embed.mjs <outDir>");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const en = readFileSync(join(out, "passages.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((p) => p.lang === "en");

let token = null;
async function embedBatch(texts) {
  token ??= execSync("npx wrangler auth token", { encoding: "utf8", cwd: join(here, "../..") }).trim().split(/\r?\n/).pop();
  for (let i = 0; i < 6; i++) {
    const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/ai/run/@cf/baai/bge-m3`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ text: texts }) }).catch(() => null);
    const j = r ? await r.json().catch(() => null) : null;
    if (r?.ok && Array.isArray(j?.result?.data) && j.result.data.length === texts.length) return j.result.data;
    if (r?.status === 401) token = null;
    await sleep(2000 * (i + 1));
  }
  throw new Error("embedding failed");
}

for (let f = 0; f * PER_FILE < en.length; f++) {
  const file = join(out, `vectors-${f + 1}.ndjson`);
  const done = join(out, `vectors-${f + 1}.done`);
  if (existsSync(done)) continue;
  if (existsSync(file)) unlinkSync(file);
  const slice = en.slice(f * PER_FILE, (f + 1) * PER_FILE);
  for (let i = 0; i < slice.length; i += 25) {
    const batch = slice.slice(i, i + 25);
    const vectors = await embedBatch(batch.map((p) => `${p.short} ${p.label}${p.heading ? `: ${p.heading}` : ""}\n${p.text}`.slice(0, 2500)));
    appendFileSync(file, batch.map((p, k) => JSON.stringify({ id: p.id, values: vectors[k], metadata: { short: p.short, kind: p.kind } })).join("\n") + "\n");
  }
  writeFileSync(done, String(slice.length));
  console.log(`vectors-${f + 1}.ndjson: ${slice.length} (${Math.min((f + 1) * PER_FILE, en.length)}/${en.length})`);
}
console.log(`done: ${readdirSync(out).filter((n) => /^vectors-\d+\.ndjson$/.test(n)).length} files`);
