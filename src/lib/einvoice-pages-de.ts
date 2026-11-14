// German versions of the e-invoice pages (14 Nov 2026): /de/e-rechnung, /de/e-rechnung/regeln and one page per rule.
// Why German: the duty to issue e-invoices is German law, an XRechnung is rejected with German messages, and the
// person fixing it searches in German. Same facts as the English pages (lib/einvoice-pages.ts), same rule table;
// only the wording differs (lib/einvoice/rules-de.ts). The two versions name each other with hreflang links.
import { ENDPOINTS, SERVICE_NAME, toolSlug, type Endpoint } from "../endpoints";
import { COMPANY_FOOTER } from "./legal";
import { PAGE_STYLE } from "./vat-pages";
import { TRY_FORM_CSS } from "./try-form";
import { RULES, ruleSlug, type RuleDoc } from "./einvoice/validate";
import { ruleDe, TERMS_DE } from "./einvoice/rules-de";
import { EINVOICE_BASE, EINVOICE_BASE_DE, EINVOICE_RULES, EINVOICE_RULES_DE, TERMS, languageLinks, termsOf } from "./einvoice-pages";
import { EXAMPLE_INVOICE_JSON, SAMPLE_XRECHNUNG } from "../routes/einvoice";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const jsonLd = (value: unknown) => JSON.stringify(value).replace(/</g, "\\u003c");
const tool = (path: string) => ENDPOINTS.find((e) => e.path === path) as Endpoint;

const head = (title: string, description: string, enPath: string, dePath: string, origin: string, extra = "") => `<!doctype html>
<html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(origin + dePath)}">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(description)}"><meta property="og:url" content="${esc(origin + dePath)}"><meta property="og:image" content="${esc(origin)}/og.png"><meta property="og:locale" content="de_DE">
<link rel="icon" href="/favicon.ico">${languageLinks(origin, enPath)}${extra}
<style>${PAGE_STYLE}${TRY_FORM_CSS}</style></head><body><main>`;
const foot = () => `<footer><a href="${EINVOICE_BASE_DE}">E-Rechnungs-API</a> · <a href="${EINVOICE_RULES_DE}">Alle Prüfregeln</a> · <a href="/tools">Alle ${ENDPOINTS.length} Tools (englisch)</a> · ${COMPANY_FOOTER}</footer>
</main></body></html>`;

const validatorForm = (label: string) => `<form class="try" method="post" action="/einvoice/validate?trial=1" enctype="multipart/form-data">
<h2>${esc(label)}</h2>
<div class="field"><label for="einv-file">Eine XRechnung-, ZUGFeRD- oder Factur-X-Datei von Ihrem Rechner (XML oder das PDF mit eingebetteter XML)</label><input id="einv-file" name="file" type="file" accept=".xml,.pdf,application/xml,text/xml,application/pdf" required><small>Bis 5 MB. Die Datei wird nur für diese eine Anfrage im Arbeitsspeicher gelesen und nicht gespeichert. Das Ergebnis erscheint auf Englisch.</small></div>
<button type="submit" class="btn primary">E-Rechnung prüfen</button>
</form>`;

const standardName = (r: RuleDoc) => (r.standard === "XRechnung" ? "XRechnung 3.0 (die deutsche CIUS der EN 16931, herausgegeben von der KoSIT)" : "EN 16931-1, die europäische Norm für elektronische Rechnungen");
const termName = (t: string) => TERMS_DE[t] ?? TERMS[t][0];

