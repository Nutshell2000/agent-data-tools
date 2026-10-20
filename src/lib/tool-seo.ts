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
    title: "Wallet counterparty risk check API (OFAC, activity, holdings)",
    uses: ["Vet an EVM address before sending funds", "Combine sanctions, account type, activity and USD holdings into one block, review or pass verdict", "Let an agent decide whether to pay an address it was given"],
    faq: [["Which networks?", "Base, Ethereum, Arbitrum and Optimism."], ["What does the verdict mean?", "Block, review or pass, with the reasons that produced it. It is a screening aid, not a security audit."]],
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
};
