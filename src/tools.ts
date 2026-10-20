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
import { bitcoinPrice, exchangeRates } from "./routes/rates";
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
  "/btc-price": () => bitcoinPrice(),
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
export const normalizedInput = (input: Input): Input => (name) => {
  const value = input(name);
  if (value === undefined || !ADDRESS_INPUTS.has(name)) return value;
  return value.split(",").map((part) => {
    const m = EVM_HEX.exec(part.trim());
    return m ? `0x${m[2].toLowerCase()}` : part;
  }).join(",");
};

// Both transports await this guard before their payment wrapper can settle.
export const TOOLS = Object.fromEntries(Object.entries(handlers).map(([path, handler]) => [
  path, async (env: Env, input: Input) => {
    if (Object.hasOwn(PAUSED_FAMILY_TOOLS, path)) throw new HttpError(503, PAUSED_FAMILY_TOOLS[path], "TOOL_PAUSED");
    const result = await handler(env, normalizedInput(input));
    assertToolOutput(path as EndpointPath, result);
    return result;
  },
])) as typeof handlers;
