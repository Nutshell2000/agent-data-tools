// Comparison pages: our invoice extraction against the document-extraction leaders, one page per rival plus a hub.
//
// Why (research of 14 Nov 2026, business\research-2026-11-14-biggest-earners): the biggest document sellers (Veryfi,
// Mindee, Nanonets, Rossum…) win search with "alternative to X" and pricing-comparison pages, and their own rules
// leave a gap a small seller can state plainly: an account and card before the first call, monthly minimums, per-page
// or per-step billing, and no VAT check in the result.
//
// Rules for this file:
// - Every rival figure is copied from the rival's own pricing page on the date in `CHECKED`, with that page linked. No
//   third-party estimates (Google Document AI, Rossum and Azure were left out on 14 Nov because their own pages could
//   not be read or gave no number). When a rival's page changes, change the row and the date, or drop the rival.
// - Say where a rival is better (cheaper per page, mobile SDKs, trained models). The comparison must be fair to stand.
// - Our own numbers are computed from the catalog, the key prices and the plans, never typed.
import { ENDPOINTS, SERVICE_NAME, type Endpoint } from "../endpoints";
import { keyPrice } from "./key-prices";
import { productBySlug, productOffers } from "./product-pages";
import { COMPANY_FOOTER } from "./legal";
import { freeKeysOn } from "./free-keys";
import { publicBrand } from "./public-brand";
import type { Env } from "./env";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const jsonLd = (value: unknown) => JSON.stringify(value).replace(/</g, "\\u003c");

/** The day every rival row below was read from the rival's own pricing page. */
export const CHECKED = "14 November 2026";
export const COMPARE_BASE = "/compare";

export interface Rival {
  /** Page path under /compare, ending in -alternative. */
  slug: string;
  name: string;
  /** The rival's own pricing page: the only source for the figures in this row. */
  source: string;
  /** What one invoice costs there, as the page states it. */
  price: string;
  /** The lowest price per invoice page the page states, in USD, for the hub table (null when it is not per page). */
  fromUsd: number | null;
  free: string;
  /** Commitment before the first paid document. */
  commitment: string;
  /** How a long invoice is billed. */
  billing: string;
  /** Where the rival is the better choice, said plainly. */
  better: readonly string[];
  /** Other facts from the same page worth knowing. */
  notes: readonly string[];
}

