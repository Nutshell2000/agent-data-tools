// One page per VIES country: "check a German VAT number". Each page carries facts that differ per country (the
// number's local name, its format, what the member state shares through VIES) and a working check, so it is not a
// templated copy of its neighbours. They belong to the company-check product (lib/product-pages.ts).
//
// Why (research of 14 Nov 2026): the buyers of VAT and company checks are businesses with a compliance need, the
// product with the best odds of paying customers; per-country pages with real data and a live tool are the page
// type that still ranks. Formats are the European Commission's published VIES formats; keep the table in step with
// VIES_COUNTRIES in routes/registries.ts (tests/vat-pages.test.cjs fails when they differ).
import { ENDPOINTS, SERVICE_NAME, toolSlug, type Endpoint } from "../endpoints";
import { TOOL_COUNT } from "../endpoints";
import { TRY_FORM_CSS } from "./try-form";
import { FREE_HTTP_CALLS_PER_CALLER } from "./free-calls";
import { CREDIT_PACKS, callsAt } from "./credits";
import { keyPrice } from "./key-prices";
import { COMPANY_FOOTER } from "./legal";
import { metaDescription, seoTitle } from "./seo-text";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const jsonLd = (value: unknown) => JSON.stringify(value).replace(/</g, "\\u003c");

export interface VatCountry {
  /** VIES prefix (EL for Greece, XI for Northern Ireland). */
  code: string;
  /** URL slug. */
  slug: string;
  country: string;
  /** "German", for "a German VAT number". */
  adjective: string;
  /** What the number is called locally. */
  localName: string;
  /** The format in words, after the prefix. */
  format: string;
  /** A made-up number of the right shape (not a real registration), prefix included. */
  shape: string;
  /** Matches a well-formed number, prefix included, spaces removed. */
  pattern: RegExp;
  /** Country-specific facts worth knowing before relying on a check. */
  notes?: string[];
  /** Our register tool for this country, when there is one. */
  register?: string;
}

