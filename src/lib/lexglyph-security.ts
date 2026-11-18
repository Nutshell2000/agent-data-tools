// LexGlyph's security and confidentiality page (18 Nov 2026, Phase A of the law-firm plan): the first question a law
// firm asks is where client information goes. Every sentence here is checked against our code or Cloudflare's own
// pages (read 18 Nov 2026; the research is in business/lexglyph/lexglyph-law-firm-plan-2026-11-18.md):
// - Questions are not stored by us. The daily allowance keeps a hash of the address for two days (lexglyph-page.ts).
// - Usage counts hold the path without its query (lib/beacon.ts).
// - Cloudflare Workers Logs keep about 1 in 100 requests (wrangler.jsonc head_sampling_rate 0.01), including the URL,
//   for up to 7 days on the Paid plan.
// - The index is a D1 database created with jurisdiction "eu": stored in the EU. Workers AI has no EU-only option on our
//   plan (Cloudflare's Data Localization Suite lists Workers AI as not supported for Regional Services, and its
//   sub-processor list names CoreWeave (US) and Nebius (UK) for Workers AI). Cloudflare: inputs and outputs are not
//   retained after the response and are not used to train models.
// Change this page whenever any of that changes.
import { STYLE } from "./page-style";
import { COMPANY_FOOTER } from "./legal";
import { UI_LANGS, type UiLang } from "./lexglyph-i18n";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const DPA = "https://www.cloudflare.com/cloudflare-customer-dpa/";
const SUBPROCESSORS = "https://www.cloudflare.com/gdpr/subprocessors/cloudflare-services/";
const AI_PRIVACY = "https://developers.cloudflare.com/workers-ai/platform/privacy/";
export const LEXGLYPH_CONTACT = "support@glyphcall.com";

interface Section { h: string; p: string[] }
interface Page { title: string; lead: string; sections: Section[]; back: string }

const en: Page = {
  title: "How LexGlyph handles your questions",
  lead: "Written for lawyers and anyone who must keep client information confidential. Last checked 18 November 2026.",
  sections: [
    { h: "In one paragraph", p: ["We do not save your questions or the answers. The law we search is stored in the EU. The AI step that writes the short summary runs on Cloudflare's network and is not guaranteed to stay inside the EU. So ask about the law in general terms, and leave client names and confidential facts out of the question."] },
    { h: "What happens when you ask", p: [
      "1. Your question reaches our service, which runs on Cloudflare Workers.",
      "2. It is searched against our own index of EU legislation, which is stored in a Cloudflare database created in the EU jurisdiction. A question in another language than English is first put into English by an AI model, for the search only.",
      "3. The question and the provisions found go to an AI model on Cloudflare Workers AI, which writes the summary. We then check every quoted sentence against the official text and drop any that do not match.",
      "4. The page is sent back to you. Nothing about the question is written to our own storage.",
    ] },
    { h: "What is kept, and for how long", p: [
      "Us: no questions, no answers, no account, no cookies. To give every visitor a fair number of free searches a day, we keep a one-way hash of your internet address and a counter for two days. Our usage statistics count which page was opened, never what was asked.",
      "Cloudflare: technical request logs for about 1 in 100 requests, kept for up to 7 days. Because a search is a normal web address, such a log line contains the question.",
      `Cloudflare Workers AI: according to Cloudflare, it does not keep inputs or outputs after it has answered, and does not use them to train AI models (<a href="${AI_PRIVACY}">Cloudflare's Workers AI privacy page</a>).`,
    ] },
    { h: "Where the data is processed", p: [
      "Stored: the legal index is in Cloudflare's EU jurisdiction.",
      `Processed: Cloudflare runs our service and the AI models on its worldwide network. Cloudflare does not offer an EU-only option for Workers AI on our plan, and its sub-processor list names GPU providers in the United States and the United Kingdom for Workers AI (<a href="${SUBPROCESSORS}">sub-processors</a>). Transfers are covered by <a href="${DPA}">Cloudflare's data processing addendum</a>.`,
    ] },
    { h: "AI and accuracy", p: [
      "The summary is written by AI and marked as such. Every sentence must quote the provision it rests on; we check each quote word for word against the official text before it is shown. LexGlyph is a search tool, not legal advice, and only the Official Journal of the European Union is authentic.",
    ] },
    { h: "For law firms", p: [
      `If your firm needs processing that stays inside the EU, a written data processing agreement, or a pilot, write to <a href="mailto:${LEXGLYPH_CONTACT}">${LEXGLYPH_CONTACT}</a>.`,
    ] },
  ],
  back: "Back to LexGlyph",
};