export const RIVALS: readonly Rival[] = [
  {
    slug: "veryfi-alternative",
    name: "Veryfi",
    source: "https://www.veryfi.com/pricing/",
    price: "$0.16 per invoice and $0.08 per receipt on the Starter plan",
    fromUsd: 0.16,
    free: "Free plan: up to 100 documents a month",
    commitment: "Starter has a $500 a month minimum commitment",
    billing: "Per document",
    better: ["Mobile capture SDKs and receipt models built for expense apps", "Volume discounts on its Growth plan"],
    notes: ["A 12-month commitment takes one cent off every document."],
  },
  {
    slug: "mindee-alternative",
    name: "Mindee",
    source: "https://www.mindee.com/pricing",
    price: "Credits from $0.05 each (Mindee's FAQ); one processed page is one credit, 1.5 with a confidence score",
    fromUsd: 0.05,
    free: "14-day free trial",
    commitment: "A plan: Starter 44 a month or 529 a year, Pro 116 a month or 1,393 a year",
    billing: "Per page; usage over the plan is charged at the plan rate plus a 20% surcharge",
    better: ["Pre-trained document models with confidence scores", "Data processing localization on the Pro and Enterprise plans"],
    notes: ["Data processing localization is listed for Pro and Enterprise only."],
  },
  {
    slug: "aws-textract-alternative",
    name: "AWS Textract (AnalyzeExpense)",
    source: "https://aws.amazon.com/textract/pricing/",
    price: "$0.01 per page for the first million pages, then $0.008 (US West, Oregon)",
    fromUsd: 0.01,
    free: "100 pages a month for the first three months, for new AWS customers",
    commitment: "None, but an AWS account, credentials and SDK setup",
    billing: "Per page",
    better: ["Cheaper per page than we are", "Runs inside AWS next to the rest of an AWS workload"],
    notes: ["It returns the fields AWS defines for invoices and receipts; you map them to your own names."],
  },
  {
    slug: "nanonets-alternative",
    name: "Nanonets",
    source: "https://nanonets.com/pricing",
    price: "$0.30 per complex AI block run; Nanonets puts a typical invoice at 4 to 6 blocks, \"under $2 per invoice end-to-end\"",
    fromUsd: 0.3,
    free: "$50 in credits to start, no card required",
    commitment: "None on Starter; Growth and Enterprise by quote",
    billing: "Per block run (several per invoice)",
    better: ["Full workflows: approval, routing and export steps in one product", "Training on your own documents"],
    notes: ["Total cost is the number of block runs times the block price."],
  },
  {
    slug: "reducto-alternative",
    name: "Reducto",
    source: "https://docs.reducto.ai/reference/pricing-migration.md",
    price: "Extract, including parsing, $20 per 1,000 pages ($0.02 a page) since 1 September 2026",
    fromUsd: 0.02,
    free: "15,000 free credits for new Standard pay-as-you-go customers",
    commitment: "None on pay as you go; an account and key",
    billing: "Per page",
    better: ["Cheaper per page than we are", "Built for long, complex documents and tables at volume"],
    notes: ["Prepaid credits carry over."],
  },
  {
    slug: "parseur-alternative",
    name: "Parseur",
    source: "https://parseur.com/pricing",
    price: "From $49 a month for 100 pages ($0.49 a page) down to $499 a month for 10,000 pages ($0.05 a page)",
    fromUsd: 0.05,
    free: "Free plan: 20 pages a month",
    commitment: "A monthly or yearly plan",
    billing: "Per page: every page of a PDF counts (a three-page PDF is 3 credits); an e-mail is one page",
    better: ["Parses e-mails and attachments from a mailbox with no code", "Templates you can correct by hand"],
    notes: [],
  },
  {
    slug: "docparser-alternative",
    name: "Docparser",
    source: "https://docparser.com/pricing/",
    price: "Starter $39 a month for 100 documents ($0.39 each), Business $159 a month for 1,000 ($0.16 each)",
    fromUsd: 0.16,
    free: "14-day free trial, no card required",
    commitment: "A monthly or yearly plan",
    billing: "Per document of up to 5 pages",
    better: ["Rule-based templates that give the same answer every time for a fixed layout", "Many export integrations"],
    notes: ["One parsing credit is one document with up to 5 pages."],
  },
  {
    slug: "llamaparse-alternative",
    name: "LlamaParse (LlamaExtract)",
    source: "https://developers.llamaindex.ai/llamaparse/general/pricing/index.md",
    price: "$1.50 per 1,000 credits pay as you go; extraction with parsing is 8, 25 or 60 credits a page by tier ($0.012 to $0.09 a page)",
    fromUsd: 0.012,
    free: "Free credits are described on its billing page, not its pricing page",
    commitment: "None on pay as you go; an account and key",
    billing: "Per page, plus 100 credits per GB per day for files it retains",
    better: ["Cheaper per page on its lowest tier", "Deep integration with the LlamaIndex framework"],
    notes: ["Ephemeral files are not charged for storage; retained files are."],
  },
];

const BY_SLUG = new Map(RIVALS.map((r) => [r.slug, r]));
export const rivalBySlug = (slug: string) => BY_SLUG.get(slug);
export const comparePaths = () => [COMPARE_BASE, ...RIVALS.map((r) => `${COMPARE_BASE}/${r.slug}`)];

const BY_PATH = new Map(ENDPOINTS.map((e) => [e.path, e as Endpoint]));
const EXTRACT = "/document/extract";
const INVOICE_CHECK = "/invoice/check";

/** Our side of every comparison, from the catalog. */
export function ourOffer(cardReady = true) {
  const extract = BY_PATH.get(EXTRACT)!;
  const check = BY_PATH.get(INVOICE_CHECK);
  const product = productBySlug("invoice-data-extraction-api")!;
  const offers = productOffers(product, cardReady);
  const lead = offers.find((o) => o.monthly) ?? offers[0];
  const extractKeyPrice = keyPrice(extract.path, extract.price);
  // What one document costs inside the cheapest monthly plan (plans carry bonus credits), e.g. "$0.018".
  const docs = lead ? Number(lead.calls.replace(/,/g, "")) : 0;
  const usd = lead ? Number(lead.label.replace(/[^0-9.]/g, "")) : 0;
  const planPerDoc = lead?.monthly && docs > 0 ? `$${(Math.ceil((usd / docs) * 1000) / 1000).toString()}` : undefined;
  const priceLine = planPerDoc && Number(planPerDoc.slice(1)) < Number(extractKeyPrice.slice(1))
    ? `${extractKeyPrice} per document with a key; ${planPerDoc} on the ${lead!.label} plan (${lead!.calls} documents)`
    : `${extractKeyPrice} per document with a key`;
  return { extractPrice: extract.price, extractKeyPrice, checkPrice: check ? check.price : undefined, lead, offers, planPerDoc, priceLine };
}

