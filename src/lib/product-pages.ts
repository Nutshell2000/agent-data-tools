// Focused product pages for people who arrive from a search engine: one page per product, written for a developer
// deciding in ten seconds. What it does, a way to try it, the request in curl, Python and Node, the answer, and the
// monthly plan first. The tool pages (/tools/<slug>) stay the reference; these are the front door.
//
// Why (audit of 14 Nov 2026): every solo API seller found above $1,000 a month sells a focused product by monthly
// plan from its own pages, found through search, while our pages opened with payment protocols. Copy here may only
// restate what the tools' own descriptions and limits say. Prices and call counts are computed from the catalog and
// the plans, never typed, so a price change cannot leave a wrong number on a page.
import { ENDPOINTS, SERVICE_NAME, exampleParams, toolSlug, type Endpoint } from "../endpoints";
import { WEB_PACKS, WEB_PLANS, PLAN_PORTAL_URL, callsAt } from "./credits";
import { keyPrice } from "./key-prices";
import { FREE_CALLS_PER_CALLER } from "./free-calls";
import { TRY_FORM_CSS, tryForm } from "./try-form";
import { COMPANY_FOOTER } from "./legal";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const jsonLd = (value: unknown) => JSON.stringify(value).replace(/</g, "\\u003c");

export interface Product {
  /** URL path of the page, without the leading slash. */
  slug: string;
  /** The search phrase: page title and h1. */
  name: string;
  /** One sentence under the h1: input, output, how. */
  tagline: string;
  /** The tool the page sells first: its example drives the code samples and the try form. */
  tool: string;
  /** Other tools the same key covers, shown as "also included". */
  also: readonly string[];
  /** Three or four short benefits, each a fact from the tool's description. */
  points: readonly string[];
  /** What it does not do, stated plainly. */
  limits: readonly string[];
  /** The noun a plan is counted in ("PDFs", "pages", "checks"). */
  unit: string;
  faq: readonly (readonly [string, string])[];
  /** Guides to link, by slug. */
  guides: readonly string[];
}

export const PRODUCTS: readonly Product[] = [
  {
    slug: "pdf-to-text-api",
    name: "PDF to text API",
    tagline: "Send the URL of a PDF, get its text back as JSON, page by page. One GET request, no SDK.",
    tool: "/pdf/text",
    also: ["/extract", "/arxiv/search"],
    points: [
      "Text per page, with the title, author and page count",
      "Read only the pages you need: a first page and a page count, up to 200 pages a call",
      "Files up to 10 MB; arXiv abstract links work as they are",
      "A file that cannot be read (scanned, encrypted, not a PDF) is never charged",
    ],
    limits: [
      "No OCR: it reads the text layer, so a scanned PDF without one returns little or nothing (and is not charged).",
      "Public URLs only: no uploads, logins or password-protected files.",
    ],
    unit: "PDFs",
    faq: [
      ["Does it OCR scanned PDFs?", "No. It extracts the text layer. A scanned file without one fails and is not charged."],
      ["How large can the PDF be?", "Up to 10 MB, and up to 200 pages in one call. Ask for a first page and a page count to read a long report in parts."],
      ["Can I send a file instead of a URL?", "No. The PDF has to be at a public http or https URL."],
      ["What happens when the site blocks the download?", "The Internet Archive's dated copy is read when there is one, and the answer says so. If nothing can be read, the call is not charged."],
      ["Is there a subscription?", "There is a monthly plan and there are one-off credit packs. Both give one API key; a plan adds credits each month and unused credits stay."],
    ],
    guides: ["pdf-to-text-api-python", "pdf-to-text-api-nodejs", "pdf-to-text-api", "extract-text-from-pdf-url", "pdf-parser-api-for-llm-and-rag", "arxiv-paper-to-text-api"],
  },
  {
    slug: "web-page-to-markdown-api",
    name: "Web page to Markdown API",
    tagline: "Send a page URL, get clean Markdown or text for an LLM: main content, headings, tables, code blocks and links.",
    tool: "/extract",
    also: ["/extract/rendered", "/pdf/text", "/sitemap"],
    points: [
      "Main content as Markdown or plain text, with code blocks, tables, links and headings kept",
      "Up to 100,000 output characters a call (20,000 by default), or one section by its ID",
      "Pages that build their content with JavaScript: the rendered reader loads them in a real browser",
      "Empty pages, browser challenges and errors are never charged",
    ],
    limits: [
      "Public pages only: no logins or paywalls.",
      "The static reader does not run JavaScript; use the rendered reader for single-page apps.",
    ],
    unit: "pages",
    faq: [
      ["Does it render JavaScript?", "The static reader does not. The rendered reader loads the page in a real browser first and returns the same output; it costs more per call."],
      ["How much of a page do I get?", "20,000 characters by default and up to 100,000 a call. Pass a section ID to read one part of a long page."],
      ["What is not charged?", "Empty pages, missing sections, browser challenges and errors."],
      ["Is there a subscription?", "There is a monthly plan and there are one-off credit packs. Both give one API key; a plan adds credits each month and unused credits stay."],
    ],
    guides: ["url-to-markdown-api", "sitemap-parser-api"],
  },
  {
    slug: "company-check-api",
    name: "Company check API",
    tagline: "Check a business before you invoice or pay it: EU VAT number, Swedish, Norwegian, Finnish and French company registers, and the OFAC sanctions list. One GET request each.",
    tool: "/vat/validate",
    also: ["/se/company", "/no/company", "/fi/company", "/fr/company", "/sanctions/check", "/lei/lookup"],
    points: [
      "EU VAT numbers checked against the European Commission's VIES service, with the registered name and address where the member state shares them",
      "Company registers of Sweden, Norway, Finland and France: legal form, status, bankruptcy or liquidation, registration date, industry codes, address",
      "OFAC SDN screening of a person or company name, with a block, review or pass verdict",
      "Legal Entity Identifiers from GLEIF by LEI or company name",
    ],
    limits: [
      "Register facts only: this is not a credit report and gives no credit score.",
      "Sanctions screening is an aid, not legal advice; it covers the OFAC SDN list.",
    ],
    unit: "checks",
    faq: [
      ["Which countries are covered?", "VAT validation covers every EU member state and Northern Ireland through VIES. The company registers are Sweden (Bolagsverket and SCB), Norway (Brønnøysund), Finland (PRH) and France (Sirene)."],
      ["Is this a credit report?", "No. It returns facts from public registers: names, legal form, status, dates, industry codes and addresses. No credit score and no personal data about owners."],
      ["How fresh is the data?", "Norway, Finland and France are read live from the register. Sweden is the register's weekly open data. VAT numbers are checked live against VIES."],
      ["Is there a subscription?", "There is a monthly plan and there are one-off credit packs. Both give one API key; a plan adds credits each month and unused credits stay."],
    ],
    guides: ["company-lookup-api", "ofac-wallet-screening-api"],
  },
];

