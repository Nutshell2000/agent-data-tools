/**
 * Company financial statements from SEC XBRL (11 Nov 2026, owner: "Yes, at $0.02").
 *
 * Why: on the Bazaar of 11 Nov financialdatasets.ai sold prices, metrics, income statements and balance sheets to 26 payers
 * at $0.02-0.035 a call, an "SEC EDGAR Financials" company-facts listing had 7 payers, 2s.io's stock metrics 9, and
 * Mercator's router sent about 50 calls a month to SEC-financials sellers; we sold filings, 8-Ks, insider trades and 13F
 * holdings but no numbers from the statements themselves.
 *
 * Source: SEC's XBRL "company facts" file (data.sec.gov/api/xbrl/companyfacts/CIK##########.json): every value a company has
 * tagged in its 10-K and 10-Q filings. Public SEC information that may be copied and redistributed (sec.gov/privacy); the
 * fair-access rules (a User-Agent naming a contact, under 10 requests a second) are kept by `govFetch`. One request per call,
 * 4-8 MB, kept six hours at the edge.
 *
 * What the file does not give directly, and how it is derived here:
 * - Fiscal years: 10-Ks repeat earlier years as comparatives under the filing's own fiscal-year label, so a period is named
 *   by the year its end date falls in (a year ending in the first week of January belongs to the year before).
 * - Quarters: 10-Qs report income for the quarter and the year to date, cash flow only for the year to date, and the 10-K
 *   has no fourth quarter. A quarter is the reported three-month value where there is one, otherwise the year-to-date
 *   value minus the one before it. Per-share figures are never derived that way (shares change): they stay null.
 * - One company can tag the same line under different names over the years (Apple's revenue is "Revenues" until 2018 and
 *   "RevenueFromContractWithCustomerExcludingAssessedTax" after): each line tries its names in order, period by period.
 * - A restated value (a later filing for the same period) replaces the earlier one.
 * US GAAP filers only; companies that file IFRS statements (most 20-F filers) answer 404.
 */
import { entry, num, opt, type Entry } from "../family";
import { HttpError } from "../lib/env";
import { govFetch, resolveCik } from "./gov-data";

export interface XbrlFact { start?: string; end: string; val: number; accn: string; fy?: number | null; fp?: string | null; form: string; filed: string; frame?: string }
export interface CompanyFacts { cik: number; entityName: string; facts: Record<string, Record<string, { units: Record<string, XbrlFact[]> }>> }

type Kind = "money" | "perShare" | "shares";
interface Line { key: string; kind: Kind; instant?: boolean; concepts: readonly string[] }

const INCOME: readonly Line[] = [
  { key: "revenue", kind: "money", concepts: ["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues", "RevenueFromContractWithCustomerIncludingAssessedTax", "SalesRevenueNet", "SalesRevenueGoodsNet", "RevenuesNetOfInterestExpense"] },
  { key: "costOfRevenue", kind: "money", concepts: ["CostOfRevenue", "CostOfGoodsAndServicesSold", "CostOfGoodsSold", "CostOfGoodsAndServiceExcludingDepreciationDepletionAndAmortization"] },
  { key: "grossProfit", kind: "money", concepts: ["GrossProfit"] },
  { key: "researchAndDevelopment", kind: "money", concepts: ["ResearchAndDevelopmentExpense", "ResearchAndDevelopmentExpenseExcludingAcquiredInProcessCost"] },
  { key: "sellingGeneralAdministrative", kind: "money", concepts: ["SellingGeneralAndAdministrativeExpense"] },
  { key: "operatingIncome", kind: "money", concepts: ["OperatingIncomeLoss"] },
  { key: "pretaxIncome", kind: "money", concepts: ["IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest", "IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments"] },
  { key: "incomeTax", kind: "money", concepts: ["IncomeTaxExpenseBenefit"] },
  { key: "netIncome", kind: "money", concepts: ["NetIncomeLoss", "ProfitLoss", "NetIncomeLossAvailableToCommonStockholdersBasic"] },
  { key: "epsBasic", kind: "perShare", concepts: ["EarningsPerShareBasic", "EarningsPerShareBasicAndDiluted"] },
  { key: "epsDiluted", kind: "perShare", concepts: ["EarningsPerShareDiluted", "EarningsPerShareBasicAndDiluted"] },
  { key: "dilutedShares", kind: "shares", concepts: ["WeightedAverageNumberOfDilutedSharesOutstanding"] },
];
const BALANCE: readonly Line[] = [
  { key: "cash", kind: "money", instant: true, concepts: ["CashAndCashEquivalentsAtCarryingValue", "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents", "Cash"] },
  { key: "currentAssets", kind: "money", instant: true, concepts: ["AssetsCurrent"] },
  { key: "totalAssets", kind: "money", instant: true, concepts: ["Assets"] },
  { key: "currentLiabilities", kind: "money", instant: true, concepts: ["LiabilitiesCurrent"] },
  { key: "longTermDebt", kind: "money", instant: true, concepts: ["LongTermDebtNoncurrent", "LongTermDebt", "LongTermDebtAndCapitalLeaseObligations"] },
  { key: "totalLiabilities", kind: "money", instant: true, concepts: ["Liabilities"] },
  { key: "shareholdersEquity", kind: "money", instant: true, concepts: ["StockholdersEquity", "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest"] },
];
const CASH_FLOW: readonly Line[] = [
  { key: "operatingCashFlow", kind: "money", concepts: ["NetCashProvidedByUsedInOperatingActivities", "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations"] },
  { key: "capitalExpenditure", kind: "money", concepts: ["PaymentsToAcquirePropertyPlantAndEquipment", "PaymentsToAcquireProductiveAssets"] },
  { key: "dividendsPaid", kind: "money", concepts: ["PaymentsOfDividends", "PaymentsOfDividendsCommonStock"] },
  { key: "shareBuybacks", kind: "money", concepts: ["PaymentsForRepurchaseOfCommonStock"] },
];
/** Lines read only to derive others (never shown): many companies tag no total liabilities (Walmart, Amazon, Coca-Cola,
 *  Disney: liabilities = liabilities and equity minus equity) or split SG&A into selling and G&A (Alphabet, Meta, Netflix). */
