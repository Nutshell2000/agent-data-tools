#!/usr/bin/env node
// Where paid attempts die, per route, from the Worker's own report routes. Read-only.
//
//   node scripts/reconcile-bazaar.mjs                         live: one plain GET each of /revenue, /metrics, /metrics/callers, /status
//   node scripts/reconcile-bazaar.mjs --save-inputs <dir>     the same, and keep the four bodies for the archive
//   node scripts/reconcile-bazaar.mjs --from-files <dir>      offline, from saved bodies (revenue.json, metrics.json,
//                                                             metrics-callers.json, status.json, optional settlements.json)
//   --origin <url>          default https://agent-data-tools.revmesh2074.workers.dev
//   --days N                the newest N UTC days of the data (default: every day the funnel holds, 30)
//   --json <file>           also write the whole report as JSON (every route; wallets in full when rows were given)
//   --all-routes            print every route with a paid attempt, not only those that lost one or have a refusal or record gap
//   --settlements <file>    per-payment rows for the wallet section (see "Wallets" below)
//   --revenue-token <t> | --token-file <path>   the owner's REVENUE_TOKEN, sent only to <origin>/revenue as a Bearer
//                           header and never printed. It is read from this flag or file only, never from the environment.
//
// What it never does: send a payment header (PAYMENT-SIGNATURE, X-PAYMENT, Authorization: Payment), call a tool, write
// anywhere but the files named with --json and --save-inputs, or read an environment variable.
//
// Where each column comes from (read with the code that builds the reports: src/lib/funnel.ts, src/metrics.ts,
// src/lib/settlement-ledger.ts, src/lib/request-metrics.ts):
//   attempts     /revenue funnel stage `attempt`: requests that carried a payment (x402 v2 PAYMENT-SIGNATURE, x402 v1
//                X-PAYMENT, MPP Authorization: Payment, or a paid MCP call), http and mcp added together.
//   402 v2/v1/mpp  /metrics outcomes `v2_payment`, `v1_payment`, `mpp_payment`: payment-carrying requests that were
//                answered 402, by protocol. This is the ONLY place the reports record the protocol, so the protocol of
//                a payment that was served is "n/a (not recorded)": it is never guessed from these three.
//   verified     funnel `verified` (the facilitator accepted the payment). Recorded directly, not inferred.
//   settled      funnel `settled`. Counts every wallet, the owner's own included.
//   completed    funnel `completed`: a 2xx answer that carried a settlement receipt.
//   exec_failed  funnel `execution_failed`: verified, then the tool answered 4xx/5xx. Nothing was charged; a lost sale.
//   lost         attempts - settled: attempts that did not end in a settled payment, so the buyer got no answer and
//                paid nothing. (Not attempts - completed: the `completed` mark is missing on some delivered calls, see
//                "record gaps".)
//   refusal stages  funnel `refused_amount`, `refused_network`, `refused_format`, `facilitator_unavailable`,
//                `verification_failed`, `settlement_failed`, with counts.
//   outside / outside_usd  /revenue ledger `byEndpoint[path]`: settlements and gross USDC from wallets that are not the
//                owner's (the ledger leaves self-payments out). It is one total for the ledger's 30 days, so with a
//                shorter --days window it prints "n/a (30-day ledger total)".
//   own/unledg   settled - outside: settlements the ledger did not count as outside income, which is the owner's own
//                wallets plus any settlement the ledger could not record. The total is checked against the ledger's
//                `selfPayments`, and the difference is printed as "unaccounted".
//   /status lines  `paymentRefusals` (why a 402 was answered to a payment) and the `topFailures` that end in
//                "[sent a,b]" (a paying caller refused for its input: the input NAMES it sent). /status covers its own
//                7 days and keeps the top six reasons per tool, whatever --days says.
//   "record gaps" are printed only when they are not zero. They are gaps in the record, not buyers:
//     no verify outcome recorded   attempts - verified - every refusal before verify, when above zero (a request cut
//                short, or an attempt from before the refusal stages existed, 19 Oct 2026).
//     refusal also counted on a verified payment   the same sum when below zero: a v2 payment whose SETTLEMENT failed
//                is answered 402, and the Worker (src/index.ts, the "signed v2 request answered 402" block) marks that
//                answer refused_* as well as settlement_failed. So refused_* overstates by this number.
//     verified, no settle outcome recorded   verified - settled - settlement_failed - exec_failed.
//     settled, not completed   settled - completed, with the /metrics `paid` count of the route beside it (a 2xx
//                answer that carried a settlement receipt): when that equals settled the calls were delivered and only
//                the `completed` mark is missing. `completed` did not count x402 v1 payments before 10 Nov 2026.
//
// Wallets. No report route returns payer wallets, with or without the revenue token (the token adds `cardCredits`
// only; ledgerSummary publishes the counts `distinctExternalWallets` and `returningOnAnotherUtcDay`). So the wallet
// section needs per-payment rows from the owner: --settlements <file> or settlements.json in the --from-files
// directory, a JSON array of { payer, recordedAt (ISO time), amountAtomic (USDC, 6 decimals), path?, recipient?,
// selfPayment? }, the Worker's SettlementRecord fields. Without it the section prints "n/a (needs …)".
// A wallet is the owner's when it is in OWNED_WALLETS (src/lib/settlement-ledger.ts), is a payout wallet
// (PREVIOUS_PAY_TO in src/lib/payout-wallets.ts; PAY_TO, TEMPO_PAY_TO, SOLANA_PAY_TO in wrangler.jsonc), pays itself,
// or the row says selfPayment: true. The addresses are parsed from those files, never typed here.
// "Repeat outside wallets": not the owner's, 5 or more paid calls, on 2 or more distinct UTC days, inside the window.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_ORIGIN = "https://agent-data-tools.revmesh2074.workers.dev";
const ROUTES = { revenue: "/revenue", metrics: "/metrics", callers: "/metrics/callers", status: "/status" };
const FILES = { revenue: "revenue.json", metrics: "metrics.json", callers: "metrics-callers.json", status: "status.json", settlements: "settlements.json" };
const REFUSAL_STAGES = ["refused_amount", "refused_network", "refused_format", "facilitator_unavailable", "verification_failed", "settlement_failed"];
const BEFORE_VERIFY = REFUSAL_STAGES.filter((s) => s !== "settlement_failed");
const PAYMENT_STAGES = new Set(["attempt", "verified", "settled", "completed", "execution_failed", ...REFUSAL_STAGES]);
const PROTOCOLS = { v2: "v2_payment", v1: "v1_payment", mpp: "mpp_payment" };
export const REPEAT_MIN_CALLS = 5, REPEAT_MIN_DAYS = 2;
const NEEDS_ROWS = "n/a (needs --settlements: no report route returns payer wallets, with or without the revenue token)";

