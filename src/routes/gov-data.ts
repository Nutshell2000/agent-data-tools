// US government public-domain data with proven buyer demand: SEC EDGAR filings and FAA airport status.
// SEC: "Information presented on sec.gov is considered public information and may be copied or further distributed"
// (sec.gov/privacy); fair access asks for at most 10 requests/s and a User-Agent naming a contact. FAA: a US federal
// work (17 U.S.C. §105).
import { entry, need, num, opt, type Entry } from "../family";
import { HttpError } from "../lib/env";

export const SEC_UA = "AgentDataTools/1.0 (spellz111122@gmail.com)";

/** GET from a government source with edge caching; failures and refusals are 502, never charged. */
export async function govFetch(url: string, cacheTtl: number, accept: string): Promise<Response> {
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
/**
 * The SEC entry for a ticker ("AAPL", "brk.b" as SEC's "BRK-B") or a company name ("Apple", "Berkshire Hathaway"): the
 * ticker first, then the title that starts with the words, then any title containing them (24 Oct 2026: "Apple" was 404).
 */
export function secCompanyMatch<T extends { ticker: string; title: string }>(entries: T[], query: string): T | undefined {
  const symbol = query.trim().toUpperCase().replace(/\./g, "-");
  const byTicker = entries.find((c) => c.ticker.toUpperCase() === symbol);
  if (byTicker) return byTicker;
  const words = query.trim().toLowerCase().replace(/[.,&']/g, " ").split(/\s+/).filter(Boolean);
  if (!words.length) return undefined;
  const norm = (t: string) => t.toLowerCase().replace(/[.,&']/g, " ").replace(/\s+/g, " ").trim();
  const starts = entries.filter((c) => norm(c.title).startsWith(words.join(" ")));
  const pool = starts.length ? starts : entries.filter((c) => words.every((w) => norm(c.title).includes(w)));
  // The SEC lists companies roughly by market size, so the first match is the one most people mean.
  return pool[0];
}

/** The CIK for a ticker or a CIK given directly. */
export async function resolveCik(ticker?: string, cik?: string): Promise<string> {
  if (cik) {
    if (!/^\d{1,10}$/.test(cik)) throw new HttpError(400, "cik must be the SEC's numeric company id, e.g. 320193");
    return cik.padStart(10, "0");
  }
  const query = (ticker ?? "").trim();
  if (!/^[A-Za-z0-9 .,&'\-]{1,60}$/.test(query)) throw new HttpError(400, "ticker must be a stock ticker such as AAPL or a company name (or pass cik)");
  const map = (await (await govFetch("https://www.sec.gov/files/company_tickers.json", 86_400, "application/json")).json()) as TickerMap;
  const hit = secCompanyMatch(Object.values(map), query);
  if (!hit) throw new HttpError(404, `no SEC-registered company with ticker or name ${query.toUpperCase()}`);
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
      const ticker = opt(q, "ticker", 60), cikInput = opt(q, "cik", 12);
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

  entry("/airport/status", "Airport delays, US ground stops and closures",
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
      // A US ICAO code is K plus the IATA code (KJFK is JFK); FAA's feed names airports by IATA code.
      const code = opt(q, "airport", 40)?.trim().toUpperCase().replace(/^K([A-Z]{3})$/, "$1");
      if (code && !/^[A-Z0-9]{3,4}$/.test(code)) throw new HttpError(400, `airport must be a 3-letter IATA code such as LGA, not "${code.slice(0, 20)}"`);
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