const HELPERS: readonly Line[] = [
  { key: "_liabilitiesAndEquity", kind: "money", instant: true, concepts: ["LiabilitiesAndStockholdersEquity"] },
  { key: "_equityWithMinority", kind: "money", instant: true, concepts: ["StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest"] },
  { key: "_selling", kind: "money", concepts: ["SellingAndMarketingExpense", "SellingExpense", "MarketingAndAdvertisingExpense"] },
  { key: "_generalAdministrative", kind: "money", concepts: ["GeneralAndAdministrativeExpense"] },
];
/** Fill the lines a company did not tag from the ones it did; returns which lines were derived. */
function derive(v: Record<string, number | null>): string[] {
  const done: string[] = [];
  if (v.totalLiabilities === null && v._liabilitiesAndEquity !== null) {
    const equity = v._equityWithMinority ?? v.shareholdersEquity;
    if (equity !== null) { v.totalLiabilities = v._liabilitiesAndEquity - equity; done.push("totalLiabilities"); }
  }
  if (v.sellingGeneralAdministrative === null && v._selling !== null && v._generalAdministrative !== null) {
    v.sellingGeneralAdministrative = v._selling + v._generalAdministrative; done.push("sellingGeneralAdministrative");
  }
  return done;
}
const DERIVED_FROM: Readonly<Record<string, string>> = {
  totalLiabilities: "LiabilitiesAndStockholdersEquity minus StockholdersEquity (including noncontrolling interest)",
  sellingGeneralAdministrative: "SellingAndMarketingExpense plus GeneralAndAdministrativeExpense",
};

/** The flow lines whose annual periods define the fiscal years, in order of trust. */
const ANCHORS = ["revenue", "netIncome", "operatingCashFlow"] as const;

const ANNUAL_FORMS: ReadonlySet<string> = new Set(["10-K", "10-K/A", "10-KT", "10-KT/A", "20-F", "20-F/A", "40-F", "40-F/A"]);
const FILING_FORMS: ReadonlySet<string> = new Set([...ANNUAL_FORMS, "10-Q", "10-Q/A"]);
const DAY = 86_400_000;
const t = (d: string) => Date.parse(`${d}T00:00:00Z`);
const days = (a: string, b: string) => Math.round((t(b) - t(a)) / DAY);
const near = (a: string, b: string, tol: number) => Math.abs(days(a, b)) <= tol;
const plusDay = (d: string) => new Date(t(d) + DAY).toISOString().slice(0, 10);