const repoFile = (name) => fileURLToPath(new URL(`../${name}`, import.meta.url));
const walletKey = (address) => (/^0x[0-9a-fA-F]{40}$/.test(address) ? address.toLowerCase() : address);

/** The owner's wallets, read from the files the Worker itself uses: address -> where it is declared. */
export function ownWallets(read = (name) => readFileSync(repoFile(name), "utf8")) {
  const own = new Map();
  const ledger = read("src/lib/settlement-ledger.ts").match(/const OWNED_WALLETS = new Set\(\[([\s\S]*?)\]\)/)?.[1] ?? "";
  for (const [, address] of ledger.matchAll(/"(0x[0-9a-fA-F]{40})"/g)) own.set(walletKey(address), "OWNED_WALLETS");
  const previous = read("src/lib/payout-wallets.ts").match(/PREVIOUS_PAY_TO[^=]*=\s*\[([\s\S]*?)\]/)?.[1] ?? "";
  for (const [, address] of previous.matchAll(/"(0x[0-9a-fA-F]{40})"/g)) own.set(walletKey(address), "payout wallet (PREVIOUS_PAY_TO)");
  for (const [, name, address] of read("wrangler.jsonc").matchAll(/^\s*"(PAY_TO|TEMPO_PAY_TO|SOLANA_PAY_TO)"\s*:\s*"([^"]+)"/gm)) {
    if (address.trim() && !own.has(walletKey(address.trim()))) own.set(walletKey(address.trim()), `payout wallet (${name})`);
  }
  if (!own.size) throw new Error("no owned wallets found in src/lib/settlement-ledger.ts, src/lib/payout-wallets.ts or wrangler.jsonc");
  return own;
}

