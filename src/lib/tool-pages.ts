// One indexable page per tool at /tools/<slug>. The tool URLs themselves answer 402, which search engines do
// not index, so before these pages Google saw only the homepage. Each page says what the tool does, its inputs,
// a request and an example result, and the ways in (free calls, card credits, MCP, x402/MPP).
import { ENDPOINTS, SERVICE_NAME, toolSlug, type Endpoint } from "../endpoints";
import { categoryOf, exampleQuery } from "../discovery";
import { FREE_CALLS_PER_CALLER } from "./free-calls";
import { TOOL_SEO } from "./tool-seo";
import { TRY_FORM_CSS, tryForm } from "./try-form";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const BY_SLUG = new Map(ENDPOINTS.map((e) => [toolSlug(e.path), e as Endpoint]));
export const toolBySlug = (slug: string) => BY_SLUG.get(slug);

/** Inline JSON for a <script type="application/ld+json"> block: "<" escaped so the data cannot close the tag. */
const jsonLd = (value: unknown) => JSON.stringify(value).replace(/</g, "\\u003c");

export function toolDocPage(e: Endpoint, origin: string, freeCalls: boolean): string {
  const slug = toolSlug(e.path);
  const url = `${origin}/tools/${slug}`;
  const query = exampleQuery(e);
  const request = `${origin}${e.path}?${query}`;
  const mcpName = e.path.slice(1).replace(/[/-]/g, "_");
  const example = JSON.stringify(e.outputExample, null, 2);
  const shown = example.length > 4000 ? `${example.slice(0, 4000)}\n…` : example;
  const seo = TOOL_SEO[e.path];
  const heading = seo?.title ?? e.summary;
  const title = seo ? `${seo.title}: ${e.price} per call, no signup · ${SERVICE_NAME}` : `${e.summary} API: ${e.price} per call, no signup · ${SERVICE_NAME}`;
  const payAnswer = `Each successful call costs ${e.price}; failed calls are not charged. ${freeCalls ? `The first ${FREE_CALLS_PER_CALLER} calls are free. Then` : "This tool is not in the free calls;"} pay with card credits (from $1; the key goes in an Authorization header or, for clients that can only fetch a URL, as api_key= in the URL) or per call in USDC over x402 or MPP. No account is needed.`;
  const faq: [string, string][] = seo ? [...seo.faq, ["How do I pay?", payAnswer]] : [];
  const category = categoryOf(e.path);
  const related = ENDPOINTS.filter((o) => o.path !== e.path && categoryOf(o.path) === category).slice(0, 12);
  const params = Object.entries(e.params).filter(([name]) => name !== "only");
  const amount = e.price.replace(/^\$/, "");
  const ld = {
    "@context": "https://schema.org",
    "@type": "WebAPI",
    name: `${e.summary} (${SERVICE_NAME})`,
    description: e.description,
    url,
    documentation: url,
    provider: { "@type": "Organization", name: SERVICE_NAME, url: origin },
    offers: { "@type": "Offer", price: amount, priceCurrency: "USD", description: `${e.price} per successful call; failed calls are not charged` },
  };
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(e.description.slice(0, 300))}">
<link rel="canonical" href="${esc(url)}">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(e.description.slice(0, 300))}">
<meta property="og:url" content="${esc(url)}"><meta property="og:image" content="${esc(origin)}/og.png">
<link rel="icon" href="/favicon.ico">
<script type="application/ld+json">${jsonLd(ld)}</script>
${faq.length ? `<script type="application/ld+json">${jsonLd({ "@context": "https://schema.org", "@type": "FAQPage", mainEntity: faq.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })) })}</script>` : ""}
<style>
:root{--bg:#fff;--fg:#1a1a1a;--muted:#5f6368;--card:#f6f7f9;--line:#e3e5e8;--accent:#0b57d0;--accent-fg:#fff}
@media (prefers-color-scheme:dark){:root{--bg:#121417;--fg:#e8eaed;--muted:#a3a8ae;--card:#1c1f24;--line:#2c3036;--accent:#8ab4f8;--accent-fg:#0b1a33}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.55 system-ui,-apple-system,Segoe UI,sans-serif}
main{max-width:760px;margin:0 auto;padding:32px 16px 48px}h1{font-size:1.6rem;line-height:1.25;margin:0 0 8px}
nav.crumbs{color:var(--muted);font-size:.9rem;margin-bottom:12px}
.meta{color:var(--muted);margin:0 0 20px}.price{font-weight:600;color:var(--fg)}
.actions{display:flex;flex-wrap:wrap;gap:10px;margin:20px 0 28px}
.btn{display:inline-block;padding:10px 16px;border-radius:8px;border:1px solid var(--line);color:var(--fg);text-decoration:none;font-weight:600}
.btn.primary{background:var(--accent);border-color:var(--accent);color:var(--accent-fg)}
h2{font-size:1.1rem;margin:30px 0 8px}pre{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:14px;overflow:auto;font-size:.85rem;line-height:1.45}
code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}p{margin:8px 0}a{color:var(--accent)}
table{border-collapse:collapse;width:100%;font-size:.92rem}td,th{border-bottom:1px solid var(--line);padding:8px 6px;text-align:left;vertical-align:top}
.wrap{overflow-x:auto}ul.related{padding-left:20px}footer{margin-top:36px;color:var(--muted);font-size:.9rem}
${freeCalls ? TRY_FORM_CSS : ""}
</style></head><body><main>
<nav class="crumbs"><a href="/">${esc(SERVICE_NAME)}</a> › <a href="/tools">${esc(category)}</a></nav>
<h1>${esc(heading)}</h1>
<p class="meta"><span class="price">${esc(e.price)} per call</span> · failed calls are never charged · no account or API key needed</p>
<p>${esc(e.description)}</p>
${seo ? `<h2>When to use it</h2><ul>${seo.uses.map((u) => `<li>${esc(u)}</li>`).join("")}</ul>` : ""}
<div class="actions">
${freeCalls ? `<a class="btn primary" rel="nofollow" href="${esc(`${e.path}?${query}&trial=1`)}">Run it free (${FREE_CALLS_PER_CALLER} free calls)</a>` : ""}
<a class="btn${freeCalls ? "" : " primary"}" href="/credits">Buy credits by card (from $5)</a>
<a class="btn" href="${esc(`${e.path}?${query}&sample=1`)}">Example result (JSON)</a>
</div>
${freeCalls ? tryForm(e) : ""}
${params.length ? `<h2>Inputs</h2><div class="wrap"><table><tr><th>Name</th><th>Type</th><th>Description</th></tr>${params.map(([name, p]) => `<tr><td><code>${esc(name)}</code>${p.required ? " (required)" : ""}</td><td>${esc(p.type)}</td><td>${esc(p.description)}${p.enum ? `${/[.!?]$/.test(p.description) ? "" : "."}` : ""}${p.enum ? ` One of: ${p.enum.map((v) => `<code>${esc(v)}</code>`).join(", ")}.` : ""}</td></tr>`).join("")}</table></div>` : ""}
<h2>Request</h2>
<p>Over HTTP, with a card key from <a href="/credits">/credits</a>:</p>
<pre><code>curl -H "Authorization: Bearer adt_…" "${esc(request)}"</code></pre>
${freeCalls ? `<p>Or one of your ${FREE_CALLS_PER_CALLER} free calls, no key:</p>\n<pre><code>curl "${esc(request)}&amp;trial=1"</code></pre>` : ""}
<p>Without a key, the same URL answers <code>402 Payment Required</code> with x402 and MPP terms, so an agent with a wallet pays per call in USDC (Base, Polygon, Arbitrum or Solana over x402; Base or Tempo over MPP) and retries.</p>
<h2>Example result</h2>
<pre><code>${esc(shown)}</code></pre>
<h2>From an AI agent (MCP)</h2>
<p>Add the MCP server to Claude, Cursor or any MCP client. This tool is <code>${esc(mcpName)}</code>, and the first ${FREE_CALLS_PER_CALLER} successful calls are free:</p>
<pre><code>${esc(origin)}/mcp</code></pre>
${(e as Endpoint).details ? `<h2>Details and limits</h2>\n<p>${esc((e as Endpoint).details!)}</p>` : ""}
${faq.length ? `<h2>Questions</h2>${faq.map(([q, a]) => `<h3>${esc(q)}</h3><p>${esc(a)}</p>`).join("")}` : ""}
${related.length ? `<h2>Related tools</h2><ul class="related">${related.map((o) => `<li><a href="/tools/${esc(toolSlug(o.path))}">${esc(o.summary)}</a> · ${esc(o.price)}</li>`).join("")}</ul>` : ""}
<footer><a href="/tools">All ${ENDPOINTS.length} tools</a> · <a href="/llms.txt">Docs for agents</a> · <a href="/openapi.json">OpenAPI</a> · <a href="/status">Reliability</a> · <a href="/terms">Terms</a> · <a href="/privacy">Privacy</a></footer>
</main></body></html>`;
}

/** /tools: every tool page, grouped like the homepage catalog. */
export function toolIndexPage(origin: string, groups: { name: string; tools: readonly Endpoint[] }[]): string {
  const title = `All ${ENDPOINTS.length} tools · ${SERVICE_NAME}`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="Pay-per-call data tools for AI agents and developers: web and PDF reading, OFAC sanctions checks, token prices, chain reads, FX, weather and more. No signup; ${FREE_CALLS_PER_CALLER} free calls.">
<link rel="canonical" href="${esc(origin)}/tools"><link rel="icon" href="/favicon.ico">
<style>
:root{--bg:#fff;--fg:#1a1a1a;--muted:#5f6368;--line:#e3e5e8;--accent:#0b57d0}
@media (prefers-color-scheme:dark){:root{--bg:#121417;--fg:#e8eaed;--muted:#a3a8ae;--line:#2c3036;--accent:#8ab4f8}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.55 system-ui,-apple-system,Segoe UI,sans-serif}
main{max-width:760px;margin:0 auto;padding:32px 16px 48px}h1{font-size:1.6rem;margin:0 0 8px}h2{font-size:1.1rem;margin:28px 0 8px}
ul{padding-left:20px}li{margin:3px 0}a{color:var(--accent)}.muted{color:var(--muted)}
</style></head><body><main>
<p class="muted"><a href="/">${esc(SERVICE_NAME)}</a></p>
<h1>${esc(title)}</h1>
<p class="muted">Each tool is one GET request that returns JSON, or an MCP tool at <code>${esc(origin)}/mcp</code>. ${FREE_CALLS_PER_CALLER} free calls, then pay per call by card credits, x402 or MPP.</p>
${groups.map((g) => `<h2>${esc(g.name)} (${g.tools.length})</h2><ul>${g.tools.map((e) => `<li><a href="/tools/${esc(toolSlug(e.path))}">${esc(e.summary)}</a> <span class="muted">· ${esc(e.price)}</span></li>`).join("")}</ul>`).join("\n")}
</main></body></html>`;
}
