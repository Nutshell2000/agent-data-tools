import { assertToolOutput } from "./lib/output-contract";
import { messagesAsArray } from "./lib/chat-messages";
import { sitemap } from "./routes/sitemap";
import { HttpError, type Env } from "./lib/env";
import { ENDPOINTS, PAUSED_FAMILY_TOOLS } from "./endpoints";
import { describeImage, generateImage, summarize, transcribe } from "./routes/ai";
import { bitcoinAddress, bitcoinFees, lightningInvoice } from "./routes/bitcoin";
import { baseAllowance, baseTransaction, ensLookup } from "./routes/chain";
import { contractRisk } from "./routes/contract-risk";
import { domainInfo } from "./routes/domain";
import { domainReport } from "./routes/domain-report";
import { emailCheck } from "./routes/email";
import { extract } from "./routes/extract";
import { liquidityPoolAudit } from "./routes/liquidity-pool-audit";
import { mevSimulator } from "./routes/mev-simulator";
import { packageInfo } from "./routes/package";
import { packageAudit } from "./routes/package-audit";
import { baseGas } from "./routes/gas";
import { searchPapers } from "./routes/papers";
import { bitcoinPriceIn, exchangeRates } from "./routes/rates";
import { timeInZone } from "./routes/time";
import { tradeInsight } from "./routes/trade-insight";
import { weather } from "./routes/weather";
import { screenshot } from "./routes/screenshot";
import { tokenInfo } from "./routes/token";
import { tokenReport } from "./routes/token-report";
import { walletInfo } from "./routes/wallet";
import { walletAudit } from "./routes/wallet-audit";
import type { CoreEndpointPath, EndpointPath } from "./endpoints";
import { FAMILIES } from "./families";

/** Reads one named input as a string, whether it came from a query string or MCP arguments. */
export type Input = (name: string) => string | undefined;

/** One implementation per catalog path, shared by the HTTP routes and the MCP tools. */
const handlers: Record<EndpointPath, (env: Env, input: Input) => Promise<unknown>> & Record<CoreEndpointPath, unknown> = {
  "/extract": (_env, q) => extract(q("url"), q("maxChars"), q("format"), q("section")),
  "/sitemap": (_env, q) => sitemap(q("url"), q("contains"), q("maxUrls"), q("offset")),
  "/domain": (_env, q) => domainInfo(q("name") ?? ""),
  "/domain-report": (env, q) => domainReport(env, q("name") ?? ""),
  "/token": (env, q) => tokenInfo(env, q("address") ?? ""),
  "/token-report": (env, q) => tokenReport(env, q("address") ?? ""),
  "/wallet": (env, q) => walletInfo(env, q("address") ?? "", q("tokens")),
  "/wallet-audit": (env, q) => walletAudit(env, q("address") ?? ""),
  "/contract-risk": (env, q) => contractRisk(env, q("address") ?? ""),
  "/liquidity-pool-audit": (env, q) => liquidityPoolAudit(env, q("address") ?? ""),
  "/mev-simulator": (env, q) => mevSimulator(env, q("scenario")),
  "/trade-insight": (env, q) => tradeInsight(env, q("token") ?? "", q("wallet") ?? ""),
  "/summarize": (env, q) => summarize(env, q("url")),
  "/screenshot": (env, q) => screenshot(env, q("url"), q("fullPage")),
  "/image": (env, q) => generateImage(env, q("prompt"), q("steps")),
  "/transcribe": (env, q) => transcribe(env, q("url")),
  "/describe": (env, q) => describeImage(env, q("url"), q("question")),
  "/btc-fees": () => bitcoinFees(),
  "/btc-address": (_env, q) => bitcoinAddress(q("address") ?? ""),
  "/ln-invoice": async (_env, q) => lightningInvoice(q("invoice") ?? ""),
  "/package-audit": (_env, q) => packageAudit(q("packages")),
  "/package": (_env, q) => packageInfo(q("ecosystem") ?? "", q("name") ?? "", q("version")),
  "/email": (_env, q) => emailCheck(q("address") ?? ""),
  "/papers": (_env, q) => searchPapers(q("query"), q("limit"), q("fromYear")),
  "/fx": (_env, q) => exchangeRates(q("from") ?? "", q("to"), q("amount")),
  "/btc-price": (_env, q) => bitcoinPriceIn(q("currency")),
  "/base-gas": (env) => baseGas(env),
  "/weather": (_env, q) => weather(q("lat"), q("lon"), q("hours"), q("city")),
  "/base-tx": (env, q) => baseTransaction(env, q("hash") ?? ""),
  "/base-allowance": (env, q) => baseAllowance(env, q("token") ?? "", q("owner") ?? "", q("spender") ?? ""),
  "/ens": (_env, q) => ensLookup(q("name") ?? ""),
  "/time": async (_env, q) => timeInZone(q("zone"), q("at"), q("to")),
};

