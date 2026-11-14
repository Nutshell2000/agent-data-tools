import { isBrowser } from "./browser-402";
import { takeDailyBudget } from "./daily-cap";
import type { Env } from "./env";

/**
 * The capped free try for PDF reading (14 Nov 2026). PDF reading left the HTTP free calls on 10 Nov 2026 (the owner's
 * decision, after one caller took 400-1,300 free reads a day and never bought). Since then the page that gets most of
 * the search visitors has had no way to try the tool, and published benchmarks say that costs most of the visitors who
 * would have tried. This puts a try back that a free rider cannot live on: browsers only, the caller's ordinary 3 free
 * HTTP calls, at most 2 pages and 6,000 characters a read, and a total per UTC day (PDF_TRY_DAILY_CAP, default 150).
 * OFF unless PDF_TRY is "on": switching it on is the owner's decision.
 */
export const PDF_TRY_PATHS: ReadonlySet<string> = new Set(["/pdf/text", "/pdf/extract"]);

export const pdfTryOn = (env: Pick<Env, "PDF_TRY">, path: string): boolean => env.PDF_TRY === "on" && PDF_TRY_PATHS.has(path);

/** True when this request may use the capped try: the switch is on, the tool is a PDF reader and a browser is asking. */
export const pdfTryFor = (env: Pick<Env, "PDF_TRY">, path: string, accept: string | undefined, userAgent: string | undefined): boolean =>
  pdfTryOn(env, path) && isBrowser(accept, userAgent);

/**
 * Takes one read from the day's total; false when the day is used up (the caller then gets the ordinary payment request).
 * A try on an uploaded file draws from its own total (PDF_TRY_UPLOAD_DAILY_CAP, default 150): on 14 Nov 2026 the URL
 * tries were used up by 10:20 local time (146 of 150, by fetchers that send a browser's headers), so a visitor with a
 * file on the product page got the payment request. A fetcher reads URLs; it does not post files.
 */
export async function takePdfTry(env: Env, upload = false): Promise<boolean> {
  try {
    if (upload) await takeDailyBudget(env, "pdftry-upload", env.PDF_TRY_UPLOAD_DAILY_CAP, 150, "free PDF try on an uploaded file");
    else await takeDailyBudget(env, "pdftry", env.PDF_TRY_DAILY_CAP, 150, "free PDF try");
    return true;
  } catch {
    return false;
  }
}

/** Requests the route let through as a capped try; the tool route reads this to set the reserved input. */
export const pdfTryRequests = new WeakSet<Request>();
