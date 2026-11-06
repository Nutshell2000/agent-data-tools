// Archived-copy fallback for page readers (6 Nov 2026). /extract is our most-called tool, and 60 of its failures in 7 days
// were the target being down or slow (36 x "target responded with HTTP 5xx/429", 24 x timeouts), each a sale lost. When the
// live page cannot be fetched for those reasons, the reader serves the Internet Archive's latest 200 capture of the same URL,
// labelled with its capture date. Only for an unavailable target: a page that refuses us (401/403/451) or is missing
// (404/410) is never fetched from the archive, so this is no way around a site's access decision.
import { fetchPublic, parseTarget } from "./fetch";

const CDX = "https://web.archive.org/cdx/search/cdx";

export interface ArchivedResponse {
  res: Response;
  /** ISO time of the capture. */
  capturedAt: string;
  /** The archive URL that was read. */
  snapshotUrl: string;
}

/** "20261025102749" -> "2026-10-25T10:27:49Z" */
export function captureTime(ts: string): string {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})?(\d{2})?(\d{2})?$/.exec(ts);
  if (!m) return ts;
  return `${m[1]}-${m[2]}-${m[3]}T${m[4] ?? "00"}:${m[5] ?? "00"}:${m[6] ?? "00"}Z`;
}

/**
 * The latest successful HTML (or `mime`) capture of `target` from the Internet Archive, fetched raw (the `id_` form, without
 * the archive's toolbar). Returns null when there is none or the archive does not answer within `budgetMs`.
 */
export async function archivedCopy(target: URL, accept: string, { budgetMs = 8_000, mime = "text/html", fetcher = fetch }: { budgetMs?: number; mime?: string; fetcher?: typeof fetch } = {}): Promise<ArchivedResponse | null> {
  const deadline = Date.now() + budgetMs;
  const lookup = `${CDX}?${new URLSearchParams({ url: target.href, output: "json", fl: "timestamp,original", limit: "-1" })}&filter=statuscode:200&filter=mimetype:${encodeURIComponent(mime)}`;
  let rows: unknown;
  try {
    const r = await fetcher(lookup, { headers: { accept: "application/json", "user-agent": "Mozilla/5.0 (compatible; AgentDataTools/1.0)" }, signal: AbortSignal.timeout(Math.max(1_000, Math.min(4_000, deadline - Date.now()))) });
    if (!r.ok) return null;
    rows = await r.json();
  } catch {
    return null;
  }
  const row = Array.isArray(rows) ? (rows[1] as unknown) : undefined;
  if (!Array.isArray(row) || typeof row[0] !== "string" || typeof row[1] !== "string" || !/^\d{8,14}$/.test(row[0])) return null;
  let original: URL;
  try { original = parseTarget(row[1]); } catch { return null; }
  const snapshotUrl = `https://web.archive.org/web/${row[0]}id_/${original.href}`;
  const left = deadline - Date.now();
  if (left < 1_000) return null;
  try {
    const res = await fetchPublic(new URL(snapshotUrl), accept, [], { budgetMs: left });
    return { res, capturedAt: captureTime(row[0]), snapshotUrl };
  } catch {
    return null;
  }
}
