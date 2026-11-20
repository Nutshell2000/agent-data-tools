// The first call a newcomer makes (16 Nov 2026). The measured problem: agents and people arrive, read a very long
// llms.txt and a large root JSON, meet a 402 whose useful part comes after the payment terms, and leave. So the three
// things a newcomer reads first are short and lead with a call that works without a key or a wallet:
//   /llms.txt   under 8 KB (the long file stays, whole, at /llms-full.txt: discovery.ts `llmsTxt`)
//   GET /       for programs: under 4 KB (the full service card stays at SERVICE_CARD_PATH: discovery.ts `serviceCard`)
//   the hero of the pages for people: the same curl with its real answer (home-page.ts, discovery.ts `homePage`)
// Every number and price here comes from the catalog or a constant; nothing is typed.
import { ENDPOINTS, SERVICE_ID, SERVICE_NAME, SUPPORT_EMAIL, exampleParams, type Endpoint } from "../endpoints";
import { httpFree } from "./capacity";
import { CREDIT_PACKS, CREDIT_PLANS, FREE_KEY_CALLS, USDC_PACKS, usdcPackPath } from "./credits";
import { PRODUCTS } from "./product-pages";
import { salesFirstPaths } from "./discovery-index";
import { FREE_CALLS_PER_CALLER, FREE_CALLS_PER_DAY, FREE_HTTP_CALLS_PER_CALLER, HTTP_FREE_EXCLUDED } from "./free-calls";
import { NETWORK_NAMES, SOLANA_NETWORK } from "./networks";

/** Where the full service card (every tool with its inputs) lives now that "/" answers programs with a short one. */
export const SERVICE_CARD_PATH = "/service-card.json";

const BY_PATH = new Map(ENDPOINTS.map((e) => [e.path, e as Endpoint]));
const queryOf = (e: Endpoint) => exampleParams(e).map(([k, p]) => `${k}=${encodeURIComponent(String(p.example ?? ""))}`).join("&");

/**
 * The tool every first example runs: it computes its answer locally (no outside source, no clock), so the answer shown
 * next to the request is the one a caller gets. tests/first-call.test.cjs runs the printed URL and compares.
 */
export const FIRST_CALL_PATH = "/validate/iban";

/** The keyless first call: the tool's published example request with trial=1, and its published example answer. */
export function firstCall(origin: string): { path: string; summary: string; url: string; curl: string; output: string } | null {
  const e = BY_PATH.get(FIRST_CALL_PATH);
  if (!e || !httpFree(e.path) || e.outputExample === undefined) return null;
  const url = `${origin}${e.path}?${queryOf(e)}&trial=1`;
  return { path: e.path, summary: e.summary, url, curl: `curl "${url}"`, output: JSON.stringify(e.outputExample) };
}

/**
 * Twelve tools for a first look, most-bought jobs first (the order of SALES_FIRST in lib/discovery-index.ts). Only
 * tools a newcomer can run with trial=1 are shown: one that left the free trial, the catalog or SALES_FIRST drops out.
 */
const FEATURED = ["/ai/chat", "/extract", "/stock/brief", "/stock/screen", "/csv/preflight", "/weather/forecast", "/check/x402-seller", "/ai/extract-json", "/ai/summarize-text", "/ai/translate", "/sanctions/check", "/company", "/email", "/domain", "/price/token", "/sec/filings", "/weather", "/check/payee", "/ai/embed", "/package", "/contents"];
export function featuredTools(): Endpoint[] {
  const first = salesFirstPaths();
  return FEATURED.filter((p) => first.includes(p) && httpFree(p)).flatMap((p) => BY_PATH.get(p) ?? []).slice(0, 12);
}

export interface FirstCallFacts {
  /** The name people know the service by (lib/public-brand.ts). */
  brand: string;
  trials: boolean;
  freeKeys: boolean;
  /** x402 networks (CAIP-2, primary first) and MPP methods, as the cards list them (index.ts `paymentRails`). */
  networks: readonly string[];
  mpp: readonly string[];
}

