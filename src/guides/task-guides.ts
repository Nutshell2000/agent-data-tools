// Task guides (31 Oct 2026): one page per job agents search for, titled and pathed as the query they type. Agent search
// engines (Exa, Keenable) rank documentation pages whose title and URL are the task ("pdf to text API"); for the four
// queries measured on 31 Oct our tool pages were absent from Exa's top 10 while Keenable's and Exa's agents were already
// calling our readers. Each guide only restates what the tool's own description says, gives the request in every way
// an agent can make it (free trial, card key in a header or in the URL, x402/MPP, MCP) and links the tool pages.
import { ENDPOINTS, SERVICE_NAME, exampleParams, toolSlug, type Endpoint } from "../endpoints";
import { FREE_CALLS_PER_CALLER } from "../lib/free-calls";
import { CAPACITY_LIMITED } from "../lib/capacity";
import { TOOL_SEO } from "../lib/tool-seo";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const jsonLd = (value: unknown) => JSON.stringify(value).replace(/</g, "\\u003c");
const query = (e: Endpoint) => exampleParams(e).map(([k, p]) => `${k}=${encodeURIComponent(String(p.example))}`).join("&") || "format=json";
const byPath = new Map(ENDPOINTS.map((e) => [e.path, e as Endpoint]));

export interface TaskGuide {
  /** URL slug under /guides/, the query as a path. */
  slug: string;
  /** The task as agents type it; the page title and h1 start with it. */
  phrase: string;
  /** The tools that do the job, main one first. */
  tools: string[];
  /** One sentence on what comes back, restating the tool's description (default: the main tool's description). */
  lead?: string;
  /** When an agent wants this (default: the main tool's TOOL_SEO uses). */
  uses?: string[];
  faq?: [string, string][];
}
const leadOf = (g: TaskGuide, main: Endpoint) => g.lead ?? main.description;
const usesOf = (g: TaskGuide, main: Endpoint) => g.uses ?? TOOL_SEO[main.path]?.uses ?? [];

