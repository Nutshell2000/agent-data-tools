import { Buffer } from "node:buffer";
import { withBrowserPage } from "../lib/browser";
import { HttpError, type Env } from "../lib/env";
import { parseTarget } from "../lib/fetch";

const WIDTH = 1280;
const HEIGHT = 800;
const MAX_FULL_HEIGHT = 4000;

/** Renders a page in Cloudflare's hosted browser (see withBrowserPage for the budget). */
export async function screenshot(env: Env, rawUrl: string | undefined, fullPageParam?: string) {
  const target = parseTarget(rawUrl);
  if (!env.BROWSER) throw new HttpError(503, "screenshots are not available in this environment");
  const fullPage = fullPageParam === "true" || fullPageParam === "1";
  return withBrowserPage(env, target, { width: WIDTH, height: HEIGHT }, async (page, status) => {
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
      status,
      title: await page.title(),
      width: WIDTH,
      height,
      contentType: "image/jpeg",
      imageBase64: Buffer.from(image).toString("base64"),
    };
  });
}
