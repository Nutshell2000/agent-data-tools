// The tools the ChatGPT plugin server (/mcp/chatgpt) offers (10 Nov 2026; the owner: "Yes, free version").
//
// OpenAI rejected the first submission on 5 Nov 2026 for three reasons, and its published rules
// (developers.openai.com/plugins/plugin-guidelines) decide this list:
//   1. Commerce. A plugin may not sell digital services or credits, "directly or indirectly (for example, through
//      freemium upsells)", and trial plugins are not accepted. So inside ChatGPT the service is free: a daily allowance
//      per signed-in user, no credits, no key, no price, no plan, no link to our checkout. Only tools that cost us nothing
//      per call are here (nothing in CAPACITY_LIMITED: no AI model, no browser, no Brave search).
//   2. Annotations must match behaviour. Nothing here writes: every tool is read-only and non-destructive
//      (annotationsFor in src/mcp-contract.ts sets open-world or closed-world per tool).
//   3. Restricted data. No tool takes payment-card numbers, health details, government identifiers, passwords, keys or
//      tokens, and none scans free text for personal data. Left out for that: /validate/luhn, /calc/bmi, /jwt/decode,
//      /hmac, /random/password, /text/pii, /text/prompt-injection, the e-mail, phone, IBAN and BIC validators, IP
//      lookups, and /vat/validate (a sole trader's VAT number holds a personal identity number in several countries).
//      /sanctions/check does take a name: it is compared with a public list and nothing else is looked up about it.
// Also left out by the same rules:
//   - prediction markets (real-money gambling) and anything that prepares or rates a trade or a payment: swap and bridge
//     quotes, Lightning invoices, trade and token verdicts, payee and counterparty checks, derivatives data;
//   - what ChatGPT already does itself (chat, summarise, translate, generic page fetching, unit and text converters);
//   - sources whose terms do not clearly allow passing the data on (stock quotes, CoinGecko, DefiLlama, Open-Meteo);
//   - precise-location inputs (geocoding an address, distances between coordinates, sun times for coordinates);
//   - entry paths: every tool appears once, under its own name;
//   - the per-network chain reads beyond Ethereum and Base, so near-identical tools do not fill the list.
// tests/chatgpt-mcp.test.cjs checks every rule above against the catalog, so a tool added here by mistake fails there.

/** Calls a signed-in ChatGPT user can make per UTC day, and all ChatGPT users together (a bound on what free costs us). */
export const CHATGPT_CALLS_PER_DAY = 50;
export const CHATGPT_CALLS_TOTAL_PER_DAY = 5000;

export const CHATGPT_TOOLS: ReadonlySet<string> = new Set([
  // Screening and company records (OFAC SDN list, GLEIF, Wikidata, SEC EDGAR, Federal Register: public records)
  "/sanctions/check", "/company", "/lei/lookup", "/sec/filings", "/sec/8k", "/sec/insider", "/sec/13f", "/gov/federal-register",
  // Domains and websites (RDAP, DNS, and what a site itself serves)
  "/domain", "/domain-report", "/domain/availability", "/dns/lookup", "/dns/propagation", "/http/security-headers", "/url/redirects", "/url/uptime",
  "/robots", "/sitemap", "/url/meta", "/url/favicon", "/tech/stack", "/seo/audit", "/pack/website-audit", "/agent-readiness", "/openapi/summary", "/mcp/inspect",
  // Documents and references
  "/pdf/text", "/feed", "/papers", "/wikipedia", "/book/isbn", "/book/search",
  // Software packages and repositories (npm, PyPI, OSV, GitHub repository data)
  "/package", "/package-audit", "/github/repo", "/github/search", "/github/releases", "/npm/downloads", "/pypi", "/dockerfile/lint", "/semver", "/cron/next",
  // Public blockchain state: balances, prices from on-chain pools, transactions. Reads only; nothing is signed or sent.
  "/wallet/balances", "/wallet/portfolio", "/ens", "/price/token", "/price/tokens", "/btc-fees", "/btc-price", "/btc-address",
  "/eth/balance", "/eth/token-balance", "/eth/token-info", "/eth/tx", "/eth/receipt", "/eth/gas", "/eth/block", "/eth/is-contract",
  "/base/balance", "/base/token-balance", "/base/token-info", "/base-tx", "/base/receipt", "/base-gas", "/base/block", "/base/is-contract",
  // Currencies and public statistics (ECB reference rates, World Bank, US Treasury)
  "/fx", "/fx/all", "/fx/symbols", "/econ/gdp", "/econ/inflation", "/econ/population", "/econ/unemployment", "/econ/national-debt", "/econ/treasury-rates",
  // Everyday public data (MET Norway, USGS, FAA, NHTSA, calendars)
  "/weather", "/time", "/holidays", "/date/business-days", "/earthquakes", "/country", "/moon", "/airport/status", "/airport/lookup", "/vin",
  // One generator ChatGPT cannot do reliably itself
  "/qr",
]);