const usd = (atomic, decimals = 6) => {
  const text = BigInt(atomic).toString().padStart(decimals + 1, "0");
  return `${text.slice(0, -decimals)}.${text.slice(-decimals)}`.replace(/(\.\d{2}\d*?)0+$/, "$1");
};
const dayBefore = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) - n * 86400_000).toISOString().slice(0, 10);

/**
 * Builds the report from the four report bodies (any may be null) and optional per-payment rows.
 * Every figure is a count read from a body or plain arithmetic on such counts; a figure whose source is missing is null.
 */
export function buildReport({ revenue = null, metrics = null, callers = null, status = null, settlements = null }, { days = null, own = ownWallets() } = {}) {
  const funnelDays = revenue?.funnel?.days ?? null;
  const allDays = Object.keys(funnelDays ?? metrics ?? {}).sort();
  const newest = allDays.at(-1) ?? null;
  const from = newest && days ? dayBefore(newest, days - 1) : allDays[0] ?? null;
  const inWindow = (day) => from !== null && day >= from && day <= newest;
  const windowDays = allDays.filter(inWindow);

  const routes = new Map();
  const route = (p) => routes.get(p) ?? routes.set(p, { path: p, attempts: 0, attemptsMcp: 0, verified: 0, settled: 0, completed: 0, executionFailed: 0, refusalStages: {} }).get(p);
  if (funnelDays) for (const day of windowDays) {
    for (const [label, n] of Object.entries(funnelDays[day] ?? {})) {
      const m = /^(http|mcp):(.+):([a-z_]+)$/.exec(label);
      if (!m || !PAYMENT_STAGES.has(m[3]) || typeof n !== "number") continue;
      const row = route(m[2]);
      if (m[3] === "attempt") { row.attempts += n; if (m[1] === "mcp") row.attemptsMcp += n; }
      else if (m[3] === "execution_failed") row.executionFailed += n;
      else if (m[3] === "verified" || m[3] === "settled" || m[3] === "completed") row[m[3]] += n;
      else row.refusalStages[m[3]] = (row.refusalStages[m[3]] ?? 0) + n;
    }
  }

  // /metrics: refused payment attempts by protocol, and paid calls at the tool's price (own wallets included).
  const refused402 = new Map(), paidByRoute = new Map();
  let metricsPaid = null;
  if (metrics) {
    metricsPaid = { calls: 0, usdMicros: 0 };
    for (const [day, paths] of Object.entries(metrics)) {
      if (!inWindow(day)) continue;
      for (const [p, row] of Object.entries(paths)) {
        metricsPaid.calls += row.trackedPaidCalls ?? 0;
        metricsPaid.usdMicros += row.revenueUsdMicros ?? 0;
        if (row.paid) paidByRoute.set(p, (paidByRoute.get(p) ?? 0) + row.paid);
        const hit = Object.entries(PROTOCOLS).filter(([, outcome]) => row[outcome]);
        if (!hit.length) continue;
        const sum = refused402.get(p) ?? refused402.set(p, { v2: 0, v1: 0, mpp: 0 }).get(p);
        for (const [name, outcome] of hit) sum[name] += row[outcome];
      }
    }
    for (const p of refused402.keys()) route(p);
  }

  // The ledger is one 30-day total: usable per route only when the window reaches back to its first day.
  const ledger = revenue && typeof revenue.settlements === "number" ? revenue : null;
  const ledgerCoversWindow = Boolean(ledger && from !== null && from <= ledger.sinceUtc);
  const statusByPath = new Map((status?.tools ?? []).map((t) => [t.path, t]));

  const rows = [...routes.values()].map((r) => {
    const stages = r.refusalStages;
    const beforeVerify = BEFORE_VERIFY.reduce((n, s) => n + (stages[s] ?? 0), 0);
    const outside = ledgerCoversWindow ? ledger.byEndpoint?.[r.path] ?? { settlements: 0, grossAtomic: "0" } : null;
    const tool = statusByPath.get(r.path);
    return {
      ...r,
      refused402: metrics ? refused402.get(r.path) ?? { v2: 0, v1: 0, mpp: 0 } : null,
      metricsPaid: metrics ? paidByRoute.get(r.path) ?? 0 : null,
      lost: r.attempts - r.settled,
      noVerifyOutcome: r.attempts - r.verified - beforeVerify,
      verifiedNoSettleOutcome: r.verified - r.settled - (stages.settlement_failed ?? 0) - r.executionFailed,
      settledNotCompleted: r.settled - r.completed,
      outsideSettled: outside ? outside.settlements : null,
      outsideUsd: outside ? usd(outside.grossAtomic, ledger.decimals ?? 6) : null,
      ownOrUnledgered: outside ? r.settled - outside.settlements : null,
      status: status ? {
        paymentRefusals: tool?.paymentRefusals ?? [],
        paidInputRefusals: (tool?.topFailures ?? []).filter((f) => /\[sent [^\]]*\]$/.test(f.reason)),
      } : null,
    };
  }).sort((a, b) => b.lost - a.lost || (b.outsideSettled ?? 0) - (a.outsideSettled ?? 0) || b.attempts - a.attempts || (a.path < b.path ? -1 : 1));

  const sum = (pick) => rows.reduce((n, r) => n + pick(r), 0);
  const totals = {
    routes: rows.length, attempts: sum((r) => r.attempts), attemptsMcp: sum((r) => r.attemptsMcp),
    refused402: metrics ? { v2: sum((r) => r.refused402.v2), v1: sum((r) => r.refused402.v1), mpp: sum((r) => r.refused402.mpp) } : null,
    verified: sum((r) => r.verified), settled: sum((r) => r.settled), completed: sum((r) => r.completed),
    executionFailed: sum((r) => r.executionFailed), lost: sum((r) => r.lost),
    refusalStages: Object.fromEntries(REFUSAL_STAGES.map((s) => [s, sum((r) => r.refusalStages[s] ?? 0)]).filter(([, n]) => n)),
    outsideSettled: ledgerCoversWindow ? sum((r) => r.outsideSettled) : null,
  };
  const ledgerCheck = ledgerCoversWindow ? {
    sinceUtc: ledger.sinceUtc, outsideSettlements: ledger.settlements, outsideUsd: usd(ledger.grossAtomic, ledger.decimals ?? 6),
    selfPayments: ledger.selfPayments, funnelSettled: totals.settled,
    unaccounted: totals.settled - ledger.settlements - ledger.selfPayments,
    payerActivity: ledger.payerActivity ? { distinctExternalWallets: ledger.payerActivity.distinctExternalWallets, returningOnAnotherUtcDay: ledger.payerActivity.returningOnAnotherUtcDay, repeatPayerToolPairs: ledger.payerActivity.repeatPayerToolPairs } : null,
  } : null;

  // Calling software (User-Agent family) that had a payment refused or served. Names only, as the Worker stores them.
  let software = null;
  if (callers?.http) {
    const by = new Map();
    for (const [day, families] of Object.entries(callers.http)) {
      if (!inWindow(day)) continue;
      for (const [family, row] of Object.entries(families)) {
        if (!row.paid && !row.v2_payment && !row.v1_payment && !row.mpp_payment) continue;
        const s = by.get(family) ?? by.set(family, { family, paid: 0, v2: 0, v1: 0, mpp: 0 }).get(family);
        s.paid += row.paid ?? 0; s.v2 += row.v2_payment ?? 0; s.v1 += row.v1_payment ?? 0; s.mpp += row.mpp_payment ?? 0;
      }
    }
    software = [...by.values()].sort((a, b) => (b.v2 + b.v1 + b.mpp) - (a.v2 + a.v1 + a.mpp) || b.paid - a.paid);
  }

  return {
    window: { from, to: newest, days: windowDays.length, requestedDays: days },
    sources: { revenue: Boolean(revenue), metrics: Boolean(metrics), callers: Boolean(callers), status: Boolean(status), settlements: Array.isArray(settlements) },
    statusWindowDays: status?.windowDays ?? null,
    routes: rows, totals, ledger: ledgerCheck, metricsPaid: metricsPaid && { calls: metricsPaid.calls, usd: usd(metricsPaid.usdMicros) },
    software, cardCredits: revenue?.cardCredits ?? null,
    wallets: Array.isArray(settlements) ? walletReport(settlements, own, days && newest ? inWindow : () => true) : null,
  };
}

