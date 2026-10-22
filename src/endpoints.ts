import { FIELDS_PARAM } from "./lib/fields";
import { FAMILIES } from "./families";
import { SITEMAP_OUTPUT_SCHEMA } from "./lib/sitemap-contract";
import { BITCOIN_FEES_OUTPUT_SCHEMA } from "./lib/bitcoin-fees-contract";
import { SITEMAP_OUTPUT_EXAMPLE } from "./lib/sitemap-example";
// What this service sells: its name, its tools and their prices.
// Everything in discovery.ts, the HTTP routes and the MCP tools is generated from this file.
import { EXTRACT_OUTPUT_SCHEMA } from "./lib/extract-contract";
import { EXTRACT_OUTPUT_EXAMPLE } from "./lib/extract-example";

/** Machine name: used for the MCP server and its registry entry. */
export const SERVICE_ID = "agent-data-tools";
export const SERVICE_NAME = "Agent Data Tools";
/** Public support address (also on the RapidAPI, Atlassian and store listings). */
export const SUPPORT_EMAIL = "spellz111122@gmail.com";
/** Shown with our listings in the Bazaar and Agentic.Market (served by this Worker at /logo.png). */
export const SERVICE_ICON_URL = "https://agent-data-tools.revmesh2074.workers.dev/logo.png";

export const SERVICE_SUMMARY =
  "181 pay-per-call tools for AI agents over HTTP or MCP, most at $0.003. Every caller gets 25 free calls; then pay per call in USDC via x402 (Base, Polygon, Arbitrum, Monad, World Chain) or by card with prepaid credits from /credits. No account needed; failed calls are never charged; per-tool reliability is public at /status. Crypto: token prices and wallet portfolios from Uniswap v3, chain reads on Base, Ethereum, Arbitrum, Optimism and Polygon, OFAC sanctions screening. Web: Read public static documentation, pages, PDFs and RSS feeds as clean text, plus link previews and sitemaps. Business: company profiles, domain and email checks. Also Bitcoin, FX, weather, holidays, geocoding, AI text, and JSON, date and validation utilities.";

export interface Param {
  type: "string" | "integer" | "number";
  description: string;
  required?: boolean;
  example: string | number;
  enum?: readonly [string, ...string[]];
}

export interface Endpoint {
  path: string;
  price: string;
  summary: string;
  /** Shown in x402 directories. Must stay under 500 characters. */
  description: string;
  /** Full source/coverage limitations, kept out of bounded discovery metadata. */
  details?: string;
  tags: readonly string[];
  params: Record<string, Param>;
  outputExample: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
}

