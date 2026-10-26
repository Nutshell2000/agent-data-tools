import { assertToolOutput } from "./lib/output-contract";
import { sitemap } from "./routes/sitemap";
import { HttpError, type Env } from "./lib/env";
import { PAUSED_FAMILY_TOOLS } from "./endpoints";
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
  address: ["wallet", "addr", "account", "email", "pool"], token: ["token_address", "contract"], hash: ["tx", "txhash", "transaction"],
  lat: ["latitude"], lon: ["longitude", "lng"], zone: ["tz", "timezone", "time_zone"], at: ["time", "timestamp", "datetime", "when"], date: ["day"], text: ["input", "json", "yaml", "xml", "csv", "content", "data", "value"],
  // The document tools read their own input name; agents send json= to /json/validate and text= to /json/to-yaml (26 Oct 2026 probe).
  // More names agents send (26 Oct 2026 utility probe): cron expression, number lists, phone numbers, QR data, loan amounts, semver pairs.
  expr: ["expression", "cron", "schedule"], values: ["numbers", "data", "nums", "list"], number: ["phone", "phone_number", "tel"], principal: ["amount", "loan", "loan_amount"],
  country: ["name", "country_code", "code"],
  // Price lists as other price APIs take them (openverbs /v1/price?ids=coingecko:bitcoin,...).
  symbols: ["ids", "coins", "tickers"], symbol: ["coin", "ticker", "id"],
  a: ["version", "v1", "from"], b: ["other", "v2", "compare", "to"],
  json: ["text", "input", "data"], yaml: ["text", "input"], xml: ["text", "input"], csv: ["text", "input", "data"],
  name: ["q", "query", "domain", "host", "company"], word: ["q", "query"], title: ["q", "query"], query: ["q"], invoice: ["bolt11"], url: ["link", "urls"], urls: ["ids", "links", "url"], documents: ["docs", "texts", "contexts"],
  from: ["from_currency"], to: ["to_currency"],
  // The request fields search agents already send (25 Oct 2026): Exa-style `query`, `numResults` and `urls`, and
  // `question`/`statement` for the answer and fact-check tools. A list of URLs reads its first one (one URL per call).
  q: ["query", "question", "search"], count: ["numResults", "num_results", "limit", "n"], claim: ["statement", "query", "q"],
};
/** Every alias, with the input it stands for (the POST-body flattener in src/index.ts keeps aliased fields). */
export const ALIAS_OF: Readonly<Record<string, readonly string[]>> = Object.freeze(Object.entries(INPUT_ALIASES).reduce((acc, [input, aliases]) => {
  for (const a of aliases) (acc[a] ??= []).push(input);
  return acc;
}, {} as Record<string, string[]>));

/** A host with an optional port, path, query or fragment and no scheme: "example.com/a?b=1", "localhost:8080", "10.0.0.1/x". */
const SCHEMELESS_URL = /^(localhost|[a-z0-9-]+(\.[a-z0-9-]+)+|\d{1,3}(\.\d{1,3}){3})(:\d+)?([/?#]|$)/i;
export const normalizedInput = (sent: Input): Input => (name) => {
  const input: Input = (n) => sent(n) ?? INPUT_ALIASES[n]?.map((alias) => (alias === "urls" ? sent(alias)?.split(",")[0]?.trim() || undefined : sent(alias))).find((v) => v !== undefined);
  const value = input(name);
  // Every tool that takes a URL reads "example.com" as https://example.com (24 Oct 2026: uptime, redirects, SEO audit,
  // security headers and robots all refused it as "not an absolute URL"). Private hosts are still refused downstream.
  if (name === "url" && value && !/^[a-z][a-z0-9+.-]*:/i.test(value.trim()) && SCHEMELESS_URL.test(value.trim())) return `https://${value.trim()}`;
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

const RAW_INPUT_PATHS = new Set(["/evm/checksum"]);
const KEEP_CASE = Symbol("keepCase");
const keepCase = (input: Input): Input => Object.assign((n: string) => input(n), { [KEEP_CASE]: true });
// Both transports await this guard before their payment wrapper can settle.
export const TOOLS = Object.fromEntries(Object.entries(handlers).map(([path, handler]) => [
  path, async (env: Env, input: Input) => {
    if (Object.hasOwn(PAUSED_FAMILY_TOOLS, path)) throw new HttpError(503, PAUSED_FAMILY_TOOLS[path], "TOOL_PAUSED");
    // /evm/checksum judges the case of the address it is given, so its input keeps its case (aliases still apply).
    if (RAW_INPUT_PATHS.has(path)) input = keepCase(input);
    if (path !== "/ens") input = await withEnsResolved(input);
    const result = await handler(env, normalizedInput(input));
    assertToolOutput(path as EndpointPath, result);
    return result;
  },
])) as typeof handlers;