/** Per-wallet sums of per-payment rows, the owner's wallets apart, and the outside wallets that came back. */
export function walletReport(settlements, own, inWindow = () => true) {
  const wallets = new Map();
  let skipped = 0;
  for (const row of settlements) {
    const payer = typeof row?.payer === "string" ? walletKey(row.payer) : "";
    const day = typeof row?.recordedAt === "string" && Number.isFinite(Date.parse(row.recordedAt)) ? new Date(row.recordedAt).toISOString().slice(0, 10) : "";
    if (!payer || !day || !/^\d{1,30}$/.test(String(row.amountAtomic ?? ""))) { skipped++; continue; }
    if (!inWindow(day)) continue;
    const ownedAs = own.get(payer) ?? (row.selfPayment === true ? "row says selfPayment" : typeof row.recipient === "string" && walletKey(row.recipient) === payer ? "pays itself" : null);
    const w = wallets.get(payer) ?? wallets.set(payer, { wallet: payer, own: ownedAs, calls: 0, days: new Set(), atomic: 0n, routes: {} }).get(payer);
    w.own ??= ownedAs;
    w.calls++; w.days.add(day); w.atomic += BigInt(row.amountAtomic);
    const p = typeof row.path === "string" && row.path ? row.path : "(route not in the row)";
    w.routes[p] = (w.routes[p] ?? 0) + 1;
  }
  const list = [...wallets.values()].map((w) => ({ wallet: w.wallet, own: w.own, calls: w.calls, days: w.days.size, usd: usd(w.atomic), routes: w.routes }))
    .sort((a, b) => b.calls - a.calls || (a.wallet < b.wallet ? -1 : 1));
  const outside = list.filter((w) => !w.own), mine = list.filter((w) => w.own);
  const total = (ws) => ({ wallets: ws.length, calls: ws.reduce((n, w) => n + w.calls, 0) });
  return {
    skippedRows: skipped, own: mine, outside, ownTotals: total(mine), outsideTotals: total(outside),
    repeatOutside: outside.filter((w) => w.calls >= REPEAT_MIN_CALLS && w.days >= REPEAT_MIN_DAYS),
  };
}

