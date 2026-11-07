// Builds the KV snapshot behind /econ/national-debt and /econ/treasury-rates (src/routes/treasury.ts). The Treasury's
// Fiscal Data API (keyless, public domain) does not answer Cloudflare's egress, so the data is fetched here, on the PC,
// and uploaded to the TRIALS KV namespace with `npx wrangler kv bulk put --binding TRIALS --remote [-c wrangler.staging.jsonc] <file>`.
//   node scripts/fetch-treasury.mjs <outDir>      writes <outDir>/treasury-kv.json (a wrangler bulk-put array)
// Debt to the Penny: 400 newest daily rows (about 19 months, enough for the 1-year change); average interest rates:
// 400 newest rows (25 months of 16 securities). Run it daily; the answer carries fetchedAt so staleness is visible.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const API = "https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v2/accounting/od";
const outDir = process.argv[2];
if (!outDir) { console.error("usage: node scripts/fetch-treasury.mjs <outDir>"); process.exit(2); }

async function rows(path, fields) {
  const url = `${API}/${path}?sort=-record_date&page[size]=400&fields=${fields.join(",")}`;
  const res = await fetch(url, { headers: { accept: "application/json", "user-agent": "AgentDataTools/1.0 (+https://agent-data-tools.revmesh2074.workers.dev)" }, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  const body = await res.json();
  if (!Array.isArray(body.data) || !body.data.length) throw new Error(`${path}: no rows`);
  return body.data;
}

const fetchedAt = new Date().toISOString();
const debt = await rows("debt_to_penny", ["record_date", "tot_pub_debt_out_amt", "debt_held_public_amt", "intragov_hold_amt", "record_fiscal_year"]);
const rates = await rows("avg_interest_rates", ["record_date", "security_type_desc", "security_desc", "avg_interest_rate_amt"]);
const bulk = [
  { key: "treasury:debt", value: JSON.stringify({ fetchedAt, rows: debt }) },
  { key: "treasury:rates", value: JSON.stringify({ fetchedAt, rows: rates }) },
];
mkdirSync(outDir, { recursive: true });
const file = join(outDir, "treasury-kv.json");
writeFileSync(file, JSON.stringify(bulk));
console.log(`${file}: debt ${debt.length} rows (latest ${debt[0].record_date}), rates ${rates.length} rows (latest ${rates[0].record_date}), fetched ${fetchedAt}`);
