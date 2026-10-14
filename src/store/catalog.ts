export interface Product {
  slug: string;
  title: string;
  /** Whole US dollars; charged in USDC. */
  priceUsd: number;
  tagline: string;
  description: string[];
  includes: string[];
  /** File name under public/_files/, served only to paid orders. */
  file: string;
}

export const PRODUCTS: Product[] = [
  {
    slug: "x402-seller-kit",
    title: "x402 Seller Kit",
    priceUsd: 1.9,
    tagline: "Go from an empty folder to a live, listed pay-per-call API in a day.",
    description: [
      "A working Cloudflare Worker template that sells API calls to AI agents over x402 and MCP, plus the guide and directory playbook we wish we'd had when we built this site.",
      "Building the paywall takes an afternoon. Getting validated and listed is where the time goes: each directory has its own rules, and most of them aren't written down in one place. This kit is the shortcut.",
    ],
    includes: [
      "Template: Hono Worker with the x402 paywall, an MCP server, opt-in free trial calls, and an OpenAPI document, web page and llms.txt generated from one catalog file",
      "Two example tools you can keep or replace, with the fetch guards a public URL-fetching service needs",
      "Guide: step by step from install to deployed, validated and paying to your own address",
      "Directory playbook: every listing route we found, the exact request or steps for each, and what each one requires before it will list you",
      "Pitfalls: the failures that cost us time, and how to avoid each",
      "GitHub Action that publishes to the official MCP Registry with no secrets",
    ],
    file: "x402-seller-kit.zip",
  },
  {
    slug: "defi-trader-bundle",
    title: "DeFi Trader Intelligence Bundle",
    priceUsd: 9.9,
    tagline: "API credentials + 250 premium calls on Agent Data Tools' highest-value DeFi endpoints.",
    description: [
      "Get instant access to trade-time risk intelligence: token contract audits, wallet due diligence, MEV cost estimates, and liquidity pool analysis—all via a single API key.",
      "No setup required. Start scoring tokens, validating wallets, and optimizing transaction costs immediately. Ideal for active traders, portfolio managers, and trading bots.",
      "Credentials grant 250 verified calls on our most trusted endpoints (/trade-insight, /wallet-audit, /contract-risk, /mev-simulator, /liquidity-pool-audit). After these 250 run out, you can upgrade to a pay-per-call subscription.",
    ],
    includes: [
      "API key for permanent use on Agent Data Tools endpoints",
      "250 verified calls across 5 premium DeFi endpoints (~$12 retail value)",
      "Priority support (48h email response)",
      "Renewal option: upgrade to monthly subscription at cost + 20% discount",
      "Access to all future DeFi report endpoints added to the platform",
    ],
    file: "defi-bundle-key.txt",
  },
];

export const findProduct = (slug: string) => PRODUCTS.find((p) => p.slug === slug);