export const TASK_GUIDES: readonly TaskGuide[] = [
  { slug: "pdf-to-text-api", phrase: "PDF to text API", tools: ["/pdf/text"],
    lead: "Give a public PDF's URL and get its text page by page as JSON, with title, author, page count and character counts; choose the page range.",
    uses: ["Feed a whitepaper, filing, invoice or paper to an LLM", "Read only a page range of a long report", "Index PDF content for retrieval"],
    faq: [["Does it OCR scanned PDFs?", "No. It extracts the text layer; scanned images without a text layer return little or nothing."], ["How large a file?", "Up to 10 MB; the default read is 20 pages, settable with pages."]] },
  { slug: "url-to-markdown-api", phrase: "URL to Markdown API", tools: ["/extract", "/extract/rendered"],
    lead: "Give a public web page's URL and get it back as clean Markdown or text for an LLM, with the page's links, tables and code blocks kept and boilerplate removed.",
    uses: ["Read documentation, articles and product pages into a RAG pipeline", "Pull one section of a long page by heading", "Read JavaScript-rendered pages with the rendered variant"],
    faq: [["Does it run JavaScript?", "/extract reads the page as served; /extract/rendered opens it in a browser first for pages that need one."], ["How long can the output be?", "Set maxChars to cap it; long pages can be read section by section."]] },
  { slug: "ofac-wallet-screening-api", phrase: "OFAC wallet screening API", tools: ["/sanctions/check", "/check/counterparty"],
    lead: "Screen a crypto wallet address or a person or company name against the US Treasury OFAC SDN list, aliases included, and get a block, review or pass verdict with each match's SDN ID and programs.",
    uses: ["Check an address before an agent pays it", "Add a sanctions step to onboarding or payouts", "Combine the sanctions result with wallet risk in one counterparty check"],
    faq: [["Which list?", "The OFAC SDN list, including the listed digital currency addresses, with the list date in every answer."], ["Is this legal advice?", "No. It is a screening aid; confirm a match against official OFAC records before acting."]] },
  { slug: "news-headlines-api", phrase: "News headlines API", tools: ["/news", "/pack/news-sentiment"],
    lead: "Search current news on any topic and get the latest headlines as JSON: title, URL, snippet, publisher domain and age, from the Brave Search news index, 1-20 per call, limited to the past day, week or month on request.",
    uses: ["Give an agent today's headlines on a company, coin or event", "Read a story in full afterwards with the URL to Markdown tool", "Get the tone of the coverage with the news sentiment pack"],
    faq: [["Where do the articles come from?", "The Brave Search API's news index, one request per paid call. Results are for the caller's immediate use: no storing, resale or model training."], ["What if the source is down?", "The call answers 503 and nothing is charged."]] },
  { slug: "describe-image-api", phrase: "Describe image API", tools: ["/describe"],
    lead: "Give an image URL and get a detailed description including any visible text, or ask a question about the image; PNG, JPEG, WebP and GIF up to 3 MB.",
    uses: ["Write alt text", "Read the text in a screenshot or chart", "Check what a picture shows before an agent uses it"],
    faq: [["Which model answers?", "A vision model on Workers AI; its name is returned in the model field."]] },
  { slug: "chat-completions-api", phrase: "Chat completions API, pay per call", tools: ["/ai/chat", "/ai/chat-large"],
    lead: "Send a prompt and get an answer from Meta's Llama 4 Scout for $0.002 a call, or from Llama 3.3 70B or gpt-oss-120b for $0.01, with an optional system prompt and up to 1,024 output tokens; no provider account.",
    uses: ["A cheap model for summaries, classification and drafts inside an agent", "An OpenAI-compatible endpoint (/v1/chat/completions) with function calling and JSON mode", "A larger model by name when the small one is not enough"],
    faq: [["Is there an OpenAI-compatible endpoint?", "Yes: POST /v1/chat/completions, /v1/responses and /v1/embeddings take the same payment methods; a card key works as the SDK apiKey."], ["Which models?", "Llama 4 Scout on /ai/chat; Llama 3.3 70B or gpt-oss-120b on /ai/chat-large; other open models by name under /ai/model/."]] },
  { slug: "token-price-api", phrase: "Token price API", tools: ["/price/token", "/price/tokens"],
    lead: "Get a token's USD price read from its Uniswap v3 pools on chain at call time, by ticker, address or CoinGecko-style id, on Base, Ethereum, Arbitrum, Optimism or Polygon; up to 20 tokens in one call.",
    uses: ["Price long-tail tokens that central feeds do not list", "Value a wallet or a trade inside an agent", "Price several tokens in one call"],
    faq: [["Where does the price come from?", "The token's Uniswap v3 pools on the chosen chain, read on chain when you call."], ["Which inputs work?", "A ticker such as WETH, a 0x address, a CoinGecko id such as coingecko:bitcoin or a coin name."]] },
  // Data-only guides (lead and uses come from the tool's description and TOOL_SEO): the other jobs agents search for,
  // picked from the Bazaar demand probes of 22-25 Oct and the shopper purchases of 28-31 Oct 2026.
  { slug: "web-search-api", phrase: "Web search API, pay per call", tools: ["/search", "/ai/answer"] },
  { slug: "weather-forecast-api", phrase: "Weather forecast API", tools: ["/weather", "/pack/location-brief"] },
  { slug: "company-lookup-api", phrase: "Company lookup API", tools: ["/company", "/pack/domain-intel"] },
  { slug: "email-verification-api", phrase: "Email verification API", tools: ["/email", "/pack/email-deliverability"] },
  { slug: "domain-whois-dns-lookup-api", phrase: "Domain WHOIS and DNS lookup API", tools: ["/domain", "/dns/lookup", "/domain-report"] },
  { slug: "wallet-balance-api", phrase: "Wallet balance API, multi-chain", tools: ["/eth/balance", "/wallet/balances", "/wallet/portfolio"] },
  { slug: "gas-price-api", phrase: "Gas price API", tools: ["/base-gas", "/eth/gas", "/pack/gas-tracker"] },
  { slug: "sec-filings-api", phrase: "SEC filings API", tools: ["/sec/filings", "/sec/insider"] },
  { slug: "hyperliquid-funding-rate-api", phrase: "Hyperliquid funding rate API", tools: ["/hyperliquid/market", "/hyperliquid/funding-history"] },
  { slug: "currency-exchange-rate-api", phrase: "Currency exchange rate API", tools: ["/fx", "/btc-price"] },
  { slug: "public-holidays-api", phrase: "Public holidays API", tools: ["/holidays", "/date/business-days"] },
  { slug: "website-screenshot-api", phrase: "Website screenshot API", tools: ["/screenshot", "/extract/rendered"] },
  { slug: "speech-to-text-api", phrase: "Speech to text API", tools: ["/transcribe"] },
  { slug: "text-embeddings-api", phrase: "Text embeddings API", tools: ["/ai/embed", "/ai/rerank"] },
  { slug: "sitemap-parser-api", phrase: "Sitemap parser API", tools: ["/sitemap", "/robots"] },
  { slug: "crypto-fear-and-greed-index-api", phrase: "Crypto fear and greed index API", tools: ["/crypto/fear-greed", "/pack/crypto-market"] },
  { slug: "bitcoin-fee-estimate-api", phrase: "Bitcoin fee estimate API", tools: ["/btc-fees", "/btc-address"] },
  { slug: "token-honeypot-check-api", phrase: "Token honeypot check API", tools: ["/token-report", "/token", "/contract-risk"] },
  { slug: "new-dex-pools-api", phrase: "New DEX pools API, new token pairs", tools: ["/dex/new-pools", "/uniswap/pool", "/token-report"] },
  { slug: "host-web-page-api", phrase: "Host a web page API for AI agents", tools: ["/page/publish", "/markdown/to-html"] },
];