export const VAT_COUNTRIES: readonly VatCountry[] = [
  { code: "AT", slug: "austria", country: "Austria", adjective: "Austrian", localName: "UID-Nummer (Umsatzsteuer-Identifikationsnummer)", format: "the letter U and 8 digits", shape: "ATU12345678", pattern: /^ATU\d{8}$/ },
  { code: "BE", slug: "belgium", country: "Belgium", adjective: "Belgian", localName: "btw-nummer / numéro de TVA", format: "10 digits, the first 0 or 1", shape: "BE0123456789", pattern: /^BE[01]\d{9}$/, notes: ["Older 9-digit numbers are written with a leading 0."] },
  { code: "BG", slug: "bulgaria", country: "Bulgaria", adjective: "Bulgarian", localName: "ДДС номер (DDS number)", format: "9 or 10 digits", shape: "BG123456789", pattern: /^BG\d{9,10}$/ },
  { code: "CY", slug: "cyprus", country: "Cyprus", adjective: "Cypriot", localName: "Αριθμός Εγγραφής ΦΠΑ (VAT registration number)", format: "8 digits and a letter", shape: "CY12345678X", pattern: /^CY\d{8}[A-Z]$/ },
  { code: "CZ", slug: "czech-republic", country: "the Czech Republic", adjective: "Czech", localName: "DIČ (daňové identifikační číslo)", format: "8, 9 or 10 digits", shape: "CZ12345678", pattern: /^CZ\d{8,10}$/ },
  { code: "DE", slug: "germany", country: "Germany", adjective: "German", localName: "USt-IdNr. (Umsatzsteuer-Identifikationsnummer)", format: "9 digits", shape: "DE123456789", pattern: /^DE\d{9}$/, notes: ["Germany does not share the registered name and address through VIES: a check returns valid or not valid only.", "The USt-IdNr. is not the Steuernummer on German invoices; only the USt-IdNr. can be checked in VIES."] },
  { code: "DK", slug: "denmark", country: "Denmark", adjective: "Danish", localName: "momsnummer (CVR-nummer or SE-nummer)", format: "8 digits", shape: "DK12345678", pattern: /^DK\d{8}$/ },
  { code: "EE", slug: "estonia", country: "Estonia", adjective: "Estonian", localName: "KMKR number (käibemaksukohustuslase number)", format: "9 digits", shape: "EE123456789", pattern: /^EE\d{9}$/ },
  { code: "EL", slug: "greece", country: "Greece", adjective: "Greek", localName: "ΑΦΜ (AFM)", format: "9 digits", shape: "EL123456789", pattern: /^EL\d{9}$/, notes: ["Greece's prefix in VIES is EL, not its ISO code GR. A number sent with GR is checked as EL."] },
  { code: "ES", slug: "spain", country: "Spain", adjective: "Spanish", localName: "NIF-IVA (número de identificación fiscal)", format: "9 characters: a letter or digit, 7 digits, a letter or digit", shape: "ESX1234567X", pattern: /^ES[A-Z0-9]\d{7}[A-Z0-9]$/, notes: ["Spain does not share the registered name and address through VIES: a check returns valid or not valid only.", "A Spanish NIF is valid in VIES only when the business is entered in the register of intra-Community operators (ROI)."] },
  { code: "FI", slug: "finland", country: "Finland", adjective: "Finnish", localName: "ALV-numero (arvonlisäverotunniste)", format: "8 digits", shape: "FI12345678", pattern: /^FI\d{8}$/, notes: ["It is the business ID (Y-tunnus) without the hyphen: 0112038-9 becomes FI01120389."], register: "/fi/company" },
  { code: "FR", slug: "france", country: "France", adjective: "French", localName: "numéro de TVA intracommunautaire", format: "a 2-character key (digits, or letters other than O and I) and the 9-digit SIREN", shape: "FR12345678901", pattern: /^FR[0-9A-HJ-NP-Z]{2}\d{9}$/, notes: ["The last 9 digits are the company's SIREN, so the number also identifies it in the Sirene register."], register: "/fr/company" },
  { code: "HR", slug: "croatia", country: "Croatia", adjective: "Croatian", localName: "PDV identifikacijski broj (OIB)", format: "11 digits", shape: "HR12345678901", pattern: /^HR\d{11}$/ },
  { code: "HU", slug: "hungary", country: "Hungary", adjective: "Hungarian", localName: "közösségi adószám", format: "8 digits", shape: "HU12345678", pattern: /^HU\d{8}$/ },
  { code: "IE", slug: "ireland", country: "Ireland", adjective: "Irish", localName: "VAT number", format: "7 digits and 1 or 2 letters, or the older form: a digit, a letter or + or *, 5 digits and a letter", shape: "IE1234567X", pattern: /^IE(\d{7}[A-Z]{1,2}|\d[A-Z+*]\d{5}[A-Z])$/ },
  { code: "IT", slug: "italy", country: "Italy", adjective: "Italian", localName: "Partita IVA", format: "11 digits", shape: "IT12345678901", pattern: /^IT\d{11}$/ },
  { code: "LT", slug: "lithuania", country: "Lithuania", adjective: "Lithuanian", localName: "PVM mokėtojo kodas", format: "9 or 12 digits", shape: "LT123456789", pattern: /^LT(\d{9}|\d{12})$/ },
  { code: "LU", slug: "luxembourg", country: "Luxembourg", adjective: "Luxembourg", localName: "numéro d'identification à la TVA", format: "8 digits", shape: "LU12345678", pattern: /^LU\d{8}$/ },
  { code: "LV", slug: "latvia", country: "Latvia", adjective: "Latvian", localName: "PVN reģistrācijas numurs", format: "11 digits", shape: "LV12345678901", pattern: /^LV\d{11}$/ },
  { code: "MT", slug: "malta", country: "Malta", adjective: "Maltese", localName: "VAT number", format: "8 digits", shape: "MT12345678", pattern: /^MT\d{8}$/ },
  { code: "NL", slug: "netherlands", country: "the Netherlands", adjective: "Dutch", localName: "btw-identificatienummer (btw-id)", format: "9 digits, the letter B and 2 digits", shape: "NL123456789B01", pattern: /^NL\d{9}B\d{2}$/, notes: ["Sole proprietors have a btw-id that differs from their older, citizen-number-based VAT number; the btw-id is the one to check."] },
  { code: "PL", slug: "poland", country: "Poland", adjective: "Polish", localName: "NIP (numer identyfikacji podatkowej)", format: "10 digits", shape: "PL1234567890", pattern: /^PL\d{10}$/ },
  { code: "PT", slug: "portugal", country: "Portugal", adjective: "Portuguese", localName: "NIF / NIPC (número de identificação fiscal)", format: "9 digits", shape: "PT123456789", pattern: /^PT\d{9}$/ },
  { code: "RO", slug: "romania", country: "Romania", adjective: "Romanian", localName: "CIF / CUI (cod de identificare fiscală)", format: "2 to 10 digits", shape: "RO12345678", pattern: /^RO\d{2,10}$/ },
  { code: "SE", slug: "sweden", country: "Sweden", adjective: "Swedish", localName: "momsregistreringsnummer", format: "12 digits: the 10-digit organisationsnummer followed by 01", shape: "SE123456789001", pattern: /^SE\d{12}$/, notes: ["The first 10 digits are the organisationsnummer, so 556703-7485 becomes SE556703748501."], register: "/se/company" },
  { code: "SI", slug: "slovenia", country: "Slovenia", adjective: "Slovenian", localName: "identifikacijska številka za DDV", format: "8 digits", shape: "SI12345678", pattern: /^SI\d{8}$/ },
  { code: "SK", slug: "slovakia", country: "Slovakia", adjective: "Slovak", localName: "IČ DPH", format: "10 digits", shape: "SK1234567890", pattern: /^SK\d{10}$/ },
  { code: "XI", slug: "northern-ireland", country: "Northern Ireland", adjective: "Northern Ireland", localName: "VAT registration number (XI prefix)", format: "9 or 12 digits, or GD or HA and 3 digits", shape: "XI123456789", pattern: /^XI(\d{9}|\d{12}|(GD|HA)\d{3})$/, notes: ["Since Brexit only Northern Ireland businesses trading in goods have an XI number in VIES. Numbers with the GB prefix are not in VIES."] },
];

