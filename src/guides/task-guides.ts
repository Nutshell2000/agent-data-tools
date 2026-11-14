// Task guides (31 Oct 2026): one page per job agents search for, titled and pathed as the query they type. Agent search
// engines (Exa, Keenable) rank documentation pages whose title and URL are the task ("pdf to text API"); for the four
// queries measured on 31 Oct our tool pages were absent from Exa's top 10 while Keenable's and Exa's agents were already
// calling our readers. Each guide only restates what the tool's own description says, gives the request in every way
// an agent can make it (free trial, card key in a header or in the URL, x402/MPP, MCP) and links the tool pages.
import { PRODUCT_FOR_TOOL } from "../lib/product-pages";
import { ENDPOINTS, SERVICE_NAME, exampleParams, toolSlug, type Endpoint } from "../endpoints";
import { FREE_HTTP_CALLS_PER_CALLER } from "../lib/free-calls";
import { CAPACITY_LIMITED, httpFree } from "../lib/capacity";
import { keyOfferNumbers } from "../lib/key-prices";
import { TOOL_SEO } from "../lib/tool-seo";
import { COMPANY_FOOTER } from "../lib/legal";

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
  /** A further page for a tool that already has its guide: the tool's own page keeps linking the main one. */
  secondary?: boolean;
  /** A complete script for the main tool in one language, shown right under the lead. `{origin}` is replaced. */
  code?: { language: string; text: string };
}
const leadOf = (g: TaskGuide, main: Endpoint) => g.lead ?? main.description;
const usesOf = (g: TaskGuide, main: Endpoint) => g.uses ?? TOOL_SEO[main.path]?.uses ?? [];