/** Hand-written tools. The table-generated families (src/families.ts) are appended in ENDPOINTS below. */
export const CORE_ENDPOINTS = [
  {
    path: "/extract",
    price: "$0.002",
    summary: "Scrape web page to Markdown: page URL into clean Markdown or text for LLMs",
    description:
      "Fetch any public web page URL and get clean, LLM-ready text or Markdown: main content, code blocks, tables, links and headings, for RAG and agent context. Static HTML, Markdown or text; optional section ID. Default 20,000 output characters, max 100,000; input 2 MiB. No JavaScript rendering (see /extract/rendered), logins or paywalls. Empty pages, bad sections, browser challenges and errors are not charged. Use to read docs or articles.",
    details: "HTML body details share a 20,000-character budget, independently of primary text/Markdown. Up to 20 code blocks, 20 tables (100 rows/20 cells each), 100 headings and 200 links. Spans/ragged tables use labelled TSV in Markdown; spans are not expanded. HTML code whitespace and list hierarchy are preserved; generated code fences are closed within the output limit. Other Markdown syntax may be incomplete after clipping. Hashes cover the returned hashFormat, not full source. linkBaseUrl reports static source link resolution; supported first HTML base href values are honored, with warnings. Scripts and CSP are not evaluated. Markdown sources retain syntax without structured parsing (warned); sections require HTML. Source content is untrusted. Image alt text is source-provided, not visual interpretation. Images are never fetched; SVG/canvas omissions and missing alt descriptions are warned. SourceMetadata adds unverified author/date declarations with provenance; conflicting/ambiguous values are warned. Separate 2,000-character metadata budget, 5 authors/10 dates. JSON-LD: at most 8 inline scripts, 64 KiB each, 100 graph nodes/depth 8; no external contexts/profiles. HTML complexity: 20,000 elements/128 nested levels. Marker-only source permalink controls (pilcrow/headerlink/permalink classes) are omitted only for same-document ancestor targets, with permalink_controls_omitted. Literal code and ordinary references remain. HTML sup/sub annotations normalize to ^{...}/_{...} in primary output, heading titles and table values with superscript_subscript_normalized; literal pre/code and raw Markdown stay unchanged. This is notation preservation, not general math interpretation.",
    outputSchema: EXTRACT_OUTPUT_SCHEMA,
    tags: ["web", "scraping", "extract", "text", "rag"],
    params: {
      url: { type: "string", description: "Absolute http(s) URL of the page to fetch", required: true, example: "https://example.com" },
      maxChars: { type: "integer", description: "Maximum characters of body text to return (500-100000, default 20000)", example: 20000 },
      format: { type: "string", description: "Returned representation: text (default), markdown, or both. HTML structured details are included in every format; Markdown/plain sources have empty details.", enum: ["text", "markdown", "both"], example: "text" },
      section: { type: "string", description: "Optional exact visible HTML ID within primary content, 1-500 characters. Heading scope includes subsections until next same/higher-level heading; section/article/main/div scope is its subtree. Missing/ambiguous/unsupported targets fail uncharged. URL fragments alone do not select a section.", example: "retry-policy" },
    },
    outputExample: EXTRACT_OUTPUT_EXAMPLE,
  },
  {
    path: "/sitemap",
    price: "$0.002",
    summary: "Sitemap URL extractor: documentation URLs from a bounded XML sitemap",
    description: "Read one public XML sitemap or sitemap index as structured URLs and source-reported dates. Supports gzip, substring filtering and pagination. Maximum 512 KiB expanded input and 1000 entries. Does not crawl pages or follow child sitemaps. Invalid XML and execution errors are not charged; a valid empty match is charged. Use to find which pages of a docs site to read before calling /extract.",
    details: "XML only: 512 KiB compressed and expanded, 1000 entries, 8000 XML elements, depth 16, locations up to 2048 characters. DTD declarations are rejected. contains is a case-insensitive substring of source-reported URLs, not semantic search. Pagination counts distinct reported loc values before public-URL validation of the selected page. Returned URLs are not probed; dates are not verified. Index entries are child sitemaps, not pages. DNS-resolution limitations of the public-fetch guard remain.",
    tags: ["web", "sitemap", "discovery", "research"],
    params: {
      url: { type: "string", required: true, description: "Absolute public HTTP(S) XML sitemap URL; child sitemaps are not fetched automatically", example: "https://www.sitemaps.org/sitemap.xml" },
      contains: { type: "string", description: "Optional case-insensitive URL substring, at most 200 characters", example: "/protocol" },
      maxUrls: { type: "integer", description: "Reported matching locations examined in one page (1-100, default 25); invalid/nonpublic locations may reduce returned entries", example: 25 },
      offset: { type: "integer", description: "Offset into distinct reported matching locations (0-1000, default 0); use nextOffset to continue", example: 0 },
    },
    outputSchema: SITEMAP_OUTPUT_SCHEMA,
    outputExample: SITEMAP_OUTPUT_EXAMPLE,
  },
  {
    path: "/domain",
    price: "$0.005",
    summary: "Domain lookup (DNS, WHOIS): DNS, RDAP registration age and email authentication",
    description:
      "Domain intelligence in one call: DNS records (A, AAAA, CNAME, MX, NS, TXT, CAA), DNSSEC status, registrar, registration and expiry dates with domain age in days (RDAP/WHOIS), and email authentication (SPF and DMARC records and policies, whether the domain accepts mail). Use for lead qualification, phishing and trust checks, and deliverability audits. For a trust verdict with named flags use domain_report.",
    tags: ["domain", "dns", "whois", "email", "security"],
    params: {
      name: { type: "string", description: "Domain name, e.g. cloudflare.com", required: true, example: "cloudflare.com" },
    },
    outputExample: {
      domain: "cloudflare.com",
      exists: true,
      dns: {
        a: ["104.16.132.229", "104.16.133.229"],
        mx: [{ priority: 5, host: "mxa-canary.global.inbound.cf-emailsecurity.net" }],
        ns: ["ns3.cloudflare.com", "ns4.cloudflare.com"],
        dnssecValidated: true,
      },
      email: { acceptsMail: true, spfPolicy: "-all", dmarcPolicy: "reject" },
      registration: {
        registrableDomain: "cloudflare.com",
        registrar: "Cloudflare, Inc.",
        registeredAt: "2009-02-17T22:07:54Z",
        expiresAt: "2033-02-17T22:07:54Z",
        ageDays: 6441,
        dnssecSigned: true,
      },
    },
  },
  {
    path: "/domain-report",
    price: "$0.01",
    summary: "Domain trust verdict: age, DNS and email-auth flags",
    description:
      "A trust verdict for any domain in one call: high/medium/low trust with named flags for very new registrations, expiry, missing or weak SPF and DMARC, too few nameservers, no web host and non-resolving domains, plus the key facts (registrar, age, nameservers, DNSSEC). Use for lead qualification, phishing and vendor checks, and before an agent sends mail to or trusts a domain. Signals only, not a guarantee. Raw DNS records: domain.",
    tags: ["domain", "security", "trust", "phishing", "email"],
    params: {
      name: { type: "string", description: "Domain name, e.g. cloudflare.com", required: true, example: "cloudflare.com" },
    },
    outputExample: {
      domain: "cloudflare.com",
      trust: "high",
      summary: "high trust: 0 high and 0 medium flag(s). Based on DNS, registration and email-authentication signals only.",
      flags: [],
      facts: {
        exists: true,
        registrar: "Cloudflare, Inc.",
        registeredAt: "2009-02-17T22:07:54Z",
        expiresAt: "2033-02-17T22:07:54Z",
        ageDays: 6447,
        nameservers: ["ns3.cloudflare.com", "ns4.cloudflare.com"],
        acceptsMail: true,
        spfPolicy: "-all",
        dmarcPolicy: "reject",
        dnssecValidated: true,
      },
      checkedAt: "2026-10-14T19:25:28.425Z",
    },
  },
  {
    path: "/token",
    price: "$0.01",
    summary: "Base ERC-20 token facts and risk flags",
    description:
      "Base only (other chains: <chain>_token_info). Live on-chain facts for an ERC-20 token on Base: name, symbol, decimals, total supply, owner and whether ownership is renounced, paused state, proxy detection (EIP-1967, minimal proxy) with implementation and admin, and bytecode heuristics for mint, pause, blacklist and fee-setter functions. Use for token due diligence and rug-pull or honeypot screening before a swap.",
    tags: ["base", "token", "erc20", "security", "onchain"],
    params: {
      address: { type: "string", description: "Token contract address on Base (0x...)", required: true, example: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" },
    },
    outputExample: {
      chain: "base",
      address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      name: "USD Coin",
      symbol: "USDC",
      decimals: 6,
      totalSupplyFormatted: "4333612020.876957",
      owner: "0x3ABd6f64A422225E61E435baE41db12096106df7",
      ownershipRenounced: false,
      paused: false,
      proxy: {
        isProxy: true,
        kind: "zeppelinos-legacy",
        implementation: "0x2ce6311ddae708829bc0784c967b7d77d19fd779",
        admin: "0x4fc7850364958d97b4d3f5a08f79db2493f8ca44",
      },
      capabilities: { mint: false, burn: false, pause: false, blacklist: false, feeSetter: false },
    },
  },
  {
    path: "/token-report",
    price: "$0.02",
    summary: "Token risk and honeypot check: red flags plus live DEX liquidity for a Base token before a swap",
    description:
      "Check a Base token before you swap into it: a high/medium/low risk verdict with named red flags (paused transfers, blacklist, owner-set fees or tax, a mint selector with a live owner, upgradeable proxy, no or thin liquidity, a pair under 7 days old, buys but no sells as a honeypot sign) plus live DexScreener price, liquidity, volume and FDV. Heuristic screening, not a safety guarantee. Use before swapping into an unfamiliar Base token.",
    details: "One call for a Base token: heuristic risk tier and flags, on-chain owner/paused/proxy facts and selector checks, plus live DEX price, 24h volume/change, liquidity, FDV, pair count, top-liquidity-pair age and 24h buys/sells. marketDataSource identifies DexScreener; marketRetrievedAt is the retrieval timestamp or null when market data is unavailable. Example market values and timestamp are illustrative. A mint selector is not proof of callable minting; mintability is reported only with a confirmed nonzero owner, otherwise unverified. Flags no-liquidity, thin liquidity, new top pairs and no-sell patterns. Not a guarantee.",
    tags: ["token-risk", "honeypot", "rug-check", "base", "token", "security", "dex", "due-diligence"],
    params: {
      address: { type: "string", description: "Token contract address on Base (0x...)", required: true, example: "0x4200000000000000000000000000000000000006" },
    },
    outputExample: {
      chain: "base",
      address: "0x4200000000000000000000000000000000000006",
      marketDataSource: "DexScreener",
      marketRetrievedAt: "2026-10-14T12:00:00.000Z",
      risk: "low",
      summary: "low risk: 0 high and 0 medium flag(s). Heuristic screening, not a guarantee of safety.",
      flags: [],
      token: { name: "Wrapped Ether", symbol: "WETH", decimals: 18 },
      market: {
        priceUsd: 2432.15,
        priceChange24hPct: -3.05,
        volume24hUsd: 40100383,
        liquidityUsdTotal: 4904163,
        pairCount: 2,
        topPair: { dex: "pancakeswap", quote: "USDC", ageDays: 1000 },
        trades24h: { buys: 32010, sells: 30694 },
      },
    },
  },
  {
    path: "/wallet",
    price: "$0.005",
    summary: "Base wallet balances and account nonce snapshot",
    description:
      "Base only (all 5 chains: wallet_balances; USD values: wallet_portfolio). An address on Base: ETH and major token balances (USDC, WETH, cbBTC, DAI, USDbC, cbETH, AERO, EURC) plus up to 20 token addresses you pass, the account nonce, and whether it is an EOA, a contract or an EIP-7702 account. The nonce counts outgoing transactions only; not transfer or trading history. Use to check a counterparty's holdings.",
    tags: ["base", "wallet", "balance", "portfolio", "onchain"],
    params: {
      address: { type: "string", description: "Wallet or contract address on Base (0x...)", required: true, example: "0x4200000000000000000000000000000000000006" },
      tokens: { type: "string", description: "Optional comma-separated extra ERC-20 addresses to check (max 20)", example: "0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed" },
    },
    outputExample: {
      chain: "base",
      address: "0x4200000000000000000000000000000000000006",
      type: "contract",
      eth: { wei: "286016330790748434767802", formatted: "286016.330790748434767802" },
      accountNonce: 0,
      limitations: [
        "accountNonce is the Base EVM account nonce; for EOAs it reflects outgoing transactions only, not full transaction, token-transfer, or trading history.",
      ],
      tokens: [
        { address: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", symbol: "USDC", decimals: 6, balance: "167551481", balanceFormatted: "167.551481" },
      ],
    },
  },
  {
    path: "/summarize",
    price: "$0.01",
    summary: "Summarize a web page from its URL",
    description:
      "Give a URL, get a short summary of the page plus three to six key points, ready to drop into an agent's context. Fetches the page, strips navigation and boilerplate, and summarizes the main text with an LLM. HTML pages only; for a PDF use pdf_text, then ai_summarize_text. Use for research, news triage, link previews and deciding whether a page is worth reading in full. For the full text use extract.",
    tags: ["summary", "web", "llm", "research", "text"],
    params: {
      url: { type: "string", description: "Absolute http(s) URL of the page to summarize", required: true, example: "https://en.wikipedia.org/wiki/HTTP_402" },
    },
    outputExample: {
      url: "https://en.wikipedia.org/wiki/List_of_HTTP_status_codes",
      title: "List of HTTP status codes - Wikipedia",
      lang: "en",
      summary: "The page lists HTTP response status codes and what each one means, grouped into five classes.",
      keyPoints: ["1xx codes are informational", "402 Payment Required is reserved for future use"],
      sourceChars: 12000,
      sourceTruncated: true,
    },
  },
  {
    path: "/screenshot",
    price: "$0.02",
    summary: "Website screenshot: capture a web page as an image",
    description:
      "Render any public web page in a real headless Chrome browser, with JavaScript executed, and get a JPEG screenshot (1280 px wide, base64) plus the final URL, HTTP status and page title. Set fullPage=true to capture up to 4000 px of page height. Use for visual checks, page previews, monitoring and feeding pages to vision models.",
    tags: ["screenshot", "browser", "render", "web", "image"],
    params: {
      url: { type: "string", description: "Absolute http(s) URL of the page to capture", required: true, example: "https://example.com" },
      fullPage: { type: "string", description: "Set to true to capture the full page height (max 4000 px) instead of the 1280x800 viewport", example: "true" },
    },
    outputExample: {
      url: "https://example.com/",
      finalUrl: "https://example.com/",
      status: 200,
      title: "Example Domain",
      width: 1280,
      height: 800,
      contentType: "image/jpeg",
      imageBase64: "/9j/4AAQSkZJRgABAQAAAQABAAD...",
    },
  },
  {
    path: "/image",
    price: "$0.02",
    summary: "Image generation from a text prompt",
    description:
      "Text-to-image generation with FLUX.1 schnell. Send a prompt, get a 1024x1024 JPEG back as base64 in a few seconds. Use for illustrations, thumbnails, mockups, avatars and social media images. Optional steps parameter (1-8, default 4) trades speed for detail.",
    tags: ["image", "generation", "flux", "ai", "art"],
    params: {
      prompt: { type: "string", description: "What the image should show (3-800 characters)", required: true, example: "a lighthouse on a cliff at sunset, watercolor" },
      steps: { type: "integer", description: "Diffusion steps, 1-8 (default 4)", example: 4 },
    },
    outputExample: {
      prompt: "a lighthouse on a cliff at sunset, watercolor",
      steps: 4,
      model: "@cf/black-forest-labs/flux-1-schnell",
      contentType: "image/jpeg",
      imageBase64: "/9j/4AAQSkZJRgABAQAAAQABAAD...",
    },
  },
  {
    path: "/transcribe",
    price: "$0.02",
    summary: "Transcribe audio: speech to text for an audio file",
    description:
      "Transcribe speech from an audio file at a public URL using Whisper large-v3-turbo. Returns the transcript text, detected language, duration and word count. Accepts common formats such as MP3, WAV, M4A and OGG up to 5 MB. Use for voice notes, podcast clips, meeting snippets and voice messages.",
    tags: ["audio", "transcription", "whisper", "speech", "ai"],
    params: {
      url: { type: "string", description: "Absolute http(s) URL of an audio file (max 5 MB)", required: true, example: "https://commons.wikimedia.org/wiki/Special:FilePath/En-us-hello.ogg" },
    },
    outputExample: {
      url: "https://commons.wikimedia.org/wiki/Special:FilePath/En-us-hello.ogg",
      text: "Hello!",
      language: "en",
      durationSeconds: 0.487625,
      wordCount: 1,
      model: "@cf/openai/whisper-large-v3-turbo",
    },
  },
  {
    path: "/describe",
    price: "$0.01",
    summary: "Describe or question an image",
    description:
      "Vision model for an image at a public URL: get a detailed description including any visible text, or pass a question to ask something specific about the image. Accepts PNG, JPEG, WebP and GIF up to 3 MB. Use for alt text, OCR-style reading of screenshots, chart reading and content checks.",
    tags: ["vision", "image", "ocr", "caption", "ai"],
    params: {
      url: { type: "string", description: "Absolute http(s) URL of a PNG, JPEG, WebP or GIF image (max 3 MB)", required: true, example: "https://upload.wikimedia.org/wikipedia/commons/4/47/PNG_transparency_demonstration_1.png" },
      question: { type: "string", description: "Optional question about the image (max 300 characters); default is a detailed description", example: "What colors are the dice?" },
    },
    outputExample: {
      url: "https://upload.wikimedia.org/wikipedia/commons/4/47/PNG_transparency_demonstration_1.png",
      question: "What colors are the dice?",
      description: "The dice are blue, red, green, and yellow.",
      model: "@cf/meta/llama-4-scout-17b-16e-instruct",
    },
  },
  {
    path: "/btc-fees",
    price: "$0.002",
    summary: "Bitcoin fee rates and mempool status",
    outputSchema: BITCOIN_FEES_OUTPUT_SCHEMA,
    description:
      "Current Bitcoin network fee rates in sat/vB for next-block, half-hour, one-hour and economy confirmation, the estimated cost in sats of a typical payment, mempool size and total pending fees, and the latest block height. Use before sending a Bitcoin transaction or to decide whether to wait for lower fees.",
    tags: ["bitcoin", "fees", "mempool", "btc", "onchain"],
    params: {},
    outputExample: {
      network: "bitcoin",
      unit: "sat/vB",
      fees: { nextBlock: 4, halfHour: 3, hour: 1, economy: 1, minimum: 1 },
      typicalPaymentSats: { nextBlock: 564, hour: 141 },
      typicalPaymentVbytes: 141,
      source: "https://mempool.space/api",
      limitations: ["Estimates do not guarantee confirmation time", "141 vB is an illustrative one-input/two-output SegWit size; actual transaction size varies", "Source endpoints are fetched concurrently, not as an atomic snapshot"],
      mempool: { transactions: 83832, vsize: 42066150, totalFeesBtc: 0.1093664 },
      blockHeight: 970000,
      checkedAt: "2026-10-01T00:00:00.000Z",
    },
  },
  {
    path: "/btc-address",
    price: "$0.003",
    summary: "Bitcoin address balance and activity",
    description:
      "Balance and activity of any Bitcoin mainnet address (legacy, P2SH or bech32): confirmed balance in sats and BTC, unconfirmed pending amount, total received and sent, and transaction counts. Use for payment verification, checking whether a deposit arrived, and wallet monitoring.",
    tags: ["bitcoin", "address", "balance", "btc", "onchain"],
    params: {
      address: { type: "string", description: "Bitcoin mainnet address (1..., 3... or bc1...)", required: true, example: "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh" },
    },
    outputExample: {
      network: "bitcoin",
      address: "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh",
      balanceSats: 392247777,
      balanceBtc: 3.92247777,
      pendingSats: 0,
      totalReceivedBtc: 16.79253616,
      totalSentBtc: 12.87005839,
      transactions: 1138,
      pendingTransactions: 0,
    },
  },
  {
    path: "/ln-invoice",
    price: "$0.003",
    summary: "Decode a Lightning invoice",
    description:
      "Decode a BOLT11 Lightning Network invoice without paying it: network, amount in sats and BTC, description, payment hash, creation time, expiry time and whether it has already expired. Use to check what an invoice asks for before an agent pays it.",
    tags: ["lightning", "bitcoin", "invoice", "bolt11", "decode"],
    params: {
      invoice: {
        type: "string",
        description: "BOLT11 invoice string starting with ln (lnbc... for mainnet)",
        required: true,
        example:
          "lnbc2500u1pvjluezsp5zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zygspp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqdq5xysxxatsyp3k7enxv4jsxqzpu9qrsgquk0rl77nj30yxdy8j9vdx85fkpmdla2087ne0xh8nhedh8w27kyke0lp53ut353s06fv3qfegext0eh0ymjpf39tuven09sam30g4vgpfna3rh",
      },
    },
    outputExample: {
      network: "bitcoin",
      amountSats: 250000,
      amountBtc: 0.0025,
      description: "1 cup coffee",
      paymentHash: "0001020304050607080900010203040506070809000102030405060708090102",
      createdAt: "2017-06-01T10:57:38.000Z",
      expiresAt: "2017-06-01T10:58:38.000Z",
      expired: true,
      expirySeconds: 60,
    },
  },
  {
    path: "/package-audit",
    price: "$0.20",
    summary: "Audit up to 10 dependencies, with exact-version advisories and fixes",
    description:
      "Check up to 10 public dependencies, optionally pinned to exact versions, for advisory IDs, OSV affected/fixed ranges and dated FIRST EPSS CVE estimates. Scoped npm names supported. Detail and subrequest caps apply; omitted details and incomplete coverage are explicit. Missing evidence is unknown, not zero risk. Automated signals, not a safety guarantee. See the buying guide for limits. Use before installing or upgrading dependencies.",
    details: "Audit up to 10 ecosystem:name items, optionally pinned to exact versions; scoped npm names are supported. npm downloads are not queried, unversioned deps.dev detail is capped at one advisory per package, pinned deps.dev detail is skipped, and OSV detail is capped at 15 per request. Batch advisory IDs/counts remain available; omitted details and EPSS coverage are reported. Exact versions add OSV ranges and dated FIRST EPSS estimates for CVE aliases (up to 50 CVEs). EPSS is not a safety guarantee; missing scores are unknown, not zero. Verdicts are bounded signals. Example timestamps are illustrative; bad input is not charged.",
    tags: ["package", "security", "supply-chain", "npm", "pypi"],
    params: {
      packages: { type: "string", description: "Comma-separated ecosystem:name items, optionally name@exact-version; max 10. For scoped npm, use npm:@scope/name@version.", required: true, example: "npm:lodash@4.17.20,pypi:requests@2.31.0,npm:@types/node@22.0.0" },
    },
    outputExample: {
      checked: 1,
      notFound: 0,
      lookupFailed: 0,
      versionNotFound: 0,
      versionAdvisoryLookupIncomplete: 0,
      epssLookup: {
        source: "FIRST EPSS",
        status: "complete",
        sourceStatus: "available",
        retrievedAt: "2026-10-14T12:00:00.000Z",
        requestedCves: 1,
        queriedCves: 1,
        returnedScores: 1,
        omittedCves: 0,
        uninspectedAdvisoryDetails: 0,
        malformedRows: 0,
        note: "FIRST EPSS estimates 30-day exploitation probability, not package safety.",
      },
      summary: "All 1 package(s) exist. Review each verdict and flags before installing.",
      results: [
        {
          ecosystem: "npm",
          name: "minimist",
          exists: true,
          version: "1.2.5",
          versionExists: true,
          verdict: "caution",
          flags: ["known-vulnerabilities"],
          weeklyDownloads: null,
          weeklyDownloadsStatus: "not-fetched-subrequest-budget",
          knownVulnerabilities: 1,
          advisoryIds: ["GHSA-xvch-5gv4-984h"],
          knownVulnerabilityCountSources: ["deps.dev", "OSV"],
          advisoryDetailsStatus: "not-fetched-subrequest-budget",
          advisoryDetailsOmitted: 1,
          advisoryDetailsUnavailable: 0,
          advisories: [],
          source: "deps.dev",
          retrievedAt: "2026-10-14T12:00:00.000Z",
          versionAdvisories: {
            source: "OSV",
            status: "complete",
            retrievedAt: "2026-10-14T12:00:00.000Z",
            advisoryCount: 1,
            vulnerabilities: [
              {
                id: "GHSA-xvch-5gv4-984h",
                source: "OSV",
                sourceUrl: "https://osv.dev/vulnerability/GHSA-xvch-5gv4-984h",
                retrievedAt: "2026-10-14T12:00:00.000Z",
                detailStatus: "available",
                modified: "2026-03-13T22:11:59.523514Z",
                published: "2022-03-18T00:01:09Z",
                aliases: ["CVE-2021-44906"],
                summary: "Prototype Pollution in minimist",
                rangeStatus: "reported",
                fixedVersionRanges: [
                  { type: "SEMVER", events: [{ introduced: "1.0.0" }, { fixed: "1.2.6" }], fixedVersions: ["1.2.6"] },
                  { type: "SEMVER", events: [{ introduced: "0" }, { fixed: "0.2.4" }], fixedVersions: ["0.2.4"] },
                ],
                epss: {
                  source: "FIRST EPSS",
                  status: "complete",
                  sourceStatus: "available",
                  retrievedAt: "2026-10-14T12:00:00.000Z",
                  scores: [
                    {
                      cve: "CVE-2021-44906",
                      status: "available",
                      score: 0.04581,
                      percentile: 0.91484,
                      date: "2026-10-14",
                    },
                  ],
                  note: "EPSS estimates 30-day exploitation probability for CVE aliases; it is not a package-safety guarantee. Null scores are unknown, not zero.",
                },
              },
            ],
            note: "OSV advisories are matched to this exact package version.",
          },
        },
      ],
      source: "deps.dev",
    },
  },
  {
    path: "/wallet-audit",
    price: "$0.02",
    summary: "Wallet risk check: fresh-wallet risk tier, flags, balances and nonce for a Base address",
    description:
      "Screen a Base address for fresh or throwaway-wallet signals: a high/medium/low heuristic risk tier with named flags (no or one outgoing transaction, a near-empty balance with few transactions), plus ETH, USDC, WETH, cbBTC and DAI balances and the account nonce. Address type is reported separately and does not affect the tier; token contracts are not audited. Use to screen a Base address; OFAC and other chains: check_counterparty.",
    tags: ["wallet-risk", "wallet", "due-diligence", "base", "crypto"],
    params: {
      address: { type: "string", description: "Base chain wallet address, 0x-prefixed 20-byte hex", required: true, example: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045" },
    },
    outputExample: {
      chain: "base",
      address: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
      type: "eoa",
      riskLevel: "low",
      riskFlags: [],
      summary: "low risk: 0 flag(s). 2 token(s) held. Account nonce: 42.",
      eth: { wei: "1500000000000000000", formatted: "1.5" },
      accountNonce: 42,
      tokenCount: 2,
      tokens: [
        { address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", symbol: "USDC", decimals: 6, balance: "1000000000", balanceFormatted: "1000", riskLevel: "unknown" },
        { address: "0x4200000000000000000000000000000000000006", symbol: "WETH", decimals: 18, balance: "500000000000000000", balanceFormatted: "0.5", riskLevel: "unknown" },
      ],
      labels: [],
      limitations: [
        "accountNonce is the Base EVM account nonce; for EOAs it reflects outgoing transactions only, not full transaction, token-transfer, or trading history.",
      ],
      lastUpdatedBlock: 18650000,
    },
  },
  {
    path: "/contract-risk",
    price: "$0.02",
    summary: "Smart contract risk check: proxy, bytecode and supply red flags for a Base contract before approving it",
    description:
      "Check a Base contract before you approve or call it: a low to critical risk tier with named flags (proxy, proxy with no implementation, tiny bytecode, zero token supply), plus bytecode size, the EIP-1967 implementation slot and ERC-20 owner, renounced and paused reads. Unreadable reads are null; EOAs return not-applicable. Limited heuristics, not a full security audit. Use before approving a spender or calling an unfamiliar Base contract.",
    details: "Base contract bytecode size and EIP-1967 slot check (a confirmed zero slot returns isProxy false; an empty/unreadable slot response returns null; RPC failures return 502). A nonzero slot with a zero implementation flags proxy-impl-unset. ERC-20 property reads run only for 500–50,000-byte contracts; individual unsupported/reverting reads are null, while multicall transport failures return 502. Zero supply requires a successful zero read; ownershipRenounced is true only for zero owner, false for nonzero, else null; paused is null if unsupported. Risk tiers are limited bytecode/proxy/zero-supply heuristics, not a full audit; empty slots cannot identify uninitialized proxies. EOAs return not-applicable.",
    tags: ["contract-risk", "approval-check", "contract", "proxy", "bytecode", "base"],
    params: {
      address: { type: "string", description: "Base chain contract address, 0x-prefixed 20-byte hex", required: true, example: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" },
    },
    outputExample: {
      chain: "base",
      address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      type: "contract",
      riskLevel: "low",
      riskFlags: [],
      summary: "low risk: 0 flag(s). Bytecode 8953 bytes.",
      facts: {
        bytecodeSize: 8953,
        deployedAt: null,
        hasCode: true,
        isProxy: false,
        proxyImplementation: null,
      },
      tokenProperties: {
        name: "USD Coin",
        symbol: "USDC",
        decimals: 6,
        totalSupply: "10000000000000",
        owner: "0x0000000000000000000000000000000000000001",
        ownershipRenounced: false,
        paused: null,
      },
      lastUpdatedBlock: 18650000,
    },
  },
  {
    path: "/trade-insight",
    price: "$0.05",
    summary: "Sourced token and wallet risk indicators with market facts",
    description:
      "Combines the Base token-report risk tier and flags, available DEX market data, and wallet-audit risk tier, flags, account nonce, and native balance. Returns the underlying indicators separately; it does not generate buy/sell recommendations or calibrated confidence, and does not evaluate holder concentration. The account nonce is not full transaction, token-transfer, or trading history. Use as one input before a Base trade.",
    tags: ["trading", "risk", "base", "market"],
    params: {
      token: { type: "string", description: "Token contract address on Base, 0x-prefixed 20-byte hex", required: true, example: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" },
      wallet: { type: "string", description: "Wallet address to evaluate, 0x-prefixed 20-byte hex", required: true, example: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045" },
    },
    outputExample: {
      tokenRisk: "high",
      tokenRiskFlags: [{ level: "high", code: "no_liquidity", message: "No DEX trading pair found on Base." }],
      tokenMarket: null,
      walletRisk: "low",
      walletRiskFlags: [],
      walletFacts: { accountNonce: 42, ethBalance: "0.5" },
      limitations: [
        "Rule-based risk indicators only; this response is not a buy/sell recommendation and has no calibrated confidence score.",
        "Holder concentration is not evaluated.",
        "walletFacts.accountNonce is the Base EVM account nonce; for EOAs it reflects outgoing transactions only, not full transaction, token-transfer, or trading history.",
      ],
    },
  },
  {
    path: "/liquidity-pool-audit",
    price: "$0.03",
    summary: "Liquidity pool check: a Base DEX pair's liquidity, volume, trades and age before trading",
    description:
      "Check a Base DEX pool before you trade or add liquidity: give a pair address and get the verified DEX, both tokens, reported liquidity, 24h volume and trades, and pair age from DexScreener, with source and retrieval time. Missing fields are null; an unknown pair returns 404. Market data only, no pool-security or investment-risk assessment. Use to confirm a pair is real and deep enough before trading; token red flags: token_report.",
    details: "Looks up a pair address on Base through DexScreener and returns the verified DEX, pair URL, token details, liquidity, volume, 24-hour trades, and pair age when supplied by the source. source identifies DexScreener and retrievedAt is the retrieval timestamp. Missing source fields are null; this endpoint does not assess pool security or investment risk. Returns 404 when no matching Base pair is found and 502 when the market-data source is unavailable. Example market values and timestamp are illustrative snapshots, not live guarantees.",
    tags: ["liquidity-check", "defi", "liquidity", "pool", "dex", "base"],
    params: {
      address: { type: "string", description: "DEX pair address on Base, 0x-prefixed 20-byte hex", required: true, example: "0x98c7A2338336d2d354663246F64676009c7bDa97" },
    },
    outputExample: {
      chain: "base",
      source: "DexScreener",
      retrievedAt: "2026-10-14T12:00:00.000Z",
      pairAddress: "0x98c7A2338336d2d354663246F64676009c7bDa97",
      dex: "aerodrome",
      url: "https://dexscreener.com/base/0x98c7a2338336d2d354663246f64676009c7bda97",
      baseToken: { address: null, name: null, symbol: "USDC" },
      quoteToken: { address: null, name: null, symbol: "USDbC" },
      priceUsd: "1.00",
      priceChange24hPct: 0,
      liquidityUsd: 1000000,
      volume24hUsd: 500000,
      trades24h: { buys: 1250, sells: 980 },
      pairCreatedAt: null,
      ageDays: null,
    },
  },
  {
    path: "/mev-simulator",
    price: "$0.04",
    summary: "Base gas-cost estimates under priority-fee scenarios",
    description:
      "Estimates Base gas costs from current fees and priority-fee presets. Fixed gas units (100k simple, 250k complex, 180k liquidity) are typical assumptions, not transaction-specific estimates or quotes. Valid values: standard, high-mev (3x priority fee), low-gas (half); invalid values return HTTP 400 without charge. No transaction simulation, mempool observation, or MEV/sandwich-risk measurement. Use to budget gas for a Base transaction.",
    tags: ["gas", "defi", "transaction-cost", "scenario-estimate", "base"],
    params: {
      scenario: {
        type: "string",
        description: "One of standard, high-mev, low-gas (default: standard)",
        example: "standard",
        enum: ["standard", "high-mev", "low-gas"],
      },
    },
    outputExample: {
      chain: "base",
      scenario: "standard",
      gasPrice: { baseFeeGwei: "0.05", priorityFeeGwei: "0.1", maxFeeGwei: "0.15" },
      estimatedCosts: {
        simpleSwap: { gasUnits: 100000, costEth: "0.000015", costUsd: "0.06" },
        complexSwap: { gasUnits: 250000, costEth: "0.0000375", costUsd: "0.16" },
        addLiquidity: { gasUnits: 180000, costEth: "0.000027", costUsd: "0.11" },
      },
      scenarioNotes: [
        "Gas units use typical fixed assumptions (100,000 simple swap, 250,000 complex swap, 180,000 add-liquidity), not a transaction-specific estimate or quote.",
        "This preset uses the current priority fee without adjustment.",
      ],
      blockNumber: 18650000,
    },
  },
  {
    path: "/package",
    // Must equal its Coinbase Bazaar listing (tests/bazaar-listed-prices.test.cjs): buyers that read the listing pay that amount.
    price: "$0.002",
    summary: "Package risk check: npm, PyPI, Cargo, Go, Maven or NuGet metadata and dependency-risk signals, latest or pinned version",
    description:
      "Reports package existence, latest version and release, age, version count, npm weekly downloads, licenses, deprecation and known advisory severity. ok means no listed flags, not a safety guarantee. Supports npm, PyPI, Cargo, Go, Maven and NuGet. Optional exact version adds pinned-version metadata and uses deps.dev advisories; use /package-audit for OSV affected ranges and dated FIRST EPSS CVE estimates. Use before adding a dependency.",
    tags: ["package", "npm", "pypi", "security", "dependencies"],
    params: {
      ecosystem: { type: "string", description: "One of npm, pypi, cargo, go, maven, nuget", required: true, example: "npm" },
      name: { type: "string", description: "Exact package name, e.g. lodash or @scope/name", required: true, example: "lodash" },
      version: { type: "string", description: "Optional exact version to inspect; ranges and tags are not accepted", example: "4.17.20" },
    },
    outputExample: {
      ecosystem: "npm",
      name: "lodash",
      exists: true,
      verdict: "ok",
      flags: [],
      latestVersion: "4.18.1",
      ageDays: 5282,
      versionCount: 117,
      weeklyDownloads: 162476177,
      licenses: ["MIT"],
      deprecated: false,
      knownVulnerabilities: 0,
      advisories: [],
      repository: "git+https://github.com/lodash/lodash.git",
    },
  },
  {
    path: "/email",
    price: "$0.003",
    summary: "Email verification: verify an address with syntax, MX and disposable-address checks, no mail sent",
    description:
      "Check email syntax, DNS and MX records, disposable providers, role addresses, free providers and SPF/DMARC presence. Returns likely-deliverable, risky, undeliverable or invalid with reasons. No message is sent and the mail server is not contacted. These are DNS and syntax signals, not proof that a mailbox exists or accepts delivery. Use before sending mail or saving a signup.",
    tags: ["email", "validation", "verification", "leads", "deliverability"],
    params: {
      address: { type: "string", description: "The email address to check", required: true, example: "support@cloudflare.com" },
    },
    outputExample: {
      address: "support@cloudflare.com",
      validSyntax: true,
      domain: "cloudflare.com",
      domainExists: true,
      acceptsMail: true,
      disposable: false,
      roleAddress: true,
      freeProvider: false,
      hasSpf: true,
      hasDmarc: true,
      verdict: "likely-deliverable",
      reasons: ["role address, not a person"],
    },
  },
  {
    path: "/papers",
    price: "$0.003",
    summary: "Research papers search: academic papers",
    description:
      "Search scholarly literature across journals, conferences, preprints and books: title, authors, year, venue, citation count, DOI link and abstract where available. Optional fromYear filter and up to 20 results per call. Use for research agents, literature reviews, fact-checking a claim against published work, and finding the DOI for a citation.",
    tags: ["research", "papers", "academic", "search", "citations"],
    params: {
      query: { type: "string", description: "Search terms, a title or a research question (3-300 characters)", required: true, example: "CRISPR off-target effects" },
      limit: { type: "integer", description: "Number of results, 1-20 (default 5)", example: 5 },
      fromYear: { type: "integer", description: "Only works published in or after this year", example: 2020 },
    },
    outputExample: {
      query: "CRISPR off-target effects",
      totalMatches: 819818,
      returned: 1,
      results: [
        { title: "Off-target effects in CRISPR/Cas9 gene editing", authors: ["Congting Guo", "Xiaoteng Ma"], year: 2023, venue: "Frontiers in Bioengineering and Biotechnology", type: "journal-article", citations: 632, doi: "10.3389/fbioe.2023.1143157", url: "https://doi.org/10.3389/fbioe.2023.1143157" },
      ],
    },
  },
  {
    path: "/fx",
    price: "$0.003",
    summary: "Currency exchange rates and conversion",
    description:
      "Foreign exchange rates from the European Central Bank for about 30 major currencies (USD, EUR, GBP, JPY, CHF, SEK, CAD, AUD, CNY, INR, BRL and more). Give a base currency, optionally the target currencies and an amount, and get the rates, the converted amounts and the date the rates apply to. Use for currency conversion, invoice and price calculations, and reporting in another currency.",
    tags: ["currency", "exchange-rate", "forex", "finance", "conversion"],
    params: {
      from: { type: "string", description: "Base currency as a three-letter ISO 4217 code, e.g. USD", required: true, example: "USD" },
      to: { type: "string", description: "Optional comma-separated target currency codes, e.g. EUR,GBP; default is all available currencies", example: "EUR,GBP,SEK" },
      amount: { type: "number", description: "Optional amount of the base currency to convert (default 1)", example: 100 },
    },
    outputExample: {
      from: "USD",
      amount: 100,
      rateDate: "2026-10-12",
      rates: { EUR: 0.89437, GBP: 0.75555, SEK: 10.0139 },
      converted: { EUR: 89.437, GBP: 75.555, SEK: 1001.39 },
      source: "European Central Bank reference rates (one rate per working day, published around 16:00 CET)",
      checkedAt: "2026-10-13T09:00:00.000Z",
    },
  },
  {
    path: "/btc-price",
    price: "$0.003",
    summary: "Bitcoin (BTC) price in USD, EUR and other major currencies",
    description:
      "Current Bitcoin (BTC) spot price in USD, EUR, GBP, CAD, CHF, AUD and JPY, averaged across major exchanges, with the number of satoshis per US dollar and the time of the price. Use to convert between sats and fiat, to value a Bitcoin or Lightning payment, or to check the BTC price before a trade.",
    tags: ["bitcoin", "price", "btc", "crypto", "market"],
    params: {},
    outputExample: {
      asset: "BTC",
      prices: { USD: 83463, EUR: 74624, GBP: 63152, CAD: 118855, CHF: 69423, AUD: 119532, JPY: 13210661 },
      satsPerUsd: 1198,
      usdPerSat: 0.00083463,
      priceTime: "2026-10-13T09:10:05.000Z",
      source: "mempool.space (average of major exchanges)",
      checkedAt: "2026-10-13T09:12:00.000Z",
    },
  },
  {
    path: "/base-gas",
    price: "$0.002",
    summary: "Base network gas price and fee estimate",
    description:
      "Live gas prices on Base (chain 8453) read from the latest block: base fee and priority fee in gwei, suggested maxFeePerGas and maxPriorityFeePerGas in wei for an EIP-1559 transaction, how full the latest block is, and the estimated execution fee in ETH for an ETH transfer and an ERC-20 transfer. Use before sending a transaction on Base or to decide whether to wait for lower fees.",
    tags: ["base", "gas", "fees", "ethereum", "onchain"],
    params: {},
    outputExample: {
      chain: "base",
      chainId: 8453,
      blockNumber: 37000000,
      blockTime: "2026-10-13T09:12:01.000Z",
      baseFeeGwei: "0.0052",
      priorityFeeGwei: "0.001",
      gasPriceGwei: "0.0062",
      suggested: { maxFeePerGasWei: "11400000", maxPriorityFeePerGasWei: "1000000" },
      blockUsedPercent: 31.4,
      estimatedExecutionFeeEth: { ethTransfer: "0.0000001302", erc20Transfer: "0.000000403" },
      checkedAt: "2026-10-13T09:12:02.000Z",
    },
  },
  {
    path: "/base-tx",
    price: "$0.003",
    summary: "Base transaction status and details",
    description:
      "Look up any transaction on Base by hash: whether it succeeded, reverted or is still pending, sender and receiver, ETH value, called method id, block number and time, number of confirmations, gas used, gas price and the execution fee paid, and whether it created a contract. Use to confirm that a payment or contract call went through before acting on it.",
    tags: ["base", "transaction", "receipt", "onchain", "payment-verification"],
    params: {
      hash: { type: "string", description: "Transaction hash on Base: 0x followed by 64 hex characters", required: true, example: "0x7d108fa131ed949c76d50caf2e7dfe25fc9903b9d276c40a0446d8afbdfe86b0" },
    },
    outputExample: {
      chain: "base",
      hash: "0x7d108fa131ed949c76d50caf2e7dfe25fc9903b9d276c40a0446d8afbdfe86b0",
      status: "success",
      from: "0x97acce27d5069544480bde0f04d9f47d7422a016",
      to: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
      contractCreated: null,
      valueEth: "0",
      nonce: 3363755,
      methodId: "0xe3ee160e",
      blockNumber: 52508570,
      blockTime: "2026-10-12T12:01:27.000Z",
      confirmations: 38598,
      gasUsed: 103410,
      gasPriceGwei: "0.00688587",
      executionFeeEth: "0.0000007120678167",
      logCount: 2,
    },
  },
  {
    path: "/base-allowance",
    price: "$0.002",
    summary: "ERC-20 token approval check on Base",
    description:
      "Check how much of a wallet's ERC-20 token a spender contract is approved to move on Base: the raw and formatted allowance, the token symbol and decimals, and whether the approval is unlimited. Use before a swap or deposit to see if an approve transaction is needed, and to audit a wallet for risky unlimited approvals.",
    tags: ["base", "erc20", "allowance", "approval", "security"],
    params: {
      token: { type: "string", description: "ERC-20 token contract address on Base (0x...)", required: true, example: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" },
      owner: { type: "string", description: "Wallet address that holds the token (0x...)", required: true, example: "0x4200000000000000000000000000000000000006" },
      spender: { type: "string", description: "Address allowed to spend, usually a router or protocol contract (0x...)", required: true, example: "0x000000000022D473030F116dDEE9F6B43aC78BA3" },
    },
    outputExample: {
      chain: "base",
      token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      symbol: "USDC",
      decimals: 6,
      owner: "0x4200000000000000000000000000000000000006",
      spender: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
      allowance: "0",
      allowanceFormatted: "0",
      unlimited: false,
      approved: false,
    },
  },
  {
    path: "/ens",
    price: "$0.003",
    summary: "ENS name lookup: ENS name to address and address to ENS name",
    description:
      "Resolve an Ethereum Name Service name such as vitalik.eth to its wallet address and avatar, or look up the primary ENS name of an address (reverse resolution). Read live from Ethereum mainnet. Use to turn a human-readable name into a payable address, or to show a readable name for a counterparty address.",
    tags: ["ens", "ethereum", "identity", "address", "resolve"],
    params: {
      name: { type: "string", description: "An ENS name such as vitalik.eth, or an address (0x...) for reverse lookup", required: true, example: "vitalik.eth" },
    },
    outputExample: {
      query: "vitalik.eth",
      type: "name",
      name: "vitalik.eth",
      address: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
      avatar: "https://euc.li/vitalik.eth",
      checkedAt: "2026-10-13T09:40:00.000Z",
    },
  },
  {
    path: "/weather",
    price: "$0.003",
    summary: "Weather forecast: current weather and 48-hour hourly forecast for any city or coordinates",
    description:
      "Weather for any city or point on Earth (city name, or latitude and longitude): current temperature in Celsius, conditions (clear, cloudy, rain, snow), precipitation in mm, wind, humidity, cloud cover and air pressure, plus an hourly forecast for up to 48 hours. Data from the Norwegian Meteorological Institute; city names resolve via Wikidata. Use for travel and event planning, logistics, agriculture and any agent that needs the weather.",
    tags: ["weather", "forecast", "temperature", "climate", "geo"],
    params: {
      city: { type: "string", description: "City or place name, e.g. London or Uppsala (used when lat and lon are not given)", example: "London" },
      lat: { type: "number", description: "Latitude in decimal degrees, -90 to 90 (with lon, instead of city)", example: 59.33 },
      lon: { type: "number", description: "Longitude in decimal degrees, -180 to 180 (with lat, instead of city)", example: 18.07 },
      hours: { type: "integer", description: "Hours of hourly forecast to return, 1-48 (default 12; 48 covers tomorrow)", example: 12 },
    },
    outputExample: {
      latitude: 59.33,
      longitude: 18.07,
      elevationM: 23,
      current: {
        time: "2026-10-13T09:00:00Z",
        temperatureC: 7.5,
        conditions: "cloudy",
        precipitationMm: 0,
        windSpeedMs: 1.1,
        windFromDegrees: 317,
        humidityPercent: 85.9,
        cloudCoverPercent: 94.6,
        pressureHpa: 1024.2,
      },
      forecast: [
        { time: "2026-10-13T10:00:00Z", temperatureC: 8.5, conditions: "partlycloudy_day", precipitationMm: 0, windSpeedMs: 1.2, windFromDegrees: 335, humidityPercent: 83.9, cloudCoverPercent: 73, pressureHpa: 1023.8 },
      ],
      forecastUpdatedAt: "2026-10-13T08:30:57Z",
      source: "MET Norway (api.met.no), licensed CC BY 4.0",
      checkedAt: "2026-10-13T09:12:00.000Z",
    },
  },
  {
    path: "/time",
    price: "$0.003",
    summary: "Current time in a time zone and time zone conversion",
    description:
      "The exact current date and time in any IANA time zone (UTC when none is given), with UTC offset, weekday, abbreviation and Unix timestamp, daylight saving time handled. Optionally convert a given moment into up to 10 other time zones in the same call. Use when an agent needs to know what time it is, to schedule across time zones or to turn a timestamp into local time. A bare GET is the smallest paid end-to-end test of an x402 or MPP client.",
    tags: ["time", "timezone", "clock", "date", "scheduling"],
    params: {
      zone: { type: "string", description: "IANA time zone name, e.g. Europe/Stockholm or America/New_York (default UTC)", example: "Europe/Stockholm" },
      at: { type: "string", description: "Optional moment to convert, as ISO 8601 with an offset (default: now)", example: "2026-03-01T09:00:00+01:00" },
      to: { type: "string", description: "Optional comma-separated time zones to convert the same moment into (max 10)", example: "America/New_York,Asia/Tokyo" },
    },
    outputExample: {
      utc: "2026-10-13T09:12:00.000Z",
      unixSeconds: 1791882720,
      zone: "Europe/Stockholm",
      localTime: "2026-10-13T11:12:00",
      isoWithOffset: "2026-10-13T11:12:00+02:00",
      utcOffset: "+02:00",
      weekday: "Tuesday",
      abbreviation: "CEST",
      converted: [
        { zone: "America/New_York", localTime: "2026-10-13T05:12:00", isoWithOffset: "2026-10-13T05:12:00-04:00", utcOffset: "-04:00", weekday: "Tuesday", abbreviation: "EDT" },
      ],
    },
  },
] as const satisfies readonly Endpoint[];

export type CoreEndpointPath = (typeof CORE_ENDPOINTS)[number]["path"];
/** Every paid tool path: the core tools plus the families. */
export type EndpointPath = CoreEndpointPath | (string & {});

/** Everything this service sells per call. Discovery, the paywall and MCP are generated from this list. */
export const PAUSED_FAMILY_TOOLS: Readonly<Record<string, string>> = Object.freeze({
  "/regex/test": "Bounded regex execution is not yet available.",
  // Duplicates of richer core tools; one name per job keeps agents from choosing between twins.
  "/base/gas": "Use /base-gas (MCP tool base_gas): the same Base gas data plus EIP-1559 fee suggestions.",
  "/base/tx": "Use /base-tx (MCP tool base_tx): the same Base transaction lookup plus confirmations and method id.",
  "/air-quality": "A source permitted for this commercial service is not yet configured.",
  "/uv": "A source permitted for this commercial service is not yet configured.",
  // Source terms checked 2026-10-18: Open-Meteo free tier, CoinGecko keyless/Demo and Nager.Date forbid commercial resale;
  // Where The ISS At, Free Dictionary API and the Hacker News API publish no terms that permit it.
  "/elevation": "A source permitted for this commercial service is not yet configured.",
  "/crypto/price": "A source permitted for this commercial service is not yet configured.",
  "/iss": "A source with terms permitting this commercial service is not yet confirmed.",
  "/hackernews/top": "A source with terms permitting this commercial service is not yet confirmed.",
  // Remove once SEARCH_API_KEY is set and Brave confirms its terms permit per-call resale.
  "/search": "Web search is not yet enabled: the provider's resale terms are being confirmed.",
});
export const ENDPOINTS: readonly Endpoint[] = [...CORE_ENDPOINTS, ...FAMILIES.map((f) => f.endpoint).filter(e => !Object.hasOwn(PAUSED_FAMILY_TOOLS, e.path))];
// Tools with no input of their own still publish an input schema: the generic `only` key filter (lib/fields.ts).
for (const e of ENDPOINTS) if (!Object.keys(e.params).length) (e as { params: Record<string, Param> }).params = { only: FIELDS_PARAM };

/**
 * The inputs of a tool's published example (service card, Bazaar discovery input, 402 Index URL): its required
 * parameters, or, for tools that take one of several inputs ("address or name"), the first parameter with an
 * example. Without that fallback those examples carried no input at all and a buyer copying one got a 400.
 */
/** The tool's documentation page, /tools/<slug>: its path with slashes as hyphens (unique across the catalog, checked by a test). */
export const toolSlug = (path: string) => path.slice(1).replaceAll("/", "-");

export function exampleParams(e: Pick<Endpoint, "params">): [string, Endpoint["params"][string]][] {
  const entries = Object.entries(e.params);
  const required = entries.filter(([, p]) => p.required);
  if (required.length) return required;
  // `only` is never an example input: it only trims a result, and a published example must show the tool itself.
  const first = entries.find(([name, p]) => name !== "only" && p.example !== undefined && p.example !== "");
  return first ? [first] : [];
}


/** Plain-language usage notes for agents, published in the OpenAPI document. */
export const GUIDANCE =
  "Every tool is a GET with query parameters that returns JSON, at /<tool> over HTTP or as an MCP tool at /mcp (same name with / replaced by _), or a smaller MCP server per section: /mcp/prices, chain, web, compliance, ai, everyday, utilities. An unpaid request returns 402 with a PAYMENT-REQUIRED header and a WWW-Authenticate: Payment challenge; pay with any x402 client (exact scheme, USDC on Base, Polygon, Arbitrum, Monad or World Chain) or any MPP client (mppx: evm/charge with USDC on Base, or tempo/charge with USDC.e on Tempo) and retry. Add sample=1 to any tool for a free static example of its output. Failed calls (4xx/5xx) are not charged; AI and screenshot tools return an uncharged 503 when their daily allowance is used up. Per-tool reliability for the last 7 days: /status. Pick by task. Token or wallet value: /price/token, /price/tokens (up to 20), /wallet/portfolio. Chain state on base, eth, arb, op or polygon: /<chain>/balance, token-balance, token-info, block, gas, tx, receipt, nonce, is-contract, logs. Counterparty checks: /check/counterparty (one call: OFAC SDN, wallet or contract risk and holdings, with a block/review/pass verdict), /sanctions/check (OFAC SDN), /token, /token-report, /wallet-audit, /contract-risk, /x402/check (inspect another x402 seller without paying). Read the web: /extract (page as text or Markdown), /extract/rendered (same, for pages built with JavaScript), /pdf/text, /feed (RSS or Atom), /url/meta (link preview), /sitemap, /summarize, /screenshot. Companies and domains: /company, /domain, /domain-report, /email, /package, /package-audit. Everyday data: /fx, /btc-price, /btc-fees, /weather, /time, /holidays, /geocode, /wikipedia, /dictionary, /papers, /country. AI text: /ai/chat, /ai/summarize-text, /ai/classify, /ai/translate, /ai/embed, /ai/extract-json and more. Utilities at $0.003: JSON, CSV, encodings, hashes, dates, cron, units and validators. Paused and not charged: /search, /air-quality, /uv, /elevation, /crypto/price, /iss, /hackernews/top, /regex/test.";

/** Extra links shown on the home page and in llms.txt. */
export const EXTRA_LINKS: { href: string; label: string }[] = [{ href: "/guides/web-reading", label: "Read documentation: real examples, free quote and capped CLI" }];
