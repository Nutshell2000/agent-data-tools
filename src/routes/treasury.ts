// US Treasury Fiscal Data (7 Nov 2026). Why: the Zero.xyz buyer 0x77a9, the one real repeat buyer that week, paid x402stock
// $0.38 in a night (19 calls) for US national-debt figures, its largest line, and we sold nothing like it. Source:
// api.fiscaldata.treasury.gov, keyless, US federal data in the public domain. Datasets: "Debt to the Penny" (daily) and
// "Average Interest Rates on U.S. Treasury Securities" (monthly).
// The Treasury's API never answers Cloudflare's egress (silent 9 s timeouts on every URL from production on 7 Nov 2026,
// while the PC gets it in 300 ms), so these tools read a snapshot in KV (`treasury:debt`, `treasury:rates`) that
// scripts/fetch-treasury.mjs builds on the PC and `upload-treasury.ps1` (release train folder) puts into TRIALS on
// staging and production. Every answer carries the record date and the snapshot time; a missing snapshot is an
// uncharged 503.
import { entry, num, opt, type Entry } from "../family";
import { HttpError, type Env } from "../lib/env";

const SOURCE = "U.S. Department of the Treasury, Fiscal Data (public domain)";
const DEBT_DATASET = "Debt to the Penny";
const DEBT_URL = "https://fiscaldata.treasury.gov/datasets/debt-to-the-penny/";
const RATES_DATASET = "Average Interest Rates on U.S. Treasury Securities";
const RATES_URL = "https://fiscaldata.treasury.gov/datasets/average-interest-rates-treasury-securities/";
export const DEBT_KEY = "treasury:debt";
export const RATES_KEY = "treasury:rates";

export type DebtRow = { record_date: string; tot_pub_debt_out_amt: string; debt_held_public_amt: string; intragov_hold_amt: string; record_fiscal_year?: string };
export type RateRow = { record_date: string; security_type_desc: string; security_desc: string; avg_interest_rate_amt: string };
export type Snapshot<T> = { fetchedAt: string; rows: T[] };

const usd = (s: string | null | undefined): number | null => { const n = Number(s); return s !== null && s !== undefined && Number.isFinite(n) ? Math.round(n * 100) / 100 : null; };
const pct = (s: string | null | undefined): number | null => { const n = Number(s); return s !== null && s !== undefined && Number.isFinite(n) ? Math.round(n * 1000) / 1000 : null; };

/** The latest Debt to the Penny record, its change over 1, 30 and 365 days, and `days` daily rows (rows newest first). */
export function debtSummary(rows: DebtRow[], days: number) {
  const sorted = rows.filter((r) => r.record_date && usd(r.tot_pub_debt_out_amt) !== null).sort((a, b) => (a.record_date < b.record_date ? 1 : -1));
  if (!sorted.length) throw new HttpError(502, "the Treasury snapshot holds no debt records; try again later");
  const latest = sorted[0];
  const total = usd(latest.tot_pub_debt_out_amt)!;
  const changeSince = (back: number) => {
    const target = new Date(`${latest.record_date}T00:00:00Z`);
    target.setUTCDate(target.getUTCDate() - back);
    const iso = target.toISOString().slice(0, 10);
    const row = sorted.find((r) => r.record_date <= iso);
    if (!row) return null;
    const then = usd(row.tot_pub_debt_out_amt)!;
    return { since: row.record_date, amountUsd: Math.round((total - then) * 100) / 100, percent: then ? Math.round(((total - then) / then) * 10000) / 100 : null };
  };
  const row = (r: DebtRow) => ({ date: r.record_date, totalPublicDebtUsd: usd(r.tot_pub_debt_out_amt), debtHeldByPublicUsd: usd(r.debt_held_public_amt), intragovernmentalHoldingsUsd: usd(r.intragov_hold_amt) });
  return {
    date: latest.record_date,
    fiscalYear: latest.record_fiscal_year ? Number(latest.record_fiscal_year) : null,
    totalPublicDebtUsd: total,
    debtHeldByPublicUsd: usd(latest.debt_held_public_amt),
    intragovernmentalHoldingsUsd: usd(latest.intragov_hold_amt),
    change: { d1: changeSince(1), d30: changeSince(30), d365: changeSince(365) },
    history: sorted.slice(0, days).map(row),
  };
}

const TOTALS: Record<string, string> = { marketable: "Total Marketable", nonMarketable: "Total Non-marketable", interestBearingDebt: "Total Interest-bearing Debt" };

/** The latest month of average Treasury interest rates (optionally filtered by security name) and `months` of totals. */
export function ratesSummary(rows: RateRow[], months: number, filter?: string) {
  const byMonth = new Map<string, RateRow[]>();
  for (const r of rows) { if (!r.record_date) continue; const list = byMonth.get(r.record_date) ?? []; list.push(r); byMonth.set(r.record_date, list); }
  const dates = [...byMonth.keys()].sort().reverse();
  if (!dates.length) throw new HttpError(502, "the Treasury snapshot holds no interest-rate records; try again later");
  const latest = dates[0];
  const lower = filter?.trim().toLowerCase();
  const rates = byMonth.get(latest)!
    .filter((r) => !lower || `${r.security_type_desc} ${r.security_desc}`.toLowerCase().includes(lower))
    .map((r) => ({ type: r.security_type_desc, security: r.security_desc, ratePercent: pct(r.avg_interest_rate_amt) }));
  if (!rates.length) throw new HttpError(404, `no Treasury security matches "${filter?.slice(0, 40)}"; try bills, notes, bonds, TIPS or marketable. Nothing was charged`);
  const totals = (list: RateRow[]) => Object.fromEntries(Object.entries(TOTALS).map(([key, desc]) => [key, pct(list.find((r) => r.security_desc === desc)?.avg_interest_rate_amt)])) as Record<keyof typeof TOTALS, number | null>;
  return {
    month: latest.slice(0, 7), recordDate: latest, rates, totals: totals(byMonth.get(latest)!),
    history: dates.slice(0, months).map((d) => ({ month: d.slice(0, 7), ...totals(byMonth.get(d)!) })),
  };
}

