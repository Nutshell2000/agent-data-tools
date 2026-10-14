import { HttpError, isAddress, type Env } from "../lib/env";
import { tokenReport as getTokenReport } from "./token-report";
import { walletAudit } from "./wallet-audit";

interface TradeInsight {
  recommendation: "high-confidence-buy" | "medium-buy" | "neutral" | "medium-sell" | "high-confidence-sell" | "high-risk";
  confidence: number;
  reasoning: string[];
  warnings: string[];
  tokenRisk: string;
  walletRisk: string;
  compositeScore: number;
}

export async function tradeInsight(env: Env, tokenAddress: string, walletAddress: string): Promise<TradeInsight> {
  if (!isAddress(tokenAddress)) throw new HttpError(400, "token must be a valid address");
  if (!isAddress(walletAddress)) throw new HttpError(400, "wallet must be a valid address");

  const [tokenData, walletData] = await Promise.all([
    getTokenReport(env, tokenAddress),
    walletAudit(env, walletAddress),
  ]).catch((e) => {
    throw new HttpError(502, `Chain data error: ${(e as any)?.message}`);
  });

  const reasoning: string[] = [];
  const warnings: string[] = [];

  // Token risk scoring from API response
  const tokenRisk = (tokenData as any).risk ?? "unknown";
  const tokenFlags = (tokenData as any).flags ?? [];
  const tokenRiskScore = tokenRisk === "low" ? 90 : tokenRisk === "medium" ? 50 : 10;
  
  if (tokenRisk === "high") {
    const flagCodes = tokenFlags.slice(0, 3).map((f: any) => (typeof f === "object" ? f.code : f)).join(", ");
    warnings.push(`High-risk token: ${flagCodes}`);
  }

  // Wallet risk scoring
  const walletRisk = walletData.riskLevel;
  const walletRiskScore = walletRisk === "low" ? 85 : walletRisk === "medium" ? 45 : 15;
  
  if (walletRisk !== "low") {
    warnings.push(`Wallet risk: ${walletData.riskFlags.slice(0, 2).join(", ")}`);
  }

  // Market condition scoring
  const market = (tokenData as any).market ?? {};
  let liquidityScore = 50;
  if (market.liquidity && parseFloat(market.liquidity) > 50000) {
    liquidityScore = 85;
    reasoning.push("Good liquidity (>$50k)");
  } else if (market.liquidity && parseFloat(market.liquidity) < 5000) {
    warnings.push("Low liquidity (<$5k)");
    liquidityScore = 30;
  }

  // Volume score
  let volumeScore = 50;
  if (market.volume24h && parseFloat(market.volume24h) > 100000) {
    volumeScore = 80;
    reasoning.push("High 24h volume");
  }

  // Check for critical red flags
  let holderScore = 60;
  if (tokenFlags.some((f: any) => (typeof f === "object" ? f.code === "paused" : f === "paused"))) {
    warnings.push("Token is paused");
    holderScore = 10;
  }
  if (tokenFlags.some((f: any) => (typeof f === "object" ? f.code === "no_liquidity" : f === "no_liquidity"))) {
    warnings.push("No trading liquidity");
    holderScore = 20;
  }

  // Wallet activity scoring
  let activityScore = 50;
  if (walletData.transactionCount > 100) {
    activityScore = 80;
    reasoning.push("Experienced wallet");
  } else if (walletData.transactionCount < 5) {
    warnings.push("New wallet");
    activityScore = 30;
  }

  // ETH balance score
  let balanceScore = 50;
  const ethBalance = parseFloat(walletData.eth.formatted);
  if (ethBalance > 1) {
    balanceScore = 80;
    reasoning.push("Sufficient balance");
  } else if (ethBalance < 0.001) {
    warnings.push("Low ETH balance");
    balanceScore = 20;
  }

  const compositeScore =
    (tokenRiskScore + walletRiskScore + liquidityScore + volumeScore + holderScore + activityScore + balanceScore) / 7;

  let recommendation: TradeInsight["recommendation"] = "neutral";
  let confidence = Math.abs(compositeScore - 50) / 50;

  if (compositeScore > 75 && warnings.length === 0) {
    recommendation = "high-confidence-buy";
    confidence = Math.min(0.95, compositeScore / 100);
  } else if (compositeScore > 60) {
    recommendation = "medium-buy";
    confidence = 0.65;
  } else if (compositeScore < 25 && warnings.length > 2) {
    recommendation = "high-confidence-sell";
    confidence = Math.min(0.95, 1 - compositeScore / 100);
  } else if (compositeScore < 40) {
    recommendation = "medium-sell";
    confidence = 0.60;
  } else if (warnings.some((w) => w.includes("paused"))) {
    recommendation = "high-risk";
    confidence = 0.9;
  }

  return {
    recommendation,
    confidence: Math.round(confidence * 100) / 100,
    reasoning: reasoning.length > 0 ? reasoning : ["No clear signals"],
    warnings,
    tokenRisk,
    walletRisk,
    compositeScore: Math.round(compositeScore * 100) / 100,
  };
}