const BY_SLUG = new Map(TASK_GUIDES.map((g) => [g.slug, g]));
/** The guide that covers a tool, for the link on its tool page. */
export const GUIDE_FOR_TOOL: ReadonlyMap<string, TaskGuide> = new Map(TASK_GUIDES.flatMap((g) => g.tools.map((t) => [t, g] as const)));
export const taskGuide = (slug: string) => BY_SLUG.get(slug);

function toolBlock(e: Endpoint, origin: string, freeCalls: boolean, md: boolean) {
  const request = `${origin}${e.path}?${query(e)}`;
  const free = freeCalls && !CAPACITY_LIMITED.has(e.path);
  const mcp = e.path.slice(1).replace(/[/-]/g, "_");
  const params = Object.entries(e.params).filter(([n]) => n !== "only").map(([n, p]) => `${n}${p.required ? " (required)" : ""}: ${p.description}`);
  const example = JSON.stringify(e.outputExample, null, 2);
  const shown = example.length > 1500 ? `${example.slice(0, 1500)}\n…` : example;
  const lines = [
    `${e.summary}. ${e.price} per successful call; failed calls are never charged.`,
    e.description,
    `Inputs: ${params.join("; ")}.`,
    free ? `Free first (${FREE_CALLS_PER_CALLER} successful calls per caller, no key):\n\n    curl "${request}&trial=1"` : `Not in the free calls (it costs us capacity per call); pay from the first call.`,
    `With a card key from ${origin}/credits, in a header or, when your client can only fetch a URL, in the URL:\n\n    curl -H "Authorization: Bearer adt_…" "${request}"\n    curl "${request}&api_key=adt_…"`,
    `Without a key the same URL answers 402 with x402 and MPP terms, so a wallet client pays USDC per call and retries. Over MCP (${origin}/mcp) this tool is ${mcp}.`,
    `Example result:\n\n${shown.split("\n").map((l) => `    ${l}`).join("\n")}`,
    `Tool page: ${origin}/tools/${toolSlug(e.path)}`,
  ];
  if (md) return lines.join("\n\n");
  return `<section><h2>${esc(e.summary)} <span class="price">${esc(e.price)}</span></h2><p>${esc(e.description)}</p>
<p><strong>Inputs:</strong> ${params.map(esc).join("; ")}.</p>
${free ? `<p>Free first (${FREE_CALLS_PER_CALLER} successful calls per caller, no key):</p><pre><code>curl "${esc(request)}&amp;trial=1"</code></pre>` : `<p>Not in the free calls (it costs capacity per call); pay from the first call.</p>`}
<p>With a card key from <a href="/credits">/credits</a>, in a header or, when your client can only fetch a URL, in the URL:</p><pre><code>curl -H "Authorization: Bearer adt_…" "${esc(request)}"\ncurl "${esc(request)}&amp;api_key=adt_…"</code></pre>
<p>Without a key the same URL answers <code>402 Payment Required</code> with x402 and MPP terms, so a wallet client pays USDC per call and retries. Over MCP (<code>${esc(origin)}/mcp</code>) this tool is <code>${esc(mcp)}</code>.</p>
<details><summary>Example result</summary><pre><code>${esc(shown)}</code></pre></details>
<p><a href="/tools/${esc(toolSlug(e.path))}">Tool page, inputs and limits</a></p></section>`;
}