const BY_SLUG = new Map(VAT_COUNTRIES.map((c) => [c.slug, c]));
export const vatCountry = (slug: string) => BY_SLUG.get(slug);
export const VAT_BASE = "/vat-number-check";
export const vatPagePaths = () => [VAT_BASE, ...VAT_COUNTRIES.map((c) => `${VAT_BASE}/${c.slug}`)];

const TOOL = "/vat/validate";
const tool = () => ENDPOINTS.find((e) => e.path === TOOL) as Endpoint;

export const PAGE_STYLE = `:root{--bg:#fff;--fg:#16181d;--muted:#5b616b;--card:#f5f6f8;--line:#e2e5ea;--accent:#0b57d0;--accent-fg:#fff}
@media (prefers-color-scheme:dark){:root{--bg:#111316;--fg:#e9ebee;--muted:#a2a8b0;--card:#1a1d22;--line:#2b3037;--accent:#8ab4f8;--accent-fg:#0b1a33}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.6 system-ui,-apple-system,Segoe UI,sans-serif}
main{max-width:780px;margin:0 auto;padding:28px 16px 56px}nav.crumbs{color:var(--muted);font-size:.9rem;margin-bottom:16px}
h1{font-size:1.9rem;line-height:1.2;margin:0 0 10px}h2{font-size:1.2rem;margin:34px 0 8px}h3{font-size:1rem;margin:18px 0 4px}p{margin:8px 0}a{color:var(--accent)}
.tag{font-size:1.1rem;color:var(--muted);margin:0 0 16px}.btn{display:inline-block;padding:10px 16px;border-radius:8px;border:1px solid var(--line);color:var(--fg);text-decoration:none;font-weight:600}.btn.primary{background:var(--accent);border-color:var(--accent);color:var(--accent-fg)}
pre{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:14px;overflow:auto;font-size:.85rem;line-height:1.5}code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
table{border-collapse:collapse;width:100%;font-size:.94rem}td,th{border-bottom:1px solid var(--line);padding:8px 6px;text-align:left;vertical-align:top}.wrap{overflow-x:auto}
ul{padding-left:20px}footer{margin-top:40px;color:var(--muted);font-size:.9rem}`;

const HOW = "The check asks VIES, the European Commission's VAT Information Exchange System, which in turn asks the member state's own tax database. Valid means the number is registered for intra-EU trade at the moment of the check.";

/**
 * What $1 of card credits buys in checks, from the catalogue: the $1 pack's credits at this tool's key price. Empty
 * when the code has no $1 pack, so the page then says only "from $1".
 */
export function checksPerDollar(e: Endpoint): string {
  const pack = CREDIT_PACKS.find((p) => p.usdCents === 100);
  return pack ? callsAt(pack.credits, keyPrice(e.path, e.price)) : "";
}

