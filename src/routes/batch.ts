// Batch doors (18 Nov 2026, owner: "batch tool-call sales are the prime focus"). Measured 4-18 Nov: the open batch market on Base
// is ~$11k a month from ~300 payers; 90% are integration buyers who wire ONE seller in and send it a list. A list of 460 links
// costs 460 round trips and 460 settlements on the single tools. These two tools take the list in one call and one payment,
// run the same code as /phishing/check and /pack/url-safety per item, and answer per item: one bad item never fails the rest.
// The prices are the common one cent, so the Bazaar sweeper pays each once and lists them (it pays nothing above $0.01).
import { entry, need, type Entry, type Input } from "../family";
import { HttpError, type Env } from "../lib/env";
import { PHISHING_SOURCES } from "../lib/phishing-list";
import { blocklist, hostOf, PACKS_RESEARCH } from "./packs-research";
import { listInput } from "./retrieval";

export const BATCH_PHISHING_MAX = 100;
export const BATCH_URL_SAFETY_MAX = 10;
const URL_SAFETY_CONCURRENCY = 5;
const LIST_CHARS = 20_000;

/** A list of links or domains from a JSON array, lines or a comma list: trimmed, de-duplicated, order kept, bounded. */
export function batchItems(raw: string, max: number, what: string): string[] {
  const items = [...new Set(listInput(raw))];
  if (!items.length) throw new HttpError(400, `urls is required: one to ${max} ${what}, as a JSON array, one per line or comma separated`);
  if (items.length > max) throw new HttpError(400, `at most ${max} ${what} per call (got ${items.length}); send the rest in another call`);
  return items;
}

/** Runs `fn` over `items` with at most `limit` in flight; results keep the input order. */
async function pool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => { while (next < items.length) { const i = next++; out[i] = await fn(items[i]); } };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

const reason = (e: unknown) => (e instanceof HttpError ? e.message : e instanceof Error && e.message ? "the check failed for this item" : "the check failed for this item");
const PHISHING_ATTRIBUTION = PHISHING_SOURCES.map((s) => `${s.name}, ${s.url} (${s.licence})`).join("; ");

const urlSafetyTool = PACKS_RESEARCH.find((e) => e.endpoint.path === "/pack/url-safety");
if (!urlSafetyTool) throw new Error("batch references unknown tool /pack/url-safety");

export const BATCH: Entry[] = [
  entry("/batch/phishing-check", "Bulk phishing check: up to 100 links or domains in one call",
    "Bulk phishing check: send up to 100 links or domains in one call and one payment (JSON array, lines or commas). Each host is checked without being requested against two public phishing blocklists (Phishing.Database, MetaMask): block, warn (a one-letter look-alike) or not_listed, with the matched domain and source. Use to vet a whole list of links before an agent opens or pays them; each bad item gets its own row.",
    ["bulk-phishing-check", "batch-url-safety", "phishing-list-check", "bulk-domain-check", "scam-domains", "batch"], {
      urls: { type: "string", description: "Up to 100 links or domains: a JSON array, one per line, or comma separated; none is ever requested", required: true, example: "https://github.com,metamask.io" },
    },
    { count: 2, summary: { block: 0, warn: 0, not_listed: 2, errors: 0 }, results: [
      { url: "https://github.com", domain: "github.com", verdict: "not_listed", matchedOn: null, sources: [], lookalikeOf: null },
      { url: "metamask.io", domain: "metamask.io", verdict: "not_listed", matchedOn: null, sources: [], lookalikeOf: null },
    ], listDate: "2026-11-18", attribution: "Phishing.Database, https://github.com/Phishing-Database/Phishing.Database (MIT); MetaMask eth-phishing-detect, https://github.com/MetaMask/eth-phishing-detect (DBAD public licence)" },
    async (env, q) => {
      const items = batchItems(need(q, "urls", LIST_CHARS), BATCH_PHISHING_MAX, "links or domains");
      let listDate: string | null = null;
      const results = await pool(items, 20, async (url) => {
        try {
          const v = await blocklist(env as Env, hostOf(url));
          listDate ??= v.listDate;
          const verdict = v.listed ? "block" : v.lookalikeOf ? "warn" : "not_listed";
          return { url, domain: v.domain, verdict, matchedOn: v.matchedOn, sources: v.sources, lookalikeOf: v.lookalikeOf };
        } catch (e) {
          if (e instanceof HttpError && e.status === 503) throw e; // the lists are not loaded: refuse the whole call, uncharged
          return { url, error: reason(e) };
        }
      });
      const count = (v: string) => results.filter((r) => "verdict" in r && r.verdict === v).length;
      const errors = results.filter((r) => "error" in r).length;
      if (errors === results.length) throw new HttpError(400, "none of the items is a public link or domain name");
      return { count: results.length, summary: { block: count("block"), warn: count("warn"), not_listed: count("not_listed"), errors }, results, listDate, attribution: PHISHING_ATTRIBUTION };
    }),

  entry("/batch/url-safety", "Bulk URL safety check: up to 10 links in one call",
    "Bulk URL safety check: send up to 10 links in one call and one payment. Each link gets a compact /pack/url-safety answer: phishing blocklists on every host it passes through, where it really leads, domain age and trust, HTTPS, security headers, named risk signals and an overall low/medium/high risk. Use to vet a list of links from emails, chats or scraped pages in one paid call; a link that cannot be checked gets its own row.",
    ["bulk-url-safety", "batch-link-checker", "url-safety-check", "bulk-scam-check", "link-safety", "batch"], {
      urls: { type: "string", description: "Up to 10 http or https links: a JSON array, one per line, or comma separated", required: true, example: "https://github.com,https://example.com" },
    },
    { count: 2, summary: { low: 2, medium: 0, high: 0, errors: 0 }, results: [
      { url: "https://github.com", finalUrl: "https://github.com/", risk: "low", signals: [], blocklisted: false, domainAgeDays: 6600, https: true, securityGrade: "B" },
      { url: "https://example.com", finalUrl: "https://example.com/", risk: "low", signals: [], blocklisted: false, domainAgeDays: 11000, https: true, securityGrade: "C" },
    ] },
    async (env, q) => {
      const items = batchItems(need(q, "urls", LIST_CHARS), BATCH_URL_SAFETY_MAX, "links");
      const results = await pool(items, URL_SAFETY_CONCURRENCY, async (url) => {
        try {
          const one: Input = (n) => (n === "url" ? url : undefined);
          const r = await urlSafetyTool!.run(env, one) as {
            finalUrl: string | null; risk: string; signals: { code: string; level: string; message: string }[];
            blocklist: { listed: boolean } | null; domain: { ageDays: number | null } | null;
            security: { https: boolean; grade: string | null }; failed: Record<string, string>;
          };
          return {
            url, finalUrl: r.finalUrl, risk: r.risk, signals: r.signals, blocklisted: r.blocklist?.listed ?? null,
            domainAgeDays: r.domain?.ageDays ?? null, https: r.security.https, securityGrade: r.security.grade,
            ...(Object.keys(r.failed).length ? { failed: r.failed } : {}),
          };
        } catch (e) { return { url, error: reason(e) }; }
      });
      const risk = (v: string) => results.filter((r) => "risk" in r && r.risk === v).length;
      const errors = results.filter((r) => "error" in r).length;
      if (errors === results.length) throw new HttpError(502, "none of the links could be checked right now; nothing was charged");
      return { count: results.length, summary: { low: risk("low"), medium: risk("medium"), high: risk("high"), errors }, results };
    }),
];