/** The snapshot under `key`, or an uncharged 503 when this deployment has none. */
export async function snapshot<T>(env: Env, key: string): Promise<Snapshot<T>> {
  const kv = env.TRIALS;
  const s = kv ? ((await kv.get(key, "json")) as Snapshot<T> | null) : null;
  if (!s?.rows?.length) throw new HttpError(503, "the Treasury data snapshot is not loaded on this deployment yet; try again later", "TREASURY_UNAVAILABLE");
  return s;
}

const NOTE = "Monthly averages of the interest paid on outstanding securities, not today's market yields.";

export const TREASURY: Entry[] = [
  entry("/econ/national-debt", "US national debt, Treasury data: total public debt outstanding today and its change",
    "US national debt from the Treasury's Debt to the Penny dataset: total public debt outstanding, debt held by the public and intragovernmental holdings (USD) at the latest record date, the change over 1 day, 30 days and 1 year, and a daily history (1-365 days). US federal data, public domain; the snapshot's record date is in the answer. Use when an agent needs the current US federal debt figure, its trend, or a daily series for a chart or brief.",
    ["national-debt", "us-national-debt", "treasury", "public-debt", "fiscal-data", "us-economy", "macro"],
    { days: { type: "integer", description: "Days of daily history to return, 1-365 (default 30)", example: 30 } },
    {
      date: "2026-11-05", fiscalYear: 2027, totalPublicDebtUsd: 40556120784983.65, debtHeldByPublicUsd: 32766722473715.61, intragovernmentalHoldingsUsd: 7789398311268.04,
      change: {
        d1: { since: "2026-11-04", amountUsd: 5890737374.5, percent: 0.01 },
        d30: { since: "2026-10-06", amountUsd: 181204583011.2, percent: 0.45 },
        d365: { since: "2025-11-05", amountUsd: 2301450102311.9, percent: 6.02 },
      },
      history: [{ date: "2026-11-05", totalPublicDebtUsd: 40556120784983.65, debtHeldByPublicUsd: 32766722473715.61, intragovernmentalHoldingsUsd: 7789398311268.04 }],
      snapshotAt: "2026-11-07T08:30:00.000Z", dataset: DEBT_DATASET, datasetUrl: DEBT_URL, source: SOURCE,
    },
    async (env, q) => {
      const days = num(q, "days", { min: 1, max: 365, fallback: 30, integer: true });
      const s = await snapshot<DebtRow>(env, DEBT_KEY);
      return { ...debtSummary(s.rows, days), snapshotAt: s.fetchedAt, dataset: DEBT_DATASET, datasetUrl: DEBT_URL, source: SOURCE };
    }),

  entry("/econ/treasury-rates", "US Treasury interest rates: average rates on bills, notes, bonds and all federal debt, monthly",
    "Average interest rates on US Treasury securities by month from the Treasury's Fiscal Data: bills, notes, bonds, TIPS, floating rate notes and the non-marketable series, with totals for marketable, non-marketable and all interest-bearing debt, for the latest month and up to 24 months. US federal data, public domain, from a dated snapshot. Use for the US government's borrowing cost, a rate trend or macro context; not a live yield curve.",
    ["treasury-rates", "interest-rates", "treasury-bills", "treasury-bonds", "us-treasury", "fiscal-data", "macro"],
    {
      months: { type: "integer", description: "Months of history for the totals, 1-24 (default 12)", example: 12 },
      security: { type: "string", description: "Optional filter on the security name: bills, notes, bonds, TIPS, floating, marketable…", example: "bills" },
    },
    {
      month: "2026-10", recordDate: "2026-10-31",
      rates: [{ type: "Marketable", security: "Treasury Bills", ratePercent: 4.014 }, { type: "Marketable", security: "Treasury Notes", ratePercent: 3.399 }],
      totals: { marketable: 3.57, nonMarketable: 3.63, interestBearingDebt: 3.58 },
      history: [{ month: "2026-10", marketable: 3.57, nonMarketable: 3.63, interestBearingDebt: 3.58 }],
      note: NOTE, snapshotAt: "2026-11-07T08:30:00.000Z", dataset: RATES_DATASET, datasetUrl: RATES_URL, source: SOURCE,
    },
    async (env, q) => {
      const months = num(q, "months", { min: 1, max: 24, fallback: 12, integer: true });
      const security = opt(q, "security", 60);
      const s = await snapshot<RateRow>(env, RATES_KEY);
      return { ...ratesSummary(s.rows, months, security), note: NOTE, snapshotAt: s.fetchedAt, dataset: RATES_DATASET, datasetUrl: RATES_URL, source: SOURCE };
    }),
];
