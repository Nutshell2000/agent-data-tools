import { HttpError, isAddress, type Env } from "../lib/env";
import { tokenReport } from "./token-report";
import { walletAudit } from "./wallet-audit";

type TokenReport = Awaited<ReturnType<typeof tokenReport>>;
type WalletAudit = Awaited<ReturnType<typeof walletAudit>>;

interface TradeInsight {
  tokenRisk: TokenReport["risk"];
  tokenRiskFlags: TokenReport["flags"];
  tokenMarket: TokenReport["market"];
  walletRisk: WalletAudit["riskLevel"];
  walletRiskFlags: WalletAudit["riskFlags"];
  walletFacts: {
    accountNonce: number;
    ethBalance: string;
  };
  limitations: string[];
}

export async function tradeInsight(env: Env, tokenAddress: string, walletAddress: string): Promise<TradeInsight> {
  if (!isAddress(tokenAddress)) throw new HttpError(400, "token must be a valid address");
  if (!isAddress(walletAddress)) throw new HttpError(400, "wallet must be a valid address");

  let tokenData: TokenReport;
  let walletData: WalletAudit;
  try {
    [tokenData, walletData] = await Promise.all([
      tokenReport(env, tokenAddress),
      walletAudit(env, walletAddress),
    ]);
  } catch (error) {
    // The caller's own mistakes (bad address, not a token: 4xx) keep their status and message.
    if (error instanceof HttpError && error.status < 500) throw error;
    const message = error instanceof Error ? error.message : "unknown";
    throw new HttpError(502, `Chain data error: ${message}`);
  }

  return {
    tokenRisk: tokenData.risk,
    tokenRiskFlags: tokenData.flags,
    tokenMarket: tokenData.market,
    walletRisk: walletData.riskLevel,
    walletRiskFlags: walletData.riskFlags,
    walletFacts: {
      accountNonce: walletData.accountNonce,
      ethBalance: walletData.eth.formatted,
    },
    limitations: [
      "Rule-based risk indicators only; this response is not a buy/sell recommendation and has no calibrated confidence score.",
      "Holder concentration is not evaluated.",
      "walletFacts.accountNonce is the Base EVM account nonce; for EOAs it reflects outgoing transactions only, not full transaction, token-transfer, or trading history.",
    ],
  };
}
