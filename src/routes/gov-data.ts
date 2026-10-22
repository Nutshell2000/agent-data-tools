// US government public-domain data with proven buyer demand: SEC EDGAR filings and FAA airport status.
// SEC: "Information presented on sec.gov is considered public information and may be copied or further distributed"
// (sec.gov/privacy); fair access asks for at most 10 requests/s and a User-Agent naming a contact. FAA: a US federal
// work (17 U.S.C. §105).
import { entry, need, num, opt, type Entry } from "../family";
import { HttpError } from "../lib/env";

const SEC_UA = "AgentDataTools/1.0 (spellz111122@gmail.com)";

/** GET from a government source with edge caching; failures and refusals are 502, never charged. */
async function govFetch(url: string, cacheTtl: number, accept: string): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, { headers: { "user-agent": SEC_UA, accept }, signal: AbortSignal.timeout(8000), cf: { cacheTtl, cacheEverything: true } });
  } catch {
    throw new HttpError(502, "the government data source did not answer in time; try again");
  }
  if (res.status === 404) return res;
  if (!res.ok) throw new HttpError(502, `the government data source answered HTTP ${res.status}; try again`);
  return res;
}

type TickerMap = Record<string, { cik_str: number; ticker: string; title: string }>;

/** The CIK for a ticker or a CIK given directly. */
async function resolveCik(ticker?: string, cik?: string): Promise<string> {
  if (cik) {
    if (!/^\d{1,10}$/.test(cik)) throw new HttpError(400, "cik must be the SEC's numeric company id, e.g. 320193");
    return cik.padStart(10, "0");
  }
  const symbol = (ticker ?? "").toUpperCase();
  if (!/^[A-Z0-9.\-]{1,10}$/.test(symbol)) throw new HttpError(400, "ticker must be a stock ticker such as AAPL (or pass cik)");
  const map = (await (await govFetch("https://www.sec.gov/files/company_tickers.json", 86_400, "application/json")).json()) as TickerMap;
  const hit = Object.values(map).find((c) => c.ticker.toUpperCase() === symbol);
  if (!hit) throw new HttpError(404, `no SEC-registered company with ticker ${symbol}`);
  return String(hit.cik_str).padStart(10, "0");
}

/** Text of one XML element, or null. */
const tag = (xml: string, name: string) => xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`))?.[1]?.trim() ?? null;
const all = (xml: string, name: string) => [...xml.matchAll(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "g"))].map((m) => m[1]);
const attr = (xml: string, name: string, key: string) => xml.match(new RegExp(`<${name}[^>]*\\b${key}="([^"]*)"`))?.[1] ?? null;

