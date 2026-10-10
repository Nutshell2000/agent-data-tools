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
    priceUsd: 19,
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
];

export const findProduct = (slug: string) => PRODUCTS.find((p) => p.slug === slug);
