// /claims/check: Sann, the green-claims checker. Finds environmental claims in shop copy and flags each one against
// Directive (EU) 2024/825 (amending the UCPD), with the rule cited and what to do. Rules only: no AI, no outside source.
// The engine lives in src/lib/sann (generated from the sann-engine repo; edit it there).
import { entry, need, opt, type Entry } from "../family";
import { HttpError } from "../lib/env";
import { check, ruleText, noteText, RULESET_VERSION } from "../lib/sann/index";

export const CLAIMS_MAX = 20_000;
const LANG_HINTS = new Set(["en", "sv", "de", "fr", "es"]);

export function claimsCheck(text: string, lang?: string, explain?: string) {
  const hint = lang && LANG_HINTS.has(lang.toLowerCase()) ? lang.toLowerCase() : undefined;
  if (lang && !hint) throw new HttpError(400, "lang must be one of en, sv, de, fr, es");
  // Explanations in Swedish or English; Swedish only when asked or when the hint is Swedish.
  const out = explain === "sv" || (!explain && hint === "sv") ? "sv" : "en";
  const r = check(text, { lang: hint });
  return {
    verdict: r.counts.high ? "fix" : r.counts.medium ? "check" : "ok",
    counts: r.counts,
    findings: r.findings.map((f: any) => ({
      text: f.text,
      start: f.start,
      end: f.end,
      severity: f.severity,
      sentence: f.sentence.text,
      rules: f.rules.map((x: any) => {
        const t = ruleText(x.id, out)!;
        return { id: x.id, severity: x.severity, title: t.title, why: t.why, fix: t.fix, law: t.ref, notes: x.notes.map((n: string) => noteText(n, out)) };
      }),
    })),
    languages: r.languages,
    truncated: r.truncated,
    rules: RULESET_VERSION,
    disclaimer: out === "sv"
      ? "Riskflaggor med regeln angiven, inte juridisk rådgivning. Bilder, färger och logotyper granskas inte."
      : "Risk flags with the rule cited, not legal advice. Images, colours and logos are not checked.",
  };
}

export const CLAIMS: Entry[] = [
  entry("/claims/check", "Green claims checker: greenwashing check for product text (EU 2024/825)",
    "Check product copy or page text (up to 20,000 characters; English, Swedish, German, French, Spanish) for environmental claims the EU bans since 27 Sep 2026: generic claims ('eco-friendly'), offset-based 'climate neutral', own labels, whole-product claims, future promises, legal requirements sold as features. Returns each finding with severity, the rule cited and a fix. Rules only, not legal advice. Use before publishing shop copy.",
    ["greenwashing", "green-claims", "compliance", "eu-law", "ecommerce"],
    {
      text: { type: "string", description: "The product text to check (up to 20,000 characters)", required: true, example: "Our eco-friendly bamboo toothbrush is climate neutral thanks to tree planting. Packaging: 100% recycled cardboard." },
      lang: { type: "string", description: "Language of the text if known: en, sv, de, fr or es (detected otherwise; English is always checked too)", example: "en" },
      explain: { type: "string", description: "Language of the explanations: en (default) or sv", example: "en" },
    },
    {
      verdict: "fix", counts: { high: 2, medium: 0, info: 0 },
      findings: [{ text: "eco-friendly", start: 4, end: 16, severity: "high", sentence: "Our eco-friendly bamboo toothbrush is climate neutral thanks to tree planting.", rules: [{ id: "GENERIC", severity: "high", title: "Generic environmental claim", why: "Vague words such as 'eco-friendly' … are banned …", fix: "Remove the word, or replace it with the specific fact you can prove …", law: "UCPD Annex I point 4a and Art. 2(p), added by Directive (EU) 2024/825", notes: [] }] }],
      languages: ["en"], truncated: false, rules: RULESET_VERSION, disclaimer: "Risk flags with the rule cited, not legal advice. Images, colours and logos are not checked.",
    },
    (_env, q) => claimsCheck(need(q, "text", CLAIMS_MAX), opt(q, "lang", 5), opt(q, "explain", 5)),
    "$0.02"),
];