/** The plain-words line for an answer the checker cannot show as a result (tests/glyphcall-seo.test.cjs runs it). */
export function checkerOutcome(status: number, trialUnavailable: boolean, perDollar: string): { text: string; buy: boolean } | null {
  const buy = perDollar ? `Buy checks by card: $1 for ${perDollar} checks.` : "Buy checks by card from $1.";
  if (status === 503) return { text: "The EU register is busy. Try again in a moment; nothing was charged.", buy: false };
  if (status === 402 && trialUnavailable) return { text: `Free checks are paused right now. ${buy}`, buy: true };
  if (status === 402) return { text: `Your ${FREE_HTTP_CALLS_PER_CALLER} free checks are used. ${buy}`, buy: true };
  return null;
}

const CHECKER_CSS = "form.vatc .row{display:flex;flex-wrap:wrap;gap:8px}form.vatc .row input{flex:1;min-width:200px}form.vatc .or{color:var(--muted);font-size:.9rem;margin:6px 0}#vatc-out{margin:0 0 24px;padding:12px 14px;border:1px solid var(--line);border-radius:10px;background:var(--card)}#vatc-out[hidden]{display:none}#vatc-out .ok{color:#137333;font-weight:700}#vatc-out .no{color:#b3261e;font-weight:700}@media (prefers-color-scheme:dark){#vatc-out .ok{color:#81c995}#vatc-out .no{color:#f28b82}}";

/**
 * The checker for people (21 Nov 2026). A plain GET form to the tool with trial=1 still works without JavaScript; with
 * it, the check runs in the page and the answer is shown here in plain words: valid or not with the registered name
 * and address, the register being busy (503), the free checks used up (402) or paused by the operator (402 with
 * X-Free-Trial-Unavailable), each with what to do next. Before, a person whose free checks were used landed on the
 * developer paywall page and was never told why. The fetch asks for JSON; the free checks are counted per caller
 * address whatever the Accept header says (src/index.ts useFreeCall), so the count is the same as the plain form's.
 */
function vatChecker(e: Endpoint, heading: string, prefix = ""): string {
  const perDollar = checksPerDollar(e);
  const lines = { busy: checkerOutcome(503, false, perDollar)!.text, used: checkerOutcome(402, false, perDollar)!.text, paused: checkerOutcome(402, true, perDollar)!.text };
  return `<form class="try vatc" method="get" action="${esc(e.path)}" id="vatc">
<h2>${esc(heading)}</h2>
<div class="field"><label for="vatc-vat">VAT number, e.g. SE556677889901</label><div class="row"><input id="vatc-vat" name="vat" type="text" value="${esc(prefix)}" autocomplete="off" spellcheck="false" inputmode="text"></div></div>
<p class="or">No number? Check by company name instead:</p>
<div class="field"><label for="vatc-name">Company name <span class="opt">(found or not in the French, Swedish, Norwegian and Finnish registers)</span></label><input id="vatc-name" name="name" type="text" autocomplete="off"></div>
<input type="hidden" name="trial" value="1">
<button type="submit" class="btn primary" data-ev="vat_check">Check</button>
<p class="small">Free: ${FREE_HTTP_CALLS_PER_CALLER} checks, no account. A check that fails is not counted.</p>
</form>
<div id="vatc-out" role="status" aria-live="polite" hidden></div>
<script>(()=>{const f=document.getElementById("vatc"),out=document.getElementById("vatc-out"),L=${JSON.stringify(lines).replace(/</g, "\\u003c")};
const esc=(s)=>String(s).replace(/[&<>"']/g,(c)=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);
const show=(h)=>{out.innerHTML=h;out.hidden=false;};const buy=(t)=>show("<p>"+esc(t)+' <a href="/credits">Buy checks by card</a></p>');
f.addEventListener("submit",async(ev)=>{const q=new URLSearchParams();for(const [k,v] of new FormData(f)){if(String(v).trim())q.set(k,String(v).trim());}
if(!q.has("vat")&&!q.has("name")){ev.preventDefault();show("<p>Type a VAT number, or a company name.</p>");return;}
ev.preventDefault();q.set("trial","1");const b=f.querySelector("button");b.disabled=true;show("<p>Checking...</p>");
try{const r=await fetch(f.action+"?"+q,{headers:{accept:"application/json"}});
if(r.status===503){show("<p>"+esc(L.busy)+"</p>");return;}
if(r.status===402){buy(r.headers.get("x-free-trial-unavailable")?L.paused:L.used);return;}
const d=await r.json().catch(()=>({}));const left=r.headers.get("x-free-trial-remaining");const tail=left!==null?'<p class="small">'+esc(left)+" free checks left.</p>":"";
if(!r.ok){show("<p>"+esc(d.error||"That check did not work.")+" Nothing was charged.</p>"+tail);return;}
if("valid" in d){show('<p class="'+(d.valid?"ok":"no")+'">'+(d.valid?"Valid":"Not valid")+": "+esc(d.vat||q.get("vat"))+"</p>"+(d.name?"<p>"+esc(d.name)+"</p>":"")+(d.address?"<p>"+esc(d.address)+"</p>":"")+tail);return;}
if("found" in d){const m=(d.matches||d.companies||[])[0];show('<p class="'+(d.found?"ok":"no")+'">'+(d.found?"Found":"Not found")+": "+esc(q.get("name"))+"</p>"+(m&&m.name?"<p>"+esc(m.name)+"</p>":"")+tail);return;}
show("<pre>"+esc(JSON.stringify(d,null,2))+"</pre>"+tail);}catch{show("<p>The check could not be reached. Try again in a moment; nothing was charged.</p>");}finally{b.disabled=false;}});})();</script>`;
}