const STYLE = `:root{--bg:#fff;--fg:#16181d;--muted:#5b616b;--card:#f5f6f8;--line:#e2e5ea;--accent:#0b57d0;--accent-fg:#fff;--ok:#0b6e4f}
@media (prefers-color-scheme:dark){:root{--bg:#111316;--fg:#e9ebee;--muted:#a2a8b0;--card:#1a1d22;--line:#2b3037;--accent:#8ab4f8;--accent-fg:#0b1a33;--ok:#5fd0a5}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.6 system-ui,-apple-system,Segoe UI,sans-serif}
main{max-width:860px;margin:0 auto;padding:28px 16px 56px}nav.crumbs{color:var(--muted);font-size:.9rem;margin-bottom:18px}
h1{font-size:2rem;line-height:1.15;margin:0 0 10px;letter-spacing:-.01em}.tag{font-size:1.1rem;color:var(--muted);margin:0 0 18px}
h2{font-size:1.25rem;margin:36px 0 10px}p{margin:8px 0}a{color:var(--accent)}ul{padding-left:22px}
.actions{display:flex;flex-wrap:wrap;gap:10px;margin:18px 0 6px}.btn{display:inline-block;padding:11px 18px;border-radius:8px;border:1px solid var(--line);color:var(--fg);text-decoration:none;font-weight:600}
.btn.primary{background:var(--accent);border-color:var(--accent);color:var(--accent-fg)}
.small{color:var(--muted);font-size:.9rem}.wrap{overflow-x:auto}table{border-collapse:collapse;width:100%;font-size:.93rem}
td,th{border-bottom:1px solid var(--line);padding:9px 8px;text-align:left;vertical-align:top}th{white-space:nowrap}tr.us td{background:var(--card)}
footer{margin-top:40px;color:var(--muted);font-size:.9rem}`;

