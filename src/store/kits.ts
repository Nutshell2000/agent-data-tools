// Spreadsheet kits sold by card through Stripe (Agentic Commerce Suite feed and Stripe checkout), not over x402.
// The seller kit in catalog.ts stays paused; these never appear in PRODUCTS, /buy/* or the x402 paywall.
// Files live under public/_files/ (git-ignored, copied into the deploy checkout like the seller kit's zip).

export interface Kit {
  slug: string;
  /** The feed `id` (Stripe returns it as line_items[].price.external_reference). Alphanumeric, stable. */
  feedId: string;
  title: string;
  /** Feed price in US cents; a paid line must be at least this much per unit. */
  usdCents: number;
  summary: string;
  description: string[];
  /** File name under public/_files/, served only to paid orders. */
  file: string;
  image: string;
  extraImages?: string[];
}

const SHOP = "https://spellzcode-apps.revmesh2074.workers.dev/shop";
const LICENCE = "One-time digital download (one XLSX file, no macros, no account needed). Use it for your own business or client work; do not resell the template.";

export const KITS: Kit[] = [
  {
    slug: "seo-audit-workbook",
    feedId: "SCKITSEOAUDIT",
    title: "Website SEO Audit Workbook: 40-Point Checklist with Score",
    usdCents: 900,
    summary: "Audit any website for search in an afternoon and leave with a score and a to-do list.",
    description: [
      "A ready-made spreadsheet with 40 checks in plain language. Each check says how to test it with free tools, so no SEO subscription or specialist is needed.",
      "Audit sheet with 40 checks across crawling, titles and text, images, speed and mobile, sharing and rich results, links and trust, and tracking, each with a how-to-test note, a priority and a status menu. Score sheet with a score per area and for the whole site plus a count of high-priority fails. Action plan sheet for turning each problem into a fix with an owner and a due date. One page of instructions.",
      "It does not crawl the site for you and does not guarantee rankings. Works in Excel, Google Sheets and LibreOffice.",
    ],
    file: "seo-audit-workbook.xlsx",
    image: `${SHOP}/seo-audit-workbook.png`,
  },
  {
    slug: "contact-list-clean-up-workbook",
    feedId: "SCKITCONTACTS",
    title: "Contact List Clean-Up Workbook for Excel and Google Sheets",
    usdCents: 900,
    summary: "Paste a messy contact list in, get a tidy one out: up to 1,000 contacts, formulas only.",
    description: [
      "Names: removes stray spaces, fixes capital letters and splits first and last name. Email addresses: trims and lower-cases them and flags any with the wrong shape. Phone numbers: strips spaces, dashes, dots and brackets, keeping a leading +. Duplicates: flags every repeat of an email address after the first. A Keep or Review column per row and a summary sheet with the counts.",
      "The email check looks at the shape of the address only; it cannot tell whether a mailbox exists. It handles Name, Email, Phone and Company columns. Includes sample data. No macros or add-ins.",
      "Used in Excel or LibreOffice the file stays on your computer; in Google Sheets your data is uploaded to Google.",
    ],
    file: "contact-list-clean-up-workbook.xlsx",
    image: `${SHOP}/contact-list-clean-up-workbook.png`,
  },
  {
    slug: "reorder-restock-planner",
    feedId: "SCKITREORDER",
    title: "Reorder & Restock Planner: Inventory Workbook for 100 SKUs",
    usdCents: 1100,
    summary: "Know what to reorder, how much and by when, for up to 100 products.",
    description: [
      "Three sheets: Reorder plan, Stock inputs and Start here, with room for 100 SKUs and fictional sample rows.",
      "Works out demand from days in stock, the reorder point, the target level, eligible incoming units, the order quantity rounded to your minimum and pack size, and optional spend. Flags receipts that arrive late or after a stock-out, missing inputs and duplicate SKUs. SKU codes keep their leading zeros.",
      "Calculations tested in LibreOffice. No macros and no live connection to a store or stock system.",
    ],
    file: "reorder-restock-planner.xlsx",
    image: `${SHOP}/reorder-restock-planner.png`,
  },
  {
    slug: "wedding-budget-payment-planner",
    feedId: "SCKITWEDDING",
    title: "Wedding Budget & Payment Planner: Costs, Deposits and Who Pays",
    usdCents: 600,
    summary: "Track wedding costs, deposits, payment deadlines and who pays in one workbook.",
    description: [
      "Five sheets: Overview, Cost plan (100 expenses), Payments (300 instalments), Contributions (20 people or families) and Start here.",
      "Keeps costs, actual payments and promised or received contributions apart, shows what is due next and what remains unpaid, and handles partial payments, credits and unscheduled balances. Invalid rows are flagged and left out of the totals.",
      "Calculations tested in LibreOffice. No macros, no account needed.",
    ],
    file: "wedding-budget-payment-planner.xlsx",
    image: `${SHOP}/wedding-overview.png`,
  },
  {
    slug: "candle-batch-cost-calculator",
    feedId: "SCKITCANDLE",
    title: "Candle Batch Cost Calculator",
    usdCents: 600,
    summary: "See what a candle batch costs per saleable candle, including rejects, labour and selling fees.",
    description: [
      "One XLSX workbook with Batch cost, Materials and Start here sheets. 30 material rows with pack cost, pack quantity and quantity used.",
      "Gives the cost per saleable candle, a break-even price, a price at your chosen contribution margin and a comparison with your proposed price, with input warnings and a fictional worked example.",
      "One currency and one batch per workbook. Includes no recipe, fragrance-load, safety or tax calculation; contribution is not accounting profit. Calculations tested in LibreOffice.",
    ],
    file: "candle-batch-cost-calculator.xlsx",
    image: `${SHOP}/candle-batch-cost-calculator-cover.png`,
    extraImages: [`${SHOP}/candle-batch-cost-calculator-preview.png`],
  },
  {
    slug: "craft-fair-sales-stock-tracker",
    feedId: "SCKITCRAFTFAIR",
    title: "Craft Fair Sales & Stock Tracker",
    usdCents: 600,
    summary: "Keep one craft fair's sales, returns, stock counts and cash reconciliation together.",
    description: [
      "Event result, Sales, Stock, Expenses and Start here sheets: 300 sale lines, 100 product rows and 50 event expenses, with discounts, refunds and returns recorded separately.",
      "Compares what you brought, sold and returned with your end count; shows cash and card sales, card fees, expected closing cash, the cash difference and the event contribution after entered costs.",
      "A manual tracker for one event and one currency; it does not connect to a till or card processor. Calculations tested in LibreOffice.",
    ],
    file: "craft-fair-sales-stock-tracker.xlsx",
    image: `${SHOP}/craft-fair-sales-stock-tracker-cover.png`,
    extraImages: [`${SHOP}/craft-fair-sales-stock-tracker-preview.png`],
  },
];

export const KIT_LICENCE = LICENCE;
export const findKit = (slug: string) => KITS.find((k) => k.slug === slug);
export const kitByFeedId = (id: unknown) => typeof id === "string" ? KITS.find((k) => k.feedId === id) : undefined;
