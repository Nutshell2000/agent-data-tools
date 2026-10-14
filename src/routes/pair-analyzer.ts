import { Hono } from "hono";
import { formatGwei, parseGwei } from "viem";

const app = new Hono();

interface PairData {
  pairAddress: string;
  token0: { symbol: string; address: string; decimals: number; totalSupply: bigint };
  token1: { symbol: string; address: string; decimals: number; totalSupply: bigint };
  liquidity: { token0: bigint; token1: bigint };
  lpSupply: bigint;
  priceToken0InToken1: number;
  priceImpact: { buy1Percent: number; buy5Percent: number; buy10Percent: number };
  volumeUsd24h: number;
  txCount24h: number;
  feeTier: number;
  protocolFeePercentage: number;
  riskLevel: "low" | "medium" | "high";
  riskFlags: string[];
  liquidity_trend: "increasing" | "decreasing" | "stable";
  liquidityUsd: number;
  recommendations: string[];
}

app.get("/", async (c) => {
  const pairAddress = c.req.query("pairAddress") || "";
  const chain = c.req.query("chain") || "ethereum";

  if (!pairAddress || !pairAddress.match(/^0x[a-f0-9]{40}$/i)) {
    return c.json(
      {
        error: "Invalid pairAddress format (must be 0x... hex address)",
      },
      400
    );
  }

  try {
    // Simulated pair data fetch from on-chain + DexScreener
    // In production: call Uniswap V3 subgraph, contract state, DexScreener API
    const riskFlags: string[] = [];
    const recommendations: string[] = [];
    
    // Heuristic: if liquidity < $10k, flag as risky
    const liquidityUsd = Math.random() * 500000 + 10000;
    if (liquidityUsd < 10000) {
      riskFlags.push("Low liquidity (<$10k) = high slippage risk");
    }
    
    // Heuristic: if 24h volume < liquidity * 0.1, low activity
    const volumeUsd24h = liquidityUsd * (Math.random() * 0.3 + 0.1);
    if (volumeUsd24h < liquidityUsd * 0.1) {
      riskFlags.push("Low trading volume relative to liquidity = wide spreads");
    }
    
    // Heuristic: if fee tier > 1%, flag as high-fee
    const feeTier = [0.01, 0.05, 0.3, 1.0][Math.floor(Math.random() * 4)];
    if (feeTier > 0.5) {
      riskFlags.push(`High protocol fee (${feeTier}%) = reduced slippage benefit`);
    }

    // Simplified liquidity trend (in production, query historical data)
    const liquidityTrend = (["increasing", "decreasing", "stable"] as const)[
      Math.floor(Math.random() * 3)
    ];
    if (liquidityTrend === "decreasing") {
      riskFlags.push("Liquidity trend: decreasing (potential exit risk)");
    }

    // Price impact simulation
    const basePriceImpact = (volumeUsd24h / liquidityUsd) * 100;
    const priceImpact = {
      buy1Percent: basePriceImpact * 0.01,
      buy5Percent: basePriceImpact * 0.05,
      buy10Percent: basePriceImpact * 0.1,
    };

    // Risk level determination
    let riskLevel: "low" | "medium" | "high" = "low";
    if (riskFlags.length >= 3) riskLevel = "high";
    else if (riskFlags.length >= 1) riskLevel = "medium";

    // Recommendations
    if (priceImpact.buy1Percent > 0.5)
      recommendations.push("Consider splitting large orders to reduce slippage");
    if (liquidityUsd < 50000)
      recommendations.push("Pair liquidity is low; monitor for sudden price moves");
    if (feeTier > 0.5)
      recommendations.push("High protocol fee; compare to lower-fee alternatives");
    if (liquidityTrend === "decreasing")
      recommendations.push("Liquidity is declining; liquidity provider exit risk");

    const response: PairData = {
      pairAddress,
      token0: {
        symbol: "USDC",
        address: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
        decimals: 6,
        totalSupply: 100000000000000n,
      },
      token1: {
        symbol: "WETH",
        address: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
        decimals: 18,
        totalSupply: 12000000000000000000000n,
      },
      liquidity: {
        token0: BigInt(Math.floor(liquidityUsd * 0.6 * 1e6)),
        token1: BigInt(Math.floor((liquidityUsd * 0.4) / 2000) * 1e18),
      },
      lpSupply: BigInt(Math.floor(Math.sqrt(liquidityUsd * 1e12))),
      priceToken0InToken1: 1 / 2000,
      priceImpact,
      volumeUsd24h,
      txCount24h: Math.floor(volumeUsd24h / 5000) + 10,
      feeTier,
      protocolFeePercentage: feeTier,
      riskLevel,
      riskFlags,
      liquidity_trend: liquidityTrend,
      liquidityUsd: Math.round(liquidityUsd * 100) / 100,
      recommendations,
    };

    return c.json(response);
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});

export default app;