/** The unit a line is read in: USD (or the company's reporting currency) for money, per share, or shares. */
function unitFor(units: Record<string, XbrlFact[]>, kind: Kind): string | undefined {
  const keys = Object.keys(units);
  if (kind === "perShare") return keys.find((k) => k === "USD/shares") ?? keys.find((k) => /^[A-Z]{3}\/shares$/.test(k));
  if (kind === "shares") return keys.find((k) => k === "shares");
  return keys.find((k) => k === "USD") ?? keys.find((k) => /^[A-Z]{3}$/.test(k));
}

/** One concept's values from 10-K and 10-Q filings, keyed by period, the latest filing winning (restatements). */
interface Series { concept: string; unit: string; byPeriod: Map<string, XbrlFact> }
function series(facts: CompanyFacts, concept: string, kind: Kind): Series | null {
  const c = facts.facts["us-gaap"]?.[concept];
  if (!c) return null;
  const unit = unitFor(c.units, kind);
  if (!unit) return null;
  const byPeriod = new Map<string, XbrlFact>();
  for (const f of c.units[unit]) {
    if (!FILING_FORMS.has(f.form) || typeof f.val !== "number" || !f.end) continue;
    const k = `${f.start ?? ""}|${f.end}`;
    const cur = byPeriod.get(k);
    if (!cur || f.filed > cur.filed || (f.filed === cur.filed && f.accn > cur.accn)) byPeriod.set(k, f);
  }
  return byPeriod.size ? { concept, unit, byPeriod } : null;
}

/** A duration value for start..end (start within a few days), or an instant value at end. */
function valueAt(s: Series, start: string | null, end: string): XbrlFact | undefined {
  if (start === null) {
    const exact = s.byPeriod.get(`|${end}`);
    if (exact) return exact;
    for (const f of s.byPeriod.values()) if (!f.start && near(f.end, end, 3)) return f;
    return undefined;
  }
  const exact = s.byPeriod.get(`${start}|${end}`);
  if (exact) return exact;
  for (const f of s.byPeriod.values()) if (f.start && near(f.start, start, 7) && near(f.end, end, 3)) return f;
  return undefined;
}

/** Fiscal year label: the calendar year the year ends in, or the year before when it ends in the first week of January. */
export function fiscalYearOf(end: string): number {
  const d = new Date(t(end));
  return d.getUTCMonth() === 0 && d.getUTCDate() <= 7 ? d.getUTCFullYear() - 1 : d.getUTCFullYear();
}

interface Period { start: string; end: string; fiscalYear: number; fiscalPeriod: string; accn: string; form: string; filed: string }

/** The company's fiscal years, newest first, from the annual periods of its anchor lines. */
function fiscalYears(lines: Map<string, Series[]>): Period[] {
  const found = new Map<string, XbrlFact>();
  for (const key of ANCHORS) {
    for (const s of lines.get(key) ?? []) {
      for (const f of s.byPeriod.values()) {
        if (!f.start || !ANNUAL_FORMS.has(f.form)) continue;
        const d = days(f.start, f.end);
        if (d < 340 || d > 380) continue;
        const k = f.end;
        if (![...found.keys()].some((e) => near(e, k, 20))) found.set(k, f);
      }
    }
  }
  return [...found.values()].sort((a, b) => b.end.localeCompare(a.end))
    .map((f) => ({ start: f.start!, end: f.end, fiscalYear: fiscalYearOf(f.end), fiscalPeriod: "FY", accn: f.accn, form: f.form, filed: f.filed }));
}

/** The first of a line's concepts that holds a value for the period. */
function lineValue(list: Series[] | undefined, start: string | null, end: string): { val: number; fact: XbrlFact; unit: string; concept: string } | null {
  for (const s of list ?? []) { const f = valueAt(s, start, end); if (f) return { val: f.val, fact: f, unit: s.unit, concept: s.concept }; }
  return null;
}

/** A flow line for one quarter: the reported three-month value, or year-to-date minus the year-to-date before it. */
function quarterValue(list: Series[] | undefined, line: Line, fyStart: string, prevEnd: string | null, end: string): number | null {
  const direct = lineValue(list, prevEnd ? plusDay(prevEnd) : fyStart, end);
  if (direct && days(direct.fact.start!, direct.fact.end) <= 100) return direct.val;
  if (line.kind !== "money") return null; // per-share figures and share counts cannot be differenced
  const ytd = lineValue(list, fyStart, end);
  if (!ytd) return null;
  if (!prevEnd) return ytd.val;
  const before = lineValue(list, fyStart, prevEnd);
  return before ? ytd.val - before.val : null;
}

