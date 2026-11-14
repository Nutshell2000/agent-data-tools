// The front page and the quick-start docs of the product site, for people. The front page is served at "/" only when
// the owner has set a public brand (PUBLIC_BRAND, lib/public-brand.ts); until then "/" stays the agent catalogue, which
// is always at /agents. Why: a developer who arrives at the product's own domain should see what is sold, what it
// costs and how to call it, and find the agent catalogue one link away rather than first.
// Numbers come from the catalog and the plans; copy restates the products' own entries (lib/product-pages.ts).
import { ENDPOINTS, exampleParams, type Endpoint } from "../endpoints";
import { PLAN_PORTAL_URL } from "./credits";
import { FREE_CALLS_PER_CALLER } from "./free-calls";
import { COMPANY_FOOTER } from "./legal";
import { PRODUCTS, productOffers } from "./product-pages";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const jsonLd = (value: unknown) => JSON.stringify(value).replace(/</g, "\\u003c");
const BY_PATH = new Map(ENDPOINTS.map((e) => [e.path, e as Endpoint]));
const queryOf = (e: Endpoint) => exampleParams(e).map(([k, p]) => `${k}=${encodeURIComponent(String(p.example ?? ""))}`).join("&");

const STYLE = `:root{--bg:#fff;--fg:#16181d;--muted:#5b616b;--card:#f5f6f8;--line:#e2e5ea;--accent:#0b57d0;--accent-fg:#fff;--ok:#0b6e4f}
@media (prefers-color-scheme:dark){:root{--bg:#111316;--fg:#e9ebee;--muted:#a2a8b0;--card:#1a1d22;--line:#2b3037;--accent:#8ab4f8;--accent-fg:#0b1a33;--ok:#5fd0a5}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.6 system-ui,-apple-system,Segoe UI,sans-serif}
header.top{max-width:980px;margin:0 auto;padding:18px 16px;display:flex;flex-wrap:wrap;gap:8px 20px;align-items:center;justify-content:space-between}
header.top .brand{font-weight:700;font-size:1.15rem;color:var(--fg);text-decoration:none}header.top nav{display:flex;flex-wrap:wrap;gap:6px 18px}header.top nav a{color:var(--muted);text-decoration:none}
main{max-width:980px;margin:0 auto;padding:8px 16px 64px}h1{font-size:2.4rem;line-height:1.12;margin:26px 0 12px;letter-spacing:-.015em;max-width:20ch}
.tag{font-size:1.2rem;color:var(--muted);margin:0 0 22px;max-width:60ch}h2{font-size:1.35rem;margin:46px 0 12px}h3{font-size:1.05rem;margin:0 0 6px}p{margin:8px 0}a{color:var(--accent)}
.btn{display:inline-block;padding:11px 18px;border-radius:8px;border:1px solid var(--line);color:var(--fg);text-decoration:none;font-weight:600;margin:0 8px 8px 0}.btn.primary{background:var(--accent);border-color:var(--accent);color:var(--accent-fg)}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:14px}.card{border:1px solid var(--line);border-radius:12px;padding:18px;background:var(--card)}
.card p{color:var(--muted);margin:0 0 10px}.card .from{color:var(--fg);font-weight:600}.steps{counter-reset:s;list-style:none;padding:0;display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px}
.steps li{counter-increment:s;border-top:2px solid var(--line);padding-top:10px}.steps li::before{content:counter(s);font-weight:700;color:var(--ok);margin-right:8px}
pre{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:14px;overflow:auto;font-size:.85rem;line-height:1.5}code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
table{border-collapse:collapse;width:100%;font-size:.94rem}td,th{border-bottom:1px solid var(--line);padding:8px 6px;text-align:left;vertical-align:top}.wrap{overflow-x:auto}
ul{padding-left:20px}.small{color:var(--muted);font-size:.92rem}footer{max-width:980px;margin:0 auto;padding:24px 16px 48px;color:var(--muted);font-size:.9rem;border-top:1px solid var(--line)}`;

const top = (brand: string) => `<header class="top"><a class="brand" href="/">${esc(brand)}</a><nav>${PRODUCTS.map((p) => `<a href="/${esc(p.slug)}">${esc(p.name.replace(/ API$/, ""))}</a>`).join("")}<a href="/credits">Pricing</a><a href="/docs">Docs</a></nav></header>`;
const foot = () => `<footer>${PRODUCTS.map((p) => `<a href="/${esc(p.slug)}">${esc(p.name)}</a>`).join(" · ")} · <a href="/docs">Docs</a> · <a href="/credits">Pricing</a> · <a href="/agents">For AI agents</a> · <a href="/status">Status</a> · ${COMPANY_FOOTER}</footer>`;

