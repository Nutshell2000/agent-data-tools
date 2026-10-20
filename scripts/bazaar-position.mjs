#!/usr/bin/env node
// Read-only weekly check of the Coinbase Bazaar: where our tools sit and how payers are spread across the market.
// Usage: node scripts/bazaar-position.mjs [payTo]   (defaults to PAY_TO in wrangler.jsonc)
// Unpaid GETs of the public discovery list only; nothing is paid or registered.
import { readFileSync } from "node:fs";

const payTo = (process.argv[2] ?? readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8").match(/"PAY_TO"\s*:\s*"(0x[0-9a-fA-F]{40})"/)?.[1] ?? "").toLowerCase();
if (!/^0x[0-9a-f]{40}$/.test(payTo)) throw new Error("payTo address not found; pass it as the first argument");

const URL_BASE = "https://api.cdp.coinbase.com/platform/v2/x402/discovery/resources?type=http&limit=100";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function page(offset) {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const res = await fetch(`${URL_BASE}&offset=${offset}`);
      if (res.ok) return await res.json();
    } catch {}
    await sleep(1500 * (attempt + 1));
  }
  throw new Error(`discovery page at offset ${offset} failed`);
}

const rows = [];
let total = 0;
for (let offset = 0; ; offset += 100) {
  const body = await page(offset);
  total = body.pagination?.total ?? total;
  const items = body.items ?? [];
  items.forEach((item, i) => rows.push({
    rank: offset + i + 1,
    resource: item.resource,
    payers: item.quality?.l30DaysUniquePayers ?? 0,
    calls: item.quality?.l30DaysTotalCalls ?? 0,
    lastCalledAt: item.quality?.lastCalledAt ?? null,
    lastUpdated: item.lastUpdated,
    ours: (item.accepts ?? []).some((a) => (a.payTo ?? "").toLowerCase() === payTo),
  }));
  if (items.length < 100) break;
  await sleep(150);
}

const count = (lo, hi) => rows.filter((r) => r.payers >= lo && r.payers <= hi).length;
console.log(`Bazaar listings: ${rows.length} of ${total} (unique payers in the last 30 days)`);
console.log(`  0: ${count(0, 0)}  1: ${count(1, 1)}  2-4: ${count(2, 4)}  5-9: ${count(5, 9)}  10-99: ${count(10, 99)}  100+: ${count(100, Infinity)}`);
for (const rank of [100, 500, 1000, 5000]) if (rows[rank - 1]) console.log(`  payers at rank ${rank}: ${rows[rank - 1].payers}`);
const ours = rows.filter((r) => r.ours);
console.log(`Our listings (${payTo}): ${ours.length}`);
for (const r of ours) console.log(`  #${r.rank} ${r.resource} payers=${r.payers} calls=${r.calls} lastCalled=${r.lastCalledAt ?? "-"} listed=${r.lastUpdated}`);