export const TASK_GUIDES: readonly TaskGuide[] = [
  { slug: "pdf-to-text-api", phrase: "PDF to text API", tools: ["/pdf/text"],
    lead: "Give a public PDF's URL and get its text page by page as JSON, with title, author, page count and character counts; choose the page range.",
    uses: ["Feed a whitepaper, filing, invoice or paper to an LLM", "Read only a page range of a long report", "Index PDF content for retrieval"],
    faq: [["Does it OCR scanned PDFs?", "No. It extracts the text layer; scanned images without a text layer return little or nothing."], ["How large a file?", "Up to 10 MB; the default read is 20 pages, settable with pages."]] },
  // 14 Nov 2026: three more PDF pages. Search Console and the funnel: the PDF tool page and its guide took most of the 540
  // Google visits of 1-14 Nov. Each page answers a different search and restates only what /pdf/text does.
  { slug: "extract-text-from-pdf-url", secondary: true, phrase: "Extract text from a PDF URL", tools: ["/pdf/text"],
    lead: "Send the link to a public PDF and get the text of the pages you ask for, one entry per page, without downloading or parsing the file yourself.",
    uses: ["Read a PDF your agent was given as a link", "Take pages 10 to 15 of a long report with firstPage and pages", "Check a PDF's page count, title and author before reading it"],
    faq: [["Which pages do I get?", "The first 20 by default. Set firstPage and pages (up to 200) to choose the range; totalPages in the answer says how long the file is."], ["What if the site blocks the download?", "The Internet Archive's dated copy of the same URL is read when there is one, and the answer says so with the date of the copy. With no copy the call fails and is not charged."]] },
  { slug: "pdf-parser-api-for-llm-and-rag", secondary: true, phrase: "PDF parser API for LLMs and RAG", tools: ["/pdf/text", "/ai/embed"],
    lead: "Turn a PDF at a URL into page-by-page text with a character count per page, capped at the length you set, ready to chunk and embed.",
    uses: ["Chunk a PDF by page for a retrieval index", "Keep a document inside a model's context with maxChars", "Embed the pages with the embeddings tool in the same workflow"],
    faq: [["Does it return tables and images?", "It returns the text layer in reading order. Images are not returned, and a table comes back as its text."], ["How do I keep the answer small?", "maxChars caps the text returned across all pages (1,000 to 200,000 characters); truncated in the answer says when the cap was hit."]] },
  { slug: "arxiv-paper-to-text-api", secondary: true, phrase: "arXiv paper to text API", tools: ["/pdf/text", "/arxiv/search"],
    lead: "Give an arXiv link, abstract page or PDF, and get the paper's text page by page; find the paper first by topic or ID with the arXiv search tool.",
    uses: ["Read a preprint into an LLM from its arXiv link", "Search arXiv by topic, then read the papers that matter", "Pull only the first pages (abstract and introduction) of many papers"],
    faq: [["Do abstract links work?", "Yes. An arxiv.org/abs/ link is read as the paper's PDF."], ["Does it work for scanned old papers?", "Only when the PDF has a text layer; scanned images without one return little or nothing."]] },
  // 14 Nov 2026: the searches a developer types. Each page is the same tool with a complete script in that language.
  { slug: "pdf-to-text-api-python", secondary: true, phrase: "PDF to text API in Python", tools: ["/pdf/text"],
    lead: "Extract the text of a PDF at a URL from Python with one GET request: no PDF library to install, the answer is JSON with one entry per page.",
    uses: ["Read a PDF in a script or notebook without pdfminer or PyPDF", "Loop over a long report 20 pages at a time", "Hand page text to an LLM or an embedding step"],
    code: { language: "Python", text: "import os, requests\n\nAPI = \"{origin}/pdf/text\"\nHEADERS = {\"Authorization\": f\"Bearer {os.environ['API_KEY']}\"}\n\ndef pdf_text(url, first_page=1, pages=20):\n    r = requests.get(API, params={\"url\": url, \"firstPage\": first_page, \"pages\": pages}, headers=HEADERS, timeout=60)\n    r.raise_for_status()\n    return r.json()\n\ndoc = pdf_text(\"https://bitcoin.org/bitcoin.pdf\")\nprint(doc[\"totalPages\"], \"pages\")\nfor page in doc[\"pages\"]:\n    print(page[\"page\"], page[\"text\"][:200])" },
    faq: [["Do I need a PDF library?", "No. The file is fetched and parsed on the server; your script only needs an HTTP client such as requests."], ["How do I read a whole long PDF?", "Call it in steps: firstPage 1, 21, 41 and so on with pages 20, until firstPage passes totalPages. Up to 200 pages fit in one call."]] },
  { slug: "pdf-to-text-api-nodejs", secondary: true, phrase: "PDF to text API in Node.js", tools: ["/pdf/text"],
    lead: "Extract the text of a PDF at a URL from Node.js or TypeScript with one fetch call: no pdf.js to bundle, the answer is JSON with one entry per page.",
    uses: ["Read a PDF in a serverless function where a PDF library is too heavy", "Loop over a long report 20 pages at a time", "Hand page text to an LLM or an embedding step"],
    code: { language: "Node.js", text: "const API = \"{origin}/pdf/text\";\n\nasync function pdfText(url, firstPage = 1, pages = 20) {\n  const params = new URLSearchParams({ url, firstPage, pages });\n  const r = await fetch(`${API}?${params}`, {\n    headers: { Authorization: `Bearer ${process.env.API_KEY}` },\n  });\n  if (!r.ok) throw new Error(await r.text());\n  return r.json();\n}\n\nconst doc = await pdfText(\"https://bitcoin.org/bitcoin.pdf\");\nconsole.log(doc.totalPages, \"pages\");\nfor (const page of doc.pages) console.log(page.page, page.text.slice(0, 200));" },
    faq: [["Does it run in a serverless or edge function?", "Yes. It is one HTTPS request with fetch; nothing is installed and no file is held in memory on your side."], ["How do I read a whole long PDF?", "Call it in steps: firstPage 1, 21, 41 and so on with pages 20, until firstPage passes totalPages. Up to 200 pages fit in one call."]] },
  // 14 Nov 2026: the company-check product's guides. VAT validation had no guide; businesses search it by language.
  { slug: "eu-vat-number-validation-api", phrase: "EU VAT number validation API", tools: ["/vat/validate", "/se/company"],
    lead: "Check an EU VAT number against the European Commission's VIES service with one GET request: valid or not, with the registered name and address where the member state shares them.",
    uses: ["Validate a B2B customer's VAT number at checkout before invoicing without VAT", "Re-check supplier VAT numbers in an accounting or ERP job", "Fill in a company's registered name and address from its VAT number"],
    faq: [["Which countries does it cover?", "Every EU member state and Northern Ireland (prefix XI) through VIES. Greece is EL; a number sent with GR is checked as EL."], ["What if VIES or a member state is busy?", "The check is retried for busy signals. If no clear answer comes, the call fails and is not charged; it never answers not valid by default."], ["Does every country return the name and address?", "No. Each member state decides; Germany and Spain return valid or not valid only."]] },
  { slug: "eu-vat-number-validation-api-python", secondary: true, phrase: "Validate an EU VAT number in Python", tools: ["/vat/validate"],
    lead: "Validate an EU VAT number from Python with one GET request to an API that asks VIES for you: no SOAP client, no zeep, JSON back.",
    uses: ["Check a customer's VAT number in a Django or Flask checkout", "Validate a spreadsheet of supplier VAT numbers in a script", "Skip the VIES SOAP service and its WSDL"],
    code: { language: "Python", text: "import os, requests\n\nAPI = \"{origin}/vat/validate\"\nHEADERS = {\"Authorization\": f\"Bearer {os.environ['API_KEY']}\"}\n\ndef check_vat(vat):\n    r = requests.get(API, params={\"vat\": vat}, headers=HEADERS, timeout=30)\n    if r.status_code >= 500:\n        return None  # VIES or the member state gave no answer: try again later\n    r.raise_for_status()\n    return r.json()\n\nresult = check_vat(\"SE556703748501\")\nif result is None:\n    print(\"no answer right now\")\nelif result[\"valid\"]:\n    print(\"valid:\", result.get(\"name\"), result.get(\"address\"))\nelse:\n    print(\"not valid\")" },
    faq: [["Do I need a SOAP library?", "No. The API speaks to VIES; your code sends one HTTPS GET and reads JSON."], ["How should I treat an error?", "As no answer, not as not valid. A 5xx means VIES or the member state could not be reached; the call is not charged and can be repeated."]] },
  { slug: "eu-vat-number-validation-api-nodejs", secondary: true, phrase: "Validate an EU VAT number in Node.js", tools: ["/vat/validate"],
    lead: "Validate an EU VAT number from Node.js or TypeScript with one fetch call to an API that asks VIES for you: no SOAP package, JSON back.",
    uses: ["Check a customer's VAT number in a checkout or sign-up form handler", "Validate VAT numbers in a serverless function", "Skip the VIES SOAP service and its WSDL"],
    code: { language: "Node.js", text: "const API = \"{origin}/vat/validate\";\n\nasync function checkVat(vat) {\n  const r = await fetch(`${API}?${new URLSearchParams({ vat })}`, {\n    headers: { Authorization: `Bearer ${process.env.API_KEY}` },\n  });\n  if (r.status >= 500) return null; // VIES or the member state gave no answer: try again later\n  if (!r.ok) throw new Error(await r.text());\n  return r.json();\n}\n\nconst result = await checkVat(\"SE556703748501\");\nif (result === null) console.log(\"no answer right now\");\nelse if (result.valid) console.log(\"valid:\", result.name, result.address);\nelse console.log(\"not valid\");" },
    faq: [["Do I need a SOAP package?", "No. The API speaks to VIES; your code sends one HTTPS GET and reads JSON."], ["How should I treat an error?", "As no answer, not as not valid. A 5xx means VIES or the member state could not be reached; the call is not charged and can be repeated."]] },
  { slug: "eu-vat-number-validation-api-php", secondary: true, phrase: "Validate an EU VAT number in PHP", tools: ["/vat/validate"],
    lead: "Validate an EU VAT number from PHP with one HTTPS request to an API that asks VIES for you: no SoapClient extension, JSON back.",
    uses: ["Check a customer's VAT number in a WooCommerce, Laravel or plain PHP checkout", "Validate VAT numbers on hosting without the SOAP extension", "Skip the VIES SOAP service and its WSDL"],
    code: { language: "PHP", text: "<?php\nfunction check_vat(string $vat): ?array {\n    $ch = curl_init('{origin}/vat/validate?' . http_build_query(['vat' => $vat]));\n    curl_setopt_array($ch, [\n        CURLOPT_RETURNTRANSFER => true,\n        CURLOPT_TIMEOUT => 30,\n        CURLOPT_HTTPHEADER => ['Authorization: Bearer ' . getenv('API_KEY')],\n    ]);\n    $body = curl_exec($ch);\n    $status = curl_getinfo($ch, CURLINFO_HTTP_CODE);\n    curl_close($ch);\n    if ($body === false || $status >= 500) return null; // no answer: try again later\n    if ($status !== 200) throw new RuntimeException($body);\n    return json_decode($body, true);\n}\n\n$result = check_vat('SE556703748501');\nif ($result === null) echo \"no answer right now\\n\";\nelseif ($result['valid']) echo 'valid: ' . ($result['name'] ?? '') . \"\\n\";\nelse echo \"not valid\\n\";" },
    faq: [["Do I need the SOAP extension?", "No. The API speaks to VIES; your code sends one HTTPS GET with cURL and reads JSON."], ["How should I treat an error?", "As no answer, not as not valid. A 5xx means VIES or the member state could not be reached; the call is not charged and can be repeated."]] },
  { slug: "url-to-markdown-api", phrase: "URL to Markdown API", tools: ["/extract", "/extract/rendered"],
    lead: "Give a public web page's URL and get it back as clean Markdown or text for an LLM, with the page's links, tables and code blocks kept and boilerplate removed.",
    uses: ["Read documentation, articles and product pages into a RAG pipeline", "Pull one section of a long page by heading", "Read JavaScript-rendered pages with the rendered variant"],
    faq: [["Does it run JavaScript?", "/extract reads the page as served; /extract/rendered opens it in a browser first for pages that need one."], ["How long can the output be?", "Set maxChars to cap it; long pages can be read section by section."]] },
  { slug: "ofac-wallet-screening-api", phrase: "OFAC wallet screening API", tools: ["/sanctions/check", "/check/counterparty"],
    lead: "Screen a crypto wallet address or a person or company name against the US Treasury OFAC SDN list, aliases included, and get a block, review or pass verdict with each match's SDN ID and programs.",
    uses: ["Check an address before an agent pays it", "Add a sanctions step to onboarding or payouts", "Combine the sanctions result with wallet risk in one counterparty check"],
    faq: [["Which list?", "The OFAC SDN list, including the listed digital currency addresses, with the list date in every answer."], ["Is this legal advice?", "No. It is a screening aid; confirm a match against official OFAC records before acting."]] },
  // 6 Nov 2026 (1.93.0 Search API 2.0): agents search for the API by the shape they already know.
  { slug: "exa-compatible-search-api", phrase: "Exa compatible search API", tools: ["/search", "/search/similar", "/ai/answer"],
    lead: "Send the neural-search request you already use (query, numResults, includeDomains, excludeDomains, startPublishedDate, category, contents.text, contents.highlights, contents.summary) to POST /v1/search and get the same result shape back: title, URL, published date, favicon, live page text, best-matching highlights with scores and AI summaries, from the Brave Search index, $0.01 a call.",
    uses: ["Point an Exa SDK client's base URL at /v1 and pay per call with x402, MPP or card credits, no account", "Restrict results to a few domains or a date range", "Get page text, highlights and summaries of the top 10 results in the same call", "Find pages similar to a URL with /v1/findSimilar"],
    faq: [["Is it the same index as Exa?", "No. Results come from the Brave Search index and are keyword-ranked (resolvedSearchType is keyword); the request and response shapes follow the neural-search SDKs so clients work unchanged."], ["How many results?", "Up to 20 per call; a larger numResults returns 20 rather than an error."], ["Can I store the results?", "No. Results are for the caller's immediate use: no storing, resale or model training (Brave API terms)."]] },
  { slug: "find-similar-websites-api", phrase: "Find similar websites API", tools: ["/search/similar", "/search"],
    lead: "Give a page URL and get the web pages most like it: we read the page, search on its title and topic words and return up to 20 similar pages with title, URL, snippet and date, leaving out the source site by default, optionally with their text, highlights or summaries.",
    uses: ["Find competitors of a company from its homepage", "Find related articles to a story", "Find alternatives to a product or tool page"],
    faq: [["Is there an Exa-style endpoint?", "Yes: POST /v1/findSimilar takes url, numResults, excludeSourceDomain, domain and date filters and contents."], ["What if the page cannot be read?", "The search is built from the URL's own words, so the call still answers."]] },
  { slug: "web-search-api-with-page-content", phrase: "Web search API with page content", tools: ["/search", "/pack/web-research"],
    lead: "One call searches the web and returns the top results with the live text of each page, the passages that best match the query and an optional AI summary, filtered by domain, date or category if you like; a page that cannot be read keeps its search snippet.",
    uses: ["Ground an LLM answer in current sources without a second fetch per result", "Search only documentation sites or only recent news", "Feed the top pages of a search straight into retrieval"],
    faq: [["How much text per page?", "Set textChars from 500 to 20,000 characters; highlights and summaries are read from up to 12,000."], ["What does it cost?", "$0.01 a call, failures uncharged."]] },
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
  { slug: "sec-filings-api", phrase: "SEC filings API", tools: ["/sec/filings", "/sec/financials", "/sec/insider"] },
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
  // 5 Nov 2026: jobs with paid demand on the Bazaar (Nansen historical balances 41 payers, who bought/sold 61, FX pairs and
  // symbols 103-114, AX1 token verdict 250) that our new tools do.
  { slug: "wallet-historical-balances-api", phrase: "Wallet historical balances API", tools: ["/wallet/balance-history", "/wallet/transactions", "/wallet/related"] },
  { slug: "token-buyers-and-sellers-api", phrase: "Token buyers and sellers API", tools: ["/token/buyers", "/dex/trending"] },
  { slug: "token-verdict-api", phrase: "Token verdict API, is this token safe", tools: ["/token/verdict", "/token-report"] },
  { slug: "forex-pairs-api", phrase: "Forex pairs API, all FX cross rates", tools: ["/fx/all", "/fx/symbols"] },
  { slug: "stock-price-api", phrase: "Stock price API, quotes and history", tools: ["/stock/quote", "/stock/history", "/stock/search"] },
  { slug: "keyword-research-api", phrase: "Keyword research API, keyword ideas", tools: ["/keywords/ideas", "/seo/audit", "/text/keyword-density"] },
  { slug: "polymarket-api", phrase: "Polymarket API, prediction market odds", tools: ["/polymarket/markets", "/polymarket/events", "/polymarket/orderbook", "/polymarket/price-history"] },
];

