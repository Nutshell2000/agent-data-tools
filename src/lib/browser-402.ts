// What a person sees when they open a paid tool's URL in a browser. The x402 library answers browsers with a
// generic "Payment Required" page meant for developers; this page instead says what the tool does, shows its
// example result, and offers the ways in: a free trial call, the free static sample, card credits and MCP.
// The status stays 402 and the payment headers are untouched, so machine clients see no difference.
import { exampleParams, type Endpoint } from "../endpoints";
import { FREE_CALLS_PER_CALLER } from "./free-calls";
import { TRY_FORM_CSS, tryForm } from "./try-form";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** The same request with one more query parameter, keeping the caller's own inputs. */
function withParam(url: URL, name: string): string {
  const next = new URL(url.href);
  next.searchParams.set(name, "1");
  return next.pathname + next.search;
}

/** The caller's request, or the tool's published example when the caller sent none of its inputs, so a free
 *  trial from a bare link returns a real result instead of a missing-input error. */
function trialBase(endpoint: Endpoint, url: URL): URL {
  if (Object.keys(endpoint.params).some((name) => url.searchParams.has(name))) return url;
  const next = new URL(url.origin + url.pathname);
  for (const [name, param] of exampleParams(endpoint)) next.searchParams.set(name, String(param.example));
  return next;
}

export function browserToolPage(endpoint: Endpoint, requestUrl: string, freeCalls: boolean): string {
  const url = new URL(requestUrl);
  const origin = url.origin;
  const example = JSON.stringify(endpoint.outputExample, null, 2);
  const shown = example.length > 1800 ? `${example.slice(0, 1800)}\n…` : example;
  const mcpName = endpoint.path.slice(1).replace(/[/-]/g, "_");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(endpoint.summary)} · Agent Data Tools</title>