const BY_SLUG = new Map(PRODUCTS.map((p) => [p.slug, p]));
const BY_PATH = new Map(ENDPOINTS.map((e) => [e.path, e as Endpoint]));
export const productBySlug = (slug: string) => BY_SLUG.get(slug);
export const productPaths = () => PRODUCTS.map((p) => `/${p.slug}`);
/** The product page that sells a tool, for links from its tool page. */
export const PRODUCT_FOR_TOOL: ReadonlyMap<string, Product> = new Map(PRODUCTS.map((p) => [p.tool, p] as const));

/** What a prepaid key pays for a tool: its key price where one exists, otherwise the listed price. */
const keyPriceOf = (e: Endpoint) => keyPrice(e.path, e.price);

/** Plans first, then packs: each with how many of the product's unit it pays for at the key price. */
export function productOffers(p: Product, cardReady = true): { label: string; calls: string; url: string; monthly: boolean }[] {
  if (!cardReady) return [];
  const e = BY_PATH.get(p.tool)!;
  const price = keyPriceOf(e);
  return [
    ...WEB_PLANS.map((plan) => ({ label: `$${plan.usdCents / 100} a month`, calls: callsAt(plan.credits, price), url: plan.url as string, monthly: true })),
    ...WEB_PACKS.map((pack) => ({ label: `$${pack.usdCents / 100} once`, calls: callsAt(pack.credits, price), url: pack.url as string, monthly: false })),
  ];
}

function samples(e: Endpoint, origin: string) {
  const pairs = exampleParams(e).map(([name, p]) => [name, String(p.example ?? "")] as const);
  const query = pairs.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
  const url = `${origin}${e.path}`;
  const pyParams = pairs.map(([k, v]) => `    ${JSON.stringify(k)}: ${JSON.stringify(v)},`).join("\n");
  const jsParams = pairs.map(([k, v]) => `  ${k}: ${JSON.stringify(v)},`).join("\n");
  return {
    curl: `curl -H "Authorization: Bearer $API_KEY" \\\n  "${url}?${query}"`,
    python: `import os, requests\n\nr = requests.get(\n    "${url}",\n    params={\n${pyParams}\n    },\n    headers={"Authorization": f"Bearer {os.environ['API_KEY']}"},\n    timeout=60,\n)\nr.raise_for_status()\nprint(r.json())`,
    node: `const params = new URLSearchParams({\n${jsParams}\n});\nconst r = await fetch(\`${url}?\${params}\`, {\n  headers: { Authorization: \`Bearer \${process.env.API_KEY}\` },\n});\nif (!r.ok) throw new Error(await r.text());\nconsole.log(await r.json());`,
  };
}

