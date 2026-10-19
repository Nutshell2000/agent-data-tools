// Brings our 402 Index listings' prices and descriptions in line with the live /openapi.json, using the
// verified-domain PATCH. Reads the domain token from .402index-token (git-ignored) and never prints it.
//   node scripts/update-402index-prices.mjs [--dry]
import { readFile } from "node:fs/promises";

const ORIGIN = "https://agent-data-tools.revmesh2074.workers.dev";
const DOMAIN = new URL(ORIGIN).host;
const DRY = process.argv.includes("--dry");
const token = (await readFile(new URL("../.402index-token", import.meta.url), "utf8")).trim();
const spec = await (await fetch(`${ORIGIN}/openapi.json`)).json();

const ours = [];
for (let offset = 0; offset < 2000; offset += 200) {
  const r = await (await fetch(`https://402index.io/api/v1/services?q=agent-data-tools.revmesh2074&limit=200&offset=${offset}`)).json();
  ours.push(...r.services.filter((s) => s.url.startsWith(ORIGIN)));
  if (r.services.length < 200) break;
}

let changed = 0, failed = 0;
for (const s of ours) {
  const op = spec.paths[new URL(s.url).pathname]?.get;
  if (!op) continue;
  const price = Number(op["x-payment-info"]?.price?.amount);
  const description = op.description?.slice(0, 480);
  const patch = {};
  if (price && Math.abs(Number(s.price_usd) - price) > 1e-9) patch.price_usd = price;
  if (description && s.description !== description) patch.description = description;
  if (!Object.keys(patch).length) continue;
  if (DRY) { console.log(`${new URL(s.url).pathname}: ${JSON.stringify(patch).slice(0, 120)}`); changed++; continue; }
  const res = await fetch(`https://402index.io/api/v1/services/${s.id}`, {
    method: "PATCH", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ domain: DOMAIN, verification_token: token, ...patch }),
  });
  if (res.ok) changed++; else { failed++; console.log(`${new URL(s.url).pathname} -> ${res.status} ${(await res.text()).slice(0, 160)}`); }
  if (res.status === 429) await new Promise((r) => setTimeout(r, 60_000));
  await new Promise((r) => setTimeout(r, 1_500));
}
console.log(`${ours.length} listings, ${changed} ${DRY ? "would change" : "updated"}, ${failed} failed`);
