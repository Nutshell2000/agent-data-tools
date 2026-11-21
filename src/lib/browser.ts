import puppeteer from "@cloudflare/puppeteer";
import { HttpError, type Env } from "./env";
import { takeDailyBudget } from "./daily-cap";
import { parseTarget } from "./fetch";

export type BrowserPage = Awaited<ReturnType<Awaited<ReturnType<typeof puppeteer.launch>>["newPage"]>>;

/**
 * Runs in the page before any of its own script (21 Nov 2026). Request interception sees HTTP requests only: a
 * WebSocket handshake, a WebRTC connection and WebTransport never pass through it, so a page's script could open a
 * connection to any host and port for as long as the page stayed open, past the public-host guard. They are closed
 * here instead. WebSocket stays defined and behaves like a connection that failed (an `error` then a `close` event):
 * pages treat that as an ordinary network fault and still render, whereas a missing constructor throws in the middle
 * of their start-up code. WebRTC and WebTransport are removed, which is what a browser without them looks like.
 * It is kept as source text, not a function: the browser receives text either way, and a function compiled by the
 * bundler can come out calling helpers that exist only in this Worker, which would fail inside the page without a
 * sign. Known limit: a script running in a Web Worker has its own globals and is not covered.
 */
export const CLOSE_SIDE_CHANNELS = `(function () {
  var g = globalThis;
  function ClosedSocket(url) {
    var socket = new EventTarget();
    socket.url = String(url);
    socket.protocol = ""; socket.extensions = ""; socket.bufferedAmount = 0; socket.binaryType = "blob";
    socket.CONNECTING = 0; socket.OPEN = 1; socket.CLOSING = 2; socket.CLOSED = 3;
    socket.readyState = 0;
    socket.onopen = null; socket.onmessage = null; socket.onerror = null; socket.onclose = null;
    socket.send = function () {};
    socket.close = function () { socket.readyState = 3; };
    setTimeout(function () {
      socket.readyState = 3;
      var error = new Event("error");
      socket.dispatchEvent(error);
      try { if (typeof socket.onerror === "function") socket.onerror(error); } catch (e) {}
      var close = new Event("close");
      close.code = 1006; close.reason = ""; close.wasClean = false;
      socket.dispatchEvent(close);
      try { if (typeof socket.onclose === "function") socket.onclose(close); } catch (e) {}
    }, 0);
    return socket;
  }
  ClosedSocket.CONNECTING = 0; ClosedSocket.OPEN = 1; ClosedSocket.CLOSING = 2; ClosedSocket.CLOSED = 3;
  try { Object.defineProperty(g, "WebSocket", { value: ClosedSocket, writable: false, configurable: false }); } catch (e) { try { g.WebSocket = ClosedSocket; } catch (e2) {} }
  ["RTCPeerConnection", "webkitRTCPeerConnection", "RTCDataChannel", "WebTransport"].forEach(function (name) {
    try { Object.defineProperty(g, name, { value: undefined, writable: false, configurable: false }); } catch (e) { try { delete g[name]; } catch (e2) {} }
  });
})();`;

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
  // Browser Rendering is billed per browser-hour on Workers Paid (10 hours a month included): 60 launches a day of a few
  // seconds each stays inside the included time, so the plan's price is the whole bill.
  await takeDailyBudget(env, "browser", env.BROWSER_DAILY_CAP, 60, "hosted browser");
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
    // A failure here must not stop the page from loading: the guard above still covers every HTTP request.
    try { await page.evaluateOnNewDocument(CLOSE_SIDE_CHANNELS); }
    catch (e) { console.warn(`browser side channels not closed: ${e}`); }
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