const networkNames = (networks: readonly string[]) => networks.map((n) => (n === SOLANA_NETWORK ? "Solana" : NETWORK_NAMES[n] ?? n)).join(", ");
const [starter] = CREDIT_PACKS;
const usdcLead = USDC_PACKS.find((p) => p.usdCents === 500) ?? USDC_PACKS[0];
const WHAT = "pay-per-call tools for AI agents and developers, over plain HTTP and MCP: speech to text and text to speech, PDFs, documents and web pages to clean text, web search, EU law, company, VAT and sanctions checks, crypto and market data, AI text tools and small utilities";
const excludedFromTrial = `web search and news, the larger AI models and the tools built on them (answers, fact checks, audits), image generation and description, speech and transcription, browser rendering and screenshots, page publishing, and resold LinkedIn and X data; over HTTP also ${[...HTTP_FREE_EXCLUDED].join(" and ")}`;

/** /llms.txt: what this is, a first call that works, how to pay, a dozen tools, where the rest is. Under 8 KB. */
export function llmsShortTxt(origin: string, f: FirstCallFacts): string {
  const call = f.trials ? firstCall(origin) : null;
  const sample = BY_PATH.get(FIRST_CALL_PATH);
  const lines = [
    `# ${f.brand}`,
    "",
    `> ${f.brand}${f.brand === SERVICE_NAME ? "" : ` (listed for agents as ${SERVICE_NAME}, id ${SERVICE_ID})`}, by SpellzCode: ${WHAT}. Every tool is one GET request (a POST with the same inputs as flat JSON works too) that returns JSON at a fixed price. Failed calls are never charged.`,
    "",
    "## First call: no key, no wallet",
    "",
    ...(call ? [
      "```sh",
      call.curl,
      "```",
      "Answer:",
      "```json",
      call.output,
      "```",
      `Add trial=1 to a GET request: every caller gets ${FREE_HTTP_CALLS_PER_CALLER} free successful calls over HTTP. An MCP client gets ${FREE_CALLS_PER_CALLER}, used automatically before any payment. Failed calls do not count; at most ${FREE_CALLS_PER_DAY.toLocaleString("en-US")} free calls a day in total, and the operator can switch them off.`,
      `Not in the free calls (they use paid capacity): ${excludedFromTrial}. A tool's 402 answer starts with \`freeTrial\` and the exact URL when the free calls cover it.`,
    ] : [
      `Free calls are switched off right now, so trial=1 answers the normal 402.${sample ? ` A free look at what a tool returns: add sample=1, for example ${origin}${sample.path}?${queryOf(sample)}&sample=1 (a static example, not a live run).` : ""}`,
    ]),
    `Which tool for a job: GET ${origin}/find?need=<the job in plain words> is free and answers with the exact calls, inputs and prices.`,
    "",
    "## How to pay",
    "",
    `- Card, prepaid credits: ${origin}/credits (from $${starter.usdCents / 100} for ${starter.credits.toLocaleString("en-US")} credits; 1 credit = $${(starter.usdCents / 100 / starter.credits).toFixed(3)}). You get a key: send it as \`Authorization: Bearer adt_…\`, \`X-API-Key\`, or \`api_key=adt_…\` in the URL. Balance: ${origin}/credits/balance`,
    ...(f.freeKeys ? [`- Free key by e-mail: ${origin}/keys/free (${FREE_KEY_CALLS} successful calls each calendar month on every tool that does not use paid capacity; POST {"email":"you@example.com"}, open the link in the message).`] : []),
    `- x402, USDC per call: call any tool URL; the 402 carries the terms in the PAYMENT-REQUIRED header (x402 v2, exact scheme; ${networkNames(f.networks)}) and repeats them in the body. Sign and retry with PAYMENT-SIGNATURE. Every tool with its terms: ${origin}/.well-known/x402`,
    ...(f.mpp.length ? [`- MPP: the same 402 carries a WWW-Authenticate: Payment challenge (${f.mpp.join(", ")}); an mppx client answers it in Authorization: Payment. Details: ${origin}/llms-full.txt`] : []),
    ...(usdcLead ? [`- USDC prepaid: GET ${origin}${usdcPackPath(usdcLead)} with an x402 client pays $${usdcLead.usdCents / 100} once and returns a key with ${usdcLead.credits.toLocaleString("en-US")} credits (${USDC_PACKS.filter((p) => p !== usdcLead).map((p) => `$${p.usdCents / 100}`).join(" or ")} at ${origin}/credits/usdc/<amount>); later calls need no payment each.`] : []),
    "",
    "## Tools to start with",
    "",
    ...featuredTools().map((e) => `- GET ${origin}${e.path}?${queryOf(e)} (${e.price}): ${e.summary}`),
    "",
    "## MCP",
    "",
    `- ${origin}/mcp (streamable HTTP; small: a finder plus popular tools) and ${origin}/mcp/compact (three tools that find, describe and run any tool in the catalog). Same prices; the free calls come first.`,
    `- With a key: send it as \`Authorization: Bearer adt_…\` on the MCP request, or connect ${origin}/mcp/k/<key> when the client cannot set headers.`,
    "",
    "## More",
    "",
    `- Everything, with every tool's inputs and an example: ${origin}/llms-full.txt`,
    `- Signed seller evidence (30-day paid calls and reliability, verifiable with our published key): ${origin}/.well-known/seller-evidence.json`,
    `- OpenAPI 3.1: ${origin}/openapi.json`,
    `- Tools by category, for people: ${origin}/tools`,
    `- Docs (keys, errors, sending a file): ${origin}/docs`,
    // 20 Nov 2026: an LLM reading llms.txt could not discover the focused product pages, the transcription plan or
    // the guides — the exact high-intent pages we want recommended. Name them here; derive the price from the plan.
    `- Monthly plan, one key for every tool: from $${CREDIT_PLANS[0].usdCents / 100}/month (${CREDIT_PLANS[0].credits.toLocaleString("en-US")} credits each month); transcription plan ${origin}/transcribe-pro ($${CREDIT_PLANS[0].usdCents / 100}/month).`,
    `- Focused API pages: ${PRODUCTS.map((p) => `${p.name} ${origin}/${p.slug}`).join("; ")}`,
    `- Guides by job: ${origin}/guides`,
    `- Support: ${SUPPORT_EMAIL}`,
  ];
  return lines.join("\n");
}