const STYLE = `:root{--bg:#fff;--fg:#16181d;--muted:#5b616b;--card:#f5f6f8;--line:#e2e5ea;--accent:#0b57d0;--accent-fg:#fff;--ok:#0b6e4f}
@media (prefers-color-scheme:dark){:root{--bg:#111316;--fg:#e9ebee;--muted:#a2a8b0;--card:#1a1d22;--line:#2b3037;--accent:#8ab4f8;--accent-fg:#0b1a33;--ok:#5fd0a5}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.6 system-ui,-apple-system,Segoe UI,sans-serif}
main{max-width:820px;margin:0 auto;padding:28px 16px 56px}nav.crumbs{color:var(--muted);font-size:.9rem;margin-bottom:18px}
h1{font-size:2.1rem;line-height:1.15;margin:0 0 10px;letter-spacing:-.01em}.tag{font-size:1.15rem;color:var(--muted);margin:0 0 18px}
h2{font-size:1.25rem;margin:38px 0 10px}h3{font-size:1rem;margin:18px 0 4px}p{margin:8px 0}a{color:var(--accent)}
ul.points{list-style:none;padding:0;margin:0 0 8px}ul.points li{padding:5px 0 5px 26px;position:relative}ul.points li::before{content:"\\2713";position:absolute;left:2px;color:var(--ok);font-weight:700}
.actions{display:flex;flex-wrap:wrap;gap:10px;margin:18px 0 6px}.btn{display:inline-block;padding:11px 18px;border-radius:8px;border:1px solid var(--line);color:var(--fg);text-decoration:none;font-weight:600}
.btn.primary{background:var(--accent);border-color:var(--accent);color:var(--accent-fg)}
pre{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:14px;overflow:auto;font-size:.85rem;line-height:1.5;margin:6px 0 14px}code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
.plans{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;margin:12px 0}.plan{border:1px solid var(--line);border-radius:10px;padding:14px;background:var(--card)}
.plan.lead{border-color:var(--accent)}.plan b{display:block;font-size:1.15rem}.plan span{display:block;color:var(--muted);margin:2px 0 10px}.plan a{font-weight:600}
.small{color:var(--muted);font-size:.9rem}table{border-collapse:collapse;width:100%;font-size:.93rem}td,th{border-bottom:1px solid var(--line);padding:8px 6px;text-align:left;vertical-align:top}.wrap{overflow-x:auto}
footer{margin-top:40px;color:var(--muted);font-size:.9rem}`;

/**
 * The page. `tryIt` is true when a browser may run the main tool free here (the HTTP trial, or the capped PDF try);
 * `tryLabel` names a capped try. `guideTitle` resolves a guide slug to its phrase (the guides module imports
 * nothing from here, so the route passes it in).
 */