const STYLE = `:root{--bg:#fff;--fg:#1a1a1a;--muted:#5f6368;--card:#f6f7f9;--line:#e3e5e8;--accent:#0b57d0}
@media (prefers-color-scheme:dark){:root{--bg:#121417;--fg:#e8eaed;--muted:#a3a8ae;--card:#1c1f24;--line:#2c3036;--accent:#8ab4f8}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.55 system-ui,-apple-system,Segoe UI,sans-serif}
main{max-width:760px;margin:0 auto;padding:32px 16px 48px}h1{font-size:1.6rem;line-height:1.25;margin:0 0 8px}h2{font-size:1.15rem;margin:30px 0 8px}h3{font-size:1rem;margin:18px 0 4px}
nav.crumbs{color:var(--muted);font-size:.9rem;margin-bottom:12px}.meta{color:var(--muted);margin:0 0 16px}.price{font-weight:600;color:var(--muted);font-size:.95rem;margin-left:6px}
pre{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:14px;overflow:auto;font-size:.85rem;line-height:1.45}code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
p{margin:8px 0}a{color:var(--accent)}details{margin:8px 0}summary{cursor:pointer;color:var(--muted)}footer{margin-top:36px;color:var(--muted);font-size:.9rem}ul{padding-left:20px}`;