/** One rule's German page. `tryIt`: a browser may run the validator free here. */
export function einvoiceRulePageDe(r: RuleDoc, origin: string, tryIt: boolean, brand: string = SERVICE_NAME): string {
  const [rule, fix] = ruleDe(r) ?? [r.rule, r.fix];
  const slug = ruleSlug(r.id);
  const terms = termsOf(r);
  const names = terms.map(termName).join(", ");
  const kind = r.level === "error" ? "Fehler" : "Warnung";
  const title = `${r.id}: ${rule.replace(/\.$/, "")} · ${r.standard === "XRechnung" ? "XRechnung" : "E-Rechnung"}: ${kind} und Lösung`.slice(0, 160);
  const description = `Was ${r.id} in einer ${r.standard === "XRechnung" ? "XRechnung" : "E-Rechnung nach EN 16931 (XRechnung, ZUGFeRD, Factur-X, Peppol)"} bedeutet, welches XML-Element in CII und UBL betroffen ist und wie Sie den Fehler beheben. Datei hier prüfen.`;
  const related = RULES.filter((o) => o !== r && o.field.split(",").some((f) => terms.includes(f.trim()))).slice(0, 8);
  const faq: [string, string][] = [
    [`Was bedeutet ${r.id}?`, `${rule} Die Regel stammt aus ${standardName(r)}.`],
    [`Wie behebe ich ${r.id}?`, fix],
    [`Ist ${r.id} ein Fehler oder eine Warnung?`, r.level === "error" ? "Ein Fehler: Ein Validator meldet die Rechnung als nicht konform, und ein Empfänger, der eingehende E-Rechnungen prüft, kann sie zurückweisen." : "Eine Warnung: Die Rechnung bleibt konform, der Wert sollte aber korrigiert werden."],
    ...(r.standard === "XRechnung" ? [[`Gilt ${r.id} auch für ZUGFeRD und Factur-X?`, "Nur wenn die Datei die Spezifikationskennung der XRechnung trägt (das ZUGFeRD-Profil „XRECHNUNG“ tut das). Dateien im reinen EN-16931-Profil werden gegen die europäischen Regeln geprüft, nicht gegen die deutschen Ergänzungen."] as [string, string]] : []),
  ];
  return `${head(title, description, `${EINVOICE_RULES}/${slug}`, `${EINVOICE_RULES_DE}/${slug}`, origin, `\n<script type="application/ld+json">${jsonLd({ "@context": "https://schema.org", "@type": "FAQPage", inLanguage: "de", mainEntity: faq.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })) })}</script>`)}
<nav class="crumbs"><a href="/">${esc(brand)}</a> › <a href="${EINVOICE_BASE_DE}">E-Rechnungs-API</a> › <a href="${EINVOICE_RULES_DE}">Prüfregeln</a> · <a href="${EINVOICE_RULES}/${slug}" hreflang="en" lang="en">English</a></nav>
<h1>${esc(r.id)}: Bedeutung und Lösung</h1>
<p class="tag">${esc(rule)}</p>
<div class="wrap"><table>
<tr><th>Regel</th><td><code>${esc(r.id)}</code></td></tr>
<tr><th>Standard</th><td>${esc(standardName(r))}</td></tr>
<tr><th>Schweregrad</th><td>${r.level === "error" ? "Fehler (die Rechnung ist nicht konform)" : "Warnung"}</td></tr>
<tr><th>Betrifft</th><td>${esc(r.field)}${names ? `: ${esc(names)}` : ""}</td></tr>
</table></div>
<h2>So beheben Sie den Fehler</h2>
<p>${esc(fix)}</p>
${terms.length ? `<h2>Wo das Feld in der XML steht</h2>
<div class="wrap"><table><tr><th>Feld</th><th>CII (XRechnung-CII, ZUGFeRD, Factur-X)</th><th>UBL (XRechnung-UBL, Peppol)</th></tr>
${terms.map((t) => `<tr><td>${esc(t)}<br>${esc(termName(t))}</td><td><code>${esc(TERMS[t][1])}</code></td><td><code>${esc(TERMS[t][2])}</code></td></tr>`).join("\n")}
</table></div>` : ""}
${tryIt ? validatorForm("Eigene Datei auf diese Regel prüfen") : `<p><a class="btn primary" href="${EINVOICE_BASE_DE}">E-Rechnung prüfen</a></p>`}
<h2>Aus Ihrem Code</h2>
<pre><code>curl -H "Authorization: Bearer $API_KEY" -H "Content-Type: application/xml" \\
  --data-binary @rechnung.xml "${esc(origin)}/einvoice/validate"</code></pre>
<p>Die Antwort nennt jede verletzte Regel mit Nummer, Feld, einer Meldung mit den Zahlen aus Ihrer Datei und der Lösung (auf Englisch). <a href="${EINVOICE_BASE_DE}">E-Rechnungs-API</a>: prüfen, in JSON umwandeln und XRechnung- oder ZUGFeRD-XML aus JSON erstellen.</p>
<h2>Fragen</h2>
${faq.map(([q, a]) => `<h3>${esc(q)}</h3><p>${esc(a)}</p>`).join("")}
${related.length ? `<h2>Verwandte Regeln</h2><ul>${related.map((o) => `<li><a href="${EINVOICE_RULES_DE}/${ruleSlug(o.id)}">${esc(o.id)}</a>: ${esc((ruleDe(o) ?? [o.rule])[0])}</li>`).join("")}</ul>` : ""}
<p class="small">Die Regelnummern sind die von ${esc(r.standard === "XRechnung" ? "XRechnung 3.0 (KoSIT)" : "EN 16931-1")}; die Erläuterung stammt von uns. Keine Steuer- oder Rechtsberatung.</p>
${foot()}`;
}