/** The page for one country. `tryIt`: a browser may run the check free here. */
export function vatCountryPage(c: VatCountry, origin: string, tryIt: boolean, brand: string = SERVICE_NAME): string {
  const e = tool();
  const url = `${origin}${VAT_BASE}/${c.slug}`;
  const title = seoTitle([`VIES VAT number validation for ${c.country.replace(/^the /, "")}`, `${c.adjective} VAT number validation (VIES)`], brand);
  const description = metaDescription(`Free VIES validation of a ${c.adjective} VAT number (${c.localName}): ${c.code} followed by ${c.format}. Check one here, with the registered name and address.`);
  const register = c.register ? ENDPOINTS.find((o) => o.path === c.register) : undefined;
  const faq: [string, string][] = [
    [`What does a ${c.adjective} VAT number look like?`, `${c.code} followed by ${c.format}, for example ${c.shape} (an example of the shape, not a real registration). Locally it is called ${c.localName}.`],
    [`How do I check that a ${c.adjective} VAT number is valid?`, `Enter it on this page, or send it to the API. ${HOW}`],
    ["Why would a real number come back as not valid?", "The business may not be registered for intra-EU trade, the registration may have ended, or the number may be written with the wrong prefix or a missing digit. A member state's database can also be unavailable for a short time; the check then fails instead of answering not valid."],
    ...(c.notes ?? []).map((n, i) => [i === 0 ? `What is special about ${c.country}?` : `Anything else to know about ${c.country}?`, n] as [string, string]),
  ];
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(url)}">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(description)}"><meta property="og:url" content="${esc(url)}"><meta property="og:image" content="${esc(origin)}/og.png">
<link rel="icon" href="/favicon.ico">
<script type="application/ld+json">${jsonLd({ "@context": "https://schema.org", "@type": "FAQPage", mainEntity: faq.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })) })}</script>
<style>${PAGE_STYLE}${tryIt ? TRY_FORM_CSS + CHECKER_CSS : ""}</style></head><body><main>
<nav class="crumbs"><a href="/">${esc(brand)}</a> › <a href="/company-check-api">Company check API</a> › <a href="${VAT_BASE}">VAT number check</a></nav>
<h1>Check a ${esc(c.adjective)} VAT number</h1>
<p class="tag">Validate a VAT number from ${esc(c.country)} against the EU's VIES service, here or from your own code.</p>
<div class="wrap"><table>
<tr><th>Country prefix</th><td><code>${esc(c.code)}</code></td></tr>
<tr><th>Local name</th><td>${esc(c.localName)}</td></tr>
<tr><th>Format</th><td><code>${esc(c.code)}</code> followed by ${esc(c.format)}</td></tr>
<tr><th>Shape</th><td><code>${esc(c.shape)}</code> (an example of the shape, not a real registration)</td></tr>
<tr><th>Pattern</th><td><code>${esc(c.pattern.source)}</code></td></tr>
</table></div>
${c.notes?.length ? `<h2>Good to know about ${esc(c.country)}</h2><ul>${c.notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>` : ""}
${tryIt ? vatChecker(e, `Check a ${c.adjective} VAT number now`, `${c.code}`) : `<p><a class="btn primary" href="/company-check-api">Check a VAT number</a></p>`}
<h2>How the check works</h2>
<p>${esc(HOW)} Where the member state shares them, the answer also carries the registered name and address. Spaces, dots and hyphens in the number are ignored.</p>
<h2>From your code</h2>
<pre><code>curl -H "Authorization: Bearer $API_KEY" \\
  "${esc(origin)}${TOOL}?vat=${esc(c.shape)}"</code></pre>