export function productPage(p: Product, origin: string, tryIt: boolean, guideTitle: (slug: string) => string | undefined, tryLabel?: string, cardReady = true): string {
  const e = BY_PATH.get(p.tool)!;
  const url = `${origin}/${p.slug}`;
  const s = samples(e, origin);
  const offers = productOffers(p, cardReady);
  const lead = offers.find((o) => o.monthly) ?? offers[0];
  const keyPrice = keyPriceOf(e);
  const example = JSON.stringify(e.outputExample, null, 2);
  const shown = example.length > 2500 ? `${example.slice(0, 2500)}\n…` : example;
  const title = `${p.name}: ${lead ? `from ${lead.label.replace(" once", "")}` : `${keyPrice} per call`} · ${SERVICE_NAME}`;
  const description = `${p.tagline} ${lead ? `${lead.label}: ${lead.calls} ${p.unit}.` : ""} Failed calls are never charged.`.slice(0, 300);
  const also = p.also.map((path) => BY_PATH.get(path)).filter((o): o is Endpoint => Boolean(o));
  const guides = p.guides.map((g) => [g, guideTitle(g)] as const).filter((g): g is readonly [string, string] => Boolean(g[1]));
  const params = Object.entries(e.params).filter(([name]) => name !== "only");
  const ld = {
    "@context": "https://schema.org", "@type": "WebAPI", name: p.name, description: p.tagline, url, documentation: `${origin}/tools/${toolSlug(e.path)}`,
    provider: { "@type": "Organization", name: SERVICE_NAME, url: origin },
    offers: offers.map((o) => ({ "@type": "Offer", price: o.label.replace(/[^0-9.]/g, ""), priceCurrency: "USD", description: `${o.label}: ${o.calls} ${p.unit}` })),
  };
  const faqLd = { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: p.faq.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })) };
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(url)}">
<meta property="og:type" content="website"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(url)}"><meta property="og:image" content="${esc(origin)}/og.png">
<link rel="icon" href="/favicon.ico">
<script type="application/ld+json">${jsonLd(ld)}</script>
<script type="application/ld+json">${jsonLd(faqLd)}</script>
<style>${STYLE}${tryIt ? TRY_FORM_CSS : ""}</style></head><body><main>
<nav class="crumbs"><a href="/">${esc(SERVICE_NAME)}</a></nav>
<h1>${esc(p.name)}</h1>
<p class="tag">${esc(p.tagline)}</p>
<ul class="points">${p.points.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
<div class="actions">
${tryIt ? `<a class="btn primary" href="#try">${esc(tryLabel ?? "Try it free")}</a>` : ""}
<a class="btn${tryIt ? "" : " primary"}" href="#pricing">${lead ? `Plans from ${esc(lead.label.replace(" once", ""))}` : "Pricing"}</a>
<a class="btn" href="${esc(`${e.path}?${exampleParams(e).map(([k, v]) => `${k}=${encodeURIComponent(String(v.example ?? ""))}`).join("&")}&sample=1`)}">Sample answer (JSON)</a>
</div>
<p class="small">No account to create. Failed calls are never charged.</p>

<h2>One request</h2>
<pre><code>${esc(s.curl)}</code></pre>
<h3>Python</h3>
<pre><code>${esc(s.python)}</code></pre>
<h3>Node.js</h3>
<pre><code>${esc(s.node)}</code></pre>
<h2>The answer</h2>
<pre><code>${esc(shown)}</code></pre>
${tryIt ? `<div id="try">${tryForm(e, undefined, tryLabel ?? "Try it on your own input")}</div>` : ""}

<h2 id="pricing">Pricing</h2>
<p>One API key, paid by card through Stripe. ${esc(keyPrice)} per successful call with a key; failed calls cost nothing.</p>
${offers.length ? "" : `<p><a href="/credits">Credits and plans</a></p>`}
<div class="plans">${offers.map((o) => `<div class="plan${o === lead ? " lead" : ""}"><b>${esc(o.label)}</b><span>${esc(o.calls)} ${esc(p.unit)}${o.monthly ? " each month" : ""}</span><a href="${esc(o.url)}">${o.monthly ? "Start plan" : "Buy"}</a></div>`).join("")}</div>
<p class="small">A plan adds its credits each month when the payment succeeds; unused credits stay, and you can <a href="${esc(PLAN_PORTAL_URL)}">cancel at any time</a>. Packs never expire. After paying you get your key on the next page. The same key works on <a href="/tools">every tool in the catalog</a>. Details: <a href="/credits">credits and plans</a>.</p>

${params.length ? `<h2>Inputs</h2><div class="wrap"><table><tr><th>Name</th><th>Type</th><th>Description</th></tr>${params.map(([name, q]) => `<tr><td><code>${esc(name)}</code>${q.required ? " (required)" : ""}</td><td>${esc(q.type)}</td><td>${esc(q.description)}</td></tr>`).join("")}</table></div>` : ""}

<h2>What it does not do</h2>
<ul>${p.limits.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>

${also.length ? `<h2>Also on the same key</h2><ul>${also.map((o) => `<li><a href="/tools/${esc(toolSlug(o.path))}">${esc(o.summary)}</a> · ${esc(keyPriceOf(o))} a call</li>`).join("")}</ul>` : ""}

<h2>Questions</h2>
${p.faq.map(([q, a]) => `<h3>${esc(q)}</h3><p>${esc(a)}</p>`).join("")}

${guides.length ? `<h2>Guides</h2><ul>${guides.map(([g, t]) => `<li><a href="/guides/${esc(g)}">${esc(t)}</a></li>`).join("")}</ul>` : ""}

<h2>For AI agents</h2>
<p>The same tool is on the MCP server <code>${esc(origin)}/mcp</code> (the first ${FREE_CALLS_PER_CALLER} successful calls are free), and an agent with a wallet can pay per call in USDC: the tool URL answers <code>402 Payment Required</code> with x402 and MPP terms. Reference: <a href="/tools/${esc(toolSlug(e.path))}">tool page</a> · <a href="/openapi.json">OpenAPI</a> · <a href="/llms.txt">docs for agents</a>.</p>
<footer>${PRODUCTS.filter((o) => o !== p).map((o) => `<a href="/${esc(o.slug)}">${esc(o.name)}</a>`).join(" · ")} · <a href="/tools">All ${ENDPOINTS.length} tools</a> · ${COMPANY_FOOTER}</footer>
</main></body></html>`;
}
