// /benchmarks: our search verticals measured against Exa's search API, method and question files public (Beat-Exa plan
// 4b step 3, 15 Nov 2026). Benchmarks are the marketing: every claim on our product pages points here.
//
// Rules for this file:
// - Only numbers from a recorded run, with its date, its question count and how it was scored. Where Exa did better,
//   say so (research papers). A new run replaces a row and its date; never mix runs in one row.
// - The question files and scripts are in the public repository; link them so anyone can re-run.
// - "Exa has no such product" only where its API reference shows none (checked 14 Nov 2026).
import { SERVICE_NAME } from "../endpoints";
import { STYLE } from "./compare-pages";
import { COMPANY_FOOTER } from "./legal";
import { publicBrand } from "./public-brand";
import type { Env } from "./env";

export const BENCHMARKS_PATH = "/benchmarks";
const REPO = "https://github.com/Nutshell2000/agent-data-tools/blob/main";
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const jsonLd = (value: unknown) => JSON.stringify(value).replace(/</g, "\\u003c");

export interface BenchRow { system: string; ours: boolean; cells: string[] }
export interface Benchmark {
  id: string;
  title: string;
  date: string;
  /** What was asked, how many, and how a hit was scored. */
  method: string;
  columns: string[];
  rows: BenchRow[];
  /** What the numbers mean, including where we lost. */
  reading: string[];
  limits: string[];
  files: [label: string, path: string][];
  product?: [label: string, path: string];
}

export const BENCHMARKS: readonly Benchmark[] = [
  {
    id: "eu-law",
    title: "EU law: does the search return the article itself?",
    date: "15 November 2026",
    method: "102 held-out compliance questions across 41 EU acts (GDPR, AI Act, DSA, DMA, NIS2, DORA, MiCA, VAT, PSD2, AML, consumer, product and sustainability law), each with the article a correct answer must cite. They were written, and every expected article checked against its own text, before either search was run; none was used to tune our ranking. Ours counts only when the result's citation is exactly that article of that act. Exa (search type auto, 5 results with text) was scored leniently: a hit when the title, URL or first 1,500 characters name the article number and the act.",
    columns: ["Right article first", "Right article in top 5", "Average time"],
    rows: [
      { system: "Our EU law search (own index of 47 acts)", ours: true, cells: ["76 / 102", "96 / 102", "about 1.3 s"] },
      { system: "Exa search, type auto", ours: false, cells: ["34 / 102", "75 / 102", "about 1.5 s"] },
    ],
    reading: [
      "Exa mostly ranked pages about the law first: national regulators, law firms, explainers. The article itself often came second or third, and for some questions not at all.",
      "The 20 questions we tuned our ranking on (14 November) give the same picture: ours 10 first and 19 in the top 5, Exa 4 and 13 in this run.",
      "An agent that has to cite a provision needs the provision. Exa's pages are often still useful background.",
    ],
    limits: ["We wrote the questions ourselves; they are checked against the law, not against either search.", "The questions do not say \"EU\": Exa searches the whole web and some of its answers were UK or US pages, which a question naming the EU might avoid. Ours searches EU law only.", "English questions only."],
    files: [["The 122 questions and expected articles", "scripts/law-index/eval-questions.json"], ["Our run", "scripts/law-index/eval-ours.mjs"], ["Exa run", "scripts/law-index/bench-exa.mjs"]],
    product: ["EU law search API", "/eu-law-search-api"],
  },
  {
    id: "companies",
    title: "Companies: who is the registered legal entity?",
    date: "14 November 2026",
    method: "10 European company names. Exa used category company, 5 results. Ours searched the official registers (France, Sweden, Norway, Finland, Czechia, Estonia) and GLEIF.",
    columns: ["Found the company", "Register ID or LEI in the result", "Average time"],
    rows: [
      { system: "Our company search (official registers and GLEIF)", ours: true, cells: ["10 / 10", "10 / 10", "1.6 to 3.0 s"] },
      { system: "Exa search, category company", ours: false, cells: ["10 / 10", "0 / 10", "about 1.7 s"] },
    ],
    reading: [
      "Both found every company. Exa returns the company's website with facts gathered from the web (founding year, headcount, funding).",
      "We return the registered entity: register ID, legal form, seat, LEI and a link to the register. That is what KYB, invoicing and supplier checks need. Different questions, both answered well.",
    ],
    limits: ["10 names is a small set.", "Where GLEIF reports no parent company, a same-named subsidiary can come first."],
    files: [["Benchmark script (companies and papers)", "scripts/exa-bench/categories.mjs"]],
    product: ["Exa alternative for EU law and company data", "/exa-alternative-api"],
  },
  {
    id: "papers",
    title: "Research papers: is the right paper first?",
    date: "14 November 2026",
    method: "20 well-known papers: 10 asked by title words, 10 by a description. A hit when the result's title is the paper's title or its URL holds the paper's arXiv ID. Exa used category research paper.",
    columns: ["Right paper first", "Right paper in top 5", "Average time"],
    rows: [
      { system: "Exa search, category research paper", ours: false, cells: ["17 / 20", "19 / 20", "about 0.6 s"] },
      { system: "Our paper search (OpenAlex and Crossref, open data)", ours: true, cells: ["16 / 20", "17 / 20", "about 1.3 s"] },
    ],
    reading: [
      "Exa is ahead here, and faster. Ours is close from open data with no index of our own.",
      "Our misses were description-style questions and two answered by Crossref when OpenAlex rate-limited the test machine.",
    ],
    limits: ["Measured from our machine; in production the free OpenAlex allowance is shared, so more answers come from Crossref."],
    files: [["Benchmark script (companies and papers)", "scripts/exa-bench/categories.mjs"]],
  },
];

