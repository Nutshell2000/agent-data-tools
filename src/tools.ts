import type { Env } from "./lib/env";
import { describeImage, generateImage, summarize, transcribe } from "./routes/ai";
import { bitcoinAddress, bitcoinFees, lightningInvoice } from "./routes/bitcoin";
import { domainInfo } from "./routes/domain";
import { emailCheck } from "./routes/email";
import { extract } from "./routes/extract";
import { packageInfo } from "./routes/package";
import { searchPapers } from "./routes/papers";
import { screenshot } from "./routes/screenshot";
import { tokenInfo } from "./routes/token";
import { walletInfo } from "./routes/wallet";

/** Reads one named input as a string, whether it came from a query string or MCP arguments. */
export type Input = (name: string) => string | undefined;

/** One implementation per catalog path, shared by the HTTP routes and the MCP tools. */
export const TOOLS: Record<string, (env: Env, input: Input) => Promise<unknown>> = {
  "/extract": (_env, q) => extract(q("url"), q("maxChars")),
  "/domain": (_env, q) => domainInfo(q("name") ?? ""),
  "/token": (env, q) => tokenInfo(env, q("address") ?? ""),
  "/wallet": (env, q) => walletInfo(env, q("address") ?? "", q("tokens")),
  "/summarize": (env, q) => summarize(env, q("url")),
  "/screenshot": (env, q) => screenshot(env, q("url"), q("fullPage")),
  "/image": (env, q) => generateImage(env, q("prompt"), q("steps")),
  "/transcribe": (env, q) => transcribe(env, q("url")),
  "/describe": (env, q) => describeImage(env, q("url"), q("question")),
  "/btc-fees": () => bitcoinFees(),
  "/btc-address": (_env, q) => bitcoinAddress(q("address") ?? ""),
  "/ln-invoice": async (_env, q) => lightningInvoice(q("invoice") ?? ""),
  "/package": (_env, q) => packageInfo(q("ecosystem") ?? "", q("name") ?? ""),
  "/email": (_env, q) => emailCheck(q("address") ?? ""),
  "/papers": (_env, q) => searchPapers(q("query"), q("limit"), q("fromYear")),
};