/** /de/e-rechnung/regeln: every rule the validator runs, in German. */
export function einvoiceRulesIndexPageDe(origin: string, brand: string = SERVICE_NAME): string {
  const groups: [string, RuleDoc[]][] = [
    ["XRechnung-Regeln (BR-DE)", RULES.filter((r) => r.standard === "XRechnung")],
    ["Pflichtangaben (BR)", RULES.filter((r) => /^BR-\d/.test(r.id))],
    ["Summen und Konsistenz (BR-CO)", RULES.filter((r) => r.id.startsWith("BR-CO"))],
    ["Umsatzsteuerkategorien (BR-S, BR-Z, BR-E, BR-AE, BR-IC, BR-G)", RULES.filter((r) => /^BR-(S|Z|E|AE|IC|G)-/.test(r.id))],
    ["Nachkommastellen (BR-DEC)", RULES.filter((r) => r.id.startsWith("BR-DEC"))],
  ];
  const title = `XRechnung-Fehler erklärt: ${RULES.length} Prüfregeln (BR-DE, BR-CO, EN 16931) mit Lösung · ${brand}`;
  const description = "Was jede Fehlermeldung bei der Prüfung einer E-Rechnung bedeutet und wie Sie sie beheben: die BR-DE-Regeln der XRechnung und die BR-, BR-CO- und Umsatzsteuerregeln der EN 16931, die auch für ZUGFeRD, Factur-X und Peppol gelten.";
  return `${head(title, description, EINVOICE_RULES, EINVOICE_RULES_DE, origin)}
<nav class="crumbs"><a href="/">${esc(brand)}</a> › <a href="${EINVOICE_BASE_DE}">E-Rechnungs-API</a> · <a href="${EINVOICE_RULES}" hreflang="en" lang="en">English</a></nav>
<h1>Prüfregeln für E-Rechnungen, verständlich erklärt</h1>
<p class="tag">Die ${RULES.length} Geschäftsregeln, die unser Validator bei XRechnung, ZUGFeRD, Factur-X und anderen Rechnungen nach EN 16931 prüft: Bedeutung, Position des Feldes in der XML und Lösung.</p>
${groups.map(([name, list]) => `<h2>${esc(name)}</h2>
<div class="wrap"><table><tr><th>Regel</th><th>Was sie verlangt</th></tr>
${list.map((r) => `<tr><td><a href="${EINVOICE_RULES_DE}/${ruleSlug(r.id)}"><code>${esc(r.id)}</code></a></td><td>${esc((ruleDe(r) ?? [r.rule])[0])}</td></tr>`).join("\n")}
</table></div>`).join("\n")}
<p>Das ist eine Teilmenge der beiden Standards: die Regeln, gegen die eine gewöhnliche Rechnung mit Positionen, Umsatzsteuer und Überweisung verstoßen kann. Regeln zu Nachlässen und Zuschlägen, Anhängen, Karten- und Lastschriftzahlungen werden nicht geprüft.</p>
${foot()}`;
}

