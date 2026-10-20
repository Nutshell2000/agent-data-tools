// What a person sees when they open a paid tool's URL in a browser. The x402 library answers browsers with a
// generic "Payment Required" page meant for developers; this page instead says what the tool does, shows its
// example result, and offers the ways in: a free trial call, the free static sample, card credits and MCP.
// The status stays 402 and the payment headers are untouched, so machine clients see no difference.
import { exampleParams, type Endpoint } from "../endpoints";
import { FREE_CALLS_PER_CALLER } from "./free-calls";

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
</style></head><body><main>
<h1>${esc(endpoint.summary)}</h1>
<p class="meta"><span class="price">${esc(endpoint.price)} per call</span> · failed calls are never charged · no account needed</p>
<p>${esc(endpoint.description)}</p>
<div class="actions">
${freeCalls ? `<a class="btn primary" href="${esc(withParam(trialBase(endpoint, url), "trial"))}">Run it free (${FREE_CALLS_PER_CALLER} free calls)</a>` : ""}
<a class="btn${freeCalls ? "" : " primary"}" href="/credits">Buy credits by card (from $5)</a>
<a class="btn" href="${esc(withParam(url, "sample"))}">See an example result</a>
</div>
<h2>Example result</h2>
<pre><code>${esc(shown)}</code></pre>
<h2>Use it from an AI agent</h2>
<p>Add this MCP server to Claude, Cursor or any MCP client. The tool is <code>${esc(mcpName)}</code>, and the first ${FREE_CALLS_PER_CALLER} successful calls are free:</p>
<pre><code>${esc(origin)}/mcp</code></pre>
<p>Agents with a wallet pay per call over HTTP: x402 (USDC on Base and four other chains) or MPP. A card key from <a href="/credits">/credits</a> works over both HTTP (<code>Authorization: Bearer adt_…</code>) and MCP.</p>
<footer><a href="/">All tools</a> · <a href="/llms.txt">Docs for agents</a> · <a href="/status">Reliability</a> · <a href="/terms">Terms</a> · <a href="/privacy">Privacy</a></footer>
</main></body></html>`;
}