const sv: Page = {
  title: "Så hanterar LexGlyph dina frågor",
  lead: "Skrivet för jurister och alla som måste hålla klientuppgifter konfidentiella. Senast kontrollerat 18 november 2026.",
  sections: [
    { h: "I ett stycke", p: ["Vi sparar inte dina frågor eller svaren. Lagtexten vi söker i lagras inom EU. AI-steget som skriver den korta sammanfattningen körs i Cloudflares nät och stannar inte garanterat inom EU. Fråga därför om rättsläget i allmänna ordalag och lämna klientnamn och konfidentiella uppgifter utanför frågan."] },
    { h: "Vad som händer när du frågar", p: [
      "1. Frågan når vår tjänst, som körs på Cloudflare Workers.",
      "2. Den söks mot vårt eget index över EU-lagstiftning, som lagras i en Cloudflare-databas skapad i EU-jurisdiktionen. En fråga på annat språk än engelska översätts först till engelska av en AI-modell, enbart för sökningen.",
      "3. Frågan och de bestämmelser som hittats går till en AI-modell på Cloudflare Workers AI, som skriver sammanfattningen. Därefter kontrollerar vi varje citerad mening mot den officiella texten och tar bort de som inte stämmer.",
      "4. Sidan skickas tillbaka till dig. Inget om frågan skrivs till vår egen lagring.",
    ] },
    { h: "Vad som sparas, och hur länge", p: [
      "Vi: inga frågor, inga svar, inget konto, inga kakor. För att ge alla ett rimligt antal gratis sökningar per dag sparar vi en envägshash av din internetadress och en räknare i två dagar. Vår användningsstatistik räknar vilken sida som öppnades, aldrig vad som frågades.",
      "Cloudflare: tekniska förfrågningsloggar för ungefär 1 av 100 förfrågningar, sparade i upp till 7 dagar. Eftersom en sökning är en vanlig webbadress innehåller en sådan loggrad frågan.",
      `Cloudflare Workers AI: enligt Cloudflare sparas inte indata eller utdata efter svaret, och de används inte för att träna AI-modeller (<a href="${AI_PRIVACY}">Cloudflares integritetssida för Workers AI</a>).`,
    ] },
    { h: "Var uppgifterna behandlas", p: [
      "Lagring: lagtextindexet finns i Cloudflares EU-jurisdiktion.",
      `Behandling: Cloudflare kör vår tjänst och AI-modellerna i sitt världsomspännande nät. Cloudflare erbjuder inget alternativ där Workers AI stannar inom EU på vår plan, och dess förteckning över underbiträden anger GPU-leverantörer i USA och Storbritannien för Workers AI (<a href="${SUBPROCESSORS}">underbiträden</a>). Överföringar omfattas av <a href="${DPA}">Cloudflares personuppgiftsbiträdesavtal</a>.`,
    ] },
    { h: "AI och tillförlitlighet", p: [
      "Sammanfattningen skrivs av AI och är märkt som det. Varje mening måste citera bestämmelsen den bygger på; vi kontrollerar varje citat ord för ord mot den officiella texten innan det visas. LexGlyph är ett sökverktyg, inte juridisk rådgivning, och endast Europeiska unionens officiella tidning är giltig.",
    ] },
    { h: "För advokatbyråer", p: [
      `Behöver er byrå behandling som stannar inom EU, ett skriftligt personuppgiftsbiträdesavtal eller ett pilotprojekt? Skriv till <a href="mailto:${LEXGLYPH_CONTACT}">${LEXGLYPH_CONTACT}</a>.`,
    ] },
  ],
  back: "Tillbaka till LexGlyph",
};

/** The page in Swedish or English (the other interface languages get English: the legal wording must be exact). */
export function lexglyphSecurityHtml(origin: string, ui: UiLang, lexPath: string): string {
  const lang = ui === "sv" ? "sv" : "en";
  const p = lang === "sv" ? sv : en;
  const url = `${origin}${lexPath}/security${lang === "sv" ? "?lang=sv" : ""}`;
  const body = p.sections.map((s) => `<h2>${esc(s.h)}</h2>${s.p.map((x) => `<p>${x}</p>`).join("")}`).join("\n");
  return `<!doctype html>
<html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(p.title)} | LexGlyph</title>
<meta name="description" content="${esc(p.lead)}">
<link rel="canonical" href="${esc(url)}">
${UI_LANGS.filter((l) => l === "en" || l === "sv").map((l) => `<link rel="alternate" hreflang="${l}" href="${esc(`${origin}${lexPath}/security${l === "sv" ? "?lang=sv" : ""}`)}">`).join("")}
<link rel="icon" href="/favicon.ico">
<style>${STYLE}</style></head><body><main>
<p><a href="${lexPath}?lang=${ui}">← ${esc(p.back)}</a></p>
<h1>${esc(p.title)}</h1>
<p class="lead">${esc(p.lead)}</p>
${body}
<footer>LexGlyph. ${COMPANY_FOOTER}</footer>
</main></body></html>`;
}