/** The front page of the product site. `cardReady`: card plans and packs can be bought (lib/credit-routes.ts). */
export function landingPage(brand: string, origin: string, cardReady: boolean): string {
  const first = PRODUCTS[0];
  const tool = BY_PATH.get(first.tool)!;
  const title = `${brand}: focused APIs for documents and company checks`;
  const description = `${PRODUCTS.map((p) => p.name).join(", ")}. One API key, a monthly plan or pay as you go, a free try on every product page. Failed calls are never charged.`.slice(0, 300);
  const cards = PRODUCTS.map((p) => {
    const lead = productOffers(p, cardReady).find((o) => o.monthly);
    return `<div class="card"><h3><a href="/${esc(p.slug)}">${esc(p.name)}</a></h3><p>${esc(p.tagline)}</p>${lead ? `<p class="from">${esc(lead.label)}: ${esc(lead.calls)} ${esc(p.unit)}</p>` : ""}<a href="/${esc(p.slug)}">Code, free try and plans</a></div>`;
  }).join("");
  const plans = productOffers(first, cardReady);
  const ld = { "@context": "https://schema.org", "@type": "Organization", name: brand, url: origin, description };
  const sample = `curl -H "Authorization: Bearer $API_KEY" \\\n  "${origin}${tool.path}?${queryOf(tool)}"`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(origin)}/">
<meta property="og:type" content="website"><meta property="og:site_name" content="${esc(brand)}"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(origin)}/"><meta property="og:image" content="${esc(origin)}/og.png">
<link rel="icon" href="/favicon.ico">
<script type="application/ld+json">${jsonLd(ld)}</script>
<style>${STYLE}</style></head><body>${top(brand)}<main>
<h1>Small, focused APIs that do one job each</h1>
<p class="tag">Text out of documents, clean Markdown out of web pages, and checks on the companies you invoice. One API key, one request per job, and you pay only for calls that succeed.</p>
<p><a class="btn primary" href="/${esc(first.slug)}">Try ${esc(first.name)} free</a><a class="btn" href="/credits">See pricing</a><a class="btn" href="/docs">Read the docs</a></p>

<h2>The APIs</h2>
<div class="grid">${cards}</div>

<h2>How it works</h2>
<ol class="steps">
<li><strong>Try it.</strong> Every product page has a form that runs the real thing on your own input, free.</li>
<li><strong>Get a key.</strong> Pick a monthly plan or a one-off pack and pay by card. No account to create: the key is shown right after payment.</li>
<li><strong>Call it.</strong> Send the key in a header. A call that fails costs nothing.</li>
</ol>
<pre><code>${esc(sample)}</code></pre>

${plans.length ? `<h2>Pricing</h2>
<p>One key works on every API here. Plans add credits each month and unused credits stay; packs never expire.</p>
<div class="wrap"><table><tr><th>Plan</th>${PRODUCTS.map((p) => `<th>${esc(p.unit.charAt(0).toUpperCase() + p.unit.slice(1))}</th>`).join("")}</tr>
${plans.map((o, i) => `<tr><td><a href="${esc(o.url)}">${esc(o.label)}</a></td>${PRODUCTS.map((p) => `<td>${esc(productOffers(p, cardReady)[i]?.calls ?? "")}</td>`).join("")}</tr>`).join("\n")}
</table></div>
<p class="small">Each column is what that amount buys if you spend it all on that one API. <a href="${esc(PLAN_PORTAL_URL)}">Cancel a plan at any time</a>. Details: <a href="/credits">pricing</a>.</p>` : `<h2>Pricing</h2><p><a href="/credits">Plans and packs</a></p>`}