/** /de/e-rechnung: the German product page of the three tools. */
export function einvoiceIndexPageDe(origin: string, tryIt: boolean, brand: string = SERVICE_NAME): string {
  const create = tool("/einvoice/create"), validate = tool("/einvoice/validate"), toJson = tool("/einvoice/to-json");
  const title = `E-Rechnungs-API: XRechnung, ZUGFeRD und Factur-X erstellen, prüfen und umwandeln · ${brand}`;
  const description = "XRechnung- und ZUGFeRD-/Factur-X-XML aus JSON erstellen, E-Rechnungen gegen die Geschäftsregeln von EN 16931 und XRechnung prüfen und E-Rechnungs-XML in JSON umwandeln. Je ein HTTP-Aufruf, ohne eigene Bibliothek.";
  const faq: [string, string][] = [
    ["Welche Formate werden unterstützt?", "XRechnung 3.0 in beiden Syntaxen (UN/CEFACT CII und UBL), die XML von ZUGFeRD 2.x und Factur-X im Profil EN 16931 sowie andere Rechnungen nach EN 16931 in UBL oder CII, etwa Peppol BIS Billing 3.0. Ein ZUGFeRD- oder Factur-X-PDF können Sie unverändert senden: Die eingebettete XML wird gelesen."],
    ["Wird auch das ZUGFeRD-PDF erzeugt?", "Ja, mit dem Format zugferd-pdf: eine lesbare A4-Rechnung mit eingebetteter factur-x.xml, aufgebaut nach PDF/A-3b mit eingebetteten Schriften. Das Layout ist schlicht und fest vorgegeben (kein Logo, kein eigenes Design), und die Datei wurde nicht von einem PDF/A-Validator zertifiziert. Eine XML in ein von Ihnen erzeugtes PDF einzubetten ist nicht möglich."],
    ["Ist das der offizielle Validator?", "Nein. Geprüft wird eine Teilmenge der Geschäftsregeln von EN 16931 und XRechnung 3.0, aufgelistet auf der Regelseite, und jeder Verstoß wird erklärt. Eine Datei, die hier besteht, kann beim offiziellen KoSIT-Validator trotzdem durchfallen, denn dieser prüft zusätzlich das XML-Schema und alle Codelisten."],
    ["Ab wann müssen Unternehmen in Deutschland E-Rechnungen ausstellen?", "Nach dem Rechtsstand vom 14. November 2026: Unternehmen mit mehr als 800.000 Euro Vorjahresumsatz ab dem 1. Januar 2027, alle Unternehmen ab dem 1. Januar 2028, jeweils für Rechnungen zwischen inländischen Unternehmen. Der Empfang von E-Rechnungen ist seit dem 1. Januar 2025 Pflicht. Eine Verschiebung wurde vorgeschlagen; klären Sie den aktuellen Stand mit Ihrer Steuerberatung."],
    ["Werden meine Rechnungen gespeichert?", "Nein. Eine Datei wird nur für die eine Anfrage im Arbeitsspeicher gelesen und weder gespeichert noch protokolliert."],
    ["In welcher Sprache antwortet die API?", "Die Feldnamen und Meldungen der API sind englisch; die Regelnummern (BR-DE-15, BR-CO-15 …) sind dieselben wie in jedem anderen Validator. Jede Regel ist auf diesen Seiten auf Deutsch erklärt."],
  ];
  return `${head(title, description, EINVOICE_BASE, EINVOICE_BASE_DE, origin, `\n<script type="application/ld+json">${jsonLd({ "@context": "https://schema.org", "@type": "FAQPage", inLanguage: "de", mainEntity: faq.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })) })}</script>`)}
<nav class="crumbs"><a href="/">${esc(brand)}</a> · <a href="${EINVOICE_BASE}" hreflang="en" lang="en">English</a></nav>
<h1>E-Rechnungs-API: erstellen, prüfen, umwandeln</h1>
<p class="tag">XRechnung, ZUGFeRD und Factur-X mit je einem HTTP-Aufruf, für Shops, ERP-Systeme, Automatisierungen und KI-Agenten, die keine Java- oder Node-Bibliothek betreiben können.</p>
<div class="wrap"><table>
<tr><th><a href="/tools/${esc(toolSlug(create.path))}">Erstellen</a></th><td>JSON hinein (Verkäufer, Käufer, Positionen, Steuersatz, IBAN), XRechnung-XML oder ein ZUGFeRD-/Factur-X-PDF heraus. Positionssummen, Umsatzsteueraufschlüsselung und Gesamtbeträge werden berechnet und vorab geprüft.</td></tr>
<tr><th><a href="/tools/${esc(toolSlug(validate.path))}">Prüfen</a></th><td>Jede verletzte Geschäftsregel mit ihrer Nummer (BR-DE-15, BR-CO-15), den Zahlen aus Ihrer Datei und der Lösung. <a href="${EINVOICE_RULES_DE}">${RULES.length} Regeln</a>.</td></tr>
<tr><th><a href="/tools/${esc(toolSlug(toJson.path))}">In JSON umwandeln</a></th><td>Eine eingehende E-Rechnung (XML oder das PDF mit eingebetteter XML) als JSON: Parteien, Positionen, Umsatzsteuer, Summen, Bankverbindung. Exakte Werte, ohne KI.</td></tr>
</table></div>
${tryIt ? validatorForm("E-Rechnung jetzt prüfen") : ""}
<h2>Eine XRechnung aus JSON erstellen</h2>
<pre><code>curl -X POST "${esc(origin)}/einvoice/create" \\
  -H "Authorization: Bearer $API_KEY" -H "Content-Type: application/json" \\
  -d '${esc(JSON.stringify({ format: "xrechnung", invoice: JSON.parse(EXAMPLE_INVOICE_JSON) }, null, 1))}'</code></pre>
<p><code>format</code>: <code>xrechnung</code> (CII), <code>xrechnung-ubl</code>, <code>zugferd-pdf</code> (eine lesbare PDF/A-3-Rechnung mit eingebetteter XML, zurückgegeben als <code>pdfBase64</code>), <code>zugferd</code> (nur die factur-x.xml) oder <code>ubl</code>. Daten, die gegen eine Regel verstoßen, werden mit den Regelnummern abgelehnt und nicht berechnet. <code>buyerReference</code> ist die Käuferreferenz, bei öffentlichen Auftraggebern die Leitweg-ID.</p>
<h2>Eine Datei prüfen oder umwandeln</h2>
<pre><code>curl -H "Authorization: Bearer $API_KEY" -H "Content-Type: application/xml" \\
  --data-binary @rechnung.xml "${esc(origin)}/einvoice/validate"

curl -H "Authorization: Bearer $API_KEY" \\
  "${esc(origin)}/einvoice/to-json?url=${esc(encodeURIComponent(SAMPLE_XRECHNUNG))}"</code></pre>
<h2>Auch Papier- und PDF-Rechnungen lesen</h2>
<p>Eine Rechnung, die nur als PDF oder Scan vorliegt, enthält keine XML zum Umwandeln. Die <a href="/invoice-data-extraction-api">Rechnungsdaten-Extraktion</a> (englische Seite) liest ihre Felder als JSON, und diese Felder können unverändert an „Erstellen“ übergeben werden.</p>
<h2>Preise</h2>
<p>Jeder Aufruf zählt als ein gewöhnlicher Aufruf Ihres Schlüssels. Schlüssel und Monatspläne: <a href="/credits">Preise</a> (englisch). Ein fehlgeschlagener oder abgelehnter Aufruf wird nie berechnet.</p>
<h2>Was die API nicht tut</h2>
<ul><li>Das ZUGFeRD-/Factur-X-PDF hat ein schlichtes, festes Layout: kein Logo, kein eigenes Design, und keine Einbettung der XML in Ihr eigenes PDF.</li><li>Kein Versand: keine Übermittlung an Peppol, an eine französische Plattform oder an ein Rechnungseingangsportal der Verwaltung.</li><li>Nicht der offizielle KoSIT-Validator und keine Steuerberatung.</li><li>Nachlässe und Zuschläge, Anhänge, Karten- und Lastschriftzahlungen werden nicht geschrieben, und ihre Regeln werden nicht geprüft.</li></ul>
<h2>Fragen</h2>
${faq.map(([q, a]) => `<h3>${esc(q)}</h3><p>${esc(a)}</p>`).join("")}
${foot()}`;
}
