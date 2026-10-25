// More US government public-domain data (1.78.0, 25 Oct 2026). On the Bazaar the same feeds sell repeatedly at $0.005
// (Federal Register 1,309 calls from 8 payers in 30 days, ClinicalTrials.gov 1,294 from 6, fund holdings 1,217 from 10), and
// the searches "8-k" (55 payers summed over the top 20), "insider trading" (47), "clinical trials" (47), "etf holdings" (42),
// "federal register" (41) and "13f" (38) had nothing of ours. Sources: SEC EDGAR ("public information and may be copied or
// further distributed", sec.gov/privacy; fair access: under 10 requests/s, a User-Agent with a contact), the Federal
// Register API (federalregister.gov, US government work, no key) and the ClinicalTrials.gov API v2 (NLM, no key).
import { entry, need, num, opt, type Entry } from "../family";
import { HttpError } from "../lib/env";
import { govFetch, resolveCik } from "./gov-data";

const tag = (xml: string, name: string) => xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`))?.[1]?.trim() ?? null;
const all = (xml: string, name: string) => [...xml.matchAll(new RegExp(`<(?:\\w+:)?${name}[^>]*>([\\s\\S]*?)</(?:\\w+:)?${name}>`, "g"))].map((m) => m[1]);
const val = (xml: string, name: string) => { const t = tag(xml, name); return t === null ? null : (tag(t, "value") ?? t).trim(); };
const ntag = (xml: string, name: string) => xml.match(new RegExp(`<(?:\\w+:)?${name}[^>]*>([\\s\\S]*?)</(?:\\w+:)?${name}>`))?.[1]?.trim() ?? null;

/** Form 8-K item codes and their titles (SEC Form 8-K General Instructions). */
export const ITEMS_8K: Readonly<Record<string, string>> = {
  "1.01": "Entry into a material definitive agreement", "1.02": "Termination of a material definitive agreement", "1.03": "Bankruptcy or receivership", "1.04": "Mine safety",
  "1.05": "Material cybersecurity incident", "2.01": "Completion of acquisition or disposition of assets", "2.02": "Results of operations and financial condition", "2.03": "Creation of a direct financial obligation",
  "2.04": "Triggering events that accelerate a financial obligation", "2.05": "Costs of exit or disposal activities", "2.06": "Material impairments", "3.01": "Notice of delisting or failure to meet listing standards",
  "3.02": "Unregistered sales of equity securities", "3.03": "Material modification to rights of security holders", "4.01": "Change in certifying accountant", "4.02": "Non-reliance on previously issued financial statements",
  "5.01": "Change in control", "5.02": "Departure or appointment of directors or officers; compensation", "5.03": "Amendments to articles or bylaws; change in fiscal year", "5.04": "Suspension of trading under employee benefit plans",
  "5.05": "Amendments to the code of ethics", "5.06": "Change in shell company status", "5.07": "Submission of matters to a vote of security holders", "5.08": "Shareholder director nominations",
  "6.01": "ABS informational and computational material", "7.01": "Regulation FD disclosure", "8.01": "Other events", "9.01": "Financial statements and exhibits",
};

type Submissions = { name: string; tickers?: string[]; filings: { recent: Record<string, string[]> } };
async function submissions(cik: string): Promise<Submissions> {
  const res = await govFetch(`https://data.sec.gov/submissions/CIK${cik}.json`, 600, "application/json");
  if (res.status === 404) throw new HttpError(404, `no SEC filer with CIK ${Number(cik)}`);
  return (await res.json()) as Submissions;
}
const archive = (cik: string, accession: string) => `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accession.replaceAll("-", "")}`;
const company = (q: (n: string) => string | undefined) => {
  const ticker = opt(q, "ticker", 60), cik = opt(q, "cik", 12);
  if (!ticker && !cik) throw new HttpError(400, "send ticker (e.g. AAPL) or cik (e.g. 320193)");
  return resolveCik(ticker, cik);
};