/** GET / for programs: the same facts as data, under 4 KB. The full card (every tool) is at SERVICE_CARD_PATH. */
export function rootCard(origin: string, f: FirstCallFacts & { payTo: string }) {
  const call = f.trials ? firstCall(origin) : null;
  return {
    name: f.brand,
    id: SERVICE_ID,
    description: `${f.brand}, by SpellzCode: pay-per-call tools for AI agents and developers over HTTP and MCP. One GET per tool, JSON back, a fixed price, failed calls never charged.`,
    ...(call ? { firstCall: { what: `No key, no wallet: add trial=1 to a GET. ${FREE_HTTP_CALLS_PER_CALLER} free successful calls per caller over HTTP, ${FREE_CALLS_PER_CALLER} over MCP; not for tools that use paid capacity (a tool's 402 starts with freeTrial when it is covered).`, url: call.url } } : {}),
    findATool: `${origin}/find?need=<the job in plain words>`,
    pay: {
      card: `${origin}/credits`,
      ...(f.freeKeys ? { freeKey: `${origin}/keys/free` } : {}),
      // `protocol`, `network` and `payTo` keep the names the full card uses, for readers that only look here.
      x402: { protocol: "x402", version: 2, scheme: "exact", asset: "USDC", network: f.networks[0], networks: f.networks, payTo: f.payTo, how: "Call any tool URL; the 402 carries the terms. Sign and retry with PAYMENT-SIGNATURE." },
      ...(f.mpp.length ? { mpp: f.mpp } : {}),
      ...(usdcLead ? { usdcPrepaid: `${origin}${usdcPackPath(usdcLead)}` } : {}),
      key: "Authorization: Bearer adt_… (or X-API-Key, or api_key=adt_… in the URL)",
    },
    mcp: `${origin}/mcp`,
    links: {
      serviceCard: `${origin}${SERVICE_CARD_PATH}`,
      openapi: `${origin}/openapi.json`,
      llms: `${origin}/llms.txt`,
      llmsFull: `${origin}/llms-full.txt`,
      tools: `${origin}/tools`,
      discovery: `${origin}/discovery/resources`,
      x402: `${origin}/.well-known/x402`,
      credits: `${origin}/credits`,
      ...(f.freeKeys ? { freeKey: `${origin}/keys/free` } : {}),
      docs: `${origin}/docs`,
      status: `${origin}/status`,
      support: `mailto:${SUPPORT_EMAIL}`,
    },
    note: `The full card with every tool, its inputs, price and example is at ${origin}${SERVICE_CARD_PATH} (what this URL used to answer).`,
  };
}
