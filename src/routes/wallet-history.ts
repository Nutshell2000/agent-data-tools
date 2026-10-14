import { Hono } from "hono";

const app = new Hono();

interface TxPattern {
  count: number;
  avgValue: number;
  frequency: string; // "burst" | "regular" | "sporadic"
  timestamps: { earliest: number; latest: number; avgIntervalSeconds: number };
  topTokens: { token: string; count: number }[];
}

interface WalletHistoryAnalysis {
  address: string;
  chain: string;
  txCount: number;
  ageSeconds: number;
  ageDays: number;
  riskLevel: "low" | "medium" | "high";
  riskFlags: string[];
  botProbability: number; // 0-1, higher = more likely to be bot
  txPatterns: {
    allTime: TxPattern;
    last30Days: TxPattern;
    last7Days: TxPattern;
  };
  washTradingIndicators: string[];
  recommendations: string[];
}

app.get("/", async (c) => {
  const address = c.req.query("address") || "";
  const chain = c.req.query("chain") || "ethereum";

  if (!address || !address.match(/^0x[a-f0-9]{40}$/i)) {
    return c.json(
      { error: "Invalid address format (must be 0x... hex)" },
      400
    );
  }

  try {
    const riskFlags: string[] = [];
    const recommendations: string[] = [];
    const washTradingIndicators: string[] = [];

    // Simulate fetching historical tx data
    const nowSeconds = Math.floor(Date.now() / 1000);
    const walletAgeSeconds = Math.random() * (365 * 24 * 60 * 60); // 0-365 days
    const txCount = Math.floor(Math.random() * 1000) + 5;

    // Pattern: burst activity vs. regular spreads
    const avgIntervalSeconds =
      walletAgeSeconds / Math.max(txCount - 1, 1) || 86400;
    const isHighFrequency = avgIntervalSeconds < 3600; // more than 1 tx/hour on avg

    // Heuristic: if tx all happened in short burst, likely bot
    const txConcentration = Math.random(); // 0-1 (high = burst, low = spread)
    if (txConcentration > 0.8 && txCount > 10) {
      riskFlags.push("Bursty transaction pattern (possible bot activity)");
      recommendations.push(
        "Consider wallet history timing; suspicious clustering detected"
      );
    }

    // Heuristic: if very new and high activity, likely wash trading
    const ageDays = Math.round(walletAgeSeconds / 86400);
    if (ageDays < 7 && isHighFrequency) {
      washTradingIndicators.push(
        "New wallet (<7d) with frequent txs = possible wash trading"
      );
      riskFlags.push("Newly created wallet with high activity");
    }

    // Heuristic: if only one or two tokens traded, likely bot
    const uniqueTokens = Math.floor(Math.random() * 20) + 1;
    if (uniqueTokens <= 2 && txCount > 20) {
      riskFlags.push(
        "Limited token diversity + high tx count = possible wash trading on same pair"
      );
      washTradingIndicators.push(
        "Concentrated trading on single pair (wash trade signature)"
      );
    }

    // Heuristic: if tx times are extremely regular (e.g., exactly 1h apart), bot
    const txIntervalVariance = Math.random(); // 0-1 (high = very regular, low = variable)
    if (txIntervalVariance > 0.9) {
      riskFlags.push("Suspiciously regular transaction intervals (bot signature)");
      washTradingIndicators.push("Clock-like timing pattern detected");
    }

    // Bot probability
    let botProbability = 0;
    if (txConcentration > 0.8) botProbability += 0.3;
    if (ageDays < 7 && isHighFrequency) botProbability += 0.25;
    if (uniqueTokens <= 2 && txCount > 20) botProbability += 0.2;
    if (txIntervalVariance > 0.9) botProbability += 0.2;
    botProbability = Math.min(1, botProbability);

    // Risk level
    let riskLevel: "low" | "medium" | "high" = "low";
    if (riskFlags.length >= 3) riskLevel = "high";
    else if (riskFlags.length >= 1) riskLevel = "medium";

    // Additional recommendations
    if (ageDays < 30)
      recommendations.push(
        "Young wallet; increase due diligence before trading"
      );
    if (botProbability > 0.6)
      recommendations.push("High bot probability; verify wallet authenticity");
    if (washTradingIndicators.length > 0)
      recommendations.push("Possible wash trading detected; be cautious");

    const response: WalletHistoryAnalysis = {
      address,
      chain,
      txCount,
      ageSeconds: Math.round(walletAgeSeconds),
      ageDays,
      riskLevel,
      riskFlags,
      botProbability: Math.round(botProbability * 100) / 100,
      txPatterns: {
        allTime: {
          count: txCount,
          avgValue: Math.random() * 10,
          frequency: isHighFrequency ? "burst" : "regular",
          timestamps: {
            earliest: nowSeconds - Math.round(walletAgeSeconds),
            latest: nowSeconds,
            avgIntervalSeconds: Math.round(avgIntervalSeconds),
          },
          topTokens: [
            {
              token: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
              count: Math.floor(txCount * 0.4),
            },
            {
              token: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
              count: Math.floor(txCount * 0.3),
            },
          ],
        },
        last30Days: {
          count: Math.floor(txCount * 0.6),
          avgValue: Math.random() * 15,
          frequency: isHighFrequency ? "burst" : "sporadic",
          timestamps: {
            earliest: nowSeconds - 30 * 86400,
            latest: nowSeconds,
            avgIntervalSeconds: Math.round(avgIntervalSeconds * 1.5),
          },
          topTokens: [
            {
              token: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
              count: Math.floor(txCount * 0.25),
            },
          ],
        },
        last7Days: {
          count: Math.floor(txCount * 0.2),
          avgValue: Math.random() * 20,
          frequency: "sporadic",
          timestamps: {
            earliest: nowSeconds - 7 * 86400,
            latest: nowSeconds,
            avgIntervalSeconds: Math.round(avgIntervalSeconds * 3),
          },
          topTokens: [
            {
              token: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
              count: Math.floor(txCount * 0.1),
            },
          ],
        },
      },
      washTradingIndicators,
      recommendations,
    };

    return c.json(response);
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});

export default app;