/** Form 4 XML as plain transactions: who, role, code, shares, price, after-trade holding. */
export function parseForm4(xml: string) {
  const owner = ntag(xml, "rptOwnerName");
  const rel = ntag(xml, "reportingOwnerRelationship") ?? "";
  const role = [ntag(rel, "isDirector") === "true" || ntag(rel, "isDirector") === "1" ? "director" : null, ntag(rel, "officerTitle"), ntag(rel, "isTenPercentOwner") === "true" || ntag(rel, "isTenPercentOwner") === "1" ? "10% owner" : null].filter(Boolean).join(", ") || null;
  const CODES: Record<string, string> = { P: "open-market purchase", S: "open-market sale", A: "grant or award", M: "option exercise", F: "tax withholding", G: "gift", D: "disposition to the issuer", C: "conversion", X: "option exercise", J: "other" };
  const rows = all(xml, "nonDerivativeTransaction").map((t) => {
    const code = val(t, "transactionCode") ?? ntag(t, "transactionCode");
    const shares = Number(val(t, "transactionShares")), price = Number(val(t, "transactionPricePerShare"));
    return {
      date: val(t, "transactionDate"), security: val(t, "securityTitle"), code, meaning: code ? CODES[code] ?? null : null,
      acquiredOrDisposed: val(t, "transactionAcquiredDisposedCode") === "A" ? "acquired" : "disposed",
      shares: Number.isFinite(shares) ? shares : null, price: Number.isFinite(price) && price > 0 ? price : null,
      valueUsd: Number.isFinite(shares) && Number.isFinite(price) && price > 0 ? Math.round(shares * price) : null,
      sharesOwnedAfter: Number(val(t, "sharesOwnedFollowingTransaction")) || null,
    };
  });
  return { insider: owner, role, plan10b5_1: /<aff10b5One>\s*(true|1)\s*<\/aff10b5One>/.test(xml), transactions: rows };
}

/** 13F information table rows, summed by issuer and class, largest first. */
export function parse13F(xml: string) {
  const byKey = new Map<string, { issuer: string; class: string; cusip: string; valueUsd: number; shares: number; putCall: string | null }>();
  for (const row of all(xml, "infoTable")) {
    const issuer = ntag(row, "nameOfIssuer") ?? "?", cls = ntag(row, "titleOfClass") ?? "", cusip = ntag(row, "cusip") ?? "", putCall = ntag(row, "putCall");
    const key = `${cusip}|${putCall ?? ""}`;
    const value = Number(ntag(row, "value") ?? 0), shares = Number(ntag(ntag(row, "shrsOrPrnAmt") ?? "", "sshPrnamt") ?? 0);
    const cur = byKey.get(key) ?? { issuer, class: cls, cusip, valueUsd: 0, shares: 0, putCall: putCall ?? null };
    cur.valueUsd += Number.isFinite(value) ? value : 0;
    cur.shares += Number.isFinite(shares) ? shares : 0;
    byKey.set(key, cur);
  }
  const rows = [...byKey.values()].sort((a, b) => b.valueUsd - a.valueUsd);
  const total = rows.reduce((s, r) => s + r.valueUsd, 0);
  return { positions: rows.length, totalValueUsd: total, holdings: rows.map((r) => ({ ...r, weightPct: total ? Math.round((r.valueUsd / total) * 10000) / 100 : null })) };
}