function shell(o: { title: string; description: string; url: string; brand: string; body: string; ld: unknown[] }) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(o.title)}</title>
<meta name="description" content="${esc(o.description)}">
<link rel="canonical" href="${esc(o.url)}">
<meta property="og:type" content="article"><meta property="og:title" content="${esc(o.title)}"><meta property="og:description" content="${esc(o.description)}">
<meta property="og:url" content="${esc(o.url)}">
<link rel="icon" href="/favicon.ico">
${o.ld.map((x) => `<script type="application/ld+json">${jsonLd(x)}</script>`).join("\n")}
<style>${STYLE}</style></head><body><main>
${o.body}
<footer><a href="${COMPARE_BASE}">All comparisons</a> · <a href="/invoice-data-extraction-api">Invoice data extraction API</a> · <a href="/document-to-text-api">Document to text API</a> · ${COMPANY_FOOTER}<br>Prices of other services were copied from each one's own pricing page on ${CHECKED} and change over time; follow the links for today's figures. Product names are trademarks of their owners; ${esc(o.brand)} is not affiliated with them.</footer>
</main></body></html>`;
}

function ourFacts(us: ReturnType<typeof ourOffer>, freeKey: boolean): string[] {
  return [
    `${us.extractKeyPrice} per document with an API key${us.extractKeyPrice !== us.extractPrice ? ` (${us.extractPrice} paid per call by an agent wallet)` : ""}: one call per file, whatever its page count. It reads the first 24,000 characters of a file, and up to three pages of a scan.`,
    `No minimum and no yearly plan: one-off credit packs that never expire, or a monthly plan you can cancel at any time${us.lead ? ` (from ${us.lead.label.replace(" once", "")})` : ""}.`,
    "No account: pay by card and get a key on the next page, or let an agent pay per call in USDC (x402).",
    freeKey ? "A free API key by e-mail for a first test." : "The first calls are free through the MCP server.",
    "Failed calls are never charged, and a file that cannot be read costs nothing.",
    "You name the fields you want in each request (invoice_number, total, due_date, supplier…): no template, no training. A value the file does not state comes back as null, never guessed.",
    "PDF, Word, Excel and PowerPoint files, and scans and photos by OCR.",
    "Files sent in a request are held in memory for that request only: not stored, cached or logged.",
    ...(us.checkPrice ? [`One-call invoice check at ${us.checkPrice}: the fields, plus the seller's and buyer's EU VAT numbers checked in VIES, the IBAN, and whether net + VAT = total.`] : []),
  ];
}

const actions = (freeKey: boolean) => `<div class="actions">
${freeKey ? `<a class="btn primary" href="/keys/free">Get a free API key</a>` : ""}
<a class="btn${freeKey ? "" : " primary"}" href="/invoice-data-extraction-api">See the API and a sample answer</a>
<a class="btn" href="/invoice-data-extraction-api#pricing">Pricing</a>
</div>`;

/** The page for one rival. */
export function comparePage(r: Rival, origin: string, freeKey: boolean, cardReady = true, brand: string = SERVICE_NAME): string {
  const us = ourOffer(cardReady);
  const url = `${origin}${COMPARE_BASE}/${r.slug}`;
  const title = `${r.name} alternative: invoice data extraction API, no minimum · ${brand}`;
  const description = `${r.name} charges ${r.price}. ${brand}: ${us.extractKeyPrice} per document, no account, no minimum, failed calls free, files not stored. Prices checked ${CHECKED}.`.slice(0, 300);
  const rows: [string, string, string][] = [
    ["Price per invoice", r.price, us.priceLine],
    ["Free to start", r.free, freeKey ? "Free API key by e-mail" : "First calls free over MCP"],
    ["Commitment", r.commitment, "None: packs never expire, plans cancel any time"],
    ["Long invoices", r.billing, "One price per file (first 24,000 characters; three pages of a scan)"],
    ["Account before the first call", "Yes", "No: card checkout gives a key, or an agent pays per call"],
    ["EU VAT numbers checked in the result", "Not on its pricing page", us.checkPrice ? `Yes, with ${INVOICE_CHECK} (${us.checkPrice})` : "Separate VAT check tool"],
  ];
  const faq: [string, string][] = [
    [`Is ${brand} cheaper than ${r.name}?`, r.fromUsd !== null && r.fromUsd < Number(us.extractKeyPrice.slice(1)) ? `Not per page at the pay-as-you-go price: ${r.name} starts lower per page${us.planPerDoc ? ` (inside the ${us.lead!.label} plan a document costs ${us.planPerDoc})` : ""}. ${brand} is per document with no account, no minimum and no plan, which costs less when volumes are small or uneven, and when invoices run to several pages.` : `For a one-page invoice, yes: ${us.extractKeyPrice} against ${r.price}. There is also no minimum, plan or account.`],
    ["Do I need to train a model or set up templates?", "No. Send the file and the field names you want; the model finds them whatever the layout or language."],
    ["Are my files stored?", "No. A file sent in a request is held in memory for that request only. It is not stored, cached or logged."],
    ["How accurate is it?", "An AI model reads the file. Check amounts and dates that matter before you act on them; a field the file does not state comes back as null rather than a guess."],
  ];
  const body = `<nav class="crumbs"><a href="/">${esc(brand)}</a> › <a href="${COMPARE_BASE}">Comparisons</a></nav>
