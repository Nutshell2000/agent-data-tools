import { Buffer } from "node:buffer";
import puppeteer from "@cloudflare/puppeteer";
import { HttpError, type Env } from "../lib/env";
import { parseTarget } from "../lib/fetch";

const WIDTH = 1280;
const HEIGHT = 800;
const MAX_FULL_HEIGHT = 4000;

/**
 * Renders a page in Cloudflare's hosted browser. The account's free daily browser
 * time is the only budget, so running out is reported as 503 and not charged.
 */
export async function screenshot(env: Env, rawUrl: string | undefined, fullPageParam?: string) {
  const target = parseTarget(rawUrl);
  if (!env.BROWSER) throw new HttpError(503, "screenshots are not available in this environment");
  const fullPage = fullPageParam === "true" || fullPageParam === "1";

  let browser: Awaited<ReturnType<typeof puppeteer.launch>>;
  try {
    browser = await puppeteer.launch(env.BROWSER);
  } catch (e) {
    console.error(`browser launch: ${e}`);
    throw new HttpError(503, "today's free browser capacity is used up or busy; try again later");
  }

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: WIDTH, height: HEIGHT });
    const response = await page.goto(target.href, { waitUntil: "networkidle2", timeout: 15_000 });
    let height = HEIGHT;
    if (fullPage) {
      // Evaluated in the page, so it is passed as a string (this project has no DOM types).
      const docHeight = Number(await page.evaluate("document.documentElement.scrollHeight"));
      height = Math.min(Math.max(docHeight || HEIGHT, HEIGHT), MAX_FULL_HEIGHT);
      await page.setViewport({ width: WIDTH, height });
    }
    const image = await page.screenshot({ type: "jpeg", quality: 70 });
    return {
      url: target.href,
      finalUrl: page.url(),
      status: response?.status() ?? null,
      title: await page.title(),
      width: WIDTH,
      height,
      contentType: "image/jpeg",
      imageBase64: Buffer.from(image).toString("base64"),
    };
  } catch (e) {
    if (e instanceof HttpError) throw e;
    const timedOut = e instanceof Error && /timeout/i.test(e.message);
    throw new HttpError(timedOut ? 504 : 502, timedOut ? "the page did not finish loading within 15 seconds" : "the page could not be rendered");
  } finally {
    await browser.close().catch(() => {});
  }
}