<meta name="description" content="${esc(endpoint.description.slice(0, 300))}">
<style>
:root{--bg:#fff;--fg:#1a1a1a;--muted:#5f6368;--card:#f6f7f9;--line:#e3e5e8;--accent:#0b57d0;--accent-fg:#fff}
@media (prefers-color-scheme:dark){:root{--bg:#121417;--fg:#e8eaed;--muted:#a3a8ae;--card:#1c1f24;--line:#2c3036;--accent:#8ab4f8;--accent-fg:#0b1a33}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.55 system-ui,-apple-system,Segoe UI,sans-serif}
main{max-width:760px;margin:0 auto;padding:32px 16px 48px}h1{font-size:1.6rem;line-height:1.25;margin:0 0 8px}
.meta{color:var(--muted);margin:0 0 20px}.price{font-weight:600;color:var(--fg)}
.actions{display:flex;flex-wrap:wrap;gap:10px;margin:20px 0 28px}
.btn{display:inline-block;padding:10px 16px;border-radius:8px;border:1px solid var(--line);color:var(--fg);text-decoration:none;font-weight:600}
.btn.primary{background:var(--accent);border-color:var(--accent);color:var(--accent-fg)}
h2{font-size:1.05rem;margin:28px 0 8px}pre{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:14px;overflow:auto;font-size:.85rem;line-height:1.45}
code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}p{margin:8px 0}a{color:var(--accent)}
footer{margin-top:36px;color:var(--muted);font-size:.9rem}
${freeCalls ? TRY_FORM_CSS : ""}
</style></head><body><main>
<h1>${esc(endpoint.summary)}</h1>
<p class="meta"><span class="price">${esc(endpoint.price)} per call</span> · failed calls are never charged · no account needed</p>
<p>${esc(endpoint.description)}</p>
<div class="actions">
${freeCalls ? `<a class="btn primary" rel="nofollow" href="${esc(withParam(trialBase(endpoint, url), "trial"))}">Run it free (${FREE_CALLS_PER_CALLER} free calls)</a>` : ""}
<a class="btn${freeCalls ? "" : " primary"}" href="/credits">Buy credits by card (from $5)</a>
<a class="btn" href="${esc(withParam(url, "sample"))}">See an example result</a>
</div>
${freeCalls ? tryForm(endpoint, url.searchParams) : ""}
<h2>Example result</h2>
<pre><code>${esc(shown)}</code></pre>
<h2>Use it from an AI agent</h2>
<p>Add this MCP server to Claude, Cursor or any MCP client. The tool is <code>${esc(mcpName)}</code>, and the first ${FREE_CALLS_PER_CALLER} successful calls are free:</p>
<pre><code>${esc(origin)}/mcp</code></pre>
<p>Agents with a wallet pay per call over HTTP: x402 (USDC on Base and four other chains) or MPP. A card key from <a href="/credits">/credits</a> works over both HTTP (<code>Authorization: Bearer adt_…</code>) and MCP.</p>
<footer><a href="/">All tools</a> · <a href="/llms.txt">Docs for agents</a> · <a href="/status">Reliability</a> · <a href="/terms">Terms</a> · <a href="/privacy">Privacy</a></footer>
</main></body></html>`;
}

/** A real browser (not an HTTP client that merely accepts HTML): it asks for HTML first and identifies as one. */
export function isBrowser(accept: string | undefined, userAgent: string | undefined): boolean {
  return /text\/html/i.test(accept ?? "") && /Mozilla\//.test(userAgent ?? "");
}

/** Hours until the next 00:00 UTC, rounded up, when the free-call allowance can be counted again. */
export function hoursToUtcMidnight(now = new Date()): number {
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return Math.max(1, Math.ceil((next - now.getTime()) / 3_600_000));
}

/** Said wherever a free call was asked for but could not be counted (storage over its daily write limit). */
export const freeCallsPausedNote = (now = new Date()) =>
  `Free calls are paused until 00:00 UTC (in about ${hoursToUtcMidnight(now)} h) because today's free-call capacity is used up; they come back then. Paid x402 calls keep working.`;

/** A person who clicked "Run it free" while free calls could not be counted: say so instead of showing the paywall. */
export function browserTrialPausedPage(endpoint: Endpoint, requestUrl: string, now = new Date()): string {
  const url = new URL(requestUrl);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(endpoint.summary)}: free calls paused · Agent Data Tools</title>
<meta name="robots" content="noindex">
<style>
:root{--bg:#fff;--fg:#1a1a1a;--muted:#5f6368;--line:#e3e5e8;--accent:#0b57d0;--accent-fg:#fff}
@media (prefers-color-scheme:dark){:root{--bg:#121417;--fg:#e8eaed;--muted:#a3a8ae;--line:#2c3036;--accent:#8ab4f8;--accent-fg:#0b1a33}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.55 system-ui,-apple-system,Segoe UI,sans-serif}
main{max-width:760px;margin:0 auto;padding:32px 16px 48px}h1{font-size:1.4rem;line-height:1.25;margin:0 0 8px}
.meta{color:var(--muted);margin:0 0 18px}.actions{display:flex;flex-wrap:wrap;gap:10px;margin:18px 0}
.btn{display:inline-block;padding:10px 16px;border-radius:8px;border:1px solid var(--line);color:var(--fg);text-decoration:none;font-weight:600}
.btn.primary{background:var(--accent);border-color:var(--accent);color:var(--accent-fg)}a{color:var(--accent)}
</style></head><body><main>
<h1>${esc(endpoint.summary)}</h1>
<p class="meta">${esc(freeCallsPausedNote(now))}</p>
<p>Nothing was charged and none of your ${FREE_CALLS_PER_CALLER} free calls were used. Until then you can look at a real example result, or come back after 00:00 UTC and run it again.</p>
<div class="actions"><a class="btn primary" href="${esc(withParam(new URL(url.origin + url.pathname), "sample"))}">See an example result</a><a class="btn" href="/tools">All tools</a></div>
</main></body></html>`;
}

/** A free trial the tool refused (bad or missing input): the reason in plain words, nothing charged, the free call
 *  given back, and the form again with what the visitor typed. */
export function browserTrialErrorPage(endpoint: Endpoint, json: string, left: number, requestUrl: string): string {
  let reason = "";
  try { const body = JSON.parse(json) as { error?: unknown; message?: unknown }; reason = String(body.error ?? body.message ?? ""); } catch { /* not JSON */ }
  if (!reason) reason = "The tool could not use these inputs.";
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(endpoint.summary)}: check the inputs · Agent Data Tools</title>
<meta name="robots" content="noindex">
<style>
:root{--bg:#fff;--fg:#1a1a1a;--muted:#5f6368;--card:#f6f7f9;--line:#e3e5e8;--accent:#0b57d0;--accent-fg:#fff;--warn:#fdecea;--warn-fg:#8a1c12}
@media (prefers-color-scheme:dark){:root{--bg:#121417;--fg:#e8eaed;--muted:#a3a8ae;--card:#1c1f24;--line:#2c3036;--accent:#8ab4f8;--accent-fg:#0b1a33;--warn:#3b1f1c;--warn-fg:#f6b8b0}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.55 system-ui,-apple-system,Segoe UI,sans-serif}
main{max-width:760px;margin:0 auto;padding:32px 16px 48px}h1{font-size:1.4rem;line-height:1.25;margin:0 0 8px}
.meta{color:var(--muted);margin:0 0 18px}.err{background:var(--warn);color:var(--warn-fg);border-radius:8px;padding:12px 14px;margin:0 0 18px}
.btn{display:inline-block;padding:10px 16px;border-radius:8px;border:1px solid var(--line);color:var(--fg);text-decoration:none;font-weight:600}
.btn.primary{background:var(--accent);border-color:var(--accent);color:var(--accent-fg)}a{color:var(--accent)}code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
${TRY_FORM_CSS}
</style></head><body><main>
<h1>${esc(endpoint.summary)}</h1>
<p class="err">${esc(reason)}</p>
<p class="meta">Nothing was charged and this did not use a free call: ${left} left.</p>
${tryForm(endpoint, new URL(requestUrl).searchParams, "Change the inputs and try again")}
<p><a href="/tools">All tools</a></p>
</main></body></html>`;
}

/** A free trial's result as a page: the JSON it returned, the free calls left and the way to keep going (another
 *  run on other inputs while free calls remain, then card credits). */
export function browserTrialResultPage(endpoint: Endpoint, json: string, left: number, requestUrl?: string): string {
  const again = left > 0 && requestUrl ? tryForm(endpoint, new URL(requestUrl).searchParams, "Run it again with other inputs") : "";
  let pretty = json;
  try { pretty = JSON.stringify(JSON.parse(json), null, 2); } catch { /* show it as sent */ }
  const shown = pretty.length > 20_000 ? `${pretty.slice(0, 20_000)}\n…` : pretty;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(endpoint.summary)}: result · Agent Data Tools</title>
<style>
:root{--bg:#fff;--fg:#1a1a1a;--muted:#5f6368;--card:#f6f7f9;--line:#e3e5e8;--accent:#0b57d0;--accent-fg:#fff}
@media (prefers-color-scheme:dark){:root{--bg:#121417;--fg:#e8eaed;--muted:#a3a8ae;--card:#1c1f24;--line:#2c3036;--accent:#8ab4f8;--accent-fg:#0b1a33}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.55 system-ui,-apple-system,Segoe UI,sans-serif}
main{max-width:760px;margin:0 auto;padding:32px 16px 48px}h1{font-size:1.4rem;line-height:1.25;margin:0 0 8px}
.meta{color:var(--muted);margin:0 0 18px}.actions{display:flex;flex-wrap:wrap;gap:10px;margin:18px 0}
.btn{display:inline-block;padding:10px 16px;border-radius:8px;border:1px solid var(--line);color:var(--fg);text-decoration:none;font-weight:600}
.btn.primary{background:var(--accent);border-color:var(--accent);color:var(--accent-fg)}
pre{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:14px;overflow:auto;font-size:.85rem;line-height:1.45}
code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}a{color:var(--accent)}
${again ? TRY_FORM_CSS : ""}
</style></head><body><main>
<h1>${esc(endpoint.summary)}</h1>
<p class="meta">Free call: ${left} of your free calls left. After that, ${esc(endpoint.price)} per call; failed calls are never charged.</p>
<pre><code>${esc(shown)}</code></pre>
<div class="actions"><a class="btn primary" href="/credits">Buy credits by card (from $5)</a><a class="btn" href="/">All tools</a></div>
${again}
<p>From code or an AI agent, the same request returns this JSON. Add <code>${esc(endpoint.path)}</code> to Claude, Cursor or any MCP client through <code>/mcp</code>.</p>
</main></body></html>`;
}