const round = (n: number, dp = 2) => Math.round(n * 10 ** dp) / 10 ** dp;
const pct = (a: number | null, b: number | null) => (a === null || b === null || b === 0 ? null : round((a / b) * 100, 1));
const ratio = (a: number | null, b: number | null) => (a === null || b === null || b === 0 ? null : round(a / b, 2));
const archiveUrl = (cik: number, accn: string) => `https://www.sec.gov/Archives/edgar/data/${cik}/${accn.replaceAll("-", "")}/`;

export interface FinancialsOptions { period: "annual" | "quarterly"; limit: number }

/** The statements for the newest `limit` periods, newest first, from a company-facts file. */
export function financials(facts: CompanyFacts, { period, limit }: FinancialsOptions) {
  if (!facts.facts["us-gaap"]) {
    if (facts.facts["ifrs-full"]) throw new HttpError(404, `${facts.entityName} files IFRS statements; this tool reads US GAAP filings (10-K and 10-Q) only`);
    throw new HttpError(404, `${facts.entityName} has no XBRL financial statements at the SEC`);
  }
  const all = [...INCOME, ...BALANCE, ...CASH_FLOW, ...HELPERS];
  const lines = new Map<string, Series[]>();
  for (const l of all) lines.set(l.key, l.concepts.map((c) => series(facts, c, l.kind)).filter((s): s is Series => s !== null));
  const years = fiscalYears(lines);
  if (!years.length) throw new HttpError(404, `${facts.entityName} has no annual financial statements in its XBRL filings`);

  // Which XBRL concept each line was read from, in the latest fiscal year (the names a buyer can check in the filing).
  const used: Record<string, string> = {};
  let currency: string | null = null;
  for (const l of all) {
    if (l.key.startsWith("_")) continue;
    const v = lineValue(lines.get(l.key), l.instant ? null : years[0].start, years[0].end);
    if (!v) continue;
    used[l.key] = v.concept;
    if (!currency && l.kind === "money" && /^[A-Z]{3}$/.test(v.unit)) currency = v.unit;
  }

  type Row = Period & { values: Record<string, number | null> };
  const rows: Row[] = [];
  if (period === "annual") {
    for (const y of years.slice(0, limit + 1)) {
      const values: Record<string, number | null> = {};
      for (const l of all) {
        const v = lineValue(lines.get(l.key), l.instant ? null : y.start, y.end);
        values[l.key] = v ? v.val : null;
      }
      rows.push({ ...y, values });
    }
  } else {
    // Fiscal year starts: every annual year, plus the year that has begun since the latest 10-K.
    const starts = [{ start: plusDay(years[0].end), end: null as string | null, fy: fiscalYearOf(new Date(t(years[0].end) + 365 * DAY).toISOString().slice(0, 10)) },
      ...years.map((y) => ({ start: y.start, end: y.end as string | null, fy: y.fiscalYear }))];
    for (const fy of starts) {
      // Quarter ends: ends of year-to-date anchor values that began with this fiscal year, plus the year end.
      const ends = new Set<string>();
      for (const key of ANCHORS) for (const s of lines.get(key) ?? []) for (const f of s.byPeriod.values()) {
        if (f.start && near(f.start, fy.start, 7) && days(f.start, f.end) >= 80 && days(f.start, f.end) <= 300 && (!fy.end || t(f.end) < t(fy.end) - 30 * DAY)) {
          if (![...ends].some((e) => near(e, f.end, 10))) ends.add(f.end);
        }
      }
      // A year with no interim report (an annual-only 20-F filer, or a year before the company listed) has no quarters.
      if (!ends.size) continue;
      if (fy.end) ends.add(fy.end);
      const sorted = [...ends].sort();
      const fyRows: Row[] = [];
      sorted.forEach((end, i) => {
        const prev = i ? sorted[i - 1] : null;
        const values: Record<string, number | null> = {};
        let anchor: XbrlFact | undefined;
        for (const l of all) {
          if (l.instant) { const v = lineValue(lines.get(l.key), null, end); values[l.key] = v ? v.val : null; continue; }
          values[l.key] = quarterValue(lines.get(l.key), l, fy.start, prev, end);
          if (!anchor && (ANCHORS as readonly string[]).includes(l.key)) anchor = lineValue(lines.get(l.key), fy.start, end)?.fact ?? lineValue(lines.get(l.key), prev ? plusDay(prev) : fy.start, end)?.fact;
        }
        fyRows.push({ start: prev ? plusDay(prev) : fy.start, end, fiscalYear: fy.fy, fiscalPeriod: `Q${i + 1}`, accn: anchor?.accn ?? "", form: anchor?.form ?? "", filed: anchor?.filed ?? "", values });
      });
      rows.push(...fyRows.reverse());
      if (rows.length >= limit + 4) break;
    }
    rows.sort((a, b) => b.end.localeCompare(a.end));
  }
  if (!rows.length) throw new HttpError(404, period === "quarterly" ? `${facts.entityName} files no quarterly statements (annual reports only); ask for period=annual` : `${facts.entityName} has no annual statements in its XBRL filings`);
  for (const r of rows) for (const key of derive(r.values)) if (r === rows[0] && !used[key]) used[key] = `derived: ${DERIVED_FROM[key]}`;

  const shaped = rows.map((r, i) => {
    const v = r.values;
    const gross = v.grossProfit ?? (v.revenue !== null && v.costOfRevenue !== null ? v.revenue - v.costOfRevenue : null);
    const fcf = v.operatingCashFlow !== null && v.capitalExpenditure !== null ? v.operatingCashFlow - v.capitalExpenditure : null;
    // Growth against the same period a year earlier (the next annual row, or the quarter four places on).
    const yearAgo = rows.slice(i + 1).find((o) => near(o.end, new Date(t(r.end) - 365 * DAY).toISOString().slice(0, 10), 20));
    const growth = (key: string) => (yearAgo ? pct(v[key] !== null && yearAgo.values[key] !== null ? v[key]! - yearAgo.values[key]! : null, yearAgo.values[key] !== null ? Math.abs(yearAgo.values[key]!) : null) : null);
    return {
      fiscalYear: r.fiscalYear, fiscalPeriod: r.fiscalPeriod, start: r.start, end: r.end,
      form: r.form || null, filed: r.filed || null, filingUrl: r.accn ? archiveUrl(facts.cik, r.accn) : null,
      incomeStatement: { revenue: v.revenue, costOfRevenue: v.costOfRevenue, grossProfit: gross, researchAndDevelopment: v.researchAndDevelopment, sellingGeneralAdministrative: v.sellingGeneralAdministrative, operatingIncome: v.operatingIncome, pretaxIncome: v.pretaxIncome, incomeTax: v.incomeTax, netIncome: v.netIncome, epsBasic: v.epsBasic, epsDiluted: v.epsDiluted, dilutedShares: v.dilutedShares },
      balanceSheet: { cash: v.cash, currentAssets: v.currentAssets, totalAssets: v.totalAssets, currentLiabilities: v.currentLiabilities, longTermDebt: v.longTermDebt, totalLiabilities: v.totalLiabilities, shareholdersEquity: v.shareholdersEquity },
      cashFlow: { operatingCashFlow: v.operatingCashFlow, capitalExpenditure: v.capitalExpenditure, freeCashFlow: fcf, dividendsPaid: v.dividendsPaid, shareBuybacks: v.shareBuybacks },
      ratios: {
        grossMarginPct: pct(gross, v.revenue), operatingMarginPct: pct(v.operatingIncome, v.revenue), netMarginPct: pct(v.netIncome, v.revenue),
        revenueGrowthPct: growth("revenue"), netIncomeGrowthPct: growth("netIncome"),
        returnOnEquityPct: r.fiscalPeriod === "FY" ? pct(v.netIncome, v.shareholdersEquity) : null,
        currentRatio: ratio(v.currentAssets, v.currentLiabilities), debtToEquity: ratio(v.longTermDebt, v.shareholdersEquity),
      },
    };
  }).slice(0, limit);

  const shares = facts.facts.dei?.EntityCommonStockSharesOutstanding?.units?.shares;
  const latestShares = shares?.length ? shares.reduce((a, b) => (b.end > a.end ? b : a)) : null;
  return {
    company: facts.entityName, cik: String(facts.cik).padStart(10, "0"), period, currency: currency ?? "USD",
    sharesOutstanding: latestShares ? { value: latestShares.val, asOf: latestShares.end } : null,
    count: shaped.length, periods: shaped, concepts: used,
    note: period === "quarterly" ? "Quarters without a reported three-month value are year-to-date minus the quarter before; per-share figures are null there." : "Fiscal years are named by the year they end in.",
    source: "SEC EDGAR XBRL company facts (public information)",
  };
}