<h2>For AI agents</h2>
<p>The same APIs, and the rest of a catalogue of ${ENDPOINTS.length} tools, are available to AI agents: an MCP server at <code>${esc(origin)}/mcp</code> (the first ${FREE_CALLS_PER_CALLER} successful calls are free) and pay-per-call over HTTP. <a href="/agents">Agent catalogue and payment details</a> · <a href="/tools">all tools</a> · <a href="/llms.txt">llms.txt</a> · <a href="/openapi.json">OpenAPI</a></p>
</main>${foot()}</body></html>`;
}

/** /docs: how to call any of the APIs with a key. Only what the service does today. */
export function docsPage(brand: string, origin: string): string {
  const pdf = BY_PATH.get("/pdf/text");
  const title = `Docs: keys, requests, errors and uploads · ${brand}`;
  const description = `How to call the ${brand} APIs: send your key in a header, read JSON back, what an error looks like, how to check your balance, replace a key and send a file.`;
  const keyed = `curl -H "Authorization: Bearer $API_KEY" "${origin}/vat/validate?vat=SE556703748501"`;
  const upload = pdf ? `curl -H "Authorization: Bearer $API_KEY" -F "file=@report.pdf" "${origin}${pdf.path}"` : "";
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(origin)}/docs">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(description)}"><meta property="og:url" content="${esc(origin)}/docs"><meta property="og:image" content="${esc(origin)}/og.png">
<link rel="icon" href="/favicon.ico">
<style>${STYLE}</style></head><body>${top(brand)}<main>
<h1>Docs</h1>
<p class="tag">Every API here is one HTTPS request that returns JSON. This page is everything that is the same for all of them.</p>

<h2>Your key</h2>
<p>Get a key from <a href="/credits">pricing</a> (a monthly plan or a one-off pack). It is shown right after payment, so copy it then. Send it with every call:</p>
<pre><code>${esc(keyed)}</code></pre>
<p><code>X-API-Key: &lt;key&gt;</code> works too. Where a client can only fetch a URL, add <code>api_key=&lt;key&gt;</code> to the query string; a key in a URL can end up in logs, so prefer the header.</p>

<h2>Requests</h2>
<ul>
<li>Inputs go in the query string of a GET. A POST with a flat JSON body of the same fields is read as the same call.</li>
<li>Each API's inputs and a sample answer are on its page: ${PRODUCTS.map((p) => `<a href="/${esc(p.slug)}">${esc(p.name)}</a>`).join(", ")}. Every tool has a reference page under <a href="/tools">/tools</a>.</li>
<li>Add <code>only=key1,key2</code> to get just those top-level fields of the answer.</li>
<li><code>sample=1</code> returns the documented example answer without running anything and without charge.</li>
</ul>

${pdf ? `<h2>Sending a file</h2>
<p>The PDF reader also takes the file itself, up to 10 MB, as a multipart form field named <code>file</code> or as the raw request body. The file is read in memory for that one request and is not stored.</p>
<pre><code>${esc(upload)}</code></pre>` : ""}

<h2>Answers and errors</h2>
<div class="wrap"><table><tr><th>Status</th><th>Meaning</th><th>Charged</th></tr>
<tr><td>200</td><td>The answer, as JSON.</td><td>Yes: the call's price in credits</td></tr>
<tr><td>400, 404, 415, 422</td><td>The input was wrong or the thing was not found. The body is JSON with an <code>error</code> message that says what to change.</td><td>No</td></tr>
<tr><td>402</td><td>No key was sent, or the key has too few credits. The body says how to pay.</td><td>No</td></tr>
<tr><td>5xx</td><td>The service or an outside source it reads could not answer. Safe to try again.</td><td>No</td></tr>
</table></div>
<p>A check that could not be made is never reported as a negative result: a VAT number is "not valid" only when the tax authority said so.</p>

<h2>Balance, top-ups and a leaked key</h2>
<ul>
<li><strong>Balance:</strong> <code>GET ${esc(origin)}/credits/balance</code> with your key in the header.</li>
<li><strong>Top up:</strong> the balance answer carries links that add credits to the same key.</li>
<li><strong>Replace a key:</strong> <code>POST ${esc(origin)}/credits/rotate</code> with the key in the header moves the balance to a new key and stops the old one.</li>
<li><strong>Plans:</strong> <a href="${esc(PLAN_PORTAL_URL)}">manage or cancel</a> with the e-mail address you paid with.</li>
</ul>

<h2>From an AI assistant</h2>
<p>The same tools are an MCP server at <code>${esc(origin)}/mcp</code>; send the key as the <code>Authorization</code> header of the connection. Agents that pay per call without a key: <a href="/agents">agent catalogue and payment details</a>. Machine-readable: <a href="/openapi.json">OpenAPI</a>, <a href="/llms.txt">llms.txt</a>.</p>

<h2>Reliability and privacy</h2>
<p>Success rates for the last seven days are public at <a href="/status">/status</a>. What is and is not stored: <a href="/privacy">privacy</a>.</p>
</main>${foot()}</body></html>`;
}
