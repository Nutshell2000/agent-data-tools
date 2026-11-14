// One page per company register we read: Sweden, Norway, Finland, France. Each carries facts that differ per country
// (what the company number is called, its format and check digit, how it relates to the VAT number, which authority
// keeps the register, how fresh our copy is) and a working lookup. Part of the company-check product
// (lib/product-pages.ts); same reasoning as lib/vat-pages.ts. The "what you get" text is the tool's own description.
import { ENDPOINTS, SERVICE_NAME, exampleParams, toolSlug, type Endpoint } from "../endpoints";
import { TRY_FORM_CSS, tryForm } from "./try-form";
import { PAGE_STYLE, VAT_BASE } from "./vat-pages";
import { COMPANY_FOOTER } from "./legal";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const jsonLd = (value: unknown) => JSON.stringify(value).replace(/</g, "\\u003c");

export interface RegisterCountry {
  slug: string;
  country: string;
  adjective: string;
  /** The lookup tool. */
  tool: string;
  /** What the company number is called. */
  numberName: string;
  /** Its format in words. */
  format: string;
  /** Matches a well-formed number as people write it. */
  pattern: RegExp;
  /** A real, public example: the one the tool's own listing uses. */
  example: string;
  exampleCompany: string;
  /** How the last digit is checked. */
  checkDigit: string;
  /** How the VAT number is built from it. */
  vat: string;
  /** Who keeps the register. */
  authority: string;
  /** How fresh our answer is. */
  freshness: string;
  /** The VAT page of this country, when it is in VIES. */
  vatSlug?: string;
}

export const REGISTER_COUNTRIES: readonly RegisterCountry[] = [
  { slug: "sweden", country: "Sweden", adjective: "Swedish", tool: "/se/company",
    numberName: "organisationsnummer", format: "10 digits, usually written NNNNNN-NNNN; for a company the third digit is 2 or higher",
    pattern: /^\d{6}-?\d{4}$/, example: "556703-7485", exampleCompany: "Spotify AB",
    checkDigit: "The tenth digit is a Luhn (mod 10) check digit over the first nine.",
    vat: "SE, the 10 digits without the hyphen, then 01: 556703-7485 becomes SE556703748501.",
    authority: "Bolagsverket (the Swedish Companies Registration Office), with activity data from Statistics Sweden (SCB)",
    freshness: "The register's open data, refreshed weekly.", vatSlug: "sweden" },
  { slug: "norway", country: "Norway", adjective: "Norwegian", tool: "/no/company",
    numberName: "organisasjonsnummer", format: "9 digits, the first 8 or 9",
    pattern: /^[89]\d{8}$/, example: "923609016", exampleCompany: "Equinor ASA",
    checkDigit: "The ninth digit is a mod 11 check digit over the first eight, with the weights 3, 2, 7, 6, 5, 4, 3, 2.",
    vat: "NO, the 9 digits, then MVA: 923609016 becomes NO923609016MVA. Norway is not in the EU, so the number cannot be checked in VIES; the register says whether the company is registered for VAT.",
    authority: "Brønnøysundregistrene (the Brønnøysund Register Centre)",
    freshness: "Read live from the register for each lookup." },
  { slug: "finland", country: "Finland", adjective: "Finnish", tool: "/fi/company",
    numberName: "Y-tunnus (business ID)", format: "7 digits, a hyphen and a check digit: NNNNNNN-N",
    pattern: /^\d{7}-?\d$/, example: "0112038-9", exampleCompany: "Nokia Oyj",
    checkDigit: "The last digit is a mod 11 check digit over the first seven, with the weights 7, 9, 10, 5, 8, 4, 2.",
    vat: "FI and the 8 digits without the hyphen: 0112038-9 becomes FI01120389.",
    authority: "the Finnish Patent and Registration Office (PRH)",
    freshness: "Read live from the register for each lookup.", vatSlug: "finland" },
  { slug: "france", country: "France", adjective: "French", tool: "/fr/company",
    numberName: "SIREN (and SIRET for each establishment)", format: "SIREN: 9 digits. SIRET: 14 digits, the SIREN followed by a 5-digit establishment number",
    pattern: /^(\d{9}|\d{14})$/, example: "552032534", exampleCompany: "Danone",
    checkDigit: "Both the SIREN and the SIRET end in a Luhn (mod 10) check digit.",
    vat: "FR, a 2-digit key, then the SIREN. The key is (12 + 3 × (SIREN mod 97)) mod 97: 552032534 becomes FR27552032534.",
    authority: "INSEE (the Sirene register) and the national business register (RNE), through the French State's company search",
    freshness: "Read live from the State's company search for each lookup.", vatSlug: "france" },
];

