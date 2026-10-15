import type { Env } from "./lib/env";
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
import type { EndpointPath } from "./endpoints";

/** Reads one named input as a string, whether it came from a query string or MCP arguments. */
export type Input = (name: string) => string | undefined;

/** One implementation per catalog path, shared by the HTTP routes and the MCP tools. */
export const TOOLS: Record<EndpointPath, (env: Env, input: Input) => Promise<unknown>> = {
  "/extract": (_env, q) => extract(q("url"), q("maxChars"), q("format")),
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
  "/weather": (_env, q) => weather(q("lat"), q("lon"), q("hours")),
  "/base-tx": (env, q) => baseTransaction(env, q("hash") ?? ""),
  "/base-allowance": (env, q) => baseAllowance(env, q("token") ?? "", q("owner") ?? "", q("spender") ?? ""),
  "/ens": (_env, q) => ensLookup(q("name") ?? ""),
  "/time": async (_env, q) => timeInZone(q("zone"), q("at"), q("to")),
};