const NA = (why) => `n/a (${why})`;
function table(header, lines) {
  const widths = header.map((h, i) => Math.max(h.length, ...lines.map((l) => String(l[i]).length)));
  const fmt = (cells) => cells.map((c, i) => (i === 0 ? String(c).padEnd(widths[i]) : String(c).padStart(widths[i]))).join("  ").trimEnd();
  return [fmt(header), ...lines.map(fmt)];
}
const routeList = (routes) => Object.entries(routes).sort((a, b) => b[1] - a[1]).map(([p, n]) => `${p} ${n}`).join(", ");

/** The report as text for a terminal. Wallet addresses are printed in full: it is the owner's own screen. */
export function renderText(report, { allRoutes = false, origin = null } = {}) {
  const out = [];
  const { window: w, totals: t, sources } = report;
  out.push(`Paid attempts per route${origin ? `, ${origin}` : ""}`);
  out.push(`Window: ${w.from ?? "?"} to ${w.to ?? "?"} UTC (${w.days} days of data${w.requestedDays ? `, --days ${w.requestedDays}` : ""}).`);
  const missing = Object.entries(ROUTES).filter(([k]) => !sources[k]).map(([, r]) => r);
  if (missing.length) out.push(`Not available: ${missing.join(", ")}. Columns that need them say so.`);
  if (!sources.revenue) { out.push("", `Per-route funnel: ${NA("needs /revenue")}`); }
  const p402 = (r, k) => (r.refused402 ? r.refused402[k] : "n/a");
  const outsideCell = (v) => (v === null ? (sources.revenue ? "n/a*" : "n/a") : v);
  const shown = allRoutes ? report.routes : report.routes.filter((r) => r.lost !== 0 || r.refused402?.v2 || r.refused402?.v1 || r.refused402?.mpp || Object.keys(r.refusalStages).length || r.settledNotCompleted !== 0);
  if (sources.revenue || sources.metrics) {
    out.push("");
    const header = ["route", "attempts", "402:v2", "402:v1", "402:mpp", "verified", "settled", "completed", "exec_failed", "lost", "outside", "outside_usd", "own/unledg"];
    const cells = (name, r) => [name, r.attempts, p402(r, "v2"), p402(r, "v1"), p402(r, "mpp"), r.verified, r.settled, r.completed, r.executionFailed, r.lost, outsideCell(r.outsideSettled), outsideCell(r.outsideUsd), outsideCell(r.ownOrUnledgered)];
    const lines = table(header, [
      ...shown.map((r) => cells(r.path, r)),
      cells("TOTAL (every route)", { ...t, outsideUsd: report.ledger?.outsideUsd ?? null, ownOrUnledgered: t.outsideSettled === null ? null : t.settled - t.outsideSettled }),
    ]);
    out.push(lines[0]);
    shown.forEach((r, i) => {
      out.push(lines[i + 1]);
      const stages = REFUSAL_STAGES.filter((s) => r.refusalStages[s]).map((s) => `${s} ${r.refusalStages[s]}`);
      if (stages.length) out.push(`    refusal stages: ${stages.join(", ")}`);
      for (const f of r.status?.paymentRefusals ?? []) out.push(`    /status payment refused: ${f.count} x "${f.reason}"`);
      for (const f of r.status?.paidInputRefusals ?? []) out.push(`    /status paid call refused for its input: ${f.count} x "${f.reason}"`);
      const gaps = [
        [Math.max(r.noVerifyOutcome, 0), "no verify outcome recorded"],
        [Math.max(-r.noVerifyOutcome, 0), "refusal also counted on a verified payment"],
        [r.verifiedNoSettleOutcome, "verified, no settle outcome recorded"],
        [r.settledNotCompleted, `settled, not completed${r.metricsPaid === null ? "" : ` (/metrics counts ${r.metricsPaid} delivered with a receipt)`}`],
      ].filter(([n]) => n !== 0);
      if (gaps.length && sources.revenue) out.push(`    record gaps: ${gaps.map(([n, label]) => `${label} ${n}`).join("; ")}`);
    });
    out.push(lines.at(-1));
    const quiet = report.routes.filter((r) => !shown.includes(r));
    if (quiet.length) out.push(`(${quiet.length} more routes lost nothing: every paid attempt settled${t.outsideSettled === null ? "" : `, ${quiet.filter((r) => r.outsideSettled).length} of them with outside settlements`}. --all-routes or --json lists them.)`);
    if (sources.revenue && t.outsideSettled === null) out.push("* n/a (30-day ledger total): /revenue gives outside settlements as one 30-day figure; run without --days for these columns.");
    if (!sources.metrics) out.push(`402 by protocol: ${NA("needs /metrics")}`);
    out.push("Protocol of served payments: n/a (not recorded; the reports record the protocol only for attempts answered 402).");
    if (!sources.status) out.push(`Refusal texts and the input names paying callers sent: ${NA("needs /status")}`);
    else out.push(`/status lines cover its own ${report.statusWindowDays ?? 7} days and the top six reasons per tool.`);
  }

  out.push("", "Totals");
  if (sources.revenue) {
    out.push(`  attempts ${t.attempts} (of which MCP ${t.attemptsMcp}), verified ${t.verified}, settled ${t.settled}, completed ${t.completed}, execution_failed ${t.executionFailed}, lost ${t.lost}`);
    out.push(`  refusal stages: ${Object.entries(t.refusalStages).map(([s, n]) => `${s} ${n}`).join(", ") || "none"}`);
  }
  if (t.refused402) out.push(`  answered 402 to a payment, by protocol: x402 v2 ${t.refused402.v2}, x402 v1 ${t.refused402.v1}, MPP ${t.refused402.mpp}`);
  if (report.metricsPaid) out.push(`  /metrics paid calls at the tool's price, every wallet (own included): ${report.metricsPaid.calls} calls, $${report.metricsPaid.usd}`);
  if (report.ledger) {
    const l = report.ledger;
    out.push(`  settled ${l.funnelSettled} = outside wallets ${l.outsideSettlements} ($${l.outsideUsd}) + own wallets ${l.selfPayments} (self-payments, not income) + unaccounted ${l.unaccounted}`);
    if (l.payerActivity) out.push(`  outside wallets since ${l.sinceUtc}: ${l.payerActivity.distinctExternalWallets} distinct, ${l.payerActivity.returningOnAnotherUtcDay} paid on more than one UTC day, ${l.payerActivity.repeatPayerToolPairs} wallet-and-tool pairs repeated on another day (counts only; the route publishes no addresses)`);
  } else if (sources.revenue) out.push(`  outside and own settlements: ${NA("30-day ledger total; run without --days")}`);
  if (report.cardCredits) out.push(`  card credits (private, shown with the revenue token): ${Object.entries(report.cardCredits).filter(([, v]) => typeof v === "number" || typeof v === "string").map(([k, v]) => `${k} ${v}`).join(", ")}`);

  if (report.software) {
    out.push("", "Calling software with a payment served or refused (/metrics/callers, software names only)");
    out.push(...table(["software", "paid", "402:v2", "402:v1", "402:mpp"], report.software.map((s) => [s.family, s.paid, s.v2, s.v1, s.mpp])).map((l) => `  ${l}`));
  } else out.push("", `Calling software: ${NA("needs /metrics/callers")}`);

  out.push("", "Own wallets (self-payments, kept out of every outside figure)");
  if (!report.wallets) out.push(`  ${NEEDS_ROWS}`, ...(report.ledger ? [`  count only: ${report.ledger.selfPayments} self-payments since ${report.ledger.sinceUtc} (/revenue selfPayments)`] : []));
  else {
    const ws = report.wallets;
    if (ws.skippedRows) out.push(`  ${ws.skippedRows} rows skipped (no payer, time or amount)`);
    out.push(...(ws.own.length ? table(["wallet", "declared as", "days", "calls", "usd"], ws.own.map((x) => [x.wallet, x.own, x.days, x.calls, x.usd])).map((l) => `  ${l}`) : ["  none in these rows"]));
  }
  out.push("", `Outside wallets with ${REPEAT_MIN_CALLS} or more paid calls on ${REPEAT_MIN_DAYS} or more distinct UTC days`);
  if (!report.wallets) out.push(`  ${NEEDS_ROWS}`);
  else {
    const ws = report.wallets;
    out.push(`  outside wallets in these rows: ${ws.outsideTotals.wallets} with ${ws.outsideTotals.calls} paid calls; ${ws.repeatOutside.length} meet the rule`);
    if (ws.repeatOutside.length) out.push(...table(["wallet", "days", "calls", "usd", "routes"], ws.repeatOutside.map((x) => [x.wallet, x.days, x.calls, x.usd, ""])).map((l, i) => `  ${l}${i ? `  ${routeList(ws.repeatOutside[i - 1].routes)}` : ""}`));
  }
  return out.join("\n");
}

