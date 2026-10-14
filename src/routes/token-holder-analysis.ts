interface TokenHolderAnalysis {
  tokenAddress: string;
  chain: string;
  totalSupply: bigint;
  totalHolders: number;
  topHolders: Array<{
    rank: number;
    address: string;
    balance: bigint;
    percentageOfSupply: number;
    isExchange: boolean;
    isContract: boolean;
  }>;
  concentrationMetrics: {
    giniCoefficient: number; // 0-1: 0=equal distribution, 1=max concentration
    top10Percentage: number;
    top100Percentage: number;
    rugRiskScore: number; // 0-1, normalized concentration risk
  };
  whaleActivity: {
    recentLargeTransfers: Array<{
      from: string;
      to: string;
      amount: bigint;
      timestamp: number;
      description: string;
    }>;
    majorDumpRisk: "low" | "medium" | "high";
  };
  recommendations: string[];
}

export async function tokenHolderAnalysis(
  tokenAddress: string,
  chain: string = "ethereum"
): Promise<TokenHolderAnalysis> {
  if (!tokenAddress || !tokenAddress.match(/^0x[a-f0-9]{40}$/i)) {
    throw new Error("Invalid tokenAddress format (must be 0x... hex)");
  }

  const recommendations: string[] = [];

  // Simulate holder distribution analysis
  // In production: fetch from blockchain data or API

  const totalSupply = BigInt("1000000000000000000000000000"); // 1B tokens with 18 decimals
  const totalHolders = 45000;

  // Simulate top 10 holders (concentrated distribution = high risk)
  const topHolders = [
    {
      rank: 1,
      address: "0xABCDEFABCDEFABCDEFABCDEFABCDEFABCDEFABCD",
      balance: BigInt("150000000000000000000000000"), // 15% of supply
      percentageOfSupply: 15.0,
      isExchange: true,
      isContract: false,
    },
    {
      rank: 2,
      address: "0x1234567890123456789012345678901234567890",
      balance: BigInt("120000000000000000000000000"), // 12%
      percentageOfSupply: 12.0,
      isExchange: false,
      isContract: true,
    },
    {
      rank: 3,
      address: "0xFEDCBAFEDCBAFEDCBAFEDCBAFEDCBAFEDCBAFEDC",
      balance: BigInt("85000000000000000000000000"), // 8.5%
      percentageOfSupply: 8.5,
      isExchange: false,
      isContract: false,
    },
    {
      rank: 4,
      address: "0x9876543210987654321098765432109876543210",
      balance: BigInt("72000000000000000000000000"), // 7.2%
      percentageOfSupply: 7.2,
      isExchange: false,
      isContract: false,
    },
    {
      rank: 5,
      address: "0x5555555555555555555555555555555555555555",
      balance: BigInt("65000000000000000000000000"), // 6.5%
      percentageOfSupply: 6.5,
      isExchange: false,
      isContract: false,
    },
    {
      rank: 6,
      address: "0x6666666666666666666666666666666666666666",
      balance: BigInt("50000000000000000000000000"), // 5%
      percentageOfSupply: 5.0,
      isExchange: false,
      isContract: false,
    },
    {
      rank: 7,
      address: "0x7777777777777777777777777777777777777777",
      balance: BigInt("42000000000000000000000000"), // 4.2%
      percentageOfSupply: 4.2,
      isExchange: false,
      isContract: false,
    },
    {
      rank: 8,
      address: "0x8888888888888888888888888888888888888888",
      balance: BigInt("38000000000000000000000000"), // 3.8%
      percentageOfSupply: 3.8,
      isExchange: false,
      isContract: false,
    },
    {
      rank: 9,
      address: "0x9999999999999999999999999999999999999999",
      balance: BigInt("32000000000000000000000000"), // 3.2%
      percentageOfSupply: 3.2,
      isExchange: false,
      isContract: false,
    },
    {
      rank: 10,
      address: "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      balance: BigInt("28000000000000000000000000"), // 2.8%
      percentageOfSupply: 2.8,
      isExchange: false,
      isContract: false,
    },
  ];

  const top10Percentage = topHolders.reduce((sum, h) => sum + h.percentageOfSupply, 0);
  const top100Percentage = top10Percentage + Math.random() * 20; // Simulated top 100

  // Gini coefficient approximation (higher = more concentrated)
  const giniCoefficient = top10Percentage / 100; // Simplified: normalized by concentration

  // Rug risk score (0-1)
  let rugRiskScore = 0;
  if (top10Percentage > 40) rugRiskScore = 0.8; // Very concentrated
  else if (top10Percentage > 25) rugRiskScore = 0.6; // High concentration
  else if (top10Percentage > 15) rugRiskScore = 0.4; // Moderate concentration
  else rugRiskScore = 0.2; // Well distributed

  // Whale activity
  const recentLargeTransfers = [
    {
      from: topHolders[0].address,
      to: "0x0000000000000000000000000000000000000000",
      amount: BigInt("10000000000000000000000000"),
      timestamp: Math.floor(Date.now() / 1000) - 86400, // 1 day ago
      description: "Large transfer (possible dump)",
    },
    {
      from: topHolders[1].address,
      to: "0xDEX1234567890123456789012345678901234567",
      amount: BigInt("25000000000000000000000000"),
      timestamp: Math.floor(Date.now() / 1000) - 172800, // 2 days ago
      description: "Transfer to DEX wallet",
    },
  ];

  let majorDumpRisk: "low" | "medium" | "high" = "low";
  if (rugRiskScore > 0.7) majorDumpRisk = "high";
  else if (rugRiskScore > 0.5) majorDumpRisk = "medium";

  // Recommendations
  if (top10Percentage > 50) {
    recommendations.push(
      "🚨 CRITICAL: Top 10 holders control >50% of supply. High rug-pull risk."
    );
  } else if (top10Percentage > 30) {
    recommendations.push(
      "⚠️ Top 10 holders control >30% of supply. Monitor for coordinated dumps."
    );
  } else {
    recommendations.push(
      "✅ Token distribution appears relatively healthy for top 10."
    );
  }

  if (topHolders.some((h) => h.isExchange)) {
    recommendations.push(
      "ℹ️ Exchange wallet detected in top holders. This can indicate locked liquidity."
    );
  }

  if (recentLargeTransfers.length > 2) {
    recommendations.push(
      `⚠️ ${recentLargeTransfers.length} large transfers in past 7 days. Watch for organized movement.`
    );
  }

  return {
    tokenAddress,
    chain,
    totalSupply,
    totalHolders,
    topHolders,
    concentrationMetrics: {
      giniCoefficient,
      top10Percentage,
      top100Percentage,
      rugRiskScore,
    },
    whaleActivity: {
      recentLargeTransfers,
      majorDumpRisk,
    },
    recommendations,
  };
}