<p>One GET request, JSON back: <code>valid</code>, and the registered name and address when they are shared. A failed check is never charged. Keys, monthly plans and code in Python and Node.js: <a href="/company-check-api">Company check API</a>. Reference: <a href="/tools/${esc(toolSlug(TOOL))}">tool page</a>.</p>
${register ? `<h2>The ${esc(c.adjective)} company register</h2><p>For more than the VAT status, look the company up in the register: <a href="/company-register/${esc(c.slug)}">${esc(register.summary)}</a>. Legal form, status, bankruptcy or liquidation, registration date, industry codes and address.</p>` : ""}
<h2>Questions</h2>
${faq.map(([q, a]) => `<h3>${esc(q)}</h3><p>${esc(a)}</p>`).join("")}
<h2>Other countries</h2>
<p>${VAT_COUNTRIES.filter((o) => o !== c).map((o) => `<a href="${VAT_BASE}/${esc(o.slug)}">${esc(o.country.replace(/^the /, ""))}</a>`).join(" · ")}</p>
<footer><a href="/company-check-api">Company check API</a> · <a href="/tools">All ${TOOL_COUNT} tools</a> · ${COMPANY_FOOTER}</footer>
</main></body></html>`;
}

/** /vat-number-check: every country's format in one table, and the check. */
export function vatIndexPage(origin: string, tryIt: boolean, brand: string = SERVICE_NAME): string {
  const e = tool();
  const url = `${origin}${VAT_BASE}`;
  const title = seoTitle(["Free VIES VAT number validation: check any EU VAT number", "Free VIES VAT number validation"], brand);
  const description = metaDescription(`Free VIES VAT number validation for every EU country and Northern Ireland: valid or not, with the registered name and address, and each country's format.`);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(url)}">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(description)}"><meta property="og:url" content="${esc(url)}"><meta property="og:image" content="${esc(origin)}/og.png">
<link rel="icon" href="/favicon.ico">
<style>${PAGE_STYLE}${tryIt ? TRY_FORM_CSS + CHECKER_CSS : ""}</style></head><body><main>
<nav class="crumbs"><a href="/">${esc(brand)}</a> › <a href="/company-check-api">Company check API</a></nav>
<h1>Free VIES VAT number validation</h1>
<p class="tag">Validate a VAT number from any EU member state or Northern Ireland against VIES, and see how each country writes its numbers.</p>
${tryIt ? vatChecker(e, "Check a VAT number now") : `<p><a class="btn primary" href="/company-check-api">Check a VAT number</a></p>`}
<h2>VAT number formats by country</h2>
<div class="wrap"><table><tr><th>Country</th><th>Prefix</th><th>After the prefix</th><th>Local name</th></tr>
${VAT_COUNTRIES.map((c) => `<tr><td><a href="${VAT_BASE}/${esc(c.slug)}">${esc(c.country.replace(/^the /, ""))}</a></td><td><code>${esc(c.code)}</code></td><td>${esc(c.format)}</td><td>${esc(c.localName)}</td></tr>`).join("\n")}
</table></div>
<h2>How the check works</h2>
<p>${esc(HOW)} Norway, Switzerland and Great Britain are not in VIES; for Norway use the <a href="/tools/no-company">Norwegian company register lookup</a>.</p>
<h2>From your code</h2>
<pre><code>curl -H "Authorization: Bearer $API_KEY" \\
  "${esc(origin)}${TOOL}?vat=SE556703748501"</code></pre>
<p>Keys, monthly plans and code in Python and Node.js: <a href="/company-check-api">Company check API</a>. The API reference: <a href="/tools/vat-validate">VIES VAT validation API</a>.</p>
<footer><a href="/company-check-api">Company check API</a> · <a href="/tools">All ${TOOL_COUNT} tools</a> · ${COMPANY_FOOTER}</footer>
</main></body></html>`;
}