function parseArgs(argv) {
  const valued = new Set(["--origin", "--revenue-token", "--token-file", "--days", "--json", "--from-files", "--save-inputs", "--settlements"]);
  const flags = new Set(["--all-routes", "--help"]);
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const name = argv[i];
    if (flags.has(name)) args[name] = true;
    else if (valued.has(name) && argv[i + 1] !== undefined) args[name] = argv[++i];
    else throw new Error(`unknown or incomplete option ${name}; see the header of scripts/reconcile-bazaar.mjs`);
  }
  if (args["--days"] !== undefined && !/^[1-9]\d{0,2}$/.test(args["--days"])) throw new Error("--days takes a whole number of days, 1 or more");
  return args;
}

const readJson = async (file) => JSON.parse(await readFile(file, "utf8"));
const readJsonIfThere = (file) => readJson(file).catch((err) => { if (err.code === "ENOENT") return null; throw new Error(`${file}: ${err.message}`); });

/** One plain GET per report route. The token goes to /revenue only, and only over https (or to localhost). */
export async function fetchReports(origin, token, saveDir) {
  const base = new URL(origin);
  if (token && base.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(base.hostname)) throw new Error("the revenue token is only sent over https");
  const bodies = {}, problems = [];
  for (const [key, route] of Object.entries(ROUTES)) {
    try {
      const res = await fetch(new URL(route, base), { method: "GET", headers: { accept: "application/json", "user-agent": "reconcile-bazaar/1 (owner report, read-only)", ...(token && key === "revenue" ? { authorization: `Bearer ${token}` } : {}) } });
      const text = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      bodies[key] = JSON.parse(text);
      // The archive never holds the private card-credit figures the token adds.
      if (saveDir) await writeFile(path.join(saveDir, FILES[key]), key === "revenue" ? JSON.stringify({ ...bodies[key], cardCredits: undefined }) : text);
    } catch (err) { bodies[key] = null; problems.push(`${route}: ${err.message}`); }
  }
  return { bodies, problems };
}