export const GOV_DATA: Entry[] = [
  entry("/sec/filings", "SEC filings (EDGAR) by ticker: 10-K, 10-Q, 8-K and Form 4 for a US public company",
    "Latest SEC EDGAR filings for a US-listed company by stock ticker or CIK: form (10-K, 10-Q, 8-K, 4, S-1…), filing and report dates, accession number, document description and a direct link, newest first, optionally only one form type. Plus company name, CIK and industry (SIC). Public SEC data. Use to check a company's latest annual or quarterly report, insider trades (form 4) or material events (8-K).",
    ["sec", "edgar", "filings", "stocks", "company", "compliance"], {
      ticker: { type: "string", description: "Stock ticker such as AAPL (or give cik)", example: "AAPL" },
      cik: { type: "string", description: "SEC Central Index Key, e.g. 320193 (instead of ticker)", example: "320193" },
      form: { type: "string", description: "Only this form type, e.g. 10-K, 10-Q, 8-K or 4 (default: all)", example: "10-K" },
      limit: { type: "integer", description: "Filings to return, 1-50 (default 10)", example: 10 },
    },
    {
      company: "Apple Inc.", cik: "0000320193", tickers: ["AAPL"], sic: "3571", industry: "Electronic Computers", count: 1,
      filings: [{ form: "10-K", filed: "2025-10-31", reportDate: "2025-09-27", accession: "0000320193-25-000079", description: "10-K", url: "https://www.sec.gov/Archives/edgar/data/320193/000032019325000079/aapl-20250927.htm" }],
      source: "SEC EDGAR (public information)",
    },
    async (_e, q) => {
      const ticker = opt(q, "ticker", 12), cikInput = opt(q, "cik", 12);
      if (!ticker && !cikInput) throw new HttpError(400, "send ticker (e.g. AAPL) or cik (e.g. 320193)");
      const form = opt(q, "form", 12)?.toUpperCase();
      const limit = num(q, "limit", { min: 1, max: 50, fallback: 10, integer: true });
      const cik = await resolveCik(ticker, cikInput);
      const res = await govFetch(`https://data.sec.gov/submissions/CIK${cik}.json`, 600, "application/json");
      if (res.status === 404) throw new HttpError(404, `no SEC filer with CIK ${Number(cik)}`);
      const s = (await res.json()) as { name: string; cik: string; tickers: string[]; sic: string; sicDescription: string; filings: { recent: Record<string, string[]> } };
      const r = s.filings.recent;
      const rows = (r.form ?? []).map((f, i) => ({ f, i })).filter(({ f }) => !form || f.toUpperCase() === form).slice(0, limit);
      const plainCik = String(Number(cik));
      return {
        company: s.name, cik, tickers: s.tickers ?? [], sic: s.sic ?? null, industry: s.sicDescription ?? null, count: rows.length,
        filings: rows.map(({ f, i }) => ({
          form: f, filed: r.filingDate?.[i] ?? null, reportDate: r.reportDate?.[i] || null, accession: r.accessionNumber?.[i] ?? null,
          description: r.primaryDocDescription?.[i] || null,
          url: r.accessionNumber?.[i] && r.primaryDocument?.[i] ? `https://www.sec.gov/Archives/edgar/data/${plainCik}/${r.accessionNumber[i].replaceAll("-", "")}/${r.primaryDocument[i]}` : null,
        })),
        source: "SEC EDGAR (public information)",
      };
    }),

  entry("/airport/status", "US airport delays, ground stops and closures",
    "Live FAA National Airspace System status for US airports: ground stops, ground delay programs, arrival and departure delays (with minimum, maximum and trend) and closures, each with its reason. Give an IATA code such as LGA for one airport (normal when nothing is reported), or nothing for the whole country. Public FAA data, refreshed about every minute. Use before travel planning, logistics or customer notices.",
    ["airport", "flights", "travel", "delays", "faa", "data"], {
      airport: { type: "string", description: "IATA airport code such as LGA, SFO or ORD (default: all US airports with events)", example: "LGA" },
    },
    {
      updated: "Tue Oct 20 18:52:24 2026 GMT", airport: "LGA", status: "delayed",
      groundStops: [{ airport: "LGA", reason: "airport volume", endTime: "7:45 pm EDT" }],
      groundDelays: [{ airport: "LGA", reason: "weather", average: "30 minutes", maximum: "54 minutes" }],
      delays: [{ airport: "LGA", type: "Departure", reason: "volume", minimum: "16 minutes", maximum: "30 minutes", trend: "Increasing" }],
      closures: [], source: "FAA National Airspace System Status",
    },
    async (_e, q) => {
      const code = opt(q, "airport", 4)?.toUpperCase();
      if (code && !/^[A-Z0-9]{3,4}$/.test(code)) throw new HttpError(400, "airport must be a 3-letter IATA code such as LGA");
      const xml = await (await govFetch("https://nasstatus.faa.gov/api/airport-status-information", 60, "application/xml")).text();
      const groups = all(xml, "Delay_type");
      const items = (list: string, item: string) => groups.flatMap((g) => all(g, list).flatMap((l) => all(l, item)));
      const mine = <T extends { airport: string | null }>(rows: T[]) => (code ? rows.filter((r) => r.airport === code) : rows);
      const groundStops = mine(items("Ground_Stop_List", "Program").map((p) => ({ airport: tag(p, "ARPT"), reason: tag(p, "Reason"), endTime: tag(p, "End_Time") })));
      const groundDelays = mine(items("Ground_Delay_List", "Ground_Delay").map((p) => ({ airport: tag(p, "ARPT"), reason: tag(p, "Reason"), average: tag(p, "Avg"), maximum: tag(p, "Max") })));
      // One <Delay> per airport, with an <Arrival_Departure Type="Arrival|Departure"> block per direction.
      const delays = mine(items("Arrival_Departure_Delay_List", "Delay").flatMap((d) =>
        [...d.matchAll(/<Arrival_Departure\b[^>]*>[\s\S]*?<\/Arrival_Departure>/g)].map(([block]) => ({
          airport: tag(d, "ARPT"), type: attr(block, "Arrival_Departure", "Type"), reason: tag(d, "Reason"),
          minimum: tag(block, "Min"), maximum: tag(block, "Max"), trend: tag(block, "Trend"),
        }))));
      const closures = mine(items("Airport_Closure_List", "Airport").map((p) => ({ airport: tag(p, "ARPT"), reason: tag(p, "Reason"), start: tag(p, "Start"), reopen: tag(p, "Reopen") })));
      const events = groundStops.length + groundDelays.length + delays.length + closures.length;
      return {
        updated: tag(xml, "Update_Time"), airport: code ?? null,
        status: events === 0 ? "normal" : groundStops.length ? "ground stop" : closures.length && !groundDelays.length && !delays.length ? "closure notice" : "delayed",
        groundStops, groundDelays, delays, closures, source: "FAA National Airspace System Status",
      };
    }),
];