<h1>${esc(r.name)} alternative for invoice data extraction</h1>
<p class="tag">Send an invoice, get the fields you name back as JSON. ${esc(us.extractKeyPrice)} per document, no account, no minimum, nothing stored.</p>
${actions(freeKey)}
<h2>${esc(r.name)} and ${esc(brand)} side by side</h2>
<div class="wrap"><table><tr><th></th><th>${esc(r.name)}</th><th>${esc(brand)}</th></tr>
${rows.map(([k, a, b]) => `<tr><td><b>${esc(k)}</b></td><td>${esc(a)}</td><td>${esc(b)}</td></tr>`).join("\n")}
</table></div>
<p class="small">${esc(r.name)} figures from <a href="${esc(r.source)}" rel="nofollow noopener">its pricing page</a>, read on ${CHECKED}.${r.notes.length ? ` ${r.notes.map(esc).join(" ")}` : ""}</p>
<h2>When ${esc(r.name)} is the better choice</h2>
<ul>${r.better.map((b) => `<li>${esc(b)}</li>`).join("")}</ul>
<h2>What you get with ${esc(brand)}</h2>
<ul>${ourFacts(us, freeKey).map((f) => `<li>${esc(f)}</li>`).join("")}</ul>
<h2>One request</h2>
<p>POST the file and name the fields in the query string:</p>
<pre style="background:var(--card);border:1px solid var(--line);border-radius:8px;padding:14px;overflow:auto;font-size:.85rem"><code>${esc(`curl -H "Authorization: Bearer $API_KEY" \\\n  -F "file=@invoice.pdf" \\\n  "${origin}${EXTRACT}?fields=invoice_number,invoice_date,due_date,supplier,supplier_vat,total,currency"`)}</code></pre>
<h2>Questions</h2>
${faq.map(([q, a]) => `<h3>${esc(q)}</h3><p>${esc(a)}</p>`).join("")}
<p>Other comparisons: ${RIVALS.filter((o) => o !== r).map((o) => `<a href="${COMPARE_BASE}/${o.slug}">${esc(o.name)}</a>`).join(" · ")}</p>`;
  const faqLd = { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: faq.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })) };
  return shell({ title, description, url, brand, body, ld: [faqLd] });
}

/**
 * The HTML for a /compare path (slug undefined = the hub), or undefined for an unknown rival. The route in src/index.ts
 * stays two lines so releases prepared at the same time do not touch the same lines there.
 */
export function compareHtml(env: Env, origin: string, slug?: string): string | undefined {
  const freeKey = freeKeysOn(env);
  const cardReady = Boolean(env.STRIPE_READ_KEY);
  const brand = publicBrand(env, SERVICE_NAME);
  if (slug === undefined) return compareIndexPage(origin, freeKey, cardReady, brand);
  const rival = rivalBySlug(slug);
  return rival ? comparePage(rival, origin, freeKey, cardReady, brand) : undefined;
}

/** The hub: every rival in one table, cheapest per page first, with our row on top. */
export function compareIndexPage(origin: string, freeKey: boolean, cardReady = true, brand: string = SERVICE_NAME): string {
  const us = ourOffer(cardReady);
  const url = `${origin}${COMPARE_BASE}`;
  const title = `Invoice extraction API pricing compared: ${RIVALS.length} services (${CHECKED.replace(/^\d+ /, "")}) · ${brand}`;
  const description = `Price per invoice, free tier, minimum commitment and billing unit for ${RIVALS.map((r) => r.name.replace(/ \(.*\)$/, "")).join(", ")}, read from each pricing page on ${CHECKED}, next to ${brand}.`.slice(0, 300);
  const sorted = [...RIVALS].sort((a, b) => (a.fromUsd ?? 99) - (b.fromUsd ?? 99));
  const body = `<nav class="crumbs"><a href="/">${esc(brand)}</a></nav>
<h1>Invoice extraction API pricing compared</h1>
<p class="tag">What one invoice costs at ${RIVALS.length} document-extraction services, what you must commit to first, and how long invoices are billed. Every figure is from the service's own pricing page, read on ${CHECKED}.</p>
${actions(freeKey)}
<div class="wrap"><table><tr><th>Service</th><th>Price per invoice</th><th>Free to start</th><th>Commitment</th><th>Billed</th></tr>
<tr class="us"><td><b>${esc(brand)}</b></td><td>${esc(us.priceLine)}</td><td>${freeKey ? "Free API key by e-mail" : "First calls free over MCP"}</td><td>None; no account</td><td>Per file</td></tr>
${sorted.map((r) => `<tr><td><a href="${COMPARE_BASE}/${r.slug}">${esc(r.name)}</a></td><td>${esc(r.price)}</td><td>${esc(r.free)}</td><td>${esc(r.commitment)}</td><td>${esc(r.billing)}</td></tr>`).join("\n")}
</table></div>
<p class="small">Sources: ${RIVALS.map((r) => `<a href="${esc(r.source)}" rel="nofollow noopener">${esc(r.name)}</a>`).join(" · ")}. Not listed: services whose own pricing page gave no figure we could read on that day.</p>
<h2>How to read this</h2>
<ul>
<li>Per-page prices are the lowest each page states; AWS Textract, Reducto and LlamaParse's lowest tier cost less per page than we do.</li>
<li>Minimums and plans decide the real cost at low volume: a $500 monthly minimum is $5 per invoice at 100 invoices.</li>
<li>Per-page billing multiplies with every page of a long invoice; per-step billing multiplies with every step of a workflow.</li>
</ul>
<h2>What you get with ${esc(brand)}</h2>
<ul>${ourFacts(us, freeKey).map((f) => `<li>${esc(f)}</li>`).join("")}</ul>`;
  const ld = { "@context": "https://schema.org", "@type": "Article", headline: "Invoice extraction API pricing compared", dateModified: "2026-11-14", url, publisher: { "@type": "Organization", name: brand, url: origin } };
  return shell({ title, description, url, brand, body, ld: [ld] });
}