// What ChatGPT reads about each tool. The catalog's descriptions are written for paying agents: they say which failures
// are "uncharged", suggest a read "before a swap or payment", and point at tools this server does not offer. Inside
// ChatGPT nothing is charged and nothing prepares a payment or a trade, so that wording is replaced here, for this server
// only. Each entry is [text in the catalog, text for ChatGPT]; tests/chatgpt-mcp.test.cjs fails when a left-hand text is
// no longer in the catalog (a description was edited) and when any ChatGPT text still holds such wording.
const GAS_USE = "Use to see what a transaction costs right now";
export const CHATGPT_WORDING: Readonly<Record<string, ReadonlyArray<readonly [string, string]>>> = {
  "/sitemap": [[" Invalid XML and execution errors are not charged; a valid empty match is charged.", ""], [" before calling /extract", ""]],
  "/time": [[" A bare GET is the smallest paid end-to-end test of an x402 or MPP client.", ""]],
  "/btc-fees": [["a typical payment", "a typical transaction"], ["Use before sending a Bitcoin transaction or to decide whether to wait for lower fees.", "Use to see what a Bitcoin transaction costs right now."]],
  "/btc-address": [["Use for payment verification, checking whether a deposit arrived, and wallet monitoring.", "Use to check whether a transaction arrived and to watch an address."]],
  "/btc-price": [[", to value a Bitcoin or Lightning payment, or to check the BTC price before a trade", " or to value an amount of Bitcoin"]],
  "/base-gas": [["Use before sending a transaction on Base or to decide whether to wait for lower fees.", `${GAS_USE} on Base.`]],
  "/eth/gas": [["Use before sending a transaction or to decide whether to wait;", `${GAS_USE};`]],
  "/base-tx": [["Use to confirm that a payment or contract call went through before acting on it.", "Use to confirm that a transaction went through."]],
  "/ens": [["into a payable address, or to show a readable name for a counterparty address", "into an address, or to show a readable name for an address"]],
  "/base/balance": [["Use to check whether a wallet can pay gas or a transfer;", "Use to see how much ETH a wallet holds;"]],
  "/eth/balance": [["Use to check whether a wallet can pay gas or a transfer;", "Use to see how much ETH a wallet holds;"]],
  "/base/token-balance": [[" before a transfer or trade;", ";"]],
  "/eth/token-balance": [[" before a transfer or trade;", ";"]],
  "/base/receipt": [["Use to confirm a payment or call went through;", "Use to confirm a transaction went through;"]],
  "/eth/receipt": [["Use to confirm a payment or call went through;", "Use to confirm a transaction went through;"]],
  "/eth/tx": [[", for emitted events eth_logs", ""]],
  "/eth/is-contract": [["Use before sending funds or approving a spender; for a fuller risk verdict use check_counterparty.", "Use to tell a contract from a wallet."]],
  "/base/is-contract": [["Use before sending funds or approving a spender; for a fuller risk verdict use check_counterparty.", "Use to tell a contract from a wallet."]],
  "/wallet/balances": [[" before a payment or bridge; for one token on one network use <chain>_token_balance,", "; for one token on Ethereum or Base use eth_token_balance or base_token_balance,"]],
  "/price/token": [[" Use to value a token or check a quote before a swap or payment.", " Use to value a token."]],
  "/price/tokens": [[" in one paid call", " in one call"]],
  "/wallet/portfolio": [[" before trading, lending or paying", ""]],
  "/sanctions/check": [[" before you pay it or accept funds", ""], [" Use before paying; with wallet risk: check_counterparty.", ""]],
  "/agent-readiness": [[", A2A agent card and x402 payment discovery", " and A2A agent card"]],
  "/qr": [["a link, Wi-Fi string or payment request", "a link or a Wi-Fi string"]],
  "/github/search": [["e.g. x402 payments", "e.g. vector database"], ["q=x402 payments", "q=vector database"]],
  "/domain/availability": [["Is a domain name free?", "Is a domain name available?"]],
};

/** A tool's description or input description as the ChatGPT server shows it. */
export function chatgptText(path: string, text: string): string {
  let out = text;
  for (const [from, to] of CHATGPT_WORDING[path] ?? []) out = out.replace(from, to);
  // "returns 404, uncharged." / "fail uncharged." / "422, both uncharged.": nothing is charged here at all.
  return out.replace(/,? (?:both )?uncharged/g, "");
}
