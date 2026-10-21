// Search-facing copy for the tool pages people are most likely to look for (src/lib/tool-pages.ts). Titles use
// the words people search with; "uses" and "faq" restate what the tool's own description and limits already
// say. Nothing here may claim more than the tool does: no reviews, customer counts or guarantees.

export interface ToolSeo {
  /** Page <title> and <h1>; the price and "no signup" are added by the page. */
  title: string;
  /** Short situations the tool is for, one line each. */
  uses: string[];
  /** Question and answer pairs, also published as schema.org FAQPage data. */
  faq: [question: string, answer: string][];
}

export const TOOL_SEO: Record<string, ToolSeo> = {
  "/sanctions/check": {
    title: "OFAC sanctions check API for crypto wallets and names",
    uses: ["Screen a wallet address against the OFAC SDN list before paying or onboarding it", "Check a person or company name against SDN names and aliases", "Add a sanctions step to an AI agent's payment flow"],
    faq: [["Which list does it check?", "The US Treasury OFAC SDN list, including aliases and the listed digital currency addresses. Each match comes with its SDN ID, programs and the list date."], ["Is this legal advice?", "No. It is a screening aid; confirm any match against official OFAC records before acting."]],
  },
  "/check/counterparty": {
    title: "Screen a payee before paying: wallet risk check API (OFAC)",
    uses: ["Screen a payee's EVM address before sending funds", "Combine sanctions, account type, activity and USD holdings into one block, review or pass verdict", "Let an agent decide whether to pay an address it was given"],
    faq: [["Which networks?", "Base, Ethereum, Arbitrum and Optimism."], ["What does the verdict mean?", "Block, review or pass, with the reasons that produced it. It is a screening aid, not a security audit."]],
  },
  "/check/payee": {
    title: "Payee preflight API: OFAC screen an address before paying",
    uses: ["Screen the address an x402 seller or invoice asks you to pay before sending USDC", "Check the payee's account type and nonce on Base, Ethereum, Arbitrum, Optimism or Polygon", "Add the payee's domain to see its age and trust flags in the same call"],
    faq: [["How is it different from /check/counterparty?", "It skips holdings and the Base wallet and contract heuristics, so it is cheaper and faster; use /check/counterparty when you need those."], ["Is a pass a guarantee?", "No. It is a screening aid; confirm any sanctions match against the official OFAC record."]],
  },
  "/check/x402-seller": {
    title: "x402 seller audit API: vet terms, payTo and domain before paying",
    uses: ["Vet an unfamiliar x402 seller before an agent's first payment to it", "OFAC-screen every payTo address and read its account type on the payment network", "Flag non-USDC assets, high prices and a young or untrusted seller domain"],
    faq: [["Does it pay or sign anything?", "No. It reads the endpoint's unpaid 402 answer and public chain and registration data."], ["Does a pass mean the seller delivers?", "No. It is a screening aid on who gets paid and on what terms, not a delivery guarantee."]],
  },
  "/token-report": {
    title: "Token honeypot and rug-pull check API for Base tokens",
    uses: ["Check a Base token before swapping into it", "Get named red flags (paused transfers, blacklist, owner-set fees, live mint owner, proxy, thin or new liquidity, buys but no sells) and a high, medium or low verdict", "Read live DEX price, liquidity, volume and FDV in the same call"],
    faq: [["Is a low verdict a safety guarantee?", "No. It is heuristic screening from on-chain reads and DexScreener market data, not an audit."], ["Which chain?", "Base. For token facts on other chains use the chain's token_info tool."]],
  },
  "/token": {
    title: "ERC-20 token facts API: owner, proxy, pause and mint flags",
    uses: ["Read a Base token's name, symbol, decimals, supply and owner on chain", "See whether ownership is renounced, transfers are paused or the token is a proxy", "Spot mint, pause, blacklist and fee-setter functions in the bytecode"],
    faq: [["Which chain?", "Base only; other chains have their own token_info tools."], ["Do I also get market data?", "No. /token-report adds a risk verdict plus live DEX liquidity and volume."]],
  },
  "/wallet-audit": {
    title: "Wallet risk check API: fresh or throwaway Base wallets",
    uses: ["Screen a Base address for fresh or throwaway-wallet signals", "Get a high, medium or low risk tier with named flags", "See ETH, USDC, WETH, cbBTC and DAI balances and the nonce in one call"],
    faq: [["Does it check sanctions?", "No. For OFAC screening and other chains use /check/counterparty."], ["Does the address type affect the tier?", "No, it is reported separately."]],
  },
  "/contract-risk": {
    title: "Smart contract risk check API before approving a Base contract",
    uses: ["Check a Base contract before approving it as a spender or calling it", "Get a low to critical tier with named flags such as proxy, unset implementation, tiny bytecode or zero supply", "Read the EIP-1967 implementation slot and ERC-20 owner, renounced and paused state"],
    faq: [["Is this a security audit?", "No. It is a limited set of bytecode, proxy and supply heuristics."], ["What about plain wallets?", "An address without code returns not-applicable."]],
  },
  "/liquidity-pool-audit": {
    title: "DEX liquidity pool check API for Base pairs",
    uses: ["Confirm a Base DEX pair is real before trading or adding liquidity", "Read its DEX, both tokens, liquidity, 24h volume and trades, and pair age", "Check a pool is deep enough for the size of a trade"],
    faq: [["Where does the data come from?", "DexScreener, with the source and retrieval time in every answer."], ["Does it assess pool security?", "No. It reports market data only; for token red flags use /token-report."]],
  },
  "/x402/check": {
    title: "x402 endpoint checker: decode payment terms without paying",
    uses: ["Check an x402 seller's price, network, asset and recipient before paying it", "Decode a v1 402 body or a v2 PAYMENT-REQUIRED header", "Score your own x402 listing for the fields directories and the Bazaar read"],
    faq: [["Does it pay or sign anything?", "No. It only reads the endpoint's unpaid 402 answer."], ["What does the listing score check?", "An https resource URL, the atomic amount, the facilitator minimum, a description, Bazaar metadata and an output schema."]],
  },
  "/package": {
    title: "Package risk check API for npm, PyPI, Cargo, Go, Maven and NuGet",
    uses: ["Check a dependency before adding it: age, versions, downloads, licenses and deprecation", "See known advisory severity for the latest or a pinned version", "Let a coding agent vet the packages it is about to install"],
    faq: [["Does ok mean the package is safe?", "No. It means none of the listed flags applied."], ["Where are the CVE details?", "/package-audit adds OSV affected ranges and dated FIRST EPSS estimates."]],
  },
  "/price/token": {
    title: "ERC-20 token price API from Uniswap v3 pools",
    uses: ["Get a token's USD price straight from its on-chain Uniswap v3 pool", "Price long-tail tokens that centralized price feeds do not list", "Value a wallet or a trade inside an agent"],
    faq: [["Where does the price come from?", "The token's Uniswap v3 pools on the chosen chain, read on chain at call time."], ["Can I price several tokens at once?", "Yes, /price/tokens prices up to 20 tokens in one call."]],
  },
  "/wallet/portfolio": {
    title: "Crypto wallet portfolio API: holdings valued in USD",
    uses: ["List a wallet's token holdings with USD values", "Check what an address holds before trading with it", "Give an agent a quick balance overview"],
    faq: [["Which tokens are included?", "The chain's common tokens, or the token addresses you pass in tokens."]],
  },
  "/wallet/balances": {
    title: "Native and USDC balance API across 5 EVM networks",
    uses: ["Check an address's ETH/POL and USDC on Base, Ethereum, Arbitrum, Optimism and Polygon in one call", "Confirm a wallet is funded before a payment", "Monitor treasury or bot wallets"],
    faq: [["Which networks?", "Base, Ethereum, Arbitrum, Optimism and Polygon."]],
  },
  "/extract": {
    title: "Web page to Markdown and text API for LLMs",
    uses: ["Turn a web page into clean Markdown or text for an LLM or RAG pipeline", "Pull the tables and code blocks out of documentation pages", "Read one section of a long page by heading"],
    faq: [["Does it run JavaScript?", "No, it reads the page as served. For pages that need a browser, use /extract/rendered."], ["How long can the output be?", "Set maxChars to cap it; long pages can be read section by section."]],
  },
  "/pdf/text": {
    title: "PDF to text API, page by page",
    uses: ["Extract the text of a public PDF by URL", "Read only a range of pages from a long report", "Feed PDF content to an LLM"],
    faq: [["Does it OCR scanned PDFs?", "No, it extracts the text layer. Scanned images without text return little or nothing."]],
  },
  "/dockerfile/lint": {
    title: "Dockerfile linter API for security and image size",
    uses: ["Check a Dockerfile for risky instructions before a build", "Find size problems such as unpinned bases and missing cleanup", "Add a lint step to a coding agent"],
    faq: [["What does it return?", "Each finding with its line, severity and a suggested fix."]],
  },
  "/http/security-headers": {
    title: "HTTP security headers checker API",
    uses: ["Audit a site's CSP, HSTS, X-Frame-Options and related headers", "Check a deploy before release", "Get fix suggestions an agent can apply"],
    faq: [["Does it scan the whole site?", "No, it checks the response headers of the URL you give."]],
  },
  "/text/prompt-injection": {
    title: "Prompt injection detection API for LLM inputs",
    uses: ["Scan web or user text for instructions aimed at an AI before passing it to a model", "Flag tool outputs that try to change an agent's task", "Log suspicious inputs"],
    faq: [["Is it a guarantee?", "No. It detects common injection patterns and reports what it found; treat it as one layer of defence."]],
  },
  "/package-audit": {
    title: "npm and PyPI dependency vulnerability audit API",
    uses: ["Check up to 10 dependencies for known advisories at their exact versions", "Get the fixed version for each advisory", "Let a coding agent vet packages before installing them"],
    faq: [["Which ecosystems?", "npm and PyPI packages with exact versions."]],
  },
  "/validate/iban": {
    title: "IBAN validation API",
    uses: ["Check an IBAN's format and checksum before a transfer", "Validate bank details in a form or an agent workflow"],
    faq: [["Does it confirm the account exists?", "No, it checks the country format and checksum only."]],
  },
  "/cron/next": {
    title: "Cron expression next run times API",
    uses: ["See when a cron schedule will run next", "Check a schedule before deploying it", "Explain a cron line to a user"],
    faq: [["How many run times can I get?", "Set count; the start time can be set with from."]],
  },
  "/json/repair": {
    title: "Broken JSON repair API",
    uses: ["Fix JSON with trailing commas, single quotes or missing brackets", "Repair LLM output that is almost JSON", "Clean data before parsing"],
    faq: [["What if it cannot be repaired?", "The call fails and is not charged."]],
  },
  "/fx": {
    title: "Currency exchange rate and conversion API",
    uses: ["Convert an amount between currencies at the current reference rate", "Price items in a user's currency", "Give an agent a quick FX lookup"],
    faq: [["How often are rates updated?", "Daily reference rates from the source named in the result."]],
  },
  "/holidays": {
    title: "Public holidays API by country and year",
    uses: ["List a country's public holidays for scheduling", "Skip holidays when planning deliveries or meetings"],
    faq: [["Which countries?", "Countries covered by the Nager.Date public holiday data, by two-letter code."]],
  },
  "/sun": {
    title: "Sunrise and sunset times API",
    uses: ["Get sunrise, sunset and day length for any coordinates and date", "Plan outdoor work or photography"],
    faq: [["Is it computed or looked up?", "Computed from the coordinates and date."]],
  },
  "/ens": {
    title: "ENS name resolver API (name to address and reverse)",
    uses: ["Resolve vitalik.eth-style names to addresses", "Show a readable name for an address", "Check an ENS name before sending funds"],
    faq: [["Which direction?", "Both: a name to its address, or an address to its primary name."]],
  },
  "/btc-fees": {
    title: "Bitcoin fee estimate API (sat/vB) and mempool status",
    uses: ["Pick a fee rate for the next block, half hour or hour", "Estimate the cost of a typical payment in sats", "Watch mempool congestion"],
    faq: [["Where do the numbers come from?", "The mempool.space API, at call time."]],
  },
  "/ai/chat": {
    title: "Pay-per-call LLM chat API (Llama 3.1 8B), no subscription",
    uses: ["Run a quick completion without an account or provider key", "Give an agent a cheap model for summaries or classification", "Use the same key through the OpenAI-compatible /v1/chat/completions"],
    faq: [["Is there an OpenAI-compatible endpoint?", "Yes: /v1/chat/completions, /v1/responses and /v1/embeddings take the same payment methods."]],
  },
  // Added 21 Oct 2026 for the job categories agents and people search for most (email verification, company data,
  // weather, screenshots, domains, filings, chain reads); each line restates the tool's own description.
  "/email": {
    title: "Email verification API: syntax, MX and disposable checks",
    uses: ["Check an address before sending mail or saving a signup", "Flag disposable, role and free-provider addresses", "See whether the domain has MX records and SPF/DMARC"],
    faq: [["Does it send an email?", "No. No message is sent and the mail server is not contacted; the result comes from syntax and DNS signals."], ["Does it prove the mailbox exists?", "No. It returns likely-deliverable, risky, undeliverable or invalid with reasons, which are signals, not proof of delivery."]],
  },
  "/company": {
    title: "Company data API: website, founders, tickers and LEI",
    uses: ["Enrich a lead, vendor or counterparty with its official website and country", "Look up founding date, headquarters, CEO, parent company and employee count", "Find a listed company's stock tickers, exchanges and LEI"],
    faq: [["Where does the data come from?", "Wikidata (public domain, CC0), with Wikidata and Wikipedia links. It is best for established and listed companies."], ["What if there is no match?", "The call returns 404 and is not charged."]],
  },
  "/weather": {
    title: "Weather API: current weather and 48-hour forecast by city",
    uses: ["Get the current temperature, conditions, wind and humidity for a city or coordinates", "Plan travel, events or logistics with an hourly forecast up to 48 hours", "Give an AI agent the weather without a provider account"],
    faq: [["Where does the forecast come from?", "The Norwegian Meteorological Institute (MET Norway); city names resolve via Wikidata."], ["Can I use coordinates instead of a city?", "Yes, pass lat and lon instead of city."]],
  },
  "/screenshot": {
    title: "Website screenshot API: capture any web page as an image",
    uses: ["Capture a page as a JPEG after its JavaScript has run", "Make page previews or monitor how a page looks", "Feed a page to a vision model"],
    faq: [["How large is the image?", "1280 px wide; with fullPage=true up to 4000 px of page height, returned as base64 with the final URL, status and title."]],
  },
  "/domain": {
    title: "Domain lookup API: DNS records, WHOIS age and SPF/DMARC",
    uses: ["See a domain's DNS records, registrar and registration and expiry dates", "Check domain age before trusting a lead or a sender", "Audit SPF and DMARC for email deliverability"],
    faq: [["Which records are included?", "A, AAAA, CNAME, MX, NS, TXT and CAA, plus DNSSEC status, RDAP/WHOIS dates and the SPF and DMARC policies."]],
  },
  "/domain-report": {
    title: "Domain trust check API: phishing and new-domain flags",
    uses: ["Get a high, medium or low trust verdict for a domain in one call", "Catch very new registrations, weak SPF/DMARC and non-resolving domains", "Check a domain before an agent emails or trusts it"],
    faq: [["Is the verdict a guarantee?", "No. It lists named signals such as new registration or missing DMARC; it is not a guarantee."]],
  },
  "/sec/filings": {
    title: "SEC EDGAR filings API: 10-K, 10-Q, 8-K and Form 4 by ticker",
    uses: ["Find a US-listed company's latest annual or quarterly report", "Watch insider trades (Form 4) and material events (8-K)", "Get direct links to filings by stock ticker or CIK"],
    faq: [["Can I ask for one form type?", "Yes, pass form (for example 10-K or 4) to get only that type, newest first."], ["Where does the data come from?", "SEC EDGAR, public SEC data."]],
  },
  "/hyperliquid/market": {
    title: "Hyperliquid funding rate and open interest API",
    uses: ["Check a perp's hourly funding rate and its APR", "See open interest, 24-hour volume and mark price for BTC, ETH, SOL and more", "List the 20 most traded Hyperliquid markets"],
    faq: [["Where does the data come from?", "Hyperliquid's public API, read at call time."]],
  },
  "/airport/status": {
    title: "US airport delay API: FAA ground stops and closures",
    uses: ["Check an airport for ground stops, delays or closures before travel", "Warn customers or plan logistics around airport delays", "See every US airport with active delays at once"],
    faq: [["Which airports?", "US airports in the FAA National Airspace System status, by IATA code such as LGA, or all of them when no code is given."], ["How fresh is it?", "Public FAA data, refreshed about every minute."]],
  },
  "/eth/balance": {
    title: "Ethereum balance API: ETH balance of any wallet address",
    uses: ["Check whether a wallet can pay gas or a transfer", "Read the ETH balance at the latest block in wei and ETH", "Add a balance check to an agent before it sends funds"],
    faq: [["Does it include tokens?", "No, native ETH only; eth_token_balance reads ERC-20 tokens and wallet_portfolio lists all holdings."], ["What about a bad address?", "A malformed address is rejected with 400 and not charged."]],
  },
  "/eth/gas": {
    title: "Ethereum gas price API: base fee, tip and transfer cost",
    uses: ["Get the current gas price, base fee and suggested priority fee in gwei", "See what a plain ETH transfer costs right now", "Decide whether to send a transaction now or wait"],
    faq: [["Does it need any input?", "No. It takes no input and reads the latest Ethereum gas data."]],
  },
  "/geocode": {
    title: "Geocoding API: place name to latitude and longitude",
    uses: ["Turn a city, town or landmark name into coordinates", "Tell two places with the same name apart by country and region", "Prepare coordinates for weather, sun or distance lookups"],
    faq: [["Where does the data come from?", "Wikidata (CC0), best match first, with population and elevation where recorded."]],
  },
  "/extract/rendered": {
    title: "JavaScript page scraper API: rendered page to Markdown",
    uses: ["Scrape single-page apps that come back empty without a browser", "Get the text of pages that build their content with JavaScript", "Fall back here when /extract returns too little text"],
    faq: [["How long does it wait?", "It renders the page in a real browser and waits for the network to settle, up to 15 seconds."], ["Can it log in?", "No. Public pages only."]],
  },
  "/url/meta": {
    title: "Link preview API: OpenGraph and Twitter card metadata",
    uses: ["Build link previews with title, description and image", "Check how a URL will unfurl before sharing it", "Label citations with site name, author and published time"],
    faq: [["Does it run JavaScript?", "No. It reads at most 512 KB of the page's head and never runs JavaScript."]],
  },
};