export function taskGuideHtml(slug: string, origin: string, freeCalls: boolean): string | undefined {
  const g = BY_SLUG.get(slug);
  if (!g) return undefined;
  const tools = g.tools.map((p) => byPath.get(p)).filter((e): e is Endpoint => Boolean(e));
  const main = tools[0];
  const title = `${g.phrase}: from ${main.price} per call, no signup · ${SERVICE_NAME}`;
  const url = `${origin}/guides/${g.slug}`;
  const lead = leadOf(g, main), uses = usesOf(g, main);
  const seoFaq = TOOL_SEO[main.path]?.faq ?? [];
  const faq: [string, string][] = [...(g.faq ?? []), ...seoFaq.filter(([q]) => !(g.faq ?? []).some(([gq]) => gq === q)),
    ["How do I pay?", `Each successful call costs the tool's price; failed calls are not charged. ${freeCalls && !CAPACITY_LIMITED.has(main.path) ? `The first ${FREE_CALLS_PER_CALLER} calls are free. Then` : "Then"} pay with card credits from $1 (the key goes in an Authorization header or as api_key= in the URL) or per call in USDC over x402 or MPP. No account is needed.`]];
  const ld = { "@context": "https://schema.org", "@type": "TechArticle", headline: `${g.phrase}`, description: lead, url, author: { "@type": "Organization", name: SERVICE_NAME, url: origin }, about: tools.map((e) => ({ "@type": "WebAPI", name: e.summary, url: `${origin}/tools/${toolSlug(e.path)}`, offers: { "@type": "Offer", price: e.price.replace(/^\$/, ""), priceCurrency: "USD" } })) };
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(lead.slice(0, 300))}">
<link rel="canonical" href="${esc(url)}"><link rel="alternate" type="text/markdown" href="${esc(url)}.md">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(lead.slice(0, 300))}"><meta property="og:url" content="${esc(url)}"><meta property="og:image" content="${esc(origin)}/og.png">
<link rel="icon" href="/favicon.ico">
<script type="application/ld+json">${jsonLd(ld)}</script>
<script type="application/ld+json">${jsonLd({ "@context": "https://schema.org", "@type": "FAQPage", mainEntity: faq.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })) })}</script>
<style>${STYLE}</style></head><body><main>
<nav class="crumbs"><a href="/">${esc(SERVICE_NAME)}</a> › <a href="/guides">Guides</a></nav>
<h1>${esc(g.phrase)}</h1>
<p class="meta">From ${esc(main.price)} per successful call · failed calls are never charged · no account needed · Markdown version: <a href="${esc(`/guides/${g.slug}.md`)}">${esc(`/guides/${g.slug}.md`)}</a></p>
<p>${esc(lead)}</p>
${uses.length ? `<h2>When an agent wants this</h2><ul>${uses.map((u) => `<li>${esc(u)}</li>`).join("")}</ul>` : ""}
${tools.map((e) => toolBlock(e, origin, freeCalls, false)).join("\n")}
<h2>Questions</h2>${faq.map(([q, a]) => `<h3>${esc(q)}</h3><p>${esc(a)}</p>`).join("")}
<footer><a href="/guides">All guides</a> · <a href="/tools">All ${ENDPOINTS.length} tools</a> · <a href="/llms.txt">Docs for agents</a> · <a href="/openapi.json">OpenAPI</a> · <a href="/status">Reliability</a> · <a href="/terms">Terms</a> · <a href="/privacy">Privacy</a></footer>
</main></body></html>`;
}

export function taskGuideMarkdown(slug: string, origin: string, freeCalls: boolean): string | undefined {
  const g = BY_SLUG.get(slug);
  if (!g) return undefined;
  const tools = g.tools.map((p) => byPath.get(p)).filter((e): e is Endpoint => Boolean(e));
  const uses = usesOf(g, tools[0]);
  return [`# ${g.phrase}`, leadOf(g, tools[0]), ...(uses.length ? [`## When an agent wants this`, uses.map((u) => `- ${u}`).join("\n")] : []),
    ...tools.map((e) => `## ${e.summary}\n\n${toolBlock(e, origin, freeCalls, true)}`),
    `## Questions`, ...(g.faq ?? []).map(([q, a]) => `**${q}** ${a}`),
    `Docs for agents: ${origin}/llms.txt · OpenAPI: ${origin}/openapi.json · All guides: ${origin}/guides`].join("\n\n") + "\n";
}

/** /guides: the task guides and the older buying guides. */
export function guidesIndexHtml(origin: string): string {
  const older: [string, string][] = [["/guides/web-reading", "Read a web page with a capped x402 client"], ["/guides/sitemap", "Discover documentation URLs from a sitemap"], ["/guides/bitcoin-fees", "Bitcoin fee estimates"], ["/guides/dependency-audit", "Dependency audit buying guide"], ["/guides/local-mcp", "Local MCP adapter"]];
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Guides: pay-per-call data tools for AI agents · ${esc(SERVICE_NAME)}</title><meta name="description" content="How to do common agent jobs with Agent Data Tools: PDF to text, URL to Markdown, OFAC wallet screening, news headlines, image description, chat completions and token prices, pay per call with a free trial."><link rel="canonical" href="${esc(origin)}/guides"><link rel="icon" href="/favicon.ico"><style>${STYLE}</style></head><body><main>
<nav class="crumbs"><a href="/">${esc(SERVICE_NAME)}</a> › Guides</nav><h1>Guides</h1>
<p>One page per job, with the request in every way an agent can make it: free trial, card key, x402 or MPP, MCP.</p>
<ul>${TASK_GUIDES.map((g) => { const e = byPath.get(g.tools[0]); return `<li><a href="/guides/${esc(g.slug)}">${esc(g.phrase)}</a>${e ? ` · from ${esc(e.price)}: ${esc(leadOf(g, e).slice(0, 160))}` : ""}</li>`; }).join("")}</ul>
<h2>Buying guides and clients</h2><ul>${older.map(([h, t]) => `<li><a href="${esc(h)}">${esc(t)}</a></li>`).join("")}</ul>
<footer><a href="/tools">All ${ENDPOINTS.length} tools</a> · <a href="/llms.txt">Docs for agents</a> · <a href="/openapi.json">OpenAPI</a></footer></main></body></html>`;
}