/** Products we sell where Exa's API reference showed no equivalent on 14 November 2026: nothing to race. */
export const NO_EQUIVALENT: readonly [what: string, ours: string, path: string][] = [
  ["Sanctions screening", "OFAC, EU, UN and UK lists in one call, each list's own date", "/eu-sanctions-screening-api"],
  ["KYB check", "Register entry, LEI and group parent, EU VAT number and four sanctions lists in one call", "/tools/pack-kyb-eu"],
  ["EU e-invoices", "Create, validate and convert XRechnung, ZUGFeRD and Factur-X", "/tools/einvoice-validate"],
  ["EU VAT numbers", "Checked live in the European Commission's VIES", "/tools/vat-validate"],
];

const table = (b: Benchmark) => `<table><thead><tr><th></th>${b.columns.map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead><tbody>
${b.rows.map((r) => `<tr${r.ours ? ' class="ours"' : ""}><th scope="row">${r.ours ? "<strong>" : ""}${esc(r.system)}${r.ours ? "</strong>" : ""}</th>${r.cells.map((c) => `<td>${r.ours ? `<strong>${esc(c)}</strong>` : esc(c)}</td>`).join("")}</tr>`).join("\n")}
</tbody></table>`;

export function benchmarksPage(origin: string, brand: string = SERVICE_NAME): string {
  const url = `${origin}${BENCHMARKS_PATH}`;
  const title = `Search benchmarks: ${brand} vs Exa`;
  const description = "EU law, company and research-paper searches measured against Exa's search API, with the questions, scoring and scripts published. Where Exa is better, it says so.";
  const summary = BENCHMARKS.map((b) => {
    const ours = b.rows.find((r) => r.ours)!, theirs = b.rows.find((r) => !r.ours)!;
    return `<tr><th scope="row"><a href="#${b.id}">${esc(b.title.split(":")[0])}</a></th><td>${esc(b.columns[0])}: <strong>${esc(ours.cells[0])}</strong> vs ${esc(theirs.cells[0])}</td><td>${esc(b.columns[1])}: <strong>${esc(ours.cells[1])}</strong> vs ${esc(theirs.cells[1])}</td></tr>`;
  }).join("\n");
  const sections = BENCHMARKS.map((b) => `<section id="${b.id}">
<h2>${esc(b.title)}</h2>
<p class="muted">Run on ${esc(b.date)}.</p>
<p><strong>Method.</strong> ${esc(b.method)}</p>
${table(b)}
<ul>${b.reading.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
<p><strong>Limits.</strong> ${b.limits.map(esc).join(" ")}</p>
<p>Re-run it: ${b.files.map(([label, path]) => `<a href="${REPO}/${path}">${esc(label)}</a>`).join(" · ")}${b.product ? ` · Product: <a href="${b.product[1]}">${esc(b.product[0])}</a>` : ""}</p>
</section>`).join("\n");
  const body = `<h1>Search benchmarks against Exa</h1>
<p class="lead">${esc(description)}</p>
<table><thead><tr><th>Area</th><th colspan="2">Ours vs Exa</th></tr></thead><tbody>
${summary}
</tbody></table>
<p>In short: where the answer is an official record (an EU article, a register entry) our own sources win clearly. On research papers Exa is slightly ahead. On the open web Exa's own index is larger than anything we run, and we do not claim otherwise.</p>
${sections}
<section id="no-equivalent">
<h2>Where Exa has no product to compare</h2>
<p>Exa's API reference showed none of these on 14 November 2026, so there is nothing to race. Each answers from the official source.</p>
<table><thead><tr><th>Product</th><th>What it returns</th></tr></thead><tbody>
${NO_EQUIVALENT.map(([what, ours, path]) => `<tr><th scope="row"><a href="${path}">${esc(what)}</a></th><td>${esc(ours)}</td></tr>`).join("\n")}
</tbody></table>
</section>
<section id="how">
<h2>How these were run</h2>
<ul>
<li>Exa was called through its public API on a standard account, with the settings named in each method. Spend: under $0.50 of Exa's free monthly credit.</li>
<li>Our side ran the same code our API runs, from our test machine.</li>
<li>Each question set, scorer and script is in the public repository linked above. Send us a question set and we will add the run, whatever it shows.</li>
<li>Exa's own SDKs (exa-js, exa-py) work against our API: change the base URL to <code>${esc(origin)}/v1</code>.</li>
</ul>
</section>`;
  const ld = [{
    "@context": "https://schema.org", "@type": "Article", headline: title, description, url,
    datePublished: "2026-11-15", dateModified: "2026-11-15", author: { "@type": "Organization", name: brand },
  }];
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(url)}">
<meta property="og:type" content="article"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(url)}">
<link rel="icon" href="/favicon.ico">
${ld.map((x) => `<script type="application/ld+json">${jsonLd(x)}</script>`).join("\n")}
<style>${STYLE} tr.ours th,tr.ours td{background:var(--card)} section{margin-top:2.2rem} table{display:block;max-width:100%;overflow-x:auto} th,td{white-space:normal;min-width:6rem}</style></head><body><main>
${body}
<footer><a href="/exa-alternative-api">Exa alternative API</a> · <a href="/eu-law-search-api">EU law search API</a> · <a href="/eu-sanctions-screening-api">EU sanctions screening API</a> · ${COMPANY_FOOTER}<br>Exa is a trademark of its owner; ${esc(brand)} is not affiliated with Exa. Figures are from the runs dated above and change as both services change.</footer>
</main></body></html>`;
}

export const benchmarksHtml = (env: Env, origin: string) => benchmarksPage(origin, publicBrand(env, SERVICE_NAME));