const BY_SLUG = new Map(REGISTER_COUNTRIES.map((c) => [c.slug, c]));
export const registerCountry = (slug: string) => BY_SLUG.get(slug);
export const REGISTER_BASE = "/company-register";
export const registerPagePaths = () => [REGISTER_BASE, ...REGISTER_COUNTRIES.map((c) => `${REGISTER_BASE}/${c.slug}`)];
/** The register page for a lookup tool, for links from the VAT pages. */
export const REGISTER_FOR_TOOL: ReadonlyMap<string, RegisterCountry> = new Map(REGISTER_COUNTRIES.map((c) => [c.tool, c] as const));

const toolOf = (c: RegisterCountry) => ENDPOINTS.find((e) => e.path === c.tool) as Endpoint;
const queryOf = (e: Endpoint) => exampleParams(e).map(([k, p]) => `${k}=${encodeURIComponent(String(p.example ?? ""))}`).join("&");

/** The page for one register. `tryIt`: a browser may run the lookup free here. */
export function registerCountryPage(c: RegisterCountry, origin: string, tryIt: boolean, brand: string = SERVICE_NAME): string {
  const e = toolOf(c);
  const url = `${origin}${REGISTER_BASE}/${c.slug}`;
  const title = `${c.adjective} company register lookup and API: ${c.numberName.replace(/ \(.*$/, "")} check · ${brand}`;
  const description = `Look up a ${c.adjective} company by ${c.numberName.replace(/ \(.*$/, "")} or name, from ${c.authority}. The number's format and check digit, a live lookup, and an API for your own code.`.slice(0, 300);
  const example = JSON.stringify(e.outputExample, null, 2);
  const shown = example.length > 2200 ? `${example.slice(0, 2200)}\n…` : example;
  const faq: [string, string][] = [
    [`What does a ${c.adjective} ${c.numberName.replace(/ \(.*$/, "")} look like?`, `${c.format}. Example: ${c.example} (${c.exampleCompany}). ${c.checkDigit}`],
    [`How is the ${c.adjective} VAT number related to it?`, c.vat],
    ["Where does the data come from, and how fresh is it?", `From ${c.authority}. ${c.freshness}`],
    ["Is this a credit report?", "No. It returns register facts: names, legal form, status, dates, industry codes and address. No credit score, no financial statements and no personal data about owners."],
  ];
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(url)}">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(description)}"><meta property="og:url" content="${esc(url)}"><meta property="og:image" content="${esc(origin)}/og.png">
<link rel="icon" href="/favicon.ico">
<script type="application/ld+json">${jsonLd({ "@context": "https://schema.org", "@type": "FAQPage", mainEntity: faq.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })) })}</script>
<style>${PAGE_STYLE}${tryIt ? TRY_FORM_CSS : ""}</style></head><body><main>
<nav class="crumbs"><a href="/">${esc(brand)}</a> › <a href="/company-check-api">Company check API</a> › <a href="${REGISTER_BASE}">Company registers</a></nav>
<h1>${esc(c.adjective)} company register lookup</h1>
<p class="tag">Look up a company in ${esc(c.country)} by its ${esc(c.numberName.replace(/ \(.*$/, ""))} or name, here or from your own code.</p>
<div class="wrap"><table>
<tr><th>Company number</th><td>${esc(c.numberName)}</td></tr>
<tr><th>Format</th><td>${esc(c.format)}</td></tr>
<tr><th>Example</th><td><code>${esc(c.example)}</code> (${esc(c.exampleCompany)})</td></tr>
<tr><th>Check digit</th><td>${esc(c.checkDigit)}</td></tr>
<tr><th>VAT number</th><td>${esc(c.vat)}</td></tr>
<tr><th>Register</th><td>${esc(c.authority)}</td></tr>
<tr><th>Freshness</th><td>${esc(c.freshness)}</td></tr>
</table></div>
${tryIt ? tryForm(e, undefined, `Look up a ${c.adjective} company now`) : `<p><a class="btn primary" href="/company-check-api">Look up a company</a></p>`}
<h2>What you get</h2>
<p>${esc(e.description)}</p>
<h2>From your code</h2>
<pre><code>curl -H "Authorization: Bearer $API_KEY" \\
  "${esc(origin)}${esc(e.path)}?${esc(queryOf(e))}"</code></pre>
<pre><code>${esc(shown)}</code></pre>
<p>One GET request, JSON back; a company that is not found is never charged. Keys and monthly plans: <a href="/company-check-api">Company check API</a>. Reference: <a href="/tools/${esc(toolSlug(e.path))}">tool page</a>.${c.vatSlug ? ` The VAT number: <a href="${VAT_BASE}/${esc(c.vatSlug)}">check a ${esc(c.adjective)} VAT number</a>.` : ""}</p>
<h2>Questions</h2>
${faq.map(([q, a]) => `<h3>${esc(q)}</h3><p>${esc(a)}</p>`).join("")}
<h2>Other registers</h2>
<p>${REGISTER_COUNTRIES.filter((o) => o !== c).map((o) => `<a href="${REGISTER_BASE}/${esc(o.slug)}">${esc(o.country)}</a>`).join(" · ")} · <a href="${VAT_BASE}">EU VAT numbers</a></p>
<footer><a href="/company-check-api">Company check API</a> · <a href="/tools">All ${ENDPOINTS.length} tools</a> · ${COMPANY_FOOTER}</footer>
</main></body></html>`;
}

/** /company-register: the registers side by side. */
export function registerIndexPage(origin: string, brand: string = SERVICE_NAME): string {
  const url = `${origin}${REGISTER_BASE}`;
  const title = `Company register lookup: Sweden, Norway, Finland, France · ${brand}`;
  const description = "Look up companies in the Swedish, Norwegian, Finnish and French registers by company number or name: number formats, check digits, VAT numbers, and one API for all four.";
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(url)}">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(description)}"><meta property="og:url" content="${esc(url)}"><meta property="og:image" content="${esc(origin)}/og.png">
<link rel="icon" href="/favicon.ico">
<style>${PAGE_STYLE}</style></head><body><main>
<nav class="crumbs"><a href="/">${esc(brand)}</a> › <a href="/company-check-api">Company check API</a></nav>
<h1>Company register lookup</h1>
<p class="tag">Four national company registers behind one API key: look a company up by its number or name and get its register facts as JSON.</p>
<div class="wrap"><table><tr><th>Country</th><th>Company number</th><th>Format</th><th>Register</th></tr>
${REGISTER_COUNTRIES.map((c) => `<tr><td><a href="${REGISTER_BASE}/${esc(c.slug)}">${esc(c.country)}</a></td><td>${esc(c.numberName)}</td><td>${esc(c.format)}</td><td>${esc(c.authority)}</td></tr>`).join("\n")}
</table></div>
<p>Register facts only: names, legal form, status, bankruptcy or liquidation, dates, industry codes and address. Not a credit report. For VAT numbers in every EU country: <a href="${VAT_BASE}">EU VAT number check</a>. Keys and monthly plans: <a href="/company-check-api">Company check API</a>.</p>
<footer><a href="/company-check-api">Company check API</a> · <a href="/tools">All ${ENDPOINTS.length} tools</a> · ${COMPANY_FOOTER}</footer>
</main></body></html>`;
}