/** A fund manager's CIK from a name through EDGAR's company search (13F filers are mostly not in the ticker list). */
async function filerCik(name: string): Promise<string> {
  if (!/^[A-Za-z0-9 .,&'\-]{2,80}$/.test(name)) throw new HttpError(400, "filer must be a fund manager's name such as Berkshire Hathaway (or pass cik)");
  const url = `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&company=${encodeURIComponent(name)}&type=13F-HR&dateb=&owner=include&count=10&output=atom`;
  const res = await govFetch(url, 86_400, "application/atom+xml");
  const xml = await res.text();
  const cik = xml.match(/<cik>(\d+)<\/cik>/)?.[1] ?? xml.match(/CIK=(\d{4,10})/)?.[1];
  if (!cik) throw new HttpError(404, `no 13F filer named like "${name}"; pass its cik`);
  return cik.padStart(10, "0");
}

export const GOV_MORE: Entry[] = [
  entry("/sec/8k", "8-K filings, SEC material events: by company",
    "Latest Form 8-K current reports for a US-listed company by ticker, name or CIK: filing date, the reported items with their meaning (results of operations, executive departures, material agreements, cybersecurity incidents, bankruptcy and others), accession number and a direct link, newest first. Public SEC EDGAR data. Use to watch a company's material events or check what it disclosed recently.",
    ["8-k", "sec-8k", "material-events", "sec-filings", "edgar"], {
      ticker: { type: "string", description: "Stock ticker or company name, e.g. AAPL (or give cik)", example: "AAPL" },
      cik: { type: "string", description: "SEC Central Index Key, e.g. 320193 (instead of ticker)", example: "320193" },
      limit: { type: "string", description: "Filings to return, 1-40 (default 10)", example: "10" },
    },
    { company: "Apple Inc.", cik: "0000320193", count: 1, filings: [{ filed: "2026-10-30", items: [{ code: "2.02", title: "Results of operations and financial condition" }, { code: "9.01", title: "Financial statements and exhibits" }], accession: "0000320193-26-000101", url: "https://www.sec.gov/Archives/edgar/data/320193/000032019326000101/aapl-20261030.htm" }], source: "SEC EDGAR (public information)" },
    async (_e, q) => {
      const cik = await company(q);
      const limit = num(q, "limit", { min: 1, max: 40, fallback: 10, integer: true });
      const s = await submissions(cik);
      const r = s.filings.recent;
      const rows = (r.form ?? []).map((f, i) => ({ f, i })).filter(({ f }) => f === "8-K" || f === "8-K/A").slice(0, limit);
      return {
        company: s.name, cik, count: rows.length,
        filings: rows.map(({ f, i }) => ({
          form: f, filed: r.filingDate?.[i] ?? null,
          items: (r.items?.[i] ?? "").split(",").map((c) => c.trim()).filter(Boolean).map((code) => ({ code, title: ITEMS_8K[code] ?? null })),
          accession: r.accessionNumber?.[i] ?? null,
          url: r.accessionNumber?.[i] && r.primaryDocument?.[i] ? `${archive(cik, r.accessionNumber[i])}/${r.primaryDocument[i]}` : null,
        })),
        source: "SEC EDGAR (public information)",
      };
    }),

  entry("/sec/insider", "Insider trading, SEC Form 4: trades by company",
    "Recent insider trades in a US-listed company from its SEC Form 4 filings: who traded (name and role: director, officer title, 10% owner), date, buy or sell (open-market purchase, sale, award, option exercise, tax withholding), shares, price, dollar value, holding afterwards and whether it was under a 10b5-1 plan. Up to 10 filings, newest first. Public SEC EDGAR data. Use to see whether insiders are buying or selling.",
    ["insider-trading", "form-4", "insider-trades", "sec-filings", "edgar"], {
      ticker: { type: "string", description: "Stock ticker or company name, e.g. AAPL (or give cik)", example: "AAPL" },
      cik: { type: "string", description: "SEC Central Index Key of the company (instead of ticker)", example: "320193" },
      limit: { type: "string", description: "Form 4 filings to read, 1-10 (default 5)", example: "5" },
    },
    { company: "Apple Inc.", cik: "0000320193", count: 1, filings: [{ filed: "2026-10-22", insider: "Newstead Jennifer", role: "SVP, GC and Government Affairs", plan10b5_1: true, transactions: [{ date: "2026-10-20", security: "Common Stock", code: "S", meaning: "open-market sale", acquiredOrDisposed: "disposed", shares: 10000, price: 252.1, valueUsd: 2521000, sharesOwnedAfter: 85000 }], url: "https://www.sec.gov/Archives/edgar/data/320193/000114036126040540/form4.xml" }], summary: { buys: 0, sells: 1, buyValueUsd: 0, sellValueUsd: 2521000 }, source: "SEC EDGAR (public information)" },
    async (_e, q) => {
      const cik = await company(q);
      const limit = num(q, "limit", { min: 1, max: 10, fallback: 5, integer: true });
      const s = await submissions(cik);
      const r = s.filings.recent;
      const rows = (r.form ?? []).map((f, i) => ({ f, i })).filter(({ f }) => f === "4").slice(0, limit);
      // The primary document is the styled copy (xslF345X06/form4.xml); the raw XML has the same name one folder up.
      const filings = await Promise.all(rows.map(async ({ i }) => {
        const url = `${archive(cik, r.accessionNumber[i])}/${(r.primaryDocument[i] ?? "").replace(/^xsl[^/]+\//, "")}`;
        try {
          const res = await govFetch(url, 86_400, "application/xml");
          if (!res.ok) return null;
          return { filed: r.filingDate?.[i] ?? null, ...parseForm4(await res.text()), url };
        } catch { return null; }
      }));
      const got = filings.filter((f): f is NonNullable<typeof f> => f !== null);
      if (rows.length && !got.length) throw new HttpError(502, "the SEC did not return the Form 4 documents; try again");
      const tx = got.flatMap((f) => f.transactions);
      return {
        company: s.name, cik, count: got.length, filings: got,
        summary: { buys: tx.filter((t) => t.code === "P").length, sells: tx.filter((t) => t.code === "S").length, buyValueUsd: tx.filter((t) => t.code === "P").reduce((a, t) => a + (t.valueUsd ?? 0), 0), sellValueUsd: tx.filter((t) => t.code === "S").reduce((a, t) => a + (t.valueUsd ?? 0), 0) },
        source: "SEC EDGAR (public information)",
      };
    }),

  entry("/sec/13f", "13F holdings, fund holdings: what an institution owns",
    "The latest 13F-HR holdings of an institutional investment manager (hedge fund, mutual fund family, bank) from SEC EDGAR: each position's issuer, class, CUSIP, value in USD, shares and portfolio weight, largest first, plus the report period, total value and position count. Give the filer by name (e.g. Berkshire Hathaway) or CIK. Public SEC data, filed quarterly up to 45 days after the quarter. Use to see what a fund owns.",
    ["13f", "fund-holdings", "etf-holdings", "institutional-holdings", "sec-filings"], {
      filer: { type: "string", description: "Fund manager's name, e.g. Berkshire Hathaway (or give cik)", example: "Berkshire Hathaway" },
      cik: { type: "string", description: "The filer's SEC CIK, e.g. 1067983 (instead of filer)", example: "1067983" },
      limit: { type: "string", description: "Positions to return, 1-200 (default 25)", example: "25" },
    },
    { filer: "BERKSHIRE HATHAWAY INC", cik: "0001067983", form: "13F-HR", filed: "2026-08-14", period: "2026-06-30", positions: 41, totalValueUsd: 257500000000, holdings: [{ issuer: "APPLE INC", class: "COM", cusip: "037833100", valueUsd: 57400000000, shares: 280000000, putCall: null, weightPct: 22.29 }], url: "https://www.sec.gov/Archives/edgar/data/1067983/000119312526352200/", source: "SEC EDGAR (public information)" },
    async (_e, q) => {
      const cikIn = opt(q, "cik", 12), name = opt(q, "filer", 80);
      if (!cikIn && !name) throw new HttpError(400, "send filer (e.g. Berkshire Hathaway) or cik (e.g. 1067983)");
      const cik = cikIn ? await resolveCik(undefined, cikIn) : await filerCik(name!);
      const limit = num(q, "limit", { min: 1, max: 200, fallback: 25, integer: true });
      const s = await submissions(cik);
      const r = s.filings.recent;
      const i = (r.form ?? []).findIndex((f) => f === "13F-HR" || f === "13F-HR/A");
      if (i < 0) throw new HttpError(404, `${s.name} has no recent 13F-HR filing`);
      const base = archive(cik, r.accessionNumber[i]);
      const index = (await (await govFetch(`${base}/index.json`, 86_400, "application/json")).json()) as { directory?: { item?: { name: string }[] } };
      const table = (index.directory?.item ?? []).map((x) => x.name).find((n) => /\.xml$/i.test(n) && !/primary_doc/i.test(n));
      if (!table) throw new HttpError(502, "the 13F filing has no information table the SEC returned; try again");
      const parsed = parse13F(await (await govFetch(`${base}/${table}`, 86_400, "application/xml")).text());
      return { filer: s.name, cik, form: r.form[i], filed: r.filingDate?.[i] ?? null, period: r.reportDate?.[i] || null, positions: parsed.positions, totalValueUsd: parsed.totalValueUsd, holdings: parsed.holdings.slice(0, limit), url: `${base}/`, source: "SEC EDGAR (public information)" };
    }),

  entry("/gov/federal-register", "Federal Register search: US rules and notices",
    "Search the US Federal Register: final rules, proposed rules, notices and presidential documents, newest first, with title, type, agencies, abstract, publication date, comment deadline, effective date and links. Filter by type and agency. From the Federal Register API (US government work). Use to track new regulations or open comment periods on a topic.",
    ["federal-register", "regulations", "rulemaking", "government", "compliance"], {
      q: { type: "string", description: "Search words, e.g. artificial intelligence", required: true, example: "artificial intelligence" },
      type: { type: "string", description: "rule, proposed_rule, notice or presidential (default all)", example: "rule" },
      agency: { type: "string", description: "Agency slug, e.g. securities-and-exchange-commission (optional)", example: "securities-and-exchange-commission" },
      limit: { type: "string", description: "Documents to return, 1-20 (default 10)", example: "10" },
    },
    { query: "artificial intelligence", total: 1605, count: 1, documents: [{ title: "Outbound Investment Security Program Regulations", type: "Rule", agencies: ["Treasury Department"], abstract: "…", published: "2026-10-24", commentsClose: null, effective: "2026-11-24", documentNumber: "2026-21001", url: "https://www.federalregister.gov/documents/2026/10/24/2026-21001/…", pdf: "https://www.govinfo.gov/…" }], source: "Federal Register API (federalregister.gov)" },
    async (_e, q) => {
      const term = need(q, "q", 200);
      const TYPES: Record<string, string> = { rule: "RULE", proposed_rule: "PRORULE", proposed: "PRORULE", notice: "NOTICE", presidential: "PRESDOCU" };
      const typeIn = opt(q, "type", 20)?.toLowerCase();
      if (typeIn && !Object.hasOwn(TYPES, typeIn)) throw new HttpError(400, "type must be rule, proposed_rule, notice or presidential");
      const agency = opt(q, "agency", 80);
      if (agency && !/^[a-z0-9-]{2,80}$/.test(agency)) throw new HttpError(400, "agency must be a Federal Register agency slug such as environmental-protection-agency");
      const limit = num(q, "limit", { min: 1, max: 20, fallback: 10, integer: true });
      const u = new URL("https://www.federalregister.gov/api/v1/documents.json");
      u.searchParams.set("conditions[term]", term);
      u.searchParams.set("per_page", String(limit));
      u.searchParams.set("order", "newest");
      if (typeIn) u.searchParams.append("conditions[type][]", TYPES[typeIn]);
      if (agency) u.searchParams.append("conditions[agencies][]", agency);
      for (const f of ["title", "type", "abstract", "document_number", "html_url", "pdf_url", "publication_date", "agencies", "comments_close_on", "effective_on"]) u.searchParams.append("fields[]", f);
      const j = (await (await govFetch(u.href, 900, "application/json")).json()) as { count?: number; results?: { title: string; type: string; abstract: string | null; document_number: string; html_url: string; pdf_url: string | null; publication_date: string; agencies?: { name?: string; raw_name?: string }[]; comments_close_on: string | null; effective_on: string | null }[] };
      const docs = (j.results ?? []).map((d) => ({ title: d.title, type: d.type, agencies: (d.agencies ?? []).map((a) => a.name ?? a.raw_name).filter(Boolean), abstract: d.abstract ? d.abstract.slice(0, 600) : null, published: d.publication_date, commentsClose: d.comments_close_on, effective: d.effective_on, documentNumber: d.document_number, url: d.html_url, pdf: d.pdf_url }));
      return { query: term, total: j.count ?? docs.length, count: docs.length, documents: docs, source: "Federal Register API (federalregister.gov)" };
    }),

  entry("/gov/clinical-trials", "Clinical trials search: ClinicalTrials.gov studies",
    "Search ClinicalTrials.gov studies by condition, intervention or any words, optionally only recruiting ones: NCT id, title, status, phase, conditions, interventions, sponsor, enrollment, start and completion dates, number of locations and countries, and a link. From the ClinicalTrials.gov API (US National Library of Medicine). Information only, not medical advice. Use to find trials for a condition or drug.",
    ["clinical-trials", "clinicaltrials-gov", "trials", "medical-research", "health"], {
      condition: { type: "string", description: "Condition or disease, e.g. type 1 diabetes", example: "type 1 diabetes" },
      intervention: { type: "string", description: "Drug or intervention, e.g. semaglutide (optional)", example: "semaglutide" },
      q: { type: "string", description: "Any other words (optional)", example: "insulin pump" },
      status: { type: "string", description: "recruiting, active, completed or all (default recruiting)", example: "recruiting" },
      limit: { type: "string", description: "Studies to return, 1-20 (default 10)", example: "10" },
    },
    { total: 412, count: 1, studies: [{ nctId: "NCT07154251", title: "Utilizing Community Health Workers as Diabetes Technology Coaches…", status: "RECRUITING", phase: ["NA"], conditions: ["Type 1 Diabetes"], interventions: ["Behavioral: CHW coaching"], sponsor: "University of …", enrollment: 60, start: "2026-01", completion: "2027-12", locations: 1, countries: ["United States"], url: "https://clinicaltrials.gov/study/NCT07154251" }], source: "ClinicalTrials.gov API (U.S. National Library of Medicine)", note: "Information only, not medical advice." },
    async (_e, q) => {
      const condition = opt(q, "condition", 120), intervention = opt(q, "intervention", 120), term = opt(q, "q", 200);
      if (!condition && !intervention && !term) throw new HttpError(400, "send condition, intervention or q");
      const STATUS: Record<string, string | null> = { recruiting: "RECRUITING", active: "ACTIVE_NOT_RECRUITING", completed: "COMPLETED", all: null };
      const statusIn = (opt(q, "status", 20) ?? "recruiting").toLowerCase();
      if (!Object.hasOwn(STATUS, statusIn)) throw new HttpError(400, "status must be recruiting, active, completed or all");
      const limit = num(q, "limit", { min: 1, max: 20, fallback: 10, integer: true });
      const u = new URL("https://clinicaltrials.gov/api/v2/studies");
      if (condition) u.searchParams.set("query.cond", condition);
      if (intervention) u.searchParams.set("query.intr", intervention);
      if (term) u.searchParams.set("query.term", term);
      if (STATUS[statusIn]) u.searchParams.set("filter.overallStatus", STATUS[statusIn]!);
      u.searchParams.set("pageSize", String(limit));
      u.searchParams.set("countTotal", "true");
      type Study = { protocolSection?: Record<string, Record<string, unknown>> };
      const j = (await (await govFetch(u.href, 900, "application/json")).json()) as { totalCount?: number; studies?: Study[] };
      const studies = (j.studies ?? []).map(({ protocolSection: p = {} }) => {
        const id = p.identificationModule ?? {}, st = p.statusModule ?? {}, design = p.designModule ?? {}, cond = p.conditionsModule ?? {}, arms = p.armsInterventionsModule ?? {}, spons = p.sponsorCollaboratorsModule ?? {}, loc = p.contactsLocationsModule ?? {};
        const locations = (loc.locations as { country?: string }[] | undefined) ?? [];
        return {
          nctId: id.nctId as string, title: (id.briefTitle as string) ?? null, status: (st.overallStatus as string) ?? null, phase: (design.phases as string[]) ?? [],
          conditions: (cond.conditions as string[]) ?? [], interventions: ((arms.interventions as { type?: string; name?: string }[]) ?? []).map((x) => `${x.type ? `${x.type[0]}${x.type.slice(1).toLowerCase()}: ` : ""}${x.name ?? ""}`).slice(0, 10),
          sponsor: (spons.leadSponsor as { name?: string } | undefined)?.name ?? null, enrollment: (design.enrollmentInfo as { count?: number } | undefined)?.count ?? null,
          start: (st.startDateStruct as { date?: string } | undefined)?.date ?? null, completion: (st.completionDateStruct as { date?: string } | undefined)?.date ?? null,
          locations: locations.length, countries: [...new Set(locations.map((l) => l.country).filter(Boolean))].slice(0, 10), url: `https://clinicaltrials.gov/study/${id.nctId}`,
        };
      });
      return { total: j.totalCount ?? studies.length, count: studies.length, studies, source: "ClinicalTrials.gov API (U.S. National Library of Medicine)", note: "Information only, not medical advice." };
    }),
];

