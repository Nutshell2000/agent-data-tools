// The counting behind scripts/warm-quotes.mjs, kept apart so it can be tested without a network (21 Nov 2026).
// Requests and URLs are two different counts: an example URL is asked twice (the front stores a URL with a query on
// its second miss), so adding every 402 to "warmed" printed more warmed URLs than there were URLs.

export const newTally = () => ({ requests: 0, quoted: 0, fromFront: 0, other: 0, failed: 0, urls: 0, urlsWarmed: 0 });

/** Counts one request. `status` is null when the request failed. Returns "quoted", "other" or "failed". */
export function countAnswer(tally, status, quoteFront) {
  if (status === null) { tally.failed++; return "failed"; }
  tally.requests++;
  if (status !== 402) { tally.other++; return "other"; }
  tally.quoted++;
  if (quoteFront === "hit") tally.fromFront++;
  return "quoted";
}

/** Counts one URL once all its requests are done; `warmed` is whether its last request got a 402 quote. */
export function countUrl(tally, warmed) {
  tally.urls++;
  if (warmed) tally.urlsWarmed++;
}

/** The line the release log keeps. It starts with "warm-quotes: warmed", which scripts/release.ps1 looks for. */
export function summaryLine(tally, plannedUrls) {
  return `warm-quotes: warmed ${tally.urlsWarmed} of ${plannedUrls} URLs (${tally.requests} requests answered: ${tally.quoted} quotes, ${tally.fromFront} of them already from the front, ${tally.other} not a 402; ${tally.failed} requests failed)`;
}
