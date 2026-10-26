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
  "/search": {
    title: "Web search API for AI agents: top results as JSON, pay per query",
    uses: ["Give an agent current information or sources from the open web in one call", "Get title, URL, snippet and page age for 1-20 results, then read one in full with /extract", "Ground an answer in live web results without an account or a monthly plan"],
    faq: [["Where do the results come from?", "The Brave Search API, one request per paid call. Results are for the caller's immediate use: no storing, resale or model training."], ["What if the search provider is down or the daily capacity is used up?", "The call answers 503 and nothing is charged."]],
  },
  "/qr": {
    title: "QR code generator API: SVG QR codes for any text or URL",
    uses: ["Turn a link, Wi-Fi string or payment request into a QR code an agent can embed", "Get a scalable SVG plus a ready-to-use data URL in one call", "Pick error correction L, M, Q or H for print or screens"],
    faq: [["Which characters work?", "Any UTF-8 text up to 1,000 characters; very long text at error correction H is refused with a 400, uncharged."], ["What format comes back?", "An SVG string and the same SVG as a base64 data URL."]],
  },
  "/calc/loan": {
    title: "Loan and mortgage calculator API: monthly payment and schedule",
    uses: ["Work out the monthly payment of a mortgage or loan from amount, rate and term", "Compare offers by total paid and total interest", "Show the first months of the repayment schedule"],
    faq: [["Which loans does it model?", "Fixed-rate, amortised loans with monthly payments; a 0% rate divides the amount evenly."], ["Can I give the term in months?", "Yes, pass months instead of years."]],
  },
  "/calc/compound-interest": {
    title: "Compound interest calculator API with monthly contributions",
    uses: ["Project savings or an investment with yearly, quarterly, monthly or daily compounding", "Add a contribution at the end of every month", "Get the balance after each year for a chart"],
    faq: [["Is the rate fixed?", "Yes, the calculation assumes a constant annual rate."], ["What does it return?", "The future value, total contributed, interest earned and the balance after each year."]],
  },
  "/calc/age": {
    title: "Age calculator API: exact age from a date of birth",
    uses: ["Get an exact age in years, months and days for forms and checks", "Find the next birthday and the days left until it", "Measure age on any date, not only today"],
    faq: [["How are 29 February birthdays handled?", "In years without 29 February the next birthday falls on 28 February."], ["Which time zone counts as today?", "UTC, unless you pass the date to measure on."]],
  },
  "/calc/bmi": {
    title: "BMI calculator API: body mass index and WHO category",
    uses: ["Compute BMI from kg and cm or from pounds and inches", "Get the WHO adult category and the normal weight range for a height", "Add a BMI step to a health or fitness app"],
    faq: [["Is this medical advice?", "No. It is a screening number for adults, not a diagnosis."], ["Which categories are used?", "The WHO adult categories, from underweight to obesity class III."]],
  },
  "/calc/tip": {
    title: "Tip calculator API: tip, total and split per person",
    uses: ["Add a tip percentage to a bill and get the total", "Split the total between several people", "Round each share up to a whole amount"],
    faq: [["What is the default tip?", "15% unless you pass percent."], ["How many people can share?", "From 1 to 100."]],
  },
  "/text/lorem": {
    title: "Lorem ipsum generator API: placeholder text for mock-ups",
    uses: ["Fill templates, mock-ups and test data with placeholder paragraphs", "Get the same text every time for a given seed", "Choose 1-20 paragraphs of 1-10 sentences"],
    faq: [["Does it start with the classic sentence?", "Yes, the first paragraph opens with \"Lorem ipsum dolor sit amet, consectetur adipiscing elit.\""], ["Is it random?", "Reproducible: the same seed gives the same text."]],
  },
  "/text/morse": {
    title: "Morse code translator API: text to Morse and back",
    uses: ["Encode text as international Morse code", "Decode Morse made of dots, dashes, spaces and slashes", "Let the direction be detected automatically"],
    faq: [["Which characters are supported?", "Letters, digits and common punctuation; anything else is reported, not guessed."], ["How are words separated?", "Letters by spaces and words by a slash."]],
  },
  "/text/caesar": {
    title: "Caesar cipher and ROT13 API: shift letters by any amount",
    uses: ["Apply ROT13 to hide spoilers or puzzle answers", "Encode or decode a Caesar cipher with any shift from 1 to 25", "Teach the basics of substitution ciphers"],
    faq: [["Is this encryption?", "No, it is a simple letter shift and offers no security."], ["What happens to digits and punctuation?", "They are left unchanged; letters keep their case."]],
  },
  "/xml/to-json": {
    title: "XML to JSON converter API",
    uses: ["Read XML feeds, SOAP responses and config files as JSON in an agent", "Keep attributes as \"@name\" keys and repeated elements as arrays", "Convert documents up to 100,000 characters"],
    faq: [["Is it safe with untrusted XML?", "DOCTYPE declarations are refused, so no external entity or file is ever loaded."], ["What happens with malformed XML?", "The call is refused with a 400 and nothing is charged."]],
  },
  "/json/schema": {
    title: "JSON schema from example API: infer a JSON Schema",
    uses: ["Turn an example API response into a JSON Schema (draft 2020-12)", "Merge the shapes of all items in an array, with optional keys left out of required", "Detect string formats such as date-time, email, uri and uuid"],
    faq: [["Which JSON Schema version?", "Draft 2020-12."], ["How are mixed numbers handled?", "Integers and decimals in the same field widen to number."]],
  },
  "/news": {
    title: "News search API for AI agents: latest headlines as JSON, pay per query",
    uses: ["Get the latest headlines on a topic with title, URL, snippet, publisher and age", "Limit results to the past day, week or month for a current-events answer", "Read a story in full afterwards with /extract"],
    faq: [["Where do the articles come from?", "The Brave Search API's news index, one request per paid call. Results are for the caller's immediate use: no storing, resale or model training."], ["What if the provider is down or the daily capacity is used up?", "The call answers 503 and nothing is charged."]],
  },
  "/econ/gdp": {
    title: "GDP by country API: World Bank GDP, growth and per capita",
    uses: ["Get a country's GDP in US dollars, real growth and GDP per capita for the last 1-10 years", "Compare economies by ISO code or English country name", "Add macro context to a market-sizing or research answer"],
    faq: [["Where does the data come from?", "A committed snapshot of World Bank Open Data (CC BY 4.0); the snapshot date is in every answer."], ["How current is it?", "The World Bank publishes annual figures; the newest year available for the country is returned first."]],
  },
  "/econ/inflation": {
    title: "Inflation rate by country API: World Bank consumer prices",
    uses: ["Get a country's annual consumer-price inflation for the last 1-10 years", "Deflate prices or returns with the official CPI change", "Compare inflation across countries by ISO code or name"],
    faq: [["Where does the data come from?", "A committed snapshot of World Bank Open Data (CC BY 4.0); the snapshot date is in every answer."], ["Is it monthly?", "No. The series is the World Bank's annual % change in consumer prices."]],
  },
  "/econ/population": {
    title: "Population by country API: World Bank totals, growth and urban share",
    uses: ["Get a country's total population, growth rate and urban share for the last 1-10 years", "Compute per-capita figures from a total you already have", "Compare countries by ISO code or English name"],
    faq: [["Where does the data come from?", "A committed snapshot of World Bank Open Data (CC BY 4.0); the snapshot date is in every answer."], ["Which countries are covered?", "The 217 World Bank economies; aggregates such as regions are not included."]],
  },
  "/econ/unemployment": {
    title: "Unemployment rate by country API: World Bank ILO estimates",
    uses: ["Get a country's unemployment rate and youth unemployment rate for the last 1-10 years", "Compare labour markets across countries by ISO code or name", "Add labour-market context to an economic answer"],
    faq: [["Where does the data come from?", "A committed snapshot of World Bank Open Data (CC BY 4.0), ILO modelled estimates; the snapshot date is in every answer."], ["Is it seasonally adjusted monthly data?", "No. The series are annual rates as % of the labour force."]],
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

  // Prices and chain reads
  "/price/tokens": {
    title: "Batch crypto price API: USD prices for up to 20 tokens in one call",
    uses: ["Value a basket of tokens or refresh a watchlist in one paid call", "Price by ticker (ETH, BTC, USDC, AERO) or ERC-20 address on Base, Ethereum, Arbitrum or Optimism", "Spot tokens with thin liquidity before relying on the price"],
    faq: [["Where do the prices come from?", "Each token's deepest Uniswap v3 pool against USDC or WETH on the chosen chain, read live from the chain at call time. Spot prices."], ["What if a token has no pool?", "It is listed under unpriced with the reason instead of failing the call."]],
  },
  "/btc-price": {
    title: "Bitcoin price API: BTC in USD, EUR, GBP and sats per dollar",
    uses: ["Convert between sats and fiat", "Value a Bitcoin or Lightning payment", "Check the BTC price before a trade"],
    faq: [["Where does the price come from?", "mempool.space, an average across major exchanges, with the time of the price in the result."], ["Which currencies?", "USD, EUR, GBP, CAD, CHF, AUD and JPY, plus satoshis per US dollar."]],
  },
  "/base-gas": {
    title: "Base gas price API: base fee, priority fee and EIP-1559 suggestions",
    uses: ["Get the current base fee and priority fee on Base in gwei", "Take suggested maxFeePerGas and maxPriorityFeePerGas for an EIP-1559 transaction", "See the estimated fee of an ETH or ERC-20 transfer before sending"],
    faq: [["Does it need any input?", "No. It reads the latest Base block (chain 8453) and reports how full it is."], ["Is this the same as /base/gas?", "/base/gas is paused and points here: this tool has the same Base gas data plus the EIP-1559 fee suggestions."]],
  },
  "/wallet": {
    title: "Base wallet balance API: ETH, USDC and token holdings with nonce",
    uses: ["Check a counterparty's ETH and major token balances on Base (USDC, WETH, cbBTC, DAI, USDbC, cbETH, AERO, EURC)", "Add up to 20 token addresses of your own to the same call", "See the account nonce and whether the address is an EOA, a contract or an EIP-7702 account"],
    faq: [["Which chains?", "Base only. For all five chains use /wallet/balances; for USD values use /wallet/portfolio."], ["Is the nonce a transaction history?", "No. It counts outgoing transactions only, not transfers or trading history."]],
  },
  "/base/token-transfers": {
    title: "Base USDC transfer history API: recent ERC-20 transfers of a wallet",
    uses: ["Confirm a USDC payment arrived at a Base address", "See what a wallet sent or received, newest first, with counterparty, amount and transaction", "Check another ERC-20 token by ticker or contract address"],
    faq: [["How far back does it look?", "The last 1 to 2,000 blocks (default 1,000); 2,000 blocks is about 67 minutes on Base. Up to 50 transfers are returned."], ["Which token is the default?", "USDC on Base; pass token for USDT, WETH or any ERC-20 contract. For the current balance use base_token_balance."]],
  },
  "/eth/token-transfers": {
    title: "Ethereum USDC transfer history API: recent ERC-20 wallet transfers",
    uses: ["Confirm a USDC payment arrived at an Ethereum address", "See what a wallet sent or received, newest first, with counterparty, amount and transaction", "Check another ERC-20 token by ticker or contract address"],
    faq: [["How far back does it look?", "The last 1 to 2,000 blocks (default 1,000); 2,000 blocks is about 6.7 hours on Ethereum. Up to 50 transfers are returned."], ["Which token is the default?", "USDC on Ethereum; pass token for USDT, WETH or any ERC-20 contract. For the current balance use eth_token_balance."]],
  },
  "/base/balance": {
    title: "Base ETH balance API: native balance of any wallet address",
    uses: ["Check whether a Base wallet can pay gas or a transfer", "Read the ETH balance at the latest block in wei and ETH", "Add a balance check before an agent sends funds on Base"],
    faq: [["Does it include tokens?", "No, native ETH only (eth_getBalance); base_token_balance reads ERC-20 tokens and wallet_portfolio lists all holdings."], ["What about a bad address?", "A malformed address is rejected with 400 and not charged."]],
  },
  "/base/token-balance": {
    title: "Base USDC balance API: ERC-20 token balance of a wallet",
    uses: ["Check a wallet's USDC, USDT, WETH or any ERC-20 balance on Base before a transfer or trade", "Pass a ticker or the token's 0x contract address", "Get the raw amount, decimals, symbol and human-readable amount from balanceOf"],
    faq: [["What if the token address is wrong?", "No contract returns 404 and a non-ERC-20 contract 422, both uncharged."], ["What about ETH itself?", "Use base_balance for the native coin."]],
  },
  "/mev-simulator": {
    title: "Base gas cost estimator API: swap fees under priority-fee scenarios",
    uses: ["Budget gas for a Base transaction", "Compare the standard, high-mev (3x priority fee) and low-gas (half) presets", "See the cost in ETH and USD for 100k, 250k and 180k gas units"],
    faq: [["Does it simulate my transaction?", "No. Gas units are fixed typical assumptions (100k simple, 250k complex, 180k liquidity), not transaction-specific estimates; there is no mempool observation or MEV or sandwich-risk measurement."], ["What if the scenario is wrong?", "Invalid values return 400 without charge."]],
  },
  "/trade-insight": {
    title: "Base token and wallet risk indicators API before a trade",
    uses: ["Get one input before a Base trade: token risk tier and flags, DEX market data, wallet risk tier and flags", "Read the wallet's account nonce and native balance in the same call"],
    faq: [["Does it recommend buying or selling?", "No. It returns the underlying indicators separately, with no buy/sell recommendation or calibrated confidence; holder concentration is not evaluated."], ["Which chain?", "Base; it combines the token-report and wallet-audit indicators."]],
  },

  // Bitcoin and Lightning
  "/btc-address": {
    title: "Bitcoin address balance API: confirmed, pending, received and sent",
    uses: ["Payment verification: check whether a deposit arrived", "Wallet monitoring with confirmed balance, unconfirmed pending amount, totals and transaction counts"],
    faq: [["Which address types?", "Bitcoin mainnet legacy, P2SH and bech32 addresses."]],
  },
  "/ln-invoice": {
    title: "Lightning invoice decoder API: BOLT11 amount, expiry and hash",
    uses: ["Check what an invoice asks for before an agent pays it", "Read network, amount in sats and BTC, description, payment hash, creation and expiry time", "See whether the invoice has already expired"],
    faq: [["Does it pay the invoice?", "No. It decodes the BOLT11 string only."]],
  },

  "/dictionary": {
    title: "English dictionary API: word definitions from Wiktionary",
    uses: ["Look up definitions of an English word grouped by part of speech", "Get example sentences where Wiktionary gives them", "Writing help, vocabulary, translation checks and word games"],
    faq: [["Where do the definitions come from?", "Wiktionary, with the page link and the CC BY-SA attribution to show."], ["Which languages?", "English words only."]],
  },
  "/wikipedia": {
    title: "Wikipedia summary API: article extract in any language edition",
    uses: ["Ground an agent's answer in a quick, citable fact sheet", "Get the title, one-paragraph extract, description, thumbnail and page URL", "Read another language edition with lang (default en)"],
    faq: [["Is the full article returned?", "No, a short summary: title, one-paragraph extract, description, thumbnail and page URL, with CC BY-SA 4.0 attribution."]],
  },
  "/papers": {
    title: "Academic paper search API: titles, authors, citations and DOI",
    uses: ["Search journals, conferences, preprints and books for a research agent or literature review", "Fact-check a claim against published work", "Find the DOI for a citation"],
    faq: [["How many results?", "Up to 20 per call (default 5), optionally only works from fromYear onwards."], ["What does each result include?", "Title, authors, year, venue, citation count, DOI link and abstract where available."]],
  },
  "/earthquakes": {
    title: "Recent earthquakes API: USGS quakes for the past day or week",
    uses: ["Alerts, news and travel checks", "Filter by minimum magnitude 2.5, 4.5 or significant", "Get magnitude, place, time, depth, coordinates, tsunami flag and USGS link"],
    faq: [["Where does the data come from?", "The US Geological Survey feeds for the past day or week."]],
  },
  "/country": {
    title: "Country data API: ISO codes, capital, region and population",
    uses: ["Enrich records with country data by ISO code (SE, SWE, US)", "Get the capital city and its coordinates", "Read the latest population figure with its year and the income level"],
    faq: [["Where does the data come from?", "World Bank open data, with the official World Bank name and region."]],
  },
  "/moon": {
    title: "Moon phase API: illumination, age and next new and full moon",
    uses: ["Calendars and night-sky planning", "Get the phase name, illuminated percentage and age in days for any date"],
    faq: [["Is it computed or looked up?", "Computed locally from the mean synodic month."]],
  },
  "/time": {
    title: "Current time API: now in any time zone, with time zone conversion",
    uses: ["Tell an agent what time it is, in UTC or any IANA zone", "Schedule across time zones: convert one moment into up to 10 zones", "Run the smallest paid end-to-end test of an x402 or MPP client with a bare GET"],
    faq: [["What if I give no zone?", "UTC. The result has the UTC offset, weekday, abbreviation and Unix timestamp, with daylight saving time handled."]],
  },

  // Web reading
  "/feed": {
    title: "RSS feed reader API: parse RSS and Atom feeds to JSON",
    uses: ["Follow news, blogs, release notes or podcasts without scraping pages", "Get the newest items with title, link, ISO date, plain-text summary, author and id", "Read the feed title, link and description"],
    faq: [["Which formats and limits?", "RSS 2.0, RSS 1.0 and Atom, up to 50 items per call and feeds up to 2 MB; it is lenient with real-world feeds."], ["What if the URL is not a feed?", "It returns 422 and is not charged."]],
  },
  "/sitemap": {
    title: "Sitemap URL extractor API: list the pages of a docs site",
    uses: ["Find which pages of a documentation site to read before calling /extract", "Filter URLs by a substring and page through large sitemaps", "Read source-reported last-modified dates"],
    faq: [["Does it crawl the pages?", "No. It reads one XML sitemap or sitemap index (gzip supported); child sitemaps are not followed and URLs are not probed."], ["What are the limits?", "Larger sitemaps are read from the start: the first 512 KiB and 1,000 entries, with a warning. Invalid XML is not charged; a valid empty match is."]],
  },
  "/summarize": {
    title: "Web page summarizer API: summary and key points from a URL",
    uses: ["Research, news triage, link previews and deciding whether a page is worth reading in full", "Get a short summary plus three to six key points ready for an agent's context"],
    faq: [["Does it work on PDFs?", "No, HTML pages only; for a PDF use pdf_text, then ai_summarize_text."], ["Can I get the full text instead?", "Yes, with /extract."]],
  },

  // AI
  "/ai/chat-large": {
    title: "Pay-per-call LLM API: Llama 3.3 70B or gpt-oss-120b, no subscription",
    uses: ["Reasoning, drafting and Q&A when the 8B model is not enough", "Pick llama-3.3-70b (default) or gpt-oss-120b with the model input", "Call it through the OpenAI-compatible /v1/chat/completions by naming a 70b or gpt-oss model"],
    faq: [["How is it different from /ai/chat?", "Same call and inputs (prompt, optional system prompt, up to 1,024 output tokens, temperature) with a stronger model, at its own price."]],
  },
  "/ai/translate": {
    title: "Translation API: translate text between 100 languages (M2M100)",
    uses: ["Localise messages and documents", "Translate up to 4,000 characters with a target ISO code such as en, sv, de, fr, es, zh or ja"],
    faq: [["Which model?", "Meta's M2M100 1.2B, about 100 languages; the source language is optional (default en)."]],
  },
  "/ai/embed": {
    title: "Text embeddings API: 1,024-dimension vectors (BGE-M3), pay per call",
    uses: ["Semantic search, RAG retrieval, clustering and deduplication", "Embed up to 4,000 characters in 100+ languages", "Use the same call through the OpenAI-compatible /v1/embeddings"],
    faq: [["Which model and size?", "BAAI's BGE-M3, 1,024 dimensions."], ["Can I send several texts at once?", "No, one text (up to 4,000 characters) per call."]],
  },
  "/ai/summarize-text": {
    title: "Text summarization API: summary and key points, pay per call",
    uses: ["Summarize long emails, documents, transcripts and tool outputs", "Choose the summary length, 1-8 sentences", "Get bullet key points with the summary"],
    faq: [["How much text?", "Up to 12,000 characters that you send; for a web page by URL use /summarize."]],
  },
  "/ai/sentiment": {
    title: "Sentiment analysis API: positive or negative with confidence score",
    uses: ["Triage reviews, support messages, social posts and replies", "Get POSITIVE or NEGATIVE with a score for each label"],
    faq: [["Which model and languages?", "A DistilBERT model fine-tuned on SST-2, for English text up to 4,000 characters."], ["Is there a neutral class?", "No, positive or negative only, each with its score."]],
  },
  "/ai/classify": {
    title: "Zero-shot text classification API: route text into your own labels",
    uses: ["Route tickets, tag content, detect intent and fill moderation queues", "Give 2-20 candidate labels and get the best one, a short reason and a ranking"],
    faq: [["Do I need to train anything?", "No. It is zero-shot: send the text (up to 8,000 characters) and the comma-separated labels."]],
  },
  "/ai/keywords": {
    title: "Keyword extraction API: key phrases from text, most relevant first",
    uses: ["Tagging, SEO, search indexing and topic detection", "Ask for 3-30 keywords (default 10) from up to 12,000 characters"],
    faq: [["What comes back?", "A list of keywords and short key phrases, most important first."]],
  },
  "/ai/rewrite": {
    title: "Text rewriting API: make text formal, casual, shorter or simpler",
    uses: ["Polish emails, replies, product copy and messages", "Pick a style: formal, casual, simpler, shorter, friendly, professional or persuasive"],
    faq: [["Does it change the meaning or language?", "No. It keeps the meaning and language and adds no facts, names or details that are not in the original."]],
  },
  "/ai/outline": {
    title: "Outline generator API: Markdown outline of a text or topic",
    uses: ["Plan articles, reports, talks and documentation", "Outline a text you send, or get a suggested outline for a topic", "Choose 1-3 heading levels"],
    faq: [["What format is the outline?", "Markdown headings and bullet points, up to the depth you choose (default 2)."]],
  },
  "/ai/extract-json": {
    title: "Text to JSON extraction API: pull named fields from messy text",
    uses: ["Turn emails, invoices, listings and bios into structured data for an agent", "Name 1-30 fields and get a JSON object with exactly those keys"],
    faq: [["What if a field is not in the text?", "It is null and listed under missing; the model is told never to guess."]],
  },
  "/ai/speech": {
    title: "Text to speech API: turn text into an audio file (MeloTTS)",
    uses: ["Voice replies, audio notes, accessibility and phone or chat bots", "Speak up to 1,000 characters in English, Spanish, French, Chinese, Japanese or Korean"],
    faq: [["What do I get back?", "The audio as base64 with its content type and size in bytes."]],
  },
  "/describe": {
    title: "Image description API: caption, OCR-style reading and visual Q&A",
    uses: ["Write alt text for an image at a public URL", "Read the text in screenshots and charts", "Ask a specific question about the image"],
    faq: [["Which formats and sizes?", "PNG, JPEG, WebP and GIF up to 3 MB, by public URL."], ["Which model answers?", "A vision model on Workers AI; its exact name is returned in the model field."]],
  },
  "/image": {
    title: "AI image generation API: text to 1024x1024 JPEG with FLUX.1 schnell",
    uses: ["Illustrations, thumbnails, mockups, avatars and social media images", "Trade speed for detail with steps 1-8 (default 4)"],
    faq: [["What do I get back?", "A 1024x1024 JPEG as base64, in a few seconds."], ["How long can the prompt be?", "3 to 800 characters."]],
  },
  "/transcribe": {
    title: "Audio transcription API: speech to text with Whisper large-v3-turbo",
    uses: ["Transcribe voice notes, podcast clips, meeting snippets and voice messages", "Get the transcript, detected language, duration and word count"],
    faq: [["Which formats and size?", "Common formats such as MP3, WAV, M4A and OGG at a public URL, up to 5 MB."]],
  },

  // Utilities
  "/ip/info": {
    title: "IP address classifier API: private, public, loopback or link-local",
    uses: ["Triage IPs in logs or allowlists", "Tell private, loopback, link-local, carrier-grade NAT and public addresses apart", "Get the integer and reverse-DNS forms of an IPv4 address"],
    faq: [["Does it look up geolocation or ownership?", "No. It classifies the IPv4 or IPv6 address without any lookup."]],
  },
  "/ip/cidr": {
    title: "CIDR calculator API: network, broadcast, hosts and netmask",
    uses: ["Build firewall rules and allowlists", "Get the network and broadcast address, first and last usable host, netmask and address count", "Check whether a given IP falls inside the range"],
    faq: [["IPv6 too?", "No, IPv4 networks in CIDR notation."]],
  },
  "/json/validate": {
    title: "JSON validator API: check JSON with line and column errors",
    uses: ["Check an LLM's or an API's output before parsing it", "Get the parsed value's type and size when it is valid", "Get the error message with line and column when it is not"],
    faq: [["How much text?", "Up to 20,000 characters."], ["Can it fix the JSON?", "No; /json/repair fixes JSON as LLMs often write it."]],
  },
  "/csv/to-json": {
    title: "CSV to JSON API: spreadsheet exports to a JSON array",
    uses: ["Load spreadsheet exports into an agent", "Convert comma, semicolon, tab or pipe delimited CSV with quoted fields", "Turn numeric cells into numbers with numbers=true"],
    faq: [["Do I have to name the delimiter?", "No, it is detected automatically; the first row becomes the keys."], ["Are numbers converted?", "They stay as text unless numbers=true."]],
  },
  "/json/to-csv": {
    title: "JSON to CSV API: convert a JSON array of objects to CSV",
    uses: ["Export API results to a spreadsheet", "Build a header row from all keys across the objects"],
    faq: [["What happens to nested values?", "They are written as JSON inside the cell."], ["What input is accepted?", "A JSON array of objects; anything else returns 422, uncharged."]],
  },
  "/html/to-text": {
    title: "HTML to plain text API: strip HTML for LLM input",
    uses: ["Feed web content or emails to an LLM", "Remove scripts and styles, decode entities, keep line breaks and list bullets"],
    faq: [["Does it fetch a URL?", "No, you send the HTML (up to 50,000 characters); /extract fetches a page by URL."]],
  },
  "/markdown/to-html": {
    title: "Markdown to HTML API: safe HTML from agent-written Markdown",
    uses: ["Publish agent-written Markdown on a web page", "Convert headings, bold, italic, strikethrough, links, images, code, lists, quotes and rules"],
    faq: [["Is raw HTML in the input kept?", "No, it is escaped, so the output is safe to embed."]],
  },
  "/text/stats": {
    title: "Text readability API: word count, reading time and Flesch score",
    uses: ["Check the length and readability of a draft", "Count characters, words, sentences and paragraphs", "Estimate reading and speaking time"],
    faq: [["Which readability scores?", "Flesch reading ease and Flesch-Kincaid grade level, for English text."]],
  },
  "/text/diff": {
    title: "Text diff API: line-by-line comparison of two texts",
    uses: ["See what changed between two versions of a document, config or prompt", "Get each line marked unchanged, removed or added, with counts"],
    faq: [["Is it word-level?", "No, line by line."]],
  },
  "/text/extract": {
    title: "Extract emails, URLs and phone numbers from text API",
    uses: ["Pull contacts and links out of scraped pages or messages", "Get de-duplicated lists of emails, URLs, phone-number-like strings, hashtags, @mentions and numbers"],
    faq: [["Does it fetch a URL?", "No, you send the text (up to 50,000 characters); /extract reads a page by URL."]],
  },
  "/units/convert": {
    title: "Unit converter API: length, mass, volume, temperature, data size",
    uses: ["Convert km to mi, lb to kg, floz to ml, mph to kn, kWh, psi and more", "Tell kB from KiB in data sizes", "Convert temperatures between c, f and k"],
    faq: [["Which unit kinds?", "Length, mass, volume (incl. US cups and gallons), temperature, speed, area, data size, time, energy and pressure."]],
  },
  "/unix": {
    title: "Unix timestamp converter API: epoch seconds to ISO date and back",
    uses: ["Read timestamps in logs and APIs", "Convert an ISO date to a Unix timestamp", "Get the current time in both forms with no input"],
    faq: [["Seconds or milliseconds?", "Either; it is detected automatically."]],
  },
  "/date/diff": {
    title: "Date difference API: days, weeks and weekdays between two dates",
    uses: ["Deadlines, ages and durations", "Get total days, weeks, hours, minutes and seconds plus a years-months-days breakdown", "Count the weekdays (Monday-Friday) in between"],
    faq: [["What input does it take?", "Two dates or ISO timestamps, from and to."]],
  },
  "/date/add": {
    title: "Date calculator API: add days, months or business days to a date",
    uses: ["Compute due dates and expiries", "Add or subtract years, months, weeks, days, hours and minutes", "Add business days, skipping Saturdays and Sundays"],
    faq: [["What about month ends?", "They are clamped: 31 Jan + 1 month = 28/29 Feb."], ["Are public holidays skipped?", "No, only Saturdays and Sundays; /holidays lists a country's holidays."]],
  },
  "/npm/downloads": {
    title: "npm download stats API: daily, weekly and monthly counts",
    uses: ["Judge how widely a dependency is used", "Read counts for the last day, week and month"],
    faq: [["Where do the counts come from?", "The official npm registry API."]],
  },
  "/pypi": {
    title: "PyPI package info API: latest version, licence and Python version",
    uses: ["Check a Python dependency before installing it", "Read the latest version, summary, licence, required Python version and home page", "See the release date and number of releases"],
    faq: [["Does it report vulnerabilities?", "No. /package and /package-audit add risk flags and advisories."]],
  },
  "/semver": {
    title: "Semver compare API: which version is newer and the next bump",
    uses: ["Decide whether an upgrade is a major change", "Compare versions with pre-releases like 2.0.0-rc.1 by the SemVer rules", "Get the next major, minor and patch of a version"],
    faq: [["What does it take?", "Two semantic versions such as 1.10.0 and 1.9.3; pre-releases follow the SemVer rules."]],
  },
  "/jwt/decode": {
    title: "JWT decoder API: read header, payload and expiry without a key",
    uses: ["Debug auth flows", "See issued-at, not-before and expiry as dates and whether the token has expired"],
    faq: [["Does it verify the signature?", "No. signatureVerified is always false; do not use the result to trust a token."], ["Is the token stored?", "No."]],
  },
  "/hash": {
    title: "SHA-256 hash API: hash text with SHA-1, SHA-256, SHA-384 or SHA-512",
    uses: ["Checksums, cache keys and deduplication", "Get the digest in hex and base64"],
    faq: [["Which algorithm is the default?", "SHA-256; pass algorithm for sha1, sha384 or sha512. Input is UTF-8 text."]],
  },
  "/hmac": {
    title: "HMAC signature API: SHA-256 webhook signature check",
    uses: ["Check webhook signatures", "Compute an HMAC with SHA-256 (default), SHA-1, SHA-384 or SHA-512 in hex and base64"],
    faq: [["Is my key stored?", "No. The key is used only for this call and is not stored."]],
  },
  "/keccak": {
    title: "Keccak-256 hash API: Ethereum function selectors and event topics",
    uses: ["Build or decode EVM calls", "Hash a function signature such as transfer(address,uint256) and get its 4-byte selector", "Hash 0x hex bytes for event topics and storage slots"],
    faq: [["Text or bytes?", "Both: plain text, or 0x-prefixed hex bytes, up to 10,000 characters."]],
  },
  "/uuid": {
    title: "UUID generator API: random version-4 UUIDs, up to 100 per call",
    uses: ["IDs, idempotency keys and test data", "Generate 1 to 100 UUIDs in one call"],
    faq: [["How random are they?", "Version-4 UUIDs from a cryptographic random source."]],
  },
  "/validate/isbn": {
    title: "ISBN validator API: check ISBN-10 and ISBN-13, convert to ISBN-13",
    uses: ["Check an ISBN before cataloguing or ordering books", "Convert a valid ISBN-10 to ISBN-13"],
    faq: [["Does it look the book up?", "No, it checks the check digit; hyphens and spaces are ignored."]],
  },
  "/validate/luhn": {
    title: "Luhn check API: validate card and IMEI numbers, compute check digit",
    uses: ["Catch typos in card or ID numbers", "Compute the check digit to append to a number"],
    faq: [["Does it check whether the card exists?", "No. Only the format (mod 10) is checked; nothing is looked up."]],
  },
  "/http/status": {
    title: "HTTP status code lookup API: meaning and whether to retry",
    uses: ["Handle API errors in an agent", "Explain 402 Payment Required, 429 Too Many Requests and other 1xx-5xx codes"],
    faq: [["What comes back?", "The code's name, a plain-language meaning, its class and whether to retry."]],
  },
  "/url/parse": {
    title: "URL parser API: host, path, query parameters and origin",
    uses: ["Read query parameters as an object", "Check a link's protocol, host, port, path, hash and origin", "See whether the host is an IP address"],
    faq: [["Does it fetch the URL?", "No, it only splits the URL you send."]],
  },
  "/url/encode": {
    title: "URL encode API: percent-encode text for query strings and URLs",
    uses: ["Build query strings safely", "Get both the query-value form (encodeURIComponent) and the full-URL form (encodeURI)"],
    faq: [["Which form should I use?", "component for a query value, uri for a whole URL; both are returned."]],
  },
  "/url/decode": {
    title: "URL decode API: decode percent-encoded text and form data",
    uses: ["Read encoded links and form data", "Treat + as a space with plus=true (form encoding)"],
    faq: [["What about a bad sequence?", "An invalid percent sequence returns 400, uncharged."]],
  },
  "/base64/encode": {
    title: "Base64 encode API: standard and URL-safe base64 from text",
    uses: ["Data URLs, headers and basic auth strings", "Get the standard and the URL-safe variant in one call"],
    faq: [["What input is accepted?", "UTF-8 text."]],
  },
  "/base64/decode": {
    title: "Base64 decode API: standard or URL-safe base64 to text",
    uses: ["Read encoded headers, tokens and data URLs", "Decode standard or URL-safe base64"],
    faq: [["Does padding matter?", "No, missing padding is tolerated; the output is UTF-8 text."]],
  },
};