async function main(argv) {
  const args = parseArgs(argv);
  if (args["--help"]) { console.log((await readFile(fileURLToPath(import.meta.url), "utf8")).split("\n").slice(1).filter((l, i, all) => all.slice(0, i + 1).every((x) => x.startsWith("//"))).map((l) => l.slice(3)).join("\n")); return; }
  const origin = args["--origin"] ?? DEFAULT_ORIGIN;
  let bodies, problems = [];
  if (args["--from-files"]) {
    const dir = args["--from-files"];
    bodies = Object.fromEntries(await Promise.all(Object.entries(FILES).map(async ([key, file]) => [key, await readJsonIfThere(path.join(dir, file))])));
  } else {
    const token = args["--revenue-token"] ?? (args["--token-file"] ? (await readFile(args["--token-file"], "utf8")).trim() : undefined);
    if (args["--save-inputs"]) await mkdir(args["--save-inputs"], { recursive: true });
    ({ bodies, problems } = await fetchReports(origin, token, args["--save-inputs"]));
  }
  if (args["--settlements"]) bodies.settlements = await readJson(args["--settlements"]);
  if (bodies.settlements != null && !Array.isArray(bodies.settlements)) throw new Error("the settlements file must be a JSON array of per-payment rows");
  const report = buildReport(bodies, { days: args["--days"] ? Number(args["--days"]) : null });
  for (const problem of problems) console.error(`could not read ${problem}`);
  console.log(renderText(report, { allRoutes: Boolean(args["--all-routes"]), origin: args["--from-files"] ? `saved files in ${args["--from-files"]}` : origin }));
  if (args["--json"]) await writeFile(args["--json"], `${JSON.stringify(report, null, 2)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((err) => { console.error(`reconcile-bazaar: ${err.message}`); process.exitCode = 1; });
}
