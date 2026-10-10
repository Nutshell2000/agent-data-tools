// What this service sells: its name, its tools and their prices.
// Everything in discovery.ts, the HTTP routes and the MCP tools is generated from this file.

/** Machine name: used for the MCP server and its registry entry. */
export const SERVICE_ID = "agent-data-tools";
export const SERVICE_NAME = "Agent Data Tools";
export const SERVICE_SUMMARY =
  "Pay-per-call tools for AI agents: web page text extraction and summaries, screenshots, image generation, speech-to-text, image description, domain and email-auth intelligence, and live Base token and wallet lookups. No account or API key; pay per request in USDC on Base via x402.";

export interface Param {
  type: "string" | "integer";
  description: string;
  required?: boolean;
  example: string | number;
}

export interface Endpoint {
  path: string;
  price: string;
  summary: string;
  /** Shown in x402 directories. Must stay under 500 characters. */
  description: string;
  tags: string[];
  params: Record<string, Param>;
  outputExample: Record<string, unknown>;
}

export const ENDPOINTS: Endpoint[] = [
  {
    path: "/extract",
    price: "$0.002",
    summary: "Web page to clean text",
    description:
      "Fetch any public web page and get clean readable text for LLM input: title, meta description, language, canonical URL, H1-H3 headings, main body text with navigation, scripts and boilerplate removed, and the page's outbound links. Use for web scraping, article reading, research and RAG ingestion.",
    tags: ["web", "scraping", "extract", "text", "rag"],
    params: {
      url: { type: "string", description: "Absolute http(s) URL of the page to fetch", required: true, example: "https://example.com" },
      maxChars: { type: "integer", description: "Maximum characters of body text to return (500-100000, default 20000)", example: 20000 },
    },
    outputExample: {
      url: "https://example.com/",
      finalUrl: "https://example.com/",
      status: 200,
      title: "Example Domain",
      description: null,
      lang: "en",
      headings: [],
      text: "This domain is for use in documentation examples without needing permission. This is not a service; avoid relying on it for testing and monitoring purposes.",
      textLength: 156,
      truncated: false,
      links: [],
    },
  },
  {
    path: "/domain",
    price: "$0.005",
    summary: "Domain DNS, registration age and email authentication",
    description:
      "Domain intelligence in one call: DNS records (A, AAAA, CNAME, MX, NS, TXT, CAA), DNSSEC status, registrar, registration and expiry dates with domain age in days (RDAP/WHOIS), and email authentication (SPF and DMARC records and policies, whether the domain accepts mail). Use for lead qualification, phishing and trust checks, and deliverability audits.",
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
    path: "/token",
    price: "$0.01",
    summary: "Base ERC-20 token facts and risk flags",
    description:
      "Live on-chain facts for any ERC-20 token on Base: name, symbol, decimals, total supply, owner address and whether ownership is renounced, paused state, proxy detection (EIP-1967 and minimal proxy) with implementation and admin addresses, and bytecode heuristics for mint, pause, blacklist and fee-setter functions. Use for token due diligence and rug-pull or honeypot screening before a swap.",
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
    path: "/wallet",
    price: "$0.005",
    summary: "Base wallet balances snapshot",
    description:
      "Live snapshot of any address on Base: ETH balance, balances of major tokens (USDC, WETH, cbBTC, DAI, USDbC, cbETH, AERO, EURC) plus up to 20 extra token addresses you pass, transaction count, and whether the address is an EOA, a smart contract or an EIP-7702 delegated account. Use for portfolio checks, counterparty screening and payment verification.",
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
      transactionCount: 0,
      tokens: [
        { address: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", symbol: "USDC", decimals: 6, balance: "167551481", balanceFormatted: "167.551481" },
      ],
    },
  },
  {
    path: "/summarize",
    price: "$0.01",
    summary: "Summarize a web page",
    description:
      "Give a URL, get a short summary of the page plus three to six key points, ready to drop into an agent's context. Fetches the page, strips navigation and boilerplate, and summarizes the main text with an LLM. Use for research, news triage, link previews and deciding whether a page is worth reading in full.",
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
    summary: "Screenshot of a web page",
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
    summary: "Generate an image from a text prompt",
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
    summary: "Speech to text for an audio file",
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
    description:
      "Current Bitcoin network fee rates in sat/vB for next-block, half-hour, one-hour and economy confirmation, the estimated cost in sats of a typical payment, mempool size and total pending fees, and the latest block height. Use before sending a Bitcoin transaction or to decide whether to wait for lower fees.",
    tags: ["bitcoin", "fees", "mempool", "btc", "onchain"],
    params: {},
    outputExample: {
      network: "bitcoin",
      unit: "sat/vB",
      fees: { nextBlock: 4, halfHour: 3, hour: 1, economy: 1, minimum: 1 },
      typicalPaymentSats: { nextBlock: 564, hour: 141 },
      mempool: { transactions: 83832, vsize: 42066150, totalFeesBtc: 0.1093664 },
      blockHeight: 970000,
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
    price: "$0.001",
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
    path: "/package",
    price: "$0.002",
    summary: "Does this package exist, and is it safe to install",
    description:
      "Check a software package before installing it: whether it exists at all (AI coding assistants sometimes invent names), latest version and release date, package age, number of versions, weekly downloads (npm), licenses, deprecation, and known security advisories with severity. Returns a verdict of ok, caution or not-found with the reasons. Covers npm, PyPI, Cargo, Go, Maven and NuGet. Use before adding a dependency or running an install command.",
    tags: ["package", "npm", "pypi", "security", "dependencies"],
    params: {
      ecosystem: { type: "string", description: "One of npm, pypi, cargo, go, maven, nuget", required: true, example: "npm" },
      name: { type: "string", description: "Exact package name, e.g. lodash or @scope/name", required: true, example: "lodash" },
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
    price: "$0.001",
    summary: "Email address validation without sending mail",
    description:
      "Validate an email address before using it: syntax, whether the domain exists and accepts mail (MX records), disposable or throwaway provider detection, role addresses such as info@ or support@, free-provider detection, and SPF and DMARC presence. Returns a verdict of likely-deliverable, risky, undeliverable or invalid with reasons. No message is sent and the mail server is not contacted. Use for sign-up checks, lead list cleaning and contact enrichment.",
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
    summary: "Search academic papers",
    description:
      "Search scholarly literature across journals, conferences, preprints and books: title, authors, year, venue, citation count, DOI link and abstract where available. Optional fromYear filter and up to 20 results per call. Use for research agents, literature reviews, fact-checking a claim against published work, and finding the DOI for a citation.",
    tags: ["research", "papers", "academic", "search", "citations"],
    params: {
      query: { type: "string", description: "Search terms, a title or a research question (3-300 characters)", required: true, example: "attention is all you need" },
      limit: { type: "integer", description: "Number of results, 1-20 (default 5)", example: 5 },
      fromYear: { type: "integer", description: "Only works published in or after this year", example: 2020 },
    },
    outputExample: {
      query: "attention is all you need",
      totalMatches: 1392853,
      returned: 1,
      results: [
        { title: "Is Attention All You Need?", authors: ["Patrick Mineault"], year: 2025, venue: "From Human Attention to Computational Attention", type: "book-chapter", citations: 55, doi: "10.1007/978-3-031-84300-6_13", url: "https://doi.org/10.1007/978-3-031-84300-6_13", abstract: null },
      ],
    },
  },
];


/** Plain-language usage notes for agents, published in the OpenAPI document. */
export const GUIDANCE =
  "All operations are GET with query parameters and return JSON. Web: /extract reads a page as clean text, /summarize returns a short summary with key points, /screenshot returns a JPEG of the rendered page. AI: /image generates an image from a prompt, /transcribe turns an audio file URL into text, /describe describes or answers a question about an image URL. Images come back as base64 in the imageBase64 field. Data: /domain covers DNS, registration age and email authentication, /token gives facts and risk flags for an ERC-20 token on Base, /wallet gives the balances of an address on Base. Each call costs a fixed price in USDC on Base via x402; failed calls (4xx/5xx) are not charged. AI and screenshot endpoints return 503 when the daily capacity is used up. Bitcoin: /btc-fees gives current fee rates, /btc-address gives an address balance, /ln-invoice decodes a Lightning invoice. Checks: /package tells you whether a software package exists and is safe to install, /email validates an email address without sending mail, /papers searches academic literature. ";

/** Extra links shown on the home page and in llms.txt. */
export const EXTRA_LINKS: { href: string; label: string }[] = [{ href: "/store", label: "Store: x402 Seller Kit, a template and guide for building a service like this" }];

/** Set to true once the TRIALS key-value binding exists in wrangler.jsonc. */
export const TRIALS_ENABLED = true;