export const SEC_FINANCIALS: Entry[] = [
  entry("/sec/financials", "Company financials: income statement, balance sheet, cash flow",
    "Company financial statements for a US-listed company by ticker or CIK, from its SEC 10-K and 10-Q filings (XBRL): revenue, gross profit, operating and net income, EPS, cash, assets, debt, equity, operating cash flow, capex, free cash flow, dividends and buybacks, with margins, growth, ROE and current ratio. Annual or quarterly, up to 10 periods. Use for fundamentals, a valuation or a company comparison.",
    ["financial-statements", "income-statement", "balance-sheet", "fundamentals", "company-facts", "cash-flow", "sec", "xbrl"], {
      ticker: { type: "string", description: "Stock ticker or company name, e.g. AAPL (or give cik)", example: "AAPL" },
      cik: { type: "string", description: "SEC Central Index Key, e.g. 320193 (instead of ticker)", example: "320193" },
      period: { type: "string", description: "annual (default) or quarterly", enum: ["annual", "quarterly"], example: "annual" },
      limit: { type: "string", description: "Periods to return, newest first: 1-10 (default 4)", example: "4" },
    },
    // A real answer for AAPL (11 Nov 2026, fiscal 2026 10-K filed 3 Nov), one period shown.
    {
      company: "Apple Inc.", cik: "0000320193", period: "annual", currency: "USD", sharesOutstanding: { value: 14532182000, asOf: "2026-10-23" }, count: 1,
      periods: [{
        fiscalYear: 2026, fiscalPeriod: "FY", start: "2025-09-28", end: "2026-09-26", form: "10-K", filed: "2026-11-03", filingUrl: "https://www.sec.gov/Archives/edgar/data/320193/000032019326000026/",
        incomeStatement: { revenue: 478834000000, costOfRevenue: 245232000000, grossProfit: 233602000000, researchAndDevelopment: 45765000000, sellingGeneralAdministrative: 29774000000, operatingIncome: 158063000000, pretaxIncome: 159237000000, incomeTax: 27062000000, netIncome: 132175000000, epsBasic: 9.01, epsDiluted: 8.98, dilutedShares: 14720306000 },
        balanceSheet: { cash: 36305000000, currentAssets: 173857000000, totalAssets: 404548000000, currentLiabilities: 169915000000, longTermDebt: 68208000000, totalLiabilities: 292455000000, shareholdersEquity: 112093000000 },
        cashFlow: { operatingCashFlow: 145097000000, capitalExpenditure: 9041000000, freeCashFlow: 136056000000, dividendsPaid: 15721000000, shareBuybacks: 86390000000 },
        ratios: { grossMarginPct: 48.8, operatingMarginPct: 33, netMarginPct: 27.6, revenueGrowthPct: 15.1, netIncomeGrowthPct: 18, returnOnEquityPct: 117.9, currentRatio: 1.02, debtToEquity: 0.61 },
      }],
      concepts: { revenue: "RevenueFromContractWithCustomerExcludingAssessedTax", costOfRevenue: "CostOfGoodsAndServicesSold", netIncome: "NetIncomeLoss", totalAssets: "Assets", operatingCashFlow: "NetCashProvidedByUsedInOperatingActivities" },
      note: "Fiscal years are named by the year they end in.", source: "SEC EDGAR XBRL company facts (public information)",
    },
    async (_e, q) => {
      const ticker = opt(q, "ticker", 60), cikIn = opt(q, "cik", 12);
      if (!ticker && !cikIn) throw new HttpError(400, "send ticker (e.g. AAPL) or cik (e.g. 320193)");
      const periodIn = (opt(q, "period", 20) ?? "annual").toLowerCase();
      const period = /^(q|quarter|quarterly|10-q)$/.test(periodIn) ? "quarterly" : /^(a|annual|year|yearly|fy|10-k)$/.test(periodIn) ? "annual" : null;
      if (!period) throw new HttpError(400, "period must be annual or quarterly");
      const limit = num(q, "limit", { min: 1, max: 10, fallback: 4, integer: true });
      const cik = await resolveCik(ticker, cikIn);
      const res = await govFetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`, 21_600, "application/json");
      if (res.status === 404) throw new HttpError(404, `the SEC holds no XBRL financial data for CIK ${Number(cik)}`);
      let facts: CompanyFacts;
      try { facts = (await res.json()) as CompanyFacts; } catch { throw new HttpError(502, "the SEC's company facts file could not be read; try again"); }
      return financials(facts, { period, limit });
    }, "$0.02"),
];
