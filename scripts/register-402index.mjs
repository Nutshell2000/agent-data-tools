// Registers our endpoints that are not yet on 402 Index (free; the index probes each URL for a valid
// x402 challenge). Its limit is 10 registrations per hour per IP, so calls are spaced 6.5 minutes apart.
//   node scripts/register-402index.mjs [--dry]
const ORIGIN = "https://agent-data-tools.revmesh2074.workers.dev";
const DRY = process.argv.includes("--dry");
const GAP_MS = 6.5 * 60 * 1000;

const listed = new Set();
for (let offset = 0; offset < 2000; offset += 200) {
  const r = await (await fetch(`https://402index.io/api/v1/services?q=agent-data-tools.revmesh2074&limit=200&offset=${offset}`)).json();
  for (const s of r.services) if (s.url.startsWith(ORIGIN)) listed.add(new URL(s.url).pathname);
  if (r.services.length < 200) break;
}

const spec = await (await fetch(`${ORIGIN}/openapi.json`)).json();
const category = (path) =>
  /^\/(base|eth|arb|op|polygon)\//.test(path) ? "blockchain/onchain-data"
  : /^\/(holidays|wikipedia|dictionary|earthquakes|air-quality|uv|geocode|elevation|sun|moon|country|crypto|npm|pypi|hackernews|iss)/.test(path) ? "data/public-data"
  : /^\/(coin|dice|random|magic-8-ball|yes-no)/.test(path) ? "entertainment/random"
  : "developer-tools/utilities";

// --skip=/a,/b leaves out paths that are about to be paused.
const skip = new Set((process.argv.find((a) => a.startsWith("--skip="))?.slice(7) ?? "").split(",").filter(Boolean));
const todo = Object.entries(spec.paths).filter(([path]) => !listed.has(path) && !path.startsWith("/buy/") && !skip.has(path));
console.log(`${listed.size} paths already listed, ${todo.length} to register${DRY ? " (dry run)" : ""}`);

for (const [i, [path, item]] of todo.entries()) {
  const op = item.get;
  const query = new URLSearchParams();
  for (const p of op.parameters ?? []) if (p.required && p.example !== undefined) query.set(p.name, String(p.example));
  const price = Number(op["x-payment-info"]?.price?.amount);
  if (!price) { console.log(`${path}: no price in OpenAPI, skipped`); continue; }
  const body = {
    url: `${ORIGIN}${path}${query.size ? `?${query}` : ""}`,
    name: `SpellzCode — ${op.summary}`,
    protocol: "x402",
    description: op.description?.slice(0, 480),
    category: category(path),
    http_method: "GET",
    price_usd: price,
    payment_asset: "USDC",
    payment_network: "Base",
    provider: "Agent Data Tools",
  };
  if (DRY) { console.log(JSON.stringify(body)); continue; }
  for (;;) {
    let res;
    try {
      res = await fetch("https://402index.io/api/v1/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(60_000) });
    } catch (e) {
      console.log(`${new Date().toISOString()} ${path} network error (${e.message}), retrying later`);
      await new Promise((r) => setTimeout(r, GAP_MS));
      continue;
    }
    const text = await res.text();
    if (res.status === 429) { console.log(`${new Date().toISOString()} rate limited, waiting`); await new Promise((r) => setTimeout(r, GAP_MS)); continue; }
    console.log(`${new Date().toISOString()} ${i + 1}/${todo.length} ${path} -> ${res.status} ${res.ok ? "" : text.slice(0, 200)}`);
    break;
  }
  if (i < todo.length - 1) await new Promise((r) => setTimeout(r, GAP_MS));
}