const BY_SLUG = new Map(TASK_GUIDES.map((g) => [g.slug, g]));
/** The guide that covers a tool, for the link on its tool page. */
export const GUIDE_FOR_TOOL: ReadonlyMap<string, TaskGuide> = new Map(TASK_GUIDES.filter((g) => !g.secondary).flatMap((g) => g.tools.map((t) => [t, g] as const)));
export const taskGuide = (slug: string) => BY_SLUG.get(slug);

function toolBlock(e: Endpoint, origin: string, freeCalls: boolean, md: boolean) {
  const request = `${origin}${e.path}?${query(e)}`;
  const free = freeCalls && httpFree(e.path);
  const mcp = e.path.slice(1).replace(/[/-]/g, "_");
  const params = Object.entries(e.params).filter(([n]) => n !== "only").map(([n, p]) => `${n}${p.required ? " (required)" : ""}: ${p.description}`);
  const example = JSON.stringify(e.outputExample, null, 2);
  const shown = example.length > 1500 ? `${example.slice(0, 1500)}\n…` : example;
  // Where a prepaid key pays less than the public price (lib/key-prices.ts), the guide leads with it.
  const keyOffer = keyOfferNumbers(e.path, e.price);
  const keyLine = keyOffer ? `With prepaid credits this tool costs ${keyOffer.price} a call: $1 by card pays for ${keyOffer.callsPerDollar} calls, with no account and no subscription.` : "";
  const lines = [
    `${e.summary}. ${e.price} per successful call; failed calls are never charged.`,
    e.description,
    `Inputs: ${params.join("; ")}.`,
    free ? `Free first (${FREE_HTTP_CALLS_PER_CALLER} successful calls per caller, no key):\n\n    curl "${request}&trial=1"` : (CAPACITY_LIMITED.has(e.path) ? `Not in the free calls (it costs us capacity per call); pay from the first call.` : `Not in the free calls over HTTP; pay from the first call.`),
    ...(keyLine ? [keyLine] : []),
    `With a card key from ${origin}/credits, in a header or, when your client can only fetch a URL, in the URL:\n\n    curl -H "Authorization: Bearer adt_…" "${request}"\n    curl "${request}&api_key=adt_…"`,
    `Without a key the same URL answers 402 with x402 and MPP terms, so a wallet client pays USDC per call and retries. Over MCP (${origin}/mcp) this tool is ${mcp}.`,
    `Example result:\n\n${shown.split("\n").map((l) => `    ${l}`).join("\n")}`,
    `Tool page: ${origin}/tools/${toolSlug(e.path)}`,
  ];
  if (md) return lines.join("\n\n");
  return `<section><h2>${esc(e.summary)} <span class="price">${esc(e.price)}</span></h2><p>${esc(e.description)}</p>
<p><strong>Inputs:</strong> ${params.map(esc).join("; ")}.</p>
${free ? `<p>Free first (${FREE_HTTP_CALLS_PER_CALLER} successful calls per caller, no key):</p><pre><code>curl "${esc(request)}&amp;trial=1"</code></pre>` : `<p>Not in the free calls${CAPACITY_LIMITED.has(e.path) ? " (it costs capacity per call)" : " over HTTP"}; pay from the first call.</p>`}
${keyLine ? `<p><strong>${esc(keyLine)}</strong></p>` : ""}<p>With a card key from <a href="/credits">/credits</a>, in a header or, when your client can only fetch a URL, in the URL:</p><pre><code>curl -H "Authorization: Bearer adt_…" "${esc(request)}"\ncurl "${esc(request)}&amp;api_key=adt_…"</code></pre>
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
  const product = PRODUCT_FOR_TOOL.get(main.path);
  const seoFaq = TOOL_SEO[main.path]?.faq ?? [];
  const faq: [string, string][] = [...(g.faq ?? []), ...seoFaq.filter(([q]) => !(g.faq ?? []).some(([gq]) => gq === q)),
    ["How do I pay?", `Each successful call costs the tool's price; failed calls are not charged. ${freeCalls && httpFree(main.path) ? `The first ${FREE_HTTP_CALLS_PER_CALLER} calls are free. Then` : "Then"} pay with card credits from $1 (the key goes in an Authorization header or as api_key= in the URL) or per call in USDC over x402 or MPP. No account is needed.`]];
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
${product ? `<p><strong><a href="/${esc(product.slug)}">${esc(product.name)}</a>:</strong> monthly plans and one-off packs, one API key.</p>` : ""}
${g.code ? `<h2>${esc(g.code.language)} example</h2><pre><code>${esc(g.code.text.replaceAll("{origin}", origin))}</code></pre><p>Set <code>API_KEY</code> to a key from <a href="/credits">/credits</a>.</p>` : ""}
${uses.length ? `<h2>When an agent wants this</h2><ul>${uses.map((u) => `<li>${esc(u)}</li>`).join("")}</ul>` : ""}
${tools.map((e) => toolBlock(e, origin, freeCalls, false)).join("\n")}
<h2>Questions</h2>${faq.map(([q, a]) => `<h3>${esc(q)}</h3><p>${esc(a)}</p>`).join("")}
<footer><a href="/guides">All guides</a> · <a href="/tools">All ${ENDPOINTS.length} tools</a> · <a href="/llms.txt">Docs for agents</a> · <a href="/openapi.json">OpenAPI</a> · ${COMPANY_FOOTER}</footer>
</main></body></html>`;
}

export function taskGuideMarkdown(slug: string, origin: string, freeCalls: boolean): string | undefined {
  const g = BY_SLUG.get(slug);
  if (!g) return undefined;
  const tools = g.tools.map((p) => byPath.get(p)).filter((e): e is Endpoint => Boolean(e));
  const uses = usesOf(g, tools[0]);
  return [`# ${g.phrase}`, leadOf(g, tools[0]), ...(g.code ? [`## ${g.code.language} example`, g.code.text.replaceAll("{origin}", origin).split("\n").map((l) => `    ${l}`).join("\n")] : []), ...(uses.length ? [`## When an agent wants this`, uses.map((u) => `- ${u}`).join("\n")] : []),
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
