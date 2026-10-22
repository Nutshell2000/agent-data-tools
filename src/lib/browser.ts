import puppeteer from "@cloudflare/puppeteer";
import { HttpError, type Env } from "./env";
import { parseTarget } from "./fetch";

export type BrowserPage = Awaited<ReturnType<Awaited<ReturnType<typeof puppeteer.launch>>["newPage"]>>;

/**
 * Opens a public page in Cloudflare's hosted browser and hands it to `use`. Every request the page
 * makes goes through the same public-host guard as fetches. The account's free daily browser time
 * is the only budget, so running out is reported as 503 and not charged.
 */
export async function withBrowserPage<T>(
  env: Env,
  target: URL,
  viewport: { width: number; height: number },
  use: (page: BrowserPage, status: number | null) => Promise<T>,
): Promise<T> {
  if (!env.BROWSER) throw new HttpError(503, "the hosted browser is not available in this environment");
  let browser: Awaited<ReturnType<typeof puppeteer.launch>>;
  let blockedNavigation = false;
  try {
    // The hosted browser refuses a launch while another session is closing (/screenshot got a 503 right after a
    // successful /extract/rendered on 22 Oct); one short retry covers that, a second refusal is capacity.
    try { browser = await puppeteer.launch(env.BROWSER); }
    catch (first) { console.warn(`browser launch retry: ${first}`); await new Promise((r) => setTimeout(r, 1500)); browser = await puppeteer.launch(env.BROWSER); }
  } catch (e) {
    console.error(`browser launch: ${e}`);
    throw new HttpError(503, "today's free browser capacity is used up or busy; try again later");
  }
  try {
    const page = await browser.newPage();
    await page.setRequestInterception(true);
    page.on("request", (request) => {
      try {
        const url = request.url();
        // Inline browser resources make no outbound network request.
        if (!/^(data:|blob:|about:blank$)/i.test(url)) parseTarget(url);
        void request.continue().catch(() => {});
      } catch {
        if (request.isNavigationRequest() && request.frame() === page.mainFrame()) blockedNavigation = true;
        void request.abort("blockedbyclient").catch(() => {});
      }
    });
    await page.setViewport(viewport);
    const response = await page.goto(target.href, { waitUntil: "networkidle2", timeout: 15_000 });
    if (blockedNavigation) throw new HttpError(400, "the page redirected to a blocked URL");
    parseTarget(page.url());
    return await use(page, response?.status() ?? null);
  } catch (e) {
    if (blockedNavigation) throw new HttpError(400, "the page redirected to a blocked URL");
    if (e instanceof HttpError) throw e;
    const timedOut = e instanceof Error && /timeout/i.test(e.message);
    throw new HttpError(timedOut ? 504 : 502, timedOut ? "the page did not finish loading within 15 seconds" : "the page could not be rendered");
  } finally {
    await browser.close().catch(() => {});
  }
}