for (const f of FAMILIES) handlers[f.endpoint.path] = async (env, q) => f.run(env, q);

/** Inputs that hold EVM addresses (one, or a comma-separated list). */
const ADDRESS_INPUTS = new Set(["address", "addresses", "token", "tokens", "owner", "spender", "wallet", "contract", "pool"]);
const EVM_HEX = /^(0x)?([0-9a-fA-F]{40})$/;

/**
 * EVM addresses as viem accepts them everywhere: "0x" and lowercase (no checksum to fail). Agents send checksummed,
 * upper-case, mis-checksummed or 0x-less addresses; viem's strict checks turned those into misleading 502s and 422s,
 * and a 0x-less address missed the sanctions list. Other inputs (and non-EVM addresses) pass through unchanged.
 */
/**
 * Other names agents commonly send for an input. Read only when the tool asks for the input and the caller did not
 * send it under its own name, so an input a tool really has is never overridden.
 */
const INPUT_ALIASES: Readonly<Record<string, readonly string[]>> = {
  // "email" and "domain"/"host" (26 Oct 2026 probe): agents call /email?email= and /domain?domain=, which both refused.
  address: ["wallet", "addr", "account", "email", "pool", "wallet_address", "walletAddress", "email_address", "emailAddress", "mail", "q", "query"],
  token: ["token_address", "contract", "tokenAddress", "contract_address"], hash: ["tx", "txhash", "transaction", "txHash", "tx_hash", "transaction_hash", "transactionHash", "txid"],
  lat: ["latitude"], lon: ["longitude", "lng", "long"], zone: ["tz", "timezone", "time_zone", "timeZone", "location", "city", "place", "country", "q", "query"], at: ["time", "timestamp", "datetime", "when"], date: ["day"],
  text: ["input", "json", "yaml", "xml", "csv", "content", "data", "value", "prompt", "message", "body", "string", "document", "article", "q", "query"],
  // The document tools read their own input name; agents send json= to /json/validate and text= to /json/to-yaml (26 Oct 2026 probe).
  // More names agents send (26 Oct 2026 utility probe): cron expression, number lists, phone numbers, QR data, loan amounts, semver pairs.
  expr: ["expression", "cron", "schedule"], values: ["numbers", "data", "nums", "list"], number: ["phone", "phone_number", "tel"], principal: ["amount", "loan", "loan_amount"],
  country: ["name", "country_code", "code", "countryCode"],
  // /se/company (11 Nov 2026): the names Swedish and English company APIs give the organisationsnummer.
  siren: ["siren_number", "sirenNumber", "numero_siren"],
  businessId: ["business_id", "businessid", "ytunnus", "y_tunnus", "y-tunnus", "company_id"],
  orgnr: ["organisationsnummer", "organisasjonsnummer", "org_nr", "orgNr", "org_number", "orgNumber", "organization_number", "organisation_number", "company_number", "registration_number", "vat_number", "vatNumber"],
  // Price lists as other price APIs take them (openverbs /v1/price?ids=coingecko:bitcoin,...).
  symbols: ["ids", "coins", "tickers", "tokens", "assets", "symbol"], symbol: ["coin", "ticker", "id", "ids", "asset", "token", "currency", "name", "stock", "symbols", "q", "query", "company"],
  coin: ["symbol", "ticker", "asset", "token", "market", "pair", "name", "id"], ticker: ["symbol", "stock", "q", "query", "name"],
  a: ["version", "v1", "from"], b: ["other", "v2", "compare", "to"],
  json: ["text", "input", "data"], yaml: ["text", "input"], xml: ["text", "input"], csv: ["text", "input", "data"],
  name: ["q", "query", "domain", "host", "company", "company_name", "companyName", "organization", "hostname", "domain_name", "website", "url", "site", "address", "location", "place", "city", "search", "term", "entity", "entity_name", "entityName", "legal_name", "legalName", "business_name", "businessName", "person"],
  domain: ["name", "host", "hostname", "website", "url", "site"],
  word: ["q", "query", "term"], title: ["q", "query", "topic", "search", "term", "name", "article", "page", "subject", "keyword", "url"], query: ["q", "search", "term", "keywords", "topic", "question", "text"], invoice: ["bolt11"],
  url: ["link", "urls", "website", "site", "page", "target", "uri", "href", "endpoint", "source", "image", "image_url", "imageUrl", "audio", "audio_url", "audioUrl", "pdf", "file", "file_url"],
  urls: ["ids", "links", "url"], documents: ["docs", "texts", "contexts"],
  // /audit/contract (1.131.0): other audit sellers take the code as code or, in one free-text field, as description.
  source: ["code", "source_code", "sourceCode", "solidity", "contract_source", "description"],
  from: ["from_currency", "fromCurrency", "base", "base_currency", "source", "pair", "currency"], to: ["to_currency", "toCurrency", "target", "quote", "symbols", "currencies", "vs"],
  // The request fields search agents already send (25 Oct 2026): Exa-style `query`, `numResults` and `urls`, and
  // `question`/`statement` for the answer and fact-check tools. A list of URLs reads its first one (one URL per call).
  q: ["query", "question", "search", "term", "keyword", "keywords", "topic", "search_query", "searchQuery", "text", "prompt", "input"],
  count: ["numResults", "num_results", "limit", "n", "max_results", "maxResults", "size"], claim: ["statement", "query", "q", "text"],
  // 11 Nov 2026 truth audit: /mime callers send the extension as ext or extension, which was refused "file is required".
  file: ["ext", "extension", "filename", "file_name", "fileName", "type"],
  // 10 Nov 2026: paying buyers were refused after their payment verified because they named the input differently:
  // /weather lost 9 of 19 paid attempts ("send city or lat and lon") and /llm/chat 3 of 4 ("prompt is required", an OpenAI
  // body). A weather buyer sends location or q; a chat buyer sends message, input or an OpenAI `messages` array (read by
  // messagePart below) with max_tokens; an IP buyer sends address.
  city: ["location", "place", "q", "query", "name", "town", "loc", "city_name", "cityName", "address", "coordinates", "coords", "latlng", "latlon", "ll", "zip", "zipcode", "postal_code", "postcode"],
  prompt: ["message", "input", "text", "query", "q", "question", "content", "user_prompt", "userPrompt", "description", "messages"],
  system: ["system_prompt", "systemPrompt", "instructions", "messages"],
  maxTokens: ["max_tokens", "max_completion_tokens", "max_output_tokens", "maxOutputTokens"],
  ip: ["address", "ip_address", "ipAddress", "host", "q", "query"],
  amount: ["value", "quantity", "qty"],
  repo: ["repository", "full_name", "fullName", "name", "url", "slug", "project", "repo_name", "repoName", "q", "query"],
  // 10 Nov 2026 probe: a wrong name here did not refuse, it silently answered for the default (4h candles for a 1d request,
  // every earthquake for a magnitude-5 request), which is worse than a refusal.
  interval: ["timeframe", "period", "tf", "resolution", "granularity"], minMagnitude: ["min_magnitude", "magnitude", "minmag", "min_mag", "mag"],
  currency: ["vs", "fiat", "vs_currency", "vs_currencies", "quote"],
  // 11 Nov 2026: the contract-call tools take a function signature in data; agents name it in several ways.
  data: ["calldata", "input", "function", "signature", "method", "sig", "abi"], args: ["arguments", "params", "parameters"],
  // 10 Nov 2026: the CVE lookup's input as other CVE sellers name it (id, cve_id, cveId) and as search agents send it.
  cve: ["id", "cve_id", "cveId", "cveid", "cve_ids", "vulnerability", "vuln", "q", "query", "name"],
  commodity: ["symbol", "name", "asset", "metal", "ticker", "q", "query", "item"],
  // /sec/financials (11 Nov 2026): statement APIs name the period frequency or timeframe.
  period: ["frequency", "timeframe", "periodicity"],
  user: ["username", "login", "owner", "account", "org", "organization", "handle", "name", "q", "query", "url"],
};

/** The text of one OpenAI message's content: a string, or the text parts of a content array. */
const messageText = (content: unknown): string => typeof content === "string" ? content
  : Array.isArray(content) ? content.map((p) => (typeof p === "string" ? p : typeof (p as { text?: unknown })?.text === "string" ? (p as { text: string }).text : "")).filter(Boolean).join("\n") : "";
/**
 * `prompt` or `system` out of an OpenAI `messages` array, for the prompt tools that have no messages input of their own
 * (/ai/chat-large, the models by name, /image): the system and developer turns are the system prompt; one user turn is the
 * prompt as sent, a longer conversation becomes a "User: … / Assistant: …" transcript. Anything unreadable is no input.
 */
export function messagePart(sentRaw: string | undefined, part: "prompt" | "system"): string | undefined {
  // One message object or plain text count as a one-message list (src/lib/chat-messages.ts, 14 Nov 2026).
  const raw = messagesAsArray(sentRaw);
  if (!raw?.startsWith("[")) return undefined;
  let list: unknown;
  try { list = JSON.parse(raw); } catch { return undefined; }
  if (!Array.isArray(list)) return undefined;
  const turns = list.map((m) => ({ role: String((m as { role?: unknown })?.role ?? ""), text: messageText((m as { content?: unknown })?.content).trim() })).filter((m) => m.text);
  const isSystem = (role: string) => role === "system" || role === "developer";
  if (part === "system") return turns.filter((m) => isSystem(m.role)).map((m) => m.text).join("\n") || undefined;
  const talk = turns.filter((m) => m.role === "user" || m.role === "assistant");
  if (!talk.length) return undefined;
  return talk.length === 1 ? talk[0].text : talk.map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.text}`).join("\n");
}/** Every alias, with the input it stands for (the POST-body flattener in src/index.ts keeps aliased fields). */
export const ALIAS_OF: Readonly<Record<string, readonly string[]>> = Object.freeze(Object.entries(INPUT_ALIASES).reduce((acc, [input, aliases]) => {
  for (const a of aliases) (acc[a] ??= []).push(input);
  return acc;
}, {} as Record<string, string[]>));

/** A host with an optional port, path, query or fragment and no scheme: "example.com/a?b=1", "localhost:8080", "10.0.0.1/x". */
const SCHEMELESS_URL = /^(localhost|[a-z0-9-]+(\.[a-z0-9-]+)+|\d{1,3}(\.\d{1,3}){3})(:\d+)?([/?#]|$)/i;
export const normalizedInput = (sent: Input): Input => (name) => {
  // An alias that is one of this tool's own inputs is never read as another input (declaredInputs): /time?city= stays
  // unread as `zone` on a tool that has a city input, and /ai/chat keeps its own `messages`.
  const own = (sent as { [DECLARED]?: ReadonlySet<string> })[DECLARED];
  const viaAlias = (n: string, alias: string): string | undefined => {
    if (own?.has(alias)) return undefined;
    const v = sent(alias);
    if (alias === "urls") return v?.split(",")[0]?.trim() || undefined;
    if (alias === "messages") return n === "prompt" || n === "system" ? messagePart(v, n) : undefined;
    // A Responses-style `input` (or a `message`) holding role/content items is a conversation, not prompt text.
    if (n === "prompt" && (alias === "input" || alias === "message") && /^[[{]/.test(v?.trim() ?? "")) return messagePart(v, "prompt") ?? v;
    // An empty alias is no input: location= must not hide q=London.
    return v?.trim() ? v : undefined;
  };
  const input: Input = (n) => sent(n) ?? INPUT_ALIASES[n]?.map((alias) => viaAlias(n, alias)).find((v) => v !== undefined);
  const value = input(name);
  // Every tool that takes a URL reads "example.com" as https://example.com (24 Oct 2026: uptime, redirects, SEO audit,
  // security headers and robots all refused it as "not an absolute URL"). Private hosts are still refused downstream.
  if (name === "url" && value && !/^[a-z][a-z0-9+.-]*:/i.test(value.trim()) && SCHEMELESS_URL.test(value.trim())) return `https://${value.trim()}`;
  // A Wikipedia link where a title is expected: the title is the last part of its path.
  if (name === "title" && value) { const m = /^https?:\/\/[a-z-]+\.(?:m\.)?wikipedia\.org\/wiki\/([^?#]+)/i.exec(value.trim()); if (m) { try { return decodeURIComponent(m[1]).replaceAll("_", " "); } catch { return m[1].replaceAll("_", " "); } } }
  if (value === undefined || !ADDRESS_INPUTS.has(name) || (sent as { [KEEP_CASE]?: boolean })[KEEP_CASE]) return value;
  return value.split(",").map((part) => {
    const m = EVM_HEX.exec(part.trim());
    return m ? `0x${m[2].toLowerCase()}` : part;
  }).join(",");
};

const ENS_NAME = /^[a-z0-9-]+(\.[a-z0-9-]+)*\.eth$/i;
/**
 * An ENS name where an address is expected (address=vitalik.eth, also in comma lists) is resolved on Ethereum mainnet
 * before the tool runs, so every chain read, balance, screen and pack takes the name agents test with. One RPC call,
 * only when a name was sent. A name with no address is a 400 (uncharged), never a silent "pass" or 404.
 */
async function withEnsResolved(input: Input): Promise<Input> {
  const resolved = new Map<string, string>();
  for (const name of ADDRESS_INPUTS) {
    const value = input(name);
    if (!value || !/\.eth\b/i.test(value)) continue;
    const parts = value.split(",");
    if (!parts.some((p) => ENS_NAME.test(p.trim()))) continue;
    const out = await Promise.all(parts.map(async (p) => {
      const t = p.trim();
      if (!ENS_NAME.test(t)) return p;
      try { return (await ensLookup(t)).address as string; }
      catch (e) { throw e instanceof HttpError && e.status === 404 ? new HttpError(400, `${t} is not a registered ENS name with an address; pass the 0x address`) : e; }
    }));
    resolved.set(name, out.join(","));
  }
  if (!resolved.size) return input;
  return Object.assign((n: string) => resolved.get(n) ?? input(n), input);
}

const DECLARED = Symbol("declaredInputs");
let declaredByPath: Map<string, ReadonlySet<string>> | undefined;
/** The inputs a tool declares, attached to its Input so normalizedInput never reads one of them as an alias of another. */
export const declaredInputFor = (path: string, input: Input): Input => {
  declaredByPath ??= new Map(ENDPOINTS.map((e) => [e.path, new Set(Object.keys(e.params))]));
  return Object.assign((n: string) => input(n), input, { [DECLARED]: declaredByPath.get(path) ?? new Set<string>() });
};

/**
 * The reserved input name under which the HTTP route says "this request carried no tool input at all" (src/index.ts sets
 * it to "1" when the query string holds nothing but control parameters). Never read from the query string; MCP does not
 * set it, because an assistant fills in what the schema asks for.
 */
export const NO_INPUT = "@no-input";
const BTC_NOTE = "No input was sent, so this is the price of BTC (the wrapped token on Base), the default. Send symbol (for example symbol=ETH) or address for another token.";
const USD_NOTE = "No input was sent, so these are the exchange rates for 1 USD, the default base currency. Send from (for example from=EUR), and optionally to and amount, for another conversion.";
/**
 * Tools that answer a call with no input at all for a documented default, with a `note` saying so (11 Nov 2026).
 * Why: vAPI Call's console (about 100 new wallets a day make their first paid call there) shows a tool's inputs as an
 * empty form with a "Pay and call" button, and Mercator planned calls as `{}`; /weather sold in both because it answers
 * an empty call (London, 1.109.3), while a 400 sends the buyer to the next seller. Rules: only a default a buyer would
 * expect (the reference asset for a price), stated in the input's description; only when NOTHING was sent, so a
 * misspelled input is still a 400 and never a silent default (the 10 Nov lesson); and the tool stays in
 * `ONE_OF_INPUT_PATHS`, so a listing still names the input and a router plans a real one.
 */
export const EMPTY_CALL_DEFAULTS: Readonly<Record<string, { input: Readonly<Record<string, string>>; note: string }>> = {
  "/price/token": { input: { symbol: "BTC" }, note: BTC_NOTE },
  "/token/price": { input: { symbol: "BTC" }, note: BTC_NOTE },
  "/price/crypto": { input: { symbol: "BTC" }, note: BTC_NOTE },
  // 1.114.0: the same rule for the two other price-like tools whose reference is not in doubt. After the full Bazaar
  // re-settle of 10 Nov vAPI Call showed 46 of our 56 tracked searches (22 before), /fx among its cheapest listings.
  "/price/tokens": { input: { symbols: "BTC,ETH" }, note: "No input was sent, so these are the prices of BTC and ETH (the wrapped tokens on Base), the default. Send symbols (for example symbols=ETH,AERO) or addresses for other tokens." },
  "/fx": { input: { from: "USD" }, note: USD_NOTE },
  "/fx/rates": { input: { from: "USD" }, note: USD_NOTE },
};

const RAW_INPUT_PATHS = new Set(["/evm/checksum"]);
const KEEP_CASE = Symbol("keepCase");
const keepCase = (input: Input): Input => Object.assign((n: string) => input(n), { [KEEP_CASE]: true });
// Both transports await this guard before their payment wrapper can settle.
export const TOOLS = Object.fromEntries(Object.entries(handlers).map(([path, handler]) => [
  path, async (env: Env, input: Input) => {
    if (Object.hasOwn(PAUSED_FAMILY_TOOLS, path)) throw new HttpError(503, PAUSED_FAMILY_TOOLS[path], "TOOL_PAUSED");
    // /evm/checksum judges the case of the address it is given, so its input keeps its case (aliases still apply).
    // A call that carried no input at all answers for the tool's documented default (see EMPTY_CALL_DEFAULTS).
    const fallback = Object.hasOwn(EMPTY_CALL_DEFAULTS, path) && input(NO_INPUT) === "1" ? EMPTY_CALL_DEFAULTS[path] : null;
    if (fallback) { const sent = input; input = (n) => (Object.hasOwn(fallback.input, n) ? fallback.input[n] : sent(n)); }
    if (RAW_INPUT_PATHS.has(path)) input = keepCase(input);
    if (path !== "/ens") input = await withEnsResolved(input);
    input = declaredInputFor(path, input);
    const result = await handler(env, normalizedInput(input));
    assertToolOutput(path as EndpointPath, result);
    if (fallback && result && typeof result === "object" && !Array.isArray(result)) return { ...result, note: fallback.note } as typeof result;
    return result;
  },
])) as typeof handlers;
